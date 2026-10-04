/**
 * Placement test v2 — shared contract between the server, the web/PC client and the iPhone client.
 * Interface copy is Russian; English is the practice language. Answer keys never leave the server
 * before the learner answers. Keep this file free of server-only imports: it is bundled into the web client.
 */
import type { StrategyMoveScore } from '../strategy-moves';

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
/** Bump when items, scoring rules or weights change; progress is compared only within one version. */
export const PLACEMENT_PROCEDURE_VERSION = 'v2.0';
/** Suggested retake interval: shorter intervals rarely show change beyond the test's error. */
export const PLACEMENT_RETAKE_DAYS = 42;
export const CEFR_LEVELS: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
/** Numeric scale: A1=1 … C2=6. Fractions are between bands (3.5 ≈ upper B1). */
export const CEFR_VALUE: Record<CEFRLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export type PlacementSectionId = 'listening' | 'reading' | 'language' | 'speaking' | 'interaction';
export type PlacementSkillId = 'listening' | 'reading' | 'grammar' | 'vocabulary' | 'speaking' | 'interaction';
export type PlacementStatus = 'not-started' | 'in-progress' | 'scoring' | 'completed' | 'error';
export type Confidence = 'low' | 'medium' | 'high';

/** Objective item stored in the server-side bank (lib/placement/bank.ts). Never sent to clients as-is. */
export interface PlacementItem {
  id: string;                       // stable, e.g. 'gr-b1-03'
  section: 'listening' | 'reading' | 'language';
  skill: 'listening' | 'reading' | 'grammar' | 'vocabulary';
  level: Exclude<CEFRLevel, 'A1'>;  // A2…C2 difficulty
  /** Reading: the passage shown with the question. Listening: the script spoken by TTS (hidden until answered). */
  passage?: string;
  /** Listening only: TTS delivery hint, e.g. 'natural pace, friendly voicemail'. */
  delivery?: string;
  /** Items sharing a groupId use the same passage/script; the engine asks at most `groupMax` of them in one attempt. */
  groupId?: string;
  prompt: string;                   // English question or a sentence with a gap shown as "____"
  options: string[];                // 3–4 options, exactly one correct
  answer: number;                   // index into options
  explanation: string;              // Russian: why the key is right (shown in the result review)
  /** Construct tags, e.g. 'present-perfect', 'question-aux', 'collocation', 'inference', 'numbers'. */
  tags?: string[];
  /** Listening: script word count and target pace used for TTS acceptance. */
  wordCount?: number;
  targetWpm?: number;
  /** 'work' ≈ 1/3 of the bank (his domain, never his real deals), 'life' ≈ 2/3. */
  context?: 'work' | 'life';
}

/** Open speaking task (rated by Sol at the end). */
export interface PlacementSpeakingPrompt {
  id: string;                       // 'sp-b1-01'
  level: Exclude<CEFRLevel, 'A1'>;  // target difficulty of the task
  instruction: string;              // Russian, one sentence
  prompt: string;                   // English task as the examiner would say it
  prepSeconds: number;              // suggested thinking time
  minSeconds: number;
  maxSeconds: number;
  /** B2/C1 prompts: an unprepared follow-up challenge asked right after the answer (0 s prep). */
  followUp?: { prompt: string; maxSeconds: number };
  /** 'read-aloud' is an optional neutral warm-up passage (mic check + read pace baseline). */
  kind?: 'task' | 'read-aloud';
}

/** Short structured work roleplay (rated by Sol for interaction + communication strategy). */
export interface PlacementRoleplayScript {
  id: string;                       // 'rp-agency-01'
  title: string;                    // Russian scenario title
  setup: string;                    // Russian: who you talk to and why (shown before the first line)
  partnerRole: string;              // English, e.g. 'Claire, production assistant at a Paris creative agency'
  lines: string[];                  // 3–4 fixed partner lines, spoken via TTS in order
  /** What a strong answer does at each line (rubric hints for the scorer, never shown before answering). */
  rubric: string[];
}

/** Task currently shown to the learner. Answer keys and listening scripts are omitted. */
export type PlacementTask =
  | { kind: 'choice'; id: string; section: 'listening' | 'reading' | 'language';
      skill: 'listening' | 'reading' | 'grammar' | 'vocabulary';
      index: number; total: number;           // 1-based position within the section, planned total
      instruction: string;                    // Russian
      passage: string | null;                 // reading passage (null for listening and language)
      audio: { url: string; maxPlays: number } | null; // listening clip, relative API path e.g. 'placement/audio/ls-b1-02'
      prompt: string; options: string[] }
  | { kind: 'speaking'; id: string; section: 'speaking'; index: number; total: number;
      instruction: string; prompt: string; prepSeconds: number; minSeconds: number; maxSeconds: number;
      /** Recording starts automatically when the prep countdown ends (measures real response latency). */
      autoStart: boolean;
      /** True for the unprepared follow-up challenge (prepSeconds 0). */
      followUp: boolean;
      /** Optional read-aloud warm-up: the passage to read is in `prompt`. */
      readAloud: boolean }
  | { kind: 'roleplay'; id: string; section: 'interaction'; index: number; total: number;
      instruction: string;                    // Russian setup (same for every turn of the script)
      partnerRole: string;
      partnerLine: { text: string; audioUrl: string | null }; // NPC line; audioUrl e.g. 'placement/audio/rp-agency-01-2'
      maxSeconds: number };

export interface PlacementSectionView {
  id: PlacementSectionId; title: string; description: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  answered: number; planned: number; minutes: number;
  /** Two sittings of ~12 min: 1 = listening, reading, language; 2 = speaking, interaction. */
  sitting: 1 | 2;
  /** Russian reason when skipped, e.g. 'Голос не подключён'. */
  note: string | null;
}

export interface PlacementSkillResult {
  id: PlacementSkillId;
  level: CEFRLevel | null;          // null when the section was skipped
  label: string | null;             // e.g. 'B1+', null when skipped
  score: number | null;             // continuous 1–6 scale (CEFR_VALUE)
  confidence: Confidence;
  basis: string;                    // Russian: what it is based on, e.g. '6 аудио, 4 верно'
  note: string;                     // Russian: what this band means for his real calls (one or two sentences)
  /** Smallest contiguous band range holding ≥ 80% of the estimate; always shown next to the label. */
  range: { from: CEFRLevel; to: CEFRLevel } | null;
  answered: number | null;          // objective items answered (null for rated skills)
  correct: number | null;
}

export interface PlacementResult {
  version: 2; attemptId: string; completedAt: string; model: string;
  procedureVersion: string;         // PLACEMENT_PROCEDURE_VERSION at scoring time
  /** Shape first, e.g. 'Понимаешь лучше, чем говоришь — примерно на уровень'. */
  headline: string;
  /** Overall = median of available skill scores; confidence at most 'medium'. */
  overall: { level: CEFRLevel; label: string; score: number; confidence: Confidence; summary: string };
  skills: PlacementSkillResult[];   // fixed order: listening, reading, grammar, vocabulary, speaking, interaction
  speaking: {
    range: CEFRLevel | null; accuracy: CEFRLevel | null; fluency: CEFRLevel | null; coherence: CEFRLevel | null;
    /** Labels with '+' for the four criteria, e.g. { accuracy: 'A2+' }. */
    labels: { range: string | null; accuracy: string | null; fluency: string | null; coherence: string | null };
    timing: { wordsPerMinute: number | null; pausesPerMinute: number | null; longestPauseSeconds: number | null;
      meanLengthOfRun: number | null; fillersPerMinute: number | null; latencySeconds: number | null } | null;
    examples: { quote: string; comment: string; better: string }[]; // exact learner quote, Russian comment, English better version
    /** Errors that matter (seed language practice): impact 'meaning' | 'seniority' | 'minor'. */
    errors: { quote: string; correction: string; tag: string; impact: 'meaning' | 'seniority' | 'minor' }[];
    notes: string[];                // e.g. 'Темп и оценка разбора расходятся'
  };
  communication: {
    strengths: string[];            // Russian
    risks: string[];                // Russian, ranked by cost
    observations: { title: string; detail: string; quote: string | null }[];
    moves: StrategyMoveScore[];     // the 8 strategy moves from the roleplay (counts only, never a CEFR band)
  };
  /** Top language targets for practice (fossilised basics first), each grounded in his own answer when possible. */
  languageTargets: { tag: string; title: string; quote: string | null; correction: string | null }[];
  /** Partner speech level for lessons = listening band (challenge lessons use +1). */
  partnerLevel: CEFRLevel | null;
  priorities: { title: string; why: string; action: string }[]; // 1–3, Russian
  review: { itemId: string; section: 'listening' | 'reading' | 'language'; prompt: string; options: string[];
    chosen: number; answer: number; correct: boolean; explanation: string; passage: string | null }[];
  limitations: string[];            // Russian, honest scope of the estimate
}

export interface PlacementView {
  version: 2;
  status: PlacementStatus;
  attemptId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  remainingMinutes: number;
  sections: PlacementSectionView[];
  task: PlacementTask | null;
  result: PlacementResult | null;   // latest completed result (also while a retake is in progress)
  history: { attemptId: string; completedAt: string; overall: string; score: number }[]; // oldest first
  error: string | null;
  /** ISO date after which a retake is suggested (PLACEMENT_RETAKE_DAYS after the last result); null before the first result.
   * An earlier retake is allowed with the note «за пару недель изменения обычно в пределах погрешности». */
  retakeAvailableAt: string | null;
  /** False when the OpenAI audio key is missing: listening/speaking/interaction will be skipped. */
  audioAvailable: boolean;
}

/** Map a continuous score (1–6) to a band and a label with '+' for the upper half. */
export function cefrFromScore(score: number): { level: CEFRLevel; label: string } {
  const clamped = Math.min(6, Math.max(1, score));
  const index = Math.min(6, Math.max(1, Math.floor(clamped + 0.25)));
  const level = CEFR_LEVELS[index - 1];
  return { level, label: level + (clamped >= index + 0.25 && index < 6 ? '+' : '') };
}
