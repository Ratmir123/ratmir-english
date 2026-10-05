import { PLACEMENT_RETAKE_DAYS, type PlacementItem, type PlacementSectionId, type PlacementSectionView, type PlacementTask,
  type PlacementView } from '../../placement/types';
import { ADAPTIVE_MAX_LEVEL_INDEX, SECTION_RULES, levelIndex, maxPlaysFor, type ObjectiveSection } from '../../placement/engine';
import { bankItem, bankPrompt, bankScript, type PlacementBank } from './bank-source';
import { currentObjective, currentSpoken } from './flow';
import { AUDIO_MISSING_NOTE, MIN_SPEECH_SECONDS, ROLEPLAY_MAX_SECONDS, SECTION_INFO, SECTION_ORDER, SITTING, iso,
  type AttemptRecord } from './model';
import { answeredObjective, answeredSpoken } from './records';

/** Typical questions per objective section (audit §2.4 simulation), used only for the time estimate. */
const TYPICAL_QUESTIONS: Record<ObjectiveSection, number> = { listening: 11, reading: 8, language: 14 };
const OBJECTIVE = new Set<PlacementSectionId>(['listening', 'reading', 'language']);

function bankQuestions(bank: PlacementBank, section: ObjectiveSection): number {
  return bank.items.filter(item => item.section === section && levelIndex(item.level) <= ADAPTIVE_MAX_LEVEL_INDEX).length;
}
function estimatedSpeakingTasks(bank: PlacementBank): number {
  const tasks = bank.prompts.filter(prompt => (prompt.kind ?? 'task') === 'task').length;
  if (!tasks) return 0;
  return (bank.prompts.some(prompt => prompt.kind === 'read-aloud') ? 1 : 0) + Math.min(3, tasks)
    + (bank.prompts.some(prompt => !!prompt.followUp?.prompt.trim()) ? 1 : 0);
}
function scriptLines(bank: PlacementBank, attempt: AttemptRecord | null): number {
  const script = attempt?.roleplayScriptId ? bankScript(bank, attempt.roleplayScriptId) : bank.scripts[0];
  return script?.lines.length ?? 0;
}

function answeredIn(attempt: AttemptRecord, id: PlacementSectionId): number {
  if (OBJECTIVE.has(id)) return answeredObjective(attempt, record => record.section === id).length;
  return answeredSpoken(attempt, id as 'speaking' | 'interaction').length;
}

function plannedIn(attempt: AttemptRecord | null, id: PlacementSectionId, bank: PlacementBank): number {
  if (OBJECTIVE.has(id)) {
    const section = id as ObjectiveSection;
    if (attempt?.sections[section].status === 'completed') return answeredIn(attempt, section);
    return Math.min(SECTION_RULES[section].maxQuestions, bankQuestions(bank, section));
  }
  if (id === 'speaking') return attempt?.speakingPlan ? attempt.speakingPlan.length : estimatedSpeakingTasks(bank);
  return scriptLines(bank, attempt);
}

function sectionViews(attempt: AttemptRecord | null, bank: PlacementBank, audioAvailable: boolean): PlacementSectionView[] {
  return SECTION_ORDER.map(id => {
    const info = SECTION_INFO[id];
    const record = attempt?.sections[id];
    const skippedForAudio = !attempt && !audioAvailable && (id === 'listening' || id === 'speaking' || id === 'interaction');
    const answered = attempt ? answeredIn(attempt, id) : 0;
    return { id, title: info.title, description: info.description,
      status: record?.status ?? (skippedForAudio ? 'skipped' : 'pending'),
      answered, planned: Math.max(answered, plannedIn(attempt, id, bank)), minutes: info.minutes, sitting: SITTING[id],
      note: record ? record.note : skippedForAudio ? AUDIO_MISSING_NOTE : null };
  });
}

function remainingMinutes(attempt: AttemptRecord | null, sections: readonly PlacementSectionView[]): number {
  if (attempt && attempt.status !== 'in-progress') return 0;
  const total = sections.reduce((sum, section) => {
    if (section.status === 'completed' || section.status === 'skipped') return sum;
    if (section.status === 'pending') return sum + section.minutes;
    const expected = OBJECTIVE.has(section.id) ? Math.min(section.planned, TYPICAL_QUESTIONS[section.id as ObjectiveSection]) : section.planned;
    return sum + section.minutes * Math.max(0.2, 1 - section.answered / Math.max(1, expected));
  }, 0);
  return total > 0 ? Math.max(1, Math.ceil(total)) : 0;
}

function choiceInstruction(item: PlacementItem, position: 1 | 2, maxPlays: number): string {
  if (item.section === 'listening') {
    const plays = maxPlays > 1 ? 'Её можно прослушать два раза.' : 'Её можно прослушать один раз.';
    return position === 2 ? `Ещё один вопрос к той же записи. ${plays}` : `Прочитай вопрос и варианты, потом включи запись. ${plays}`;
  }
  if (item.section === 'reading') return position === 2 ? 'Ещё один вопрос к тому же тексту.' : 'Прочитай текст и выбери ответ.';
  return item.skill === 'grammar' ? 'Выбери вариант, который подходит грамматически.' : 'Выбери слово или выражение, которое подходит по смыслу.';
}

/** The current task without answer keys, listening scripts or roleplay rubrics. */
export function taskView(attempt: AttemptRecord, bank: PlacementBank): PlacementTask | null {
  if (attempt.status !== 'in-progress') return null;
  const objective = currentObjective(attempt);
  if (objective) {
    const item = bankItem(bank, objective.itemId);
    if (!item) return null;
    const answered = answeredObjective(attempt, record => record.section === item.section).length;
    const maxPlays = maxPlaysFor(item.level);
    return { kind: 'choice', id: item.id, section: item.section, skill: item.skill, index: answered + 1,
      total: Math.max(answered + 1, plannedIn(attempt, item.section, bank)),
      instruction: choiceInstruction(item, objective.position, maxPlays),
      passage: item.section === 'reading' ? item.passage ?? null : null,
      audio: item.section === 'listening' ? { url: `placement/audio/${encodeURIComponent(item.id)}`, maxPlays } : null,
      prompt: item.prompt, options: [...item.options] };
  }
  const spoken = currentSpoken(attempt);
  if (spoken?.section === 'speaking' && spoken.promptId) {
    const prompt = bankPrompt(bank, spoken.promptId);
    const plan = attempt.speakingPlan ?? [];
    if (!prompt) return null;
    const index = Math.max(1, plan.findIndex(entry => entry.taskId === spoken.taskId) + 1);
    const total = Math.max(index, plan.length);
    if (spoken.role === 'F2') {
      if (!prompt.followUp) return null;
      return { kind: 'speaking', id: spoken.taskId, section: 'speaking', index, total,
        instruction: 'Вопрос без подготовки: отвечай сразу, запись начнётся сама.', prompt: prompt.followUp.prompt,
        prepSeconds: 0, minSeconds: MIN_SPEECH_SECONDS, maxSeconds: prompt.followUp.maxSeconds, autoStart: true, followUp: true, readAloud: false };
    }
    const readAloud = spoken.role === 'R0';
    return { kind: 'speaking', id: spoken.taskId, section: 'speaking', index, total, instruction: prompt.instruction,
      prompt: prompt.prompt, prepSeconds: prompt.prepSeconds,
      minSeconds: readAloud ? prompt.minSeconds : Math.max(prompt.minSeconds, MIN_SPEECH_SECONDS),
      maxSeconds: prompt.maxSeconds, autoStart: true, followUp: false, readAloud };
  }
  if (spoken?.section === 'interaction' && spoken.scriptId && spoken.lineIndex !== null) {
    const script = bankScript(bank, spoken.scriptId);
    const line = script?.lines[spoken.lineIndex];
    if (!script || !line) return null;
    return { kind: 'roleplay', id: spoken.taskId, section: 'interaction', index: spoken.lineIndex + 1, total: script.lines.length,
      instruction: script.setup, partnerRole: script.partnerRole,
      partnerLine: { text: line, audioUrl: attempt.audioAvailable ? `placement/audio/${encodeURIComponent(spoken.taskId)}` : null },
      maxSeconds: ROLEPLAY_MAX_SECONDS };
  }
  return null;
}

export function buildPlacementView(input: { active: AttemptRecord | null; completed: readonly AttemptRecord[]; bank: PlacementBank;
  audioAvailable: boolean }): PlacementView {
  const { active, completed, bank } = input;
  const latest = completed.at(-1) ?? null;
  const shown = active ?? latest;
  const sections = sectionViews(shown, bank, input.audioAvailable);
  let result = latest?.result ?? null;
  // Answer keys of a previous attempt stay hidden while a retake is running (items can repeat when the bank runs out).
  if (result && active?.status === 'in-progress') result = { ...result, review: [] };
  return {
    version: 2,
    status: active ? active.status : latest ? 'completed' : 'not-started',
    attemptId: shown?.id ?? null,
    startedAt: shown?.startedAt ?? null,
    completedAt: active ? null : latest?.completedAt ?? null,
    remainingMinutes: remainingMinutes(shown, sections),
    sections,
    task: active ? taskView(active, bank) : null,
    result,
    history: completed.filter(attempt => attempt.result && attempt.completedAt).map(attempt => ({ attemptId: attempt.id,
      completedAt: attempt.completedAt!, overall: attempt.result!.overall.label, score: attempt.result!.overall.score })),
    error: active?.status === 'error' ? active.error ?? 'Оценка ответов не завершилась. Ответы сохранены, можно пересчитать.' : null,
    retakeAvailableAt: latest?.completedAt ? iso(Date.parse(latest.completedAt) + PLACEMENT_RETAKE_DAYS * 86_400_000) : null,
    audioAvailable: input.audioAvailable,
  };
}
