import { ApiError } from '../security';
import { PLACEMENT_PROCEDURE_VERSION, type PlacementSectionId } from '../../placement/types';
import { SECTION_RULES, argmax, chooseRoleplayScript, chooseStimulus, levelIndex, maxPlaysFor, mulberry32, parallelPrompt,
  planSpeaking, posteriorFrom, speakingStartLevel, stimulusKey, stopReason, type Exposure, type ObjectiveSection } from '../../placement/engine';
import { bankItem, bankPrompt, bankScript, type PlacementBank } from './bank-source';
import { AUDIO_MISSING_NOTE, INTERRUPTION_GRACE_MS, LEARNER_SKIP_NOTE, SECTION_ORDER, SKIPPABLE_SECTIONS, SITTING,
  STALE_SITTING_DAYS, STALE_SITTING_NOTE, followUpTaskId, iso, roleplayTaskId, type AttemptRecord, type ObjectiveRecord,
  type SectionRecord, type SpokenRecord } from './model';
import { answeredObjective, answeredSpoken, toEvidence } from './records';
import { buildPlacementResult } from './results';
import type { RecordedIntegrity } from './runtime';

/** Everything a flow step may read: the bank, exposure in OTHER attempts and the clock. */
export interface FlowContext { bank: PlacementBank; exposure: ReadonlyMap<string, Exposure>; now: number }
/** Ids that became visible in this step (items, prompts, scripts): the caller records them as exposure. */
export type Shown = string[];

const OBJECTIVE_SECTIONS: readonly ObjectiveSection[] = ['listening', 'reading', 'language'];
const MAX_ITEM_MS = 3 * 60_000;
const DONE = new Set<SectionRecord['status']>(['completed', 'skipped']);

function rng(attempt: AttemptRecord) {
  return mulberry32((attempt.seed ^ Math.imul(attempt.objective.length + 1, 0x9E3779B1) ^ Math.imul(attempt.spoken.length + 1, 0x85EBCA77)) >>> 0);
}
function touch(attempt: AttemptRecord, ctx: FlowContext) { attempt.updatedAt = iso(ctx.now); }

export function currentObjective(attempt: AttemptRecord): ObjectiveRecord | undefined {
  if (attempt.current?.kind !== 'objective') return undefined;
  const taskId = attempt.current.taskId;
  return attempt.objective.find(record => record.taskId === taskId && !record.answeredAt && !record.voided);
}
export function currentSpoken(attempt: AttemptRecord): SpokenRecord | undefined {
  if (attempt.current?.kind !== 'spoken') return undefined;
  const taskId = attempt.current.taskId;
  return attempt.spoken.find(record => record.taskId === taskId && !record.answeredAt && !record.voided);
}

function emptySection(): SectionRecord { return { status: 'pending', note: null, startedAt: null, completedAt: null, stopReason: null }; }

export function createAttempt(ctx: FlowContext, input: { id: string; seed: number; audioAvailable: boolean }): { attempt: AttemptRecord; shown: Shown } {
  const sections = Object.fromEntries(SECTION_ORDER.map(id => [id, emptySection()])) as Record<PlacementSectionId, SectionRecord>;
  if (!input.audioAvailable) for (const id of SKIPPABLE_SECTIONS) Object.assign(sections[id], { status: 'skipped', note: AUDIO_MISSING_NOTE });
  const script = sections.interaction.status === 'skipped' ? null : chooseRoleplayScript(ctx.bank.scripts, ctx.exposure);
  if (!script && sections.interaction.status !== 'skipped') Object.assign(sections.interaction, { status: 'skipped', note: 'Ролевая сцена сейчас недоступна.' });
  if (!ctx.bank.prompts.length && sections.speaking.status !== 'skipped') Object.assign(sections.speaking, { status: 'skipped', note: 'Задания на говорение сейчас недоступны.' });
  const startedAt = iso(ctx.now);
  const attempt: AttemptRecord = { version: 1, id: input.id, status: 'in-progress', procedureVersion: PLACEMENT_PROCEDURE_VERSION,
    startedAt, updatedAt: startedAt, completedAt: null, seed: input.seed >>> 0, audioAvailable: input.audioAvailable, sections,
    objective: [], queued: [], spoken: [], speakingPlan: null, roleplayScriptId: script?.id ?? null, current: null, result: null, error: null };
  return { attempt, shown: advance(attempt, ctx) };
}

/** Move to the next task, activating and completing sections in contract order; finish the attempt when all are done. */
export function advance(attempt: AttemptRecord, ctx: FlowContext): Shown {
  if (attempt.status !== 'in-progress' || attempt.current) return [];
  for (const id of SECTION_ORDER) {
    const section = attempt.sections[id];
    if (DONE.has(section.status)) continue;
    if (section.status === 'pending') { section.status = 'active'; section.startedAt = iso(ctx.now); }
    const shown = id === 'speaking' ? nextSpeaking(attempt, ctx) : id === 'interaction' ? nextRoleplayLine(attempt, ctx)
      : nextObjective(attempt, id, ctx);
    if (shown) { touch(attempt, ctx); return shown; }
    section.status = 'completed'; section.completedAt = iso(ctx.now);
  }
  finish(attempt, ctx);
  return [];
}

/** True when the speaking or roleplay answers need the model rating (one scoring call). */
export function needsModelScoring(attempt: AttemptRecord): boolean {
  return (attempt.sections.speaking.status !== 'skipped' && answeredSpoken(attempt, 'speaking').some(record => record.role !== 'R0'))
    || (attempt.sections.interaction.status !== 'skipped' && answeredSpoken(attempt, 'interaction').length > 0);
}

function finish(attempt: AttemptRecord, ctx: FlowContext) {
  attempt.current = null; attempt.queued = [];
  if (needsModelScoring(attempt)) { attempt.status = 'scoring'; attempt.error = null; }
  else {
    attempt.result = buildPlacementResult(attempt, ctx.bank, null, ctx.now);
    attempt.status = 'completed'; attempt.completedAt = iso(ctx.now); attempt.error = null;
  }
  touch(attempt, ctx);
}

function sectionElapsedMs(records: readonly ObjectiveRecord[]): number {
  return records.reduce((sum, record) => {
    const measured = record.elapsedMs ?? (record.answeredAt ? Date.parse(record.answeredAt) - Date.parse(record.shownAt) : 0);
    return sum + Math.min(MAX_ITEM_MS, Math.max(0, Number.isFinite(measured) ? measured : 0));
  }, 0);
}

function showObjective(attempt: AttemptRecord, ctx: FlowContext, item: { id: string; section: ObjectiveSection; skill: ObjectiveRecord['skill'];
  level: ObjectiveRecord['level']; groupId?: string }, position: 1 | 2, reusedExposure: boolean) {
  attempt.objective.push({ taskId: item.id, itemId: item.id, section: item.section, skill: item.skill, level: item.level,
    stimulus: stimulusKey(item), position, shownAt: iso(ctx.now), audioServedAt: null, answeredAt: null, choice: null, correct: null,
    plays: null, elapsedMs: null, voided: false, reusedExposure });
  attempt.current = { kind: 'objective', taskId: item.id };
}

function nextObjective(attempt: AttemptRecord, section: ObjectiveSection, ctx: FlowContext, requiredLevel?: number): Shown | null {
  while (attempt.queued.length) {
    const item = bankItem(ctx.bank, attempt.queued.shift()!);
    if (!item || item.section !== section || attempt.objective.some(record => record.itemId === item.id)) continue;
    const previous = attempt.objective.at(-1);
    showObjective(attempt, ctx, item, 2, !!previous?.reusedExposure);
    return [item.id];
  }
  const answered = answeredObjective(attempt, record => record.section === section);
  const rule = SECTION_RULES[section];
  const posterior = posteriorFrom(answered.map(record => toEvidence(record, ctx.bank)));
  const stop = stopReason(rule, posterior, answered.map(record => levelIndex(record.level)), sectionElapsedMs(answered));
  if (stop) { attempt.sections[section].stopReason = stop; return null; }
  const shownInSection = attempt.objective.filter(record => record.section === section && !record.voided);
  const usedByLevel = new Map<number, number>();
  for (const record of answered) usedByLevel.set(levelIndex(record.level), (usedByLevel.get(levelIndex(record.level)) ?? 0) + 1);
  const tagUsage = new Map<string, number>();
  for (const record of attempt.objective) for (const tag of bankItem(ctx.bank, record.itemId)?.tags ?? []) tagUsage.set(tag, (tagUsage.get(tag) ?? 0) + 1);
  const last = shownInSection.at(-1);
  const choice = chooseStimulus(ctx.bank.items, {
    section, posterior, first: answered.length === 0, usedByLevel, usedItemIds: new Set(attempt.objective.map(record => record.itemId)),
    exposure: ctx.exposure, now: ctx.now, tagUsage, remainingQuestions: rule.maxQuestions - answered.length,
    preferredSkill: section === 'language' ? (last?.skill === 'grammar' ? 'vocabulary' : 'grammar') : undefined,
    lastContext: last ? bankItem(ctx.bank, last.itemId)?.context ?? null : null,
    requiredLevel, rng: rng(attempt),
  });
  if (!choice) { attempt.sections[section].stopReason = 'exhausted'; return null; }
  const [first, ...rest] = choice.items;
  showObjective(attempt, ctx, first, 1, choice.reusedExposure);
  attempt.queued = rest.map(item => item.id);
  return [first.id];
}

function sectionMap(attempt: AttemptRecord, ctx: FlowContext, section: ObjectiveSection): number | null {
  if (attempt.sections[section].status !== 'completed') return null;
  const answered = answeredObjective(attempt, record => record.section === section);
  return answered.length ? argmax(posteriorFrom(answered.map(record => toEvidence(record, ctx.bank)))) : null;
}

function nextSpeaking(attempt: AttemptRecord, ctx: FlowContext): Shown | null {
  if (!attempt.speakingPlan) {
    // Prompts already shown stay excluded; the neutral read-aloud warm-up may be reused.
    const used = new Set(attempt.spoken.flatMap(record => record.promptId && record.role !== 'R0' ? [record.promptId] : []));
    const steps = planSpeaking(ctx.bank.prompts, speakingStartLevel(sectionMap(attempt, ctx, 'listening'), sectionMap(attempt, ctx, 'language')),
      { exposure: ctx.exposure, now: ctx.now, rng: rng(attempt), exclude: used });
    attempt.speakingPlan = steps.map(step => ({ role: step.role, promptId: step.prompt.id,
      taskId: step.role === 'F2' ? followUpTaskId(step.prompt.id) : step.prompt.id }));
  }
  const entry = attempt.speakingPlan.find(item => !attempt.spoken.some(record => record.taskId === item.taskId && (record.answeredAt || record.voided)));
  if (!entry) return null;
  const prompt = bankPrompt(ctx.bank, entry.promptId);
  if (!prompt) { attempt.speakingPlan = attempt.speakingPlan.filter(item => item !== entry); return nextSpeaking(attempt, ctx); }
  attempt.spoken.push({ taskId: entry.taskId, section: 'speaking', role: entry.role, promptId: prompt.id, level: prompt.level,
    scriptId: null, lineIndex: null, shownAt: iso(ctx.now), answeredAt: null, text: null, originalTranscript: null,
    transcriptEdited: false, audioFile: null, speechTiming: null, voided: false });
  attempt.current = { kind: 'spoken', taskId: entry.taskId };
  return entry.role === 'F2' ? [] : [prompt.id];
}

function nextRoleplayLine(attempt: AttemptRecord, ctx: FlowContext): Shown | null {
  let script = attempt.roleplayScriptId ? bankScript(ctx.bank, attempt.roleplayScriptId) : undefined;
  if (!script && !answeredSpoken(attempt, 'interaction').length) {
    script = chooseRoleplayScript(ctx.bank.scripts, ctx.exposure) ?? undefined;
    attempt.roleplayScriptId = script?.id ?? null;
  }
  if (!script) return null;
  const lineIndex = attempt.spoken.filter(record => record.section === 'interaction' && record.answeredAt && !record.voided).length;
  if (lineIndex >= script.lines.length) return null;
  const taskId = roleplayTaskId(script.id, lineIndex);
  attempt.spoken.push({ taskId, section: 'interaction', role: 'RP', promptId: null, level: null, scriptId: script.id, lineIndex,
    shownAt: iso(ctx.now), answeredAt: null, text: null, originalTranscript: null, transcriptEdited: false, audioFile: null,
    speechTiming: null, voided: false });
  attempt.current = { kind: 'spoken', taskId };
  return lineIndex === 0 ? [script.id] : [];
}

function requireInProgress(attempt: AttemptRecord) {
  if (attempt.status !== 'in-progress') throw new ApiError('Тест сейчас не ждёт ответа.', 409);
}

/** Record a multiple-choice answer. Re-sending the same answer to an already answered task is a harmless replay. */
export function answerChoice(attempt: AttemptRecord, ctx: FlowContext, input: { taskId: string; choice: number; plays?: number; elapsedMs?: number }): { replay: boolean; shown: Shown } {
  const current = currentObjective(attempt);
  if (!current || current.taskId !== input.taskId) {
    const previous = attempt.objective.find(record => record.taskId === input.taskId && record.answeredAt && !record.voided);
    if (previous && previous.choice === input.choice) return { replay: true, shown: [] };
    requireInProgress(attempt);
    throw new ApiError('Это задание уже не активно. Обнови тест.', 409);
  }
  requireInProgress(attempt);
  const item = bankItem(ctx.bank, current.itemId);
  if (!item) { current.voided = true; attempt.current = null; attempt.queued = []; return { replay: false, shown: advance(attempt, ctx) }; }
  if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice >= item.options.length) throw new ApiError('Такого варианта ответа нет.', 400);
  current.choice = input.choice; current.correct = input.choice === item.answer; current.answeredAt = iso(ctx.now);
  current.plays = item.section === 'listening' ? Math.max(0, Math.min(maxPlaysFor(item.level), Math.round(input.plays ?? 1))) : null;
  current.elapsedMs = input.elapsedMs === undefined || !Number.isFinite(input.elapsedMs) ? null : Math.max(0, Math.min(30 * 60_000, Math.round(input.elapsedMs)));
  attempt.current = null;
  touch(attempt, ctx);
  return { replay: false, shown: advance(attempt, ctx) };
}

/** Record a spoken answer (speaking task or roleplay turn) with server-derived transcript provenance and timing. */
export function answerSpoken(attempt: AttemptRecord, ctx: FlowContext, input: { taskId: string; text: string; audioFile: string;
  originalTranscript?: string; integrity: RecordedIntegrity }): { replay: boolean; shown: Shown } {
  const current = currentSpoken(attempt);
  if (!current || current.taskId !== input.taskId) {
    const previous = attempt.spoken.find(record => record.taskId === input.taskId && record.answeredAt && !record.voided);
    if (previous && previous.audioFile === input.audioFile) return { replay: true, shown: [] };
    requireInProgress(attempt);
    throw new ApiError('Это задание уже не активно. Обнови тест.', 409);
  }
  requireInProgress(attempt);
  current.text = input.text.trim();
  current.originalTranscript = input.integrity.originalTranscript ?? input.originalTranscript ?? null;
  current.transcriptEdited = input.integrity.transcriptEdited ?? (current.originalTranscript !== null && current.originalTranscript.trim() !== current.text);
  current.audioFile = input.audioFile;
  current.speechTiming = input.integrity.speechTiming ?? null;
  current.answeredAt = iso(ctx.now);
  attempt.current = null;
  touch(attempt, ctx);
  return { replay: false, shown: advance(attempt, ctx) };
}

function sectionOfCurrent(attempt: AttemptRecord): PlacementSectionId | null {
  return currentObjective(attempt)?.section ?? currentSpoken(attempt)?.section ?? null;
}

/** Only listening, speaking and interaction can be skipped; a skipped section reports «не измерено». */
export function skipSection(attempt: AttemptRecord, ctx: FlowContext, section: PlacementSectionId, reason?: string): Shown {
  if (!SKIPPABLE_SECTIONS.includes(section)) throw new ApiError('Этот раздел нельзя пропустить.', 400);
  requireInProgress(attempt);
  const record = attempt.sections[section];
  if (DONE.has(record.status)) return [];
  if (sectionOfCurrent(attempt) === section) {
    const current = currentObjective(attempt) ?? currentSpoken(attempt);
    if (current) current.voided = true;
    attempt.current = null; attempt.queued = [];
  }
  Object.assign(record, { status: 'skipped', note: reason?.trim() ? reason.trim().slice(0, 300) : LEARNER_SKIP_NOTE, completedAt: iso(ctx.now) });
  touch(attempt, ctx);
  return advance(attempt, ctx);
}

/**
 * Resume rules (audit §2.2): a listening clip that was played but not answered is replaced by a parallel clip of the
 * same level; an interrupted speaking prompt restarts with a parallel prompt (an interrupted follow-up is dropped);
 * the first sitting is redone when it is more than 14 days old and the second has not started.
 */
export function resumeAttempt(attempt: AttemptRecord, ctx: FlowContext): Shown {
  if (attempt.status !== 'in-progress') return [];
  const shown: Shown = [];
  // A deploy can remove a bank entry mid-attempt: drop a task that can no longer be shown.
  const missingItem = currentObjective(attempt);
  if (missingItem && !bankItem(ctx.bank, missingItem.itemId)) { missingItem.voided = true; attempt.current = null; attempt.queued = []; }
  const missingPrompt = currentSpoken(attempt);
  if (missingPrompt?.promptId && !bankPrompt(ctx.bank, missingPrompt.promptId)) { missingPrompt.voided = true; attempt.current = null; }
  resetStaleSitting(attempt, ctx);
  const listening = currentObjective(attempt);
  if (listening?.section === 'listening' && listening.audioServedAt && ctx.now - Date.parse(listening.audioServedAt) >= INTERRUPTION_GRACE_MS) {
    listening.voided = true; attempt.current = null; attempt.queued = [];
    if (listening.position === 1) shown.push(...(nextObjective(attempt, 'listening', ctx, levelIndex(listening.level)) ?? []));
  }
  const spoken = currentSpoken(attempt);
  if (spoken?.section === 'speaking' && ctx.now - Date.parse(spoken.shownAt) >= INTERRUPTION_GRACE_MS) {
    if (spoken.role === 'F2') { spoken.voided = true; attempt.current = null; }
    else if (spoken.role !== 'R0' && spoken.promptId && attempt.speakingPlan) {
      const prompt = bankPrompt(ctx.bank, spoken.promptId);
      const entry = attempt.speakingPlan.find(item => item.taskId === spoken.taskId);
      const followUp = spoken.role === 'P2' ? attempt.speakingPlan.find(item => item.role === 'F2') : undefined;
      const usedIds = new Set([...attempt.spoken.flatMap(record => record.promptId ? [record.promptId] : []),
        ...attempt.speakingPlan.map(item => item.promptId)]);
      const replacement = prompt && entry ? parallelPrompt(ctx.bank.prompts, prompt, { usedIds, exposure: ctx.exposure, now: ctx.now,
        rng: rng(attempt), needsFollowUp: !!followUp }) : null;
      if (replacement && entry) {
        spoken.voided = true; attempt.current = null;
        entry.promptId = replacement.id; entry.taskId = replacement.id;
        if (followUp) { followUp.promptId = replacement.id; followUp.taskId = followUpTaskId(replacement.id); }
      }
    }
  }
  touch(attempt, ctx);
  shown.push(...advance(attempt, ctx));
  return shown;
}

function resetStaleSitting(attempt: AttemptRecord, ctx: FlowContext) {
  const first = OBJECTIVE_SECTIONS.map(id => attempt.sections[id]);
  if (!first.every(section => DONE.has(section.status))) return;
  if (SECTION_ORDER.every(id => DONE.has(attempt.sections[id].status))) return;
  if (attempt.spoken.some(record => record.answeredAt && !record.voided)) return;
  const finished = Math.max(0, ...first.filter(section => section.status === 'completed' && section.completedAt).map(section => Date.parse(section.completedAt!)));
  if (!finished || ctx.now - finished <= STALE_SITTING_DAYS * 86_400_000) return;
  for (const id of OBJECTIVE_SECTIONS) {
    const section = attempt.sections[id];
    if (section.status !== 'completed') continue;
    for (const record of attempt.objective) if (record.section === id) record.voided = true;
    Object.assign(section, { status: 'pending', note: STALE_SITTING_NOTE, startedAt: null, completedAt: null, stopReason: null });
  }
  // Prompts already shown stay voided (and excluded); the ladder depends on the first sitting, so plan it again.
  for (const record of attempt.spoken) record.voided = true;
  attempt.speakingPlan = null; attempt.current = null; attempt.queued = [];
}

export function sittingOf(section: PlacementSectionId): 1 | 2 { return SITTING[section]; }
