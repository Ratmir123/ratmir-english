export const SKILLS = [
  { id: 'listening', label: 'Понимание на слух', group: 'language' },
  { id: 'vocabulary', label: 'Активный английский', group: 'language' },
  { id: 'grammar', label: 'Построение фраз', group: 'language' },
  { id: 'clarity', label: 'Понятность речи', group: 'language' },
  { id: 'coherence', label: 'Содержание и логика', group: 'dialogue' },
  { id: 'reciprocity', label: 'Использование услышанного', group: 'dialogue' },
  { id: 'initiative', label: 'Управление разговором', group: 'dialogue' },
  { id: 'repair', label: 'Уточнение и восстановление', group: 'dialogue' },
] as const;
export type SkillId = typeof SKILLS[number]['id'];
export type Context = 'work' | 'life' | 'relocation';
export type Mode = 'learning' | 'call';
export type EvidenceResult = 'success' | 'partial' | 'difficulty' | 'unobserved' | 'disputed';
export type Support = 0 | 1 | 2 | 3;
export interface Profile {
  name: string; goals: string; interests: string[]; professionalContext: string;
  relocation: string; dailyMinutes: number; feedback: string;
  audioRetentionDays: number; budgetUsd: number;
}
export interface LessonPlan {
  id: string; familyId: string; title: string; context: Context;
  goal: string; why: string; minutes: number; targetSkills: SkillId[];
  languageFocus: string; opening: string; role: string; npcBrief: string;
  hiddenFacts: string[]; successCriteria: string[]; difficulty: string;
  kind: 'calibration' | 'practice' | 'transfer' | 'retention';
}
export interface Turn {
  id: string; role: 'user' | 'assistant'; text: string; createdAt: string;
  source: 'text' | 'audio'; support: Support; audioFile?: string;
  disputed?: boolean; originalText?: string;
  originalTranscript?: string; transcriptEdited?: boolean;
}
export interface Priority {
  type: 'language' | 'dialogue'; title: string; turnId: string; quote: string;
  explanation: string; example: string; retryInstruction: string;
}
export interface Evidence {
  skill: SkillId; result: EvidenceResult; turnId: string; quote: string;
  reason: string; opportunity: boolean; supported: boolean;
}
export interface Analysis {
  summary: string; strengths: string[]; priorities: Priority[];
  evidence: Evidence[]; nextFocus: string; limitations: string[];
  model: string; createdAt: string; version: number;
}
export interface Session {
  id: string; lesson: LessonPlan; mode: Mode;
  status: 'active' | 'analysing' | 'review' | 'completed' | 'error';
  createdAt: string; updatedAt: string; turns: Turn[]; analysis: Analysis | null;
  retries: { id?: string; text: string; feedback: string; createdAt: string; audioFile?: string; improved?: boolean; analysisVersion?: number; originalTranscript?: string; transcriptEdited?: boolean }[];
  support: Support; error?: string; comfort?: number;
  clientRequestId?: string; retryDeferred?: boolean;
  processing?: { stage: 'queued' | 'evaluating' | 'waiting-retry' | 'responding'; startedAt: string; attempt?: number; nextAttemptAt?: string };
  completion?: { canComplete: boolean; needsRetry: boolean; reason: string | null };
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
  profile: Profile; sessions: Session[]; skills: SkillState[]; reviews: ReviewItem[];
  xp: number; completed: number; calibrationCompleted: number;
  audioUsage: AudioUsage;
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
