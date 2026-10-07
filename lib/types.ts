import type { PlacementView } from './placement/types';
import type { CallSummary, CommunicationPattern, CostCategory, PersonalDrill, ProfileFact } from './calls/types';
import type { LessonPlanExtras } from './training';
import type { StrategyMoveScore } from './strategy-moves';
import type { PhraseResult, SavedPhrase } from './phrases/types';
import type { CallPrep } from './preps/types';

/** Canonical skill names for BOTH clients (iPhone mirrors these labels exactly). */
export const SKILLS = [
  { id: 'listening', label: 'Понимать на слух', group: 'language' },
  { id: 'vocabulary', label: 'Находить слова', group: 'language' },
  { id: 'grammar', label: 'Строить фразы', group: 'language' },
  { id: 'clarity', label: 'Говорить понятно', group: 'language' },
  { id: 'coherence', label: 'Держать мысль', group: 'dialogue' },
  { id: 'reciprocity', label: 'Учитывать собеседника', group: 'dialogue' },
  { id: 'initiative', label: 'Вести разговор', group: 'dialogue' },
  { id: 'repair', label: 'Уточнять и исправляться', group: 'dialogue' },
  // v0.5 Smooth Talk: communication strategy is a first-class skill area.
  { id: 'positioning', label: 'Подавать себя', group: 'strategy' },
  { id: 'negotiation', label: 'Держать цену и условия', group: 'strategy' },
] as const;
export type SkillGroup = typeof SKILLS[number]['group'];
export const SKILL_GROUP_LABELS: Record<SkillGroup, string> = { language: 'Английский', dialogue: 'Разговор', strategy: 'Стратегия' };
/** Canonical skill-state names for both clients. */
export const SKILL_STATE_LABELS = { unknown: 'Ещё не проверено', supported: 'Получается с опорой', provisional: 'Первые самостоятельные успехи',
  independent: 'Получается самостоятельно', recheck: 'Пора проверить снова' } as const;
export type SkillId = typeof SKILLS[number]['id'];
export type Context = 'work' | 'life' | 'relocation';
export type Mode = 'learning' | 'call';
export type LearningTrackId = 'life' | 'work' | 'relocation' | 'ielts-foundation';
export type LearningActivity = 'speaking' | 'listening' | 'reading' | 'writing';
export type EvidenceResult = 'success' | 'partial' | 'difficulty' | 'unobserved' | 'disputed';
export type Support = 0 | 1 | 2 | 3;
export interface Profile {
  name: string; goals: string; interests: string[]; professionalContext: string;
  relocation: string; dailyMinutes: number; feedback: string;
  audioRetentionDays: number; budgetUsd: number;
}
/** v0.5 adds optional LessonPlanExtras (format, seed, persona, speechLevel, pressureTier, pushback, norms, patterns, moves, drill…).
 * Partner-only fields (npcBrief, hiddenFacts, pushback, coaching) are blanked before a session reaches a client. */
export interface LessonPlan extends LessonPlanExtras {
  id: string; familyId: string; title: string; context: Context;
  goal: string; why: string; minutes: number; targetSkills: SkillId[];
  languageFocus: string; opening: string; role: string; npcBrief: string;
  hiddenFacts: string[]; successCriteria: string[]; difficulty: string;
  kind: 'calibration' | 'practice' | 'transfer' | 'retention';
  track?: LearningTrackId; activity?: LearningActivity;
  material?: { type: 'reading-passage' | 'writing-prompt'; text: string; instruction: string; source: 'generated' } | null;
}
export interface Turn {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: string;
  source: 'text' | 'audio'; support: Support; audioFile?: string;
  disputed?: boolean; originalText?: string;
  originalTranscript?: string; transcriptEdited?: boolean;
  speechTiming?: SpeechTiming;
}
/** Instrumental estimates from the original audio, never inferred from fluent ASR text. */
export interface SpeechTiming {
  version: 1; method: 'webrtc-vad'; source: 'server-audio'; audioFile: string;
  durationSeconds: number; detectedSpeechSeconds: number; speechSpanSeconds: number;
  leadingSilenceSeconds: number; trailingSilenceSeconds: number;
  internalPauseSeconds: number; longestPauseSeconds: number; internalPauseCount: number;
  pauseThresholdSeconds: number;
  segments: { startSeconds: number; endSeconds: number; kind: 'speech' | 'pause' | 'leading-silence' | 'trailing-silence' | 'gap' }[];
  quality: 'usable' | 'limited' | 'no-speech'; limitations: string[];
  recognizedWords: number | null; approximateWordsPerMinute: number | null;
  transcriptEdited: boolean;
}
export interface TimingFeedback {
  turnId: string; startSeconds: number; endSeconds: number; durationSeconds: number;
  observation: string; practice: string;
}
export interface Priority {
  type: 'language' | 'dialogue'; title: string; turnId: string; quote: string;
  explanation: string; example: string; retryInstruction: string;
  /** v0.5: what kind of real cost this is, and the linked communication pattern. */
  costKind?: CostCategory | null; patternId?: string | null;
}
export interface Evidence {
  skill: SkillId; result: EvidenceResult; turnId: string; quote: string;
  reason: string; opportunity: boolean; supported: boolean;
}
export interface Analysis {
  summary: string; strengths: string[]; priorities: Priority[];
  evidence: Evidence[]; nextFocus: string; limitations: string[];
  model: string; createdAt: string; version: number;
  timingFeedback?: TimingFeedback[];
  // v0.5 optional fields (older analyses lack them; clients must treat them as optional).
  outcome?: { achieved: 'yes' | 'partly' | 'no' | 'n/a'; what: string };
  languageErrors?: { turnId: string; quote: string; correction: string; tag: string; impact: 'meaning' | 'seniority' | 'minor' }[];
  minorErrorsIgnored?: number;
  patternHits?: { patternId: string; outcome: 'repeated' | 'avoided' | 'no-opportunity' | 'improved'; turnId: string; quote: string }[];
  /** Scores are 0, 1 or 2 (null = no opportunity in this lesson). */
  strategyMoves?: (Omit<StrategyMoveScore, 'score'> & { score: number | null })[];
  debatable?: { title: string; turnId: string; quote: string; forSide: string; againstSide: string; verdict: string }[];
  /** Invalid model items the server removed instead of failing the whole review. */
  dropped?: number;
}
export interface Session {
  id: string; lesson: LessonPlan; mode: Mode;
  status: 'active' | 'analysing' | 'review' | 'completed' | 'error';
  createdAt: string; updatedAt: string; turns: Turn[]; analysis: Analysis | null;
  retries: { id?: string; text: string; feedback: string; createdAt: string; audioFile?: string; improved?: boolean; analysisVersion?: number; originalTranscript?: string; transcriptEdited?: boolean; speechTiming?: SpeechTiming;
    /** v0.5 pushback round after an improved retry: the partner objects once; holding it = "stress-tested" (badge only, never required). */
    pushback?: { npcLine: string; audioFile?: string; reply: string | null; replyAudioFile?: string; held: boolean | null; feedback: string | null; createdAt: string } | null }[];
  support: Support; error?: string; comfort?: number;
  clientRequestId?: string; retryDeferred?: boolean;
  baseline?: { version: 1; stepId: BaselineStepId };
  processing?: { stage: 'queued' | 'evaluating' | 'waiting-retry' | 'responding'; startedAt: string; attempt?: number; nextAttemptAt?: string };
  completion?: { canComplete: boolean; needsRetry: boolean; reason: string | null };
  completedAt?: string;
  /** 0.5.3: which saved phrases this conversation used (PASS-0.5.3 §1.5); set when the conversation finishes. */
  phraseResults?: PhraseResult[];
}
export interface SkillState {
  id: SkillId; state: 'unknown' | 'supported' | 'provisional' | 'independent' | 'recheck';
  independentSuccesses: number; transfer: boolean; retention: boolean;
  lastChecked: string | null; examples: { sessionId: string; quote: string; reason: string }[];
}
export interface ReviewItem {
  id: string; skill: SkillId; focus: string; dueAt: string; intervalDays: number;
  sourceSessionId: string;
}
export interface AudioUsage {
  usedUsd: number; estimated: boolean; budgetUsd: number;
  recordedMinutes: number; spokenCharacters: number;
}
export interface AppState {
  /** Display identity of the backend that produced this state. */
  app?: { name: string; version: string };
  profile: Profile; sessions: Session[]; skills: SkillState[]; reviews: ReviewItem[];
  xp: number; completed: number; calibrationCompleted: number;
  audioUsage: AudioUsage;
  /** @deprecated v0.4 three-probe baseline. Replaced by `placement` in v0.5; kept only for old clients. */
  onboarding?: OnboardingState;
  progression?: ProgressionState;
  /** v0.5 placement test (always present from a v0.5 server). */
  placement?: PlacementView;
  /** v0.5 uploaded real calls, newest first (summaries only; GET /api/calls/:id for details). */
  calls?: CallSummary[];
  /** v0.5 recurring communication patterns across calls and practice. */
  patterns?: CommunicationPattern[];
  /** v0.5 personal drills generated from calls, patterns and the placement result. */
  drills?: PersonalDrill[];
  /** v0.5 facts about the learner suggested by call reviews (accepted ones feed the coach). */
  profileFacts?: ProfileFact[];
  /** 0.5.3 «Мои фразы»: saved with «Запомнить», newest first, archived included (PASS-0.5.3 §1). */
  phrases?: SavedPhrase[];
  /** 0.5.5 «Подготовка к созвону»: the latest preps, newest first (PASS-0.5.5 §2). */
  preps?: CallPrep[];
}
export interface PracticeQuality {
  observedTargets: number; targetCount: number; independentSuccesses: number;
  supportedObservations: number; partial: number; difficulty: number;
}
export interface PracticeResult {
  sessionId: string; xp: number; completedAt: string; track: LearningTrackId; activity: LearningActivity;
  improvedRetry: boolean; improvedAt?: string; quality: PracticeQuality;
  evidence: { skill: SkillId; result: 'success' | 'partial' | 'difficulty'; supported: boolean; turnId: string; quote: string }[];
}
export interface ProgressionState {
  version: 1; xp: number; level: number; levelTitle: string;
  levelFloorXP: number; nextLevelXP: number; xpInLevel: number; xpToNextLevel: number;
  completedPractice: number; practiceDays: number; practiceDayTimezone: 'UTC';
  evidenceCoverage: { observedSkills: number; observableSkills: number; independentSuccesses: number;
    supportedObservations: number; partial: number; difficulty: number };
  tracks: { id: LearningTrackId; title: string; description: string; completedSessions: number; targetSessions: number;
    activities: { id: LearningActivity; title: string; completedSessions: number; targetSessions: number }[] }[];
  achievements: { id: string; title: string; description: string; current: number; target: number; unlocked: boolean; unlockedAt: string | null }[];
  recentResults: PracticeResult[]; notice: string;
  recommendation?: { familyId: string; title: string; track: LearningTrackId; activity: LearningActivity; preferredMode: Mode; why: string;
    /** v0.5: when set, start with POST /api/sessions { drillId } instead of familyId. */
    drillId?: string | null;
    /** v0.5: what kind of next step this is, for the Today card copy. */
    source?: 'drill' | 'review' | 'pattern' | 'balance' } | null;
}
export type BaselineStepId = 'expression' | 'listening' | 'interaction';
export type CEFRBand = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export interface BaselineReport {
  version: 1; model: string; createdAt: string; provisional: true; summary: string;
  cefr: { from: CEFRBand; to: CEFRBand; confidence: 'low'; scope: string; reason: string } | null;
  skills: { skill: SkillId; observation: string; confidence: 'unobserved' | 'limited' | 'consistent';
    evidence: { sessionId: string; turnId: string; quote: string; result: EvidenceResult }[] }[];
  languageVsCommunication: { observation: string; russianQuote: string; limitation: string };
  priorities: string[]; limitations: string[]; nextFocus: string;
}
export interface OnboardingState {
  version: 1; status: 'intro' | 'baseline' | 'ready'; introCompletedAt: string | null;
  russianPrompt: string; russianControl: string | null; completedStages: number;
  steps: { id: BaselineStepId; familyId: string; title: string; focus: string; minutes: number;
    status: 'pending' | 'in_progress' | 'analysing' | 'ready'; sessionId: string | null; missingEvidence: string | null }[];
  report: BaselineReport | null;
}
export interface BrainStatus {
  mode?: 'codex' | 'siwc';
  connected: boolean; authenticated: boolean; model: string; modelAvailable: boolean;
  verified: boolean; authType: string | null; plan: string | null; error?: string;
}

export interface SubscriptionWindow {
  id: string; bucketId: string; bucketName: string | null; kind: 'primary' | 'secondary';
  usedPercent: number | null; remainingPercent: number | null;
  windowDurationMins: number | null; resetsAt: string | null;
}
export interface SubscriptionUsage {
  source: 'codex' | 'siwc'; available: boolean; scope: 'account' | 'app' | 'unknown';
  checkedAt: string | null; stale: boolean; windows: SubscriptionWindow[];
  plan: string | null; error?: string;
  manageUrl?: string;
  activity?: { scope: 'app'; periodDays: number; requests: number; successful: number; failed: number; lastRequestAt: string | null; lastLimitAt: string | null; retryAt: string | null; averageLatencyMs: number | null };
}
