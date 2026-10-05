import type { CEFRLevel, PlacementResult, PlacementSectionId } from '../../placement/types';
import type { ObjectiveSection, ObjectiveSkill, SpeakingRole, StopReason } from '../../placement/engine';
import type { SpeechTiming } from '../../types';
import type { StrategyMoveScore } from '../../strategy-moves';
import { ROLEPLAY_ANSWER_MAX_SECONDS } from '../../placement/prompts';

/** Server-side placement attempt (stored as JSON). Never sent to clients as-is: see view.ts. */
export const SECTION_ORDER: readonly PlacementSectionId[] = ['listening', 'reading', 'language', 'speaking', 'interaction'];
export const SKIPPABLE_SECTIONS: readonly PlacementSectionId[] = ['listening', 'speaking', 'interaction'];
export const SITTING: Record<PlacementSectionId, 1 | 2> = { listening: 1, reading: 1, language: 1, speaking: 2, interaction: 2 };
/** Russian section copy and target minutes (two sittings of about 12 minutes). */
export const SECTION_INFO: Record<PlacementSectionId, { title: string; description: string; minutes: number }> = {
  listening: { title: 'Аудирование', minutes: 6,
    description: 'Короткие записи на английском, к каждой по два вопроса. Сначала прочитай вопрос, потом слушай.' },
  reading: { title: 'Чтение', minutes: 4, description: 'Короткие тексты, к каждому по два вопроса.' },
  language: { title: 'Грамматика и слова', minutes: 4, description: 'Короткие задания с выбором ответа: грамматика и лексика по очереди.' },
  speaking: { title: 'Говорение', minutes: 6,
    description: 'Чтение вслух для проверки микрофона, затем вопросы на подготовку и один вопрос без подготовки. Запись начинается сама.' },
  interaction: { title: 'Рабочий разговор', minutes: 4, description: 'Короткая рабочая сцена: собеседник говорит, ты отвечаешь голосом.' },
};
export const AUDIO_MISSING_NOTE = 'Голос не подключён — добавь OpenAI API-ключ в настройках';
export const LEARNER_SKIP_NOTE = 'Раздел пропущен по твоему решению.';
export const STALE_SITTING_NOTE = 'Первая часть устарела: прошло больше 14 дней. Пройди её заново.';
/** Objective results stay valid this long while the second sitting is pending (audit §2.2). */
export const STALE_SITTING_DAYS = 14;
/** A clip played (or a prompt shown) at least this long before a resume counts as interrupted. */
export const INTERRUPTION_GRACE_MS = 20_000;
/** Minimum detected speech for a rated speaking task (audit §2.6). */
export const MIN_SPEECH_SECONDS = 15;
/** Word-count fallback when VAD timing is unavailable (≈ 15 s of speech). */
export const MIN_SPEECH_WORDS = 25;
/** Upper limit of one live roleplay answer (bank constant, audit §2.7). */
export const ROLEPLAY_MAX_SECONDS = ROLEPLAY_ANSWER_MAX_SECONDS;

export interface SectionRecord {
  status: 'pending' | 'active' | 'completed' | 'skipped';
  note: string | null;
  startedAt: string | null;
  completedAt: string | null;
  stopReason: StopReason | null;
}

export interface ObjectiveRecord {
  taskId: string;                      // = itemId
  itemId: string;
  section: ObjectiveSection;
  skill: ObjectiveSkill;
  level: CEFRLevel;
  stimulus: string;                    // engine stimulusKey (group or item)
  position: 1 | 2;                     // question number on the stimulus
  shownAt: string;
  audioServedAt: string | null;
  answeredAt: string | null;
  choice: number | null;
  correct: boolean | null;
  plays: number | null;
  elapsedMs: number | null;
  /** Interrupted (played but unanswered on resume) or reset: shown, never scored. */
  voided: boolean;
  /** Served although seen in a past attempt within 90 days (bank exhausted). */
  reusedExposure: boolean;
}

export interface SpokenRecord {
  taskId: string;
  section: 'speaking' | 'interaction';
  role: SpeakingRole | 'RP';
  promptId: string | null;
  level: CEFRLevel | null;
  scriptId: string | null;
  lineIndex: number | null;
  shownAt: string;
  answeredAt: string | null;
  text: string | null;
  originalTranscript: string | null;
  transcriptEdited: boolean;
  audioFile: string | null;
  speechTiming: SpeechTiming | null;
  voided: boolean;
}

export interface SpeakingPlanEntry { role: SpeakingRole; promptId: string; taskId: string }

export interface AttemptRecord {
  version: 1;
  id: string;
  status: 'in-progress' | 'scoring' | 'completed' | 'error';
  procedureVersion: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  seed: number;
  audioAvailable: boolean;
  sections: Record<PlacementSectionId, SectionRecord>;
  objective: ObjectiveRecord[];
  /** Remaining question ids of the current stimulus (the second question on a clip or passage). */
  queued: string[];
  spoken: SpokenRecord[];
  speakingPlan: SpeakingPlanEntry[] | null;
  roleplayScriptId: string | null;
  current: { kind: 'objective' | 'spoken'; taskId: string } | null;
  result: PlacementResult | null;
  error: string | null;
}

/** Validated model rating of the spoken answers, in numbers (half-band scores). Quotes are exact learner substrings. */
export interface RatedTask {
  ref: string; insufficient: boolean;
  range: number | null; accuracy: number | null; fluency: number | null; coherence: number | null;
  /** Unprepared follow-up only. */
  interaction: number | null;
}
export interface RatedScoring {
  model: string;
  tasks: RatedTask[];
  roleplayInteraction: number | null;
  moves: StrategyMoveScore[];
  errors: { ref: string; quote: string; correction: string; tag: string; impact: 'meaning' | 'seniority' | 'minor'; title: string }[];
  examples: { quote: string; comment: string; better: string }[];
  strengths: string[];
  risks: string[];
  observations: { title: string; detail: string; quote: string | null }[];
  priorities: { title: string; why: string; action: string }[];
  summary: string;
  speakingNextBand: string;
  interactionNextBand: string;
  /** Items removed because their quote was not an exact learner substring. */
  dropped: number;
}

/** Scorer reference for a spoken answer: p1/p2/f2/p3 for speaking tasks, rp1… for roleplay turns (r0 is never rated). */
export function spokenRef(record: Pick<SpokenRecord, 'role' | 'lineIndex'>): string {
  return record.role === 'RP' ? `rp${(record.lineIndex ?? 0) + 1}` : record.role.toLowerCase();
}

export const followUpTaskId = (promptId: string) => `${promptId}-follow-up`;
export const roleplayTaskId = (scriptId: string, lineIndex: number) => `${scriptId}-${lineIndex}`;
export const iso = (time: number) => new Date(time).toISOString();
