/**
 * Real calls, communication patterns, personal drills and the learner's playbook — shared contract between
 * the server, the web/PC client and the iPhone client. Russian coaching, English quotes and model answers.
 * Keep this file free of server-only imports: it is bundled into the web client.
 */
import type { StrategyMoveScore } from '../strategy-moves';

export type CallContext = 'work' | 'life' | 'relocation' | 'other';
export type CallStatus =
  | 'awaiting-upload'   // created, waiting for chunked PUT /api/calls/:id/upload + /upload/complete
  | 'queued'            // stored, waiting for the worker
  | 'processing'        // audio extraction / transcription in progress (see progress)
  | 'needs-speaker'     // transcript ready, the learner must confirm which speaker is him
  | 'analysing'         // Sol is writing the review
  | 'ready'
  | 'error';
/** audio/video file, transcript text (Whisper lines, "Name: text", .vtt/.sbv), a coach's Markdown debrief,
 * or a typed recollection of an unrecorded call ('memory' → reduced strategy-only review, no quotes). */
export type CallSourceType = 'audio' | 'transcript' | 'debrief' | 'memory';

export interface CallSpeaker {
  id: string;                 // 'A', 'B', … or 'me' when matched by voice reference
  label: string;              // display name, e.g. 'Ты', 'Claire', 'Собеседник 1'
  isMe: boolean;
  talkSeconds: number | null;
  sample: string[];           // up to 3 short lines to help the learner recognise the speaker
}

export interface CallSegment {
  id: string;                 // 's0', 's1', …
  speaker: string | null;     // CallSpeaker.id, null when unknown
  start: number | null;       // seconds from the start of the call
  end: number | null;
  text: string;               // diarized text (timestamps come from here)
  /** Learner segments only: verbatim re-transcription (fillers, false starts kept). Language analysis uses this. */
  verbatim?: string | null;
  /** Learner marked this line as mis-heard by ASR; never used to teach. */
  disputed?: boolean;
}

export interface CallMetrics {
  myTalkShare: number | null;          // 0–1 share of speaking time (null without timestamps)
  myWordsPerMinute: number | null;
  longestMonologueSeconds: number | null;
  myTurns: number; otherTurns: number;
  myQuestions: number;                 // informational only, never a quota
  /** Median gap between the end of the counterpart's line and the start of his reply (real conversational latency). */
  responseLatencyMedianSeconds: number | null;
  fillersPerMinute: number | null;     // from his verbatim segments
  /** Counterpart said "sorry?", "what?", "could you repeat" right after his line — the only honest intelligibility proxy. */
  clarifyRequests: number;
}

export type CostCategory = 'positioning' | 'negotiation' | 'confidentiality' | 'structure' | 'questions'
  | 'closing' | 'listening' | 'language' | 'fluency' | 'other';
/** Outcome of a known pattern in one source. 'avoided' = had the opportunity and did it right; 'no-opportunity' changes nothing. */
export type PatternOutcome = 'repeated' | 'avoided' | 'no-opportunity' | 'improved' | 'new';

export interface DealModel {
  currency: 'USD' | 'EUR';
  fixedFee: number;                    // per deliverable
  percent: number | null;              // e.g. 3 for "3% of ad spend"
  base: string | null;                 // Russian: what the percent applies to
  floor: number | null;                // learner's floor for this deliverable type (from the playbook)
  scenarios: number[];                 // spend/base values to tabulate
}

export interface CallReview {
  version: number; model: string; createdAt: string;
  /** True for a 'memory' source: strategy only, no quotes, no language or timing analysis. */
  fromMemory: boolean;
  kind: string;                         // Russian short type, e.g. 'Скрининг агентства', 'Переговоры о цене'
  outcome: string;                      // Russian: итог звонка, 1–2 sentences
  summary: string;                      // Russian: 2–4 sentences
  timeline: { at: number | null; title: string; detail: string }[];               // ход звонка
  agreedTerms: { term: string; value: string; quote: string | null; at: number | null; clarity: 'explicit' | 'implied' | 'unclear' }[];
  nextStep: { who: string; what: string; when: string | null; explicit: boolean } | null;
  dealModel: DealModel | null;
  /** Server-computed from dealModel (never written by the model). */
  dealTable: { base: number; percentFee: number; total: number }[] | null;
  /** Base value at which fixedFee + percent reaches the floor (null if not applicable). */
  breakEven: number | null;
  wins: { title: string; detail: string; quote: string | null; at: number | null }[];          // что сработало
  costs: { rank: number; title: string; detail: string; quote: string | null; at: number | null;
    segmentId: string | null; category: CostCategory; impact: 'high' | 'medium' | 'low';
    patternId: string | null;
    impactUsd: number | null;           // only when the numbers are in the call or the playbook
    impactBasis: string | null;         // Russian formula/explanation for impactUsd
    better: string }[];                 // что стоило денег, по порядку цены; better = English line in his voice
  debatable: { title: string; quote: string | null; at: number | null; forSide: string; againstSide: string; verdict: string }[];
  /** Only errors that change meaning or lower perceived seniority (≤ 8); minor slips are only counted. */
  language: { quote: string; correction: string; why: string; at: number | null; tag: string;
    impact: 'meaning' | 'seniority' | 'minor'; asrSuspect: boolean }[];
  minorErrorsIgnored: number;
  /** situation Russian, answer English; trigger = the counterpart's exact line that prompted it. */
  betterAnswers: { situation: string; answer: string; trigger: string | null; at: number | null }[];
  followUp: { channel: 'email' | 'message'; subject: string | null; text: string; notes: string[] } | null; // English text with [[placeholders]], Russian notes
  risks: { title: string; detail: string }[];
  /** A status for EVERY active pattern, plus new ones (max 3 new, each with a quote). */
  patterns: { patternId: string; status: PatternOutcome; evidence: string }[];
  strategyMoves: StrategyMoveScore[];
  limitations: string[];
  /** Server note when invalid items were dropped instead of failing the whole review. */
  dropped: number;
}

export type FactKind = 'rate' | 'floor' | 'case' | 'metric' | 'confidential' | 'relocation' | 'counterpart' | 'positioning' | 'preference' | 'other';

/** Accepted facts form the learner's PLAYBOOK used by the planner, partner, hints and evaluator. */
export interface ProfileFact {
  id: string;
  kind: FactKind;
  text: string;                         // Russian, e.g. 'Агентства: €600/день или от €3 000 за ролик'
  quote: string | null;                 // supporting line from the source, if any
  at: number | null;
  source: { type: 'call'; callId: string } | { type: 'manual' } | { type: 'seed' };
  status: 'suggested' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface CallSummary {
  id: string;
  title: string;
  counterpart: string | null;
  context: CallContext;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: CallSourceType;
  status: CallStatus;
  progress: { stage: string; percent: number } | null; // Russian stage label
  durationSeconds: number | null;
  outcome: string | null;               // review.outcome when ready
  topCost: string | null;               // review.costs[0].title when ready
  drillsTotal: number;
  drillsDone: number;
  /** Bytes already stored for an audio upload (resume point), null otherwise. */
  uploadedBytes: number | null;
  error: string | null;
}

export interface CallDetail extends CallSummary {
  notes: string | null;                 // learner's context/goal before analysis
  speakers: CallSpeaker[];
  segments: CallSegment[];
  metrics: CallMetrics | null;
  review: CallReview | null;
  facts: ProfileFact[];                 // facts suggested by this call
  drills: PersonalDrill[];              // drills generated from this call
  audioUrl: string | null;              // relative API path to the processed audio, e.g. 'calls/<id>/audio'
  /** Raw call audio is deleted after this date (privacy; transcript and review stay). */
  audioExpiresAt: string | null;
}

export interface CommunicationPattern {
  id: string;                           // stable slug, e.g. 'beginner-framing'
  title: string;                        // Russian, e.g. 'Подаёшь себя новичком'
  kind: 'weakness' | 'strength';
  category: CostCategory;
  description: string;                  // Russian: what it looks like and why it costs
  /** 'watch' = seen once, not yet confirmed; 'active' after confirmation or a second source. */
  status: 'watch' | 'active' | 'improving' | 'resolved';
  costRank: 1 | 2 | 3 | 4 | 5;          // 1 = most expensive
  contexts: ('work' | 'life' | 'relocation')[]; // rules apply only there (age talk among friends is fine)
  occurrences: number;
  firstSeenAt: string; lastSeenAt: string;
  /** Rounds per pattern (his K/D): real calls vs practice, evidence-based. */
  real: { opportunities: number; avoided: number; repeated: number };
  practice: { attempts: number; independentSuccesses: number; lastAt: string | null };
  /** Chronological per-source outcome for the cross-call table (oldest first). ● repeated ○ avoided · no-opportunity ◐ improved. */
  history: { source: 'call' | 'practice' | 'placement'; sourceId: string; date: string; status: PatternOutcome }[];
  evidence: { source: 'call' | 'practice' | 'placement'; sourceId: string; quote: string; at: number | null; date: string; status: PatternOutcome }[]; // latest first, max 5
  drillHint: string;                    // Russian: what to practise
  userConfirmed: boolean;
  dismissed: boolean;
  userNote: string | null;
}

export type DrillType = 'replay' | 'pitch' | 'price' | 'questions' | 'closing' | 'language' | 'story' | 'followup' | 'rapidfire' | 'cards';

export interface PersonalDrill {
  id: string;
  type: DrillType;
  title: string;                        // Russian
  why: string;                          // Russian: link to the real moment or pattern, e.g. «В звонке с клиентом (08:13) ты согласился сразу»
  goal: string;                         // Russian: observable success effect
  seedLine: string | null;              // English counterpart line to replay (exact or lightly cleaned quote)
  counterpartRole: string | null;       // English, e.g. 'startup co-founder, friendly, fast, uses fillers'
  context: 'work' | 'life' | 'relocation';
  source: { type: 'call'; callId: string; at: number | null } | { type: 'pattern'; patternId: string } | { type: 'placement' };
  patternIds: string[];
  tier: 1 | 2 | 3;                      // pressure tier
  successCriteria: string[];            // Russian, observable, 2–4 items
  pushback: string[];                   // English NPC escalation lines by tier
  mustInclude: string[];                // deterministic checks (keywords/facts)
  mustAvoid: string[];                  // e.g. 'just started', 'AI native'
  dueAt: string | null;                 // spaced schedule: today, +2, +5, +12 days until 2 independent successes
  attempts: number;
  status: 'new' | 'started' | 'done';   // derived from the linked session
  sessionId: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Request bodies (validated server-side with zod). */
export interface CreateCallRequest {
  title?: string; counterpart?: string; context?: CallContext; occurredAt?: string;
  notes?: string;                       // goal / prep notes before the call
  source:
    | { type: 'audio'; fileName: string; bytes: number; mime: string }
    | { type: 'transcript'; fileName?: string; text: string; referenceDebrief?: string }
    | { type: 'debrief'; text: string }
    | { type: 'memory'; text: string };
}
export interface ConfirmSpeakersRequest { me: string; labels?: Record<string, string> }
export interface UpdateCallRequest { title?: string; counterpart?: string; context?: CallContext; occurredAt?: string | null; notes?: string | null }
export interface FactDecisionRequest { factId: string; decision: 'accept' | 'reject' }
export interface PatternUpdateRequest { confirm?: boolean; dismiss?: boolean; note?: string | null }
export interface SegmentDisputeRequest { segmentId: string; disputed: boolean }

export const MAX_CALL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
/** Uploads are sent as sequential resumable chunks (PUT calls/:id/upload with X-Upload-Offset). */
export const CALL_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB
/** Raw call audio retention (privacy). Transcript, review, patterns and drills stay until deleted. */
export const CALL_AUDIO_RETENTION_DAYS = 30;
export const CALL_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'mp4', 'mov', 'wav', 'webm', 'ogg', 'oga', 'opus', 'aac', 'flac', 'mkv'] as const;
export const CALL_TRANSCRIPT_EXTENSIONS = ['txt', 'vtt', 'sbv', 'srt', 'md'] as const;
