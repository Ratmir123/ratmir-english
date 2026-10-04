/**
 * Placement flow: PlacementView (server) → which screen the client shows, plus the progress header model.
 * Pure (no React/DOM) — unit-tested in tests/web-placement-flow.test.ts.
 */
import type { PlacementSectionId, PlacementSectionView, PlacementTask, PlacementView } from '@/lib/placement/types';

export type FlowScreen =
  | { kind: 'intro'; retake: boolean }
  | { kind: 'resume' }
  | { kind: 'section-intro'; section: PlacementSectionView }
  | { kind: 'break' }
  | { kind: 'task'; task: PlacementTask; section: PlacementSectionView | null }
  | { kind: 'waiting' }
  | { kind: 'scoring' }
  | { kind: 'error'; message: string }
  | { kind: 'result' };

export interface FlowMemory {
  /** The learner pressed "Продолжить" on the resume screen in this mount. */
  resumed: boolean;
  /** Section intros already shown in this mount (and sections in progress before mount). */
  seenIntros: readonly PlacementSectionId[];
  /** "Продолжить сейчас" was pressed on the sitting break screen. */
  breakDismissed: boolean;
  /** The flow was opened (or reached `completed`) in this mount: show the result instead of a fresh intro. */
  wantsRetakeIntro: boolean;
}

export const INITIAL_MEMORY: FlowMemory = { resumed: false, seenIntros: [], breakDismissed: false, wantsRetakeIntro: false };

export const SKIPPABLE: readonly PlacementSectionId[] = ['listening', 'speaking', 'interaction'];
export const VOICE_SECTIONS: readonly PlacementSectionId[] = ['speaking', 'interaction'];

export function sectionOfTask(task: PlacementTask): PlacementSectionId {
  if (task.kind === 'choice') return task.section;
  return task.kind === 'speaking' ? 'speaking' : 'interaction';
}

function done(section: PlacementSectionView) { return section.status === 'completed' || section.status === 'skipped'; }

/** Any answer exists in this attempt (used to decide between "resume" and a fresh section intro). */
export function attemptHasProgress(view: PlacementView): boolean {
  return view.sections.some(section => section.answered > 0 || done(section));
}

/** Pure screen decision. `memory` is local UI state of the current mount. */
export function flowScreen(view: PlacementView, memory: FlowMemory): FlowScreen {
  switch (view.status) {
    case 'not-started': return { kind: 'intro', retake: false };
    case 'scoring': return { kind: 'scoring' };
    case 'error': return { kind: 'error', message: view.error || 'Не получилось посчитать результат.' };
    case 'completed': return memory.wantsRetakeIntro ? { kind: 'intro', retake: true } : { kind: 'result' };
    case 'in-progress': break;
  }
  const task = view.task;
  if (!task) return { kind: 'waiting' };
  if (!memory.resumed && attemptHasProgress(view)) return { kind: 'resume' };
  const sectionId = sectionOfTask(task);
  const section = view.sections.find(item => item.id === sectionId) ?? null;
  if (section && section.sitting === 2 && !memory.breakDismissed) {
    const firstSitting = view.sections.filter(item => item.sitting === 1);
    const secondStarted = view.sections.some(item => item.sitting === 2 && (item.answered > 0 || done(item)));
    if (firstSitting.length > 0 && firstSitting.every(done) && !secondStarted) return { kind: 'break' };
  }
  if (section && section.answered === 0 && !memory.seenIntros.includes(section.id)) return { kind: 'section-intro', section };
  return { kind: 'task', task, section };
}

/** Sections already underway when the flow mounts don't get their intro again. */
export function seenOnMount(view: PlacementView): PlacementSectionId[] {
  return view.sections.filter(section => section.answered > 0 || done(section)).map(section => section.id);
}

export interface ProgressDot { id: PlacementSectionId; title: string; status: PlacementSectionView['status']; current: boolean }
export interface ProgressGroup { sitting: 1 | 2; label: string; dots: ProgressDot[] }
export interface ProgressModel {
  groups: ProgressGroup[];
  /** 0–1 answered share of the planned items (skipped sections count as done). */
  fraction: number;
  /** "Вопрос 3 из ~8" for the current section, null outside tasks. */
  position: string | null;
  sectionTitle: string | null;
  remaining: string;
}

export function progressModel(view: PlacementView): ProgressModel {
  const current = view.task ? sectionOfTask(view.task) : null;
  const groups: ProgressGroup[] = ([1, 2] as const).map(sitting => ({
    sitting, label: `Часть ${sitting}`,
    dots: view.sections.filter(section => section.sitting === sitting)
      .map(section => ({ id: section.id, title: section.title, status: section.status, current: section.id === current })),
  })).filter(group => group.dots.length > 0);
  let planned = 0; let answered = 0;
  for (const section of view.sections) {
    const size = Math.max(1, section.planned);
    planned += size;
    answered += done(section) ? size : Math.min(size, section.answered);
  }
  const task = view.task;
  const position = task ? `${taskNoun(task)} ${task.index} из ${task.total > task.index ? '~' : ''}${Math.max(task.total, task.index)}` : null;
  const section = current ? view.sections.find(item => item.id === current) : null;
  return {
    groups,
    fraction: planned ? Math.min(1, answered / planned) : 0,
    position,
    sectionTitle: section?.title ?? null,
    remaining: remainingLabel(view.remainingMinutes),
  };
}

function taskNoun(task: PlacementTask): string {
  if (task.kind === 'roleplay') return 'Реплика';
  if (task.kind === 'speaking') return 'Задание';
  return 'Вопрос';
}

export function remainingLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'почти готово';
  const value = Math.max(1, Math.round(minutes));
  return `≈ ${value} мин`;
}

/** Splits "I ____ there since May." around the gap so the UI can draw a blank. */
export function promptParts(prompt: string): { text: string; gap: boolean }[] {
  const parts: { text: string; gap: boolean }[] = [];
  const pattern = /_{2,}/g;
  let last = 0;
  for (let match = pattern.exec(prompt); match; match = pattern.exec(prompt)) {
    if (match.index > last) parts.push({ text: prompt.slice(last, match.index), gap: false });
    parts.push({ text: '', gap: true });
    last = match.index + match[0].length;
  }
  if (last < prompt.length) parts.push({ text: prompt.slice(last), gap: false });
  return parts.length ? parts : [{ text: prompt, gap: false }];
}

/** Keyboard shortcut for option tiles: "1"–"9" (and numpad) → index, otherwise null. */
export function optionIndexFromKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return index < count ? index : null;
}

/** Speaking recorder rules: when the stop button needs a confirmation and when to stop automatically. */
export function recordingGate(elapsedSeconds: number, minSeconds: number, maxSeconds: number) {
  const max = Math.max(1, maxSeconds);
  return {
    belowMin: elapsedSeconds < minSeconds,
    remainingToMin: Math.max(0, Math.ceil(minSeconds - elapsedSeconds)),
    shouldAutoStop: elapsedSeconds >= max,
    fraction: Math.min(1, Math.max(0, elapsedSeconds / max)),
    minFraction: Math.min(1, Math.max(0, minSeconds / max)),
  };
}

/** Shown on the intro before the server has created an attempt (sections are empty until start). */
export const DEFAULT_SECTIONS: PlacementSectionView[] = [
  { id: 'listening', title: 'Слушание', description: 'Короткие аудио: голосовые, созвоны, объявления.', status: 'pending', answered: 0, planned: 8, minutes: 6, sitting: 1, note: null },
  { id: 'reading', title: 'Чтение', description: 'Письма, сообщения и короткие тексты.', status: 'pending', answered: 0, planned: 6, minutes: 4, sitting: 1, note: null },
  { id: 'language', title: 'Грамматика и слова', description: 'Какой вариант звучит естественно.', status: 'pending', answered: 0, planned: 14, minutes: 4, sitting: 1, note: null },
  { id: 'speaking', title: 'Речь', description: 'Ответы голосом на вопросы о работе и жизни.', status: 'pending', answered: 0, planned: 4, minutes: 6, sitting: 2, note: null },
  { id: 'interaction', title: 'Разговор', description: 'Короткий рабочий созвон с агентством.', status: 'pending', answered: 0, planned: 4, minutes: 4, sitting: 2, note: null },
];

export const SECTION_TIPS: Record<PlacementSectionId, string> = {
  listening: 'Сначала прочитай вопрос, потом включай запись. Слушать можно ограниченное число раз — как в живом разговоре.',
  reading: 'Текст и вопрос на одном экране. Время чтения не влияет на оценку.',
  language: 'Выбери вариант, который звучит естественно. Клавиши 1–4 выбирают ответ, Enter — отправляет.',
  speaking: 'Сначала есть время подумать, потом запись включится сама. Говори, пока не закончишь мысль — минимум 15 секунд.',
  interaction: 'Короткий рабочий созвон: собеседник говорит, ты отвечаешь голосом сразу после его реплики — как в жизни.',
};
