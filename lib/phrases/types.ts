// «Мои фразы» (planning/v05/PASS-0.5.3.md §1): what the learner saved with «Запомнить» and how it comes back in practice.
// Shared by the server (lib/server/phrases/*), the web client and, field for field, the iPhone (ios/Sources/PhrasesModels.swift).

export type PhraseStatus = 'new' | 'learning' | 'learned';
export type PhraseOrigin = 'desktop' | 'iphone' | 'web';
export type PhraseEnrichment = 'pending' | 'ready' | 'failed';
export type PhraseHistoryResult = 'used' | 'hinted' | 'missed' | 'offered';

export interface SavedPhrase {
  id: string;
  /** What the learner saved, trimmed, 1–600 characters (an English expression or a Russian «как сказать …»). */
  text: string;
  origin: PhraseOrigin;
  createdAt: string;
  updatedAt: string;
  /** Sol fills the fields below in the background; `failed` keeps the phrase usable when `text` itself is English. */
  enrichment: PhraseEnrichment;
  /** English target expression, e.g. "be on the same page". */
  phrase: string | null;
  /** Russian meaning. */
  meaning: string | null;
  /** Russian usage note or nuance (or, when enrichment failed, why). */
  note: string | null;
  /** English example sentence about the learner's own life or work. */
  example: string | null;
  exampleRu: string | null;
  /** Russian recall cue that never contains the target words. */
  cue: string | null;
  /** English counterpart line that invites the expression without saying it (opens a phrase round turn). */
  situation: string | null;
  status: PhraseStatus;
  /** 0..5: independent uses so far on the 1-3-7-16-35-day ladder. */
  stage: number;
  /** A new phrase is due at once. */
  dueAt: string;
  lastPracticedAt: string | null;
  /** Last time it was woven into an ordinary practice session (not re-woven within 20 h). */
  lastOfferedAt: string | null;
  /** Newest first, at most 12. */
  history: { at: string; sessionId: string; result: PhraseHistoryResult }[];
  /** «Уже знаю»: kept in the list, never offered. */
  archived: boolean;
}

/** Stored on a session when its conversation finishes (a phrase round or a session the phrases were woven into). */
export interface PhraseResult {
  phraseId: string;
  phrase: string;
  meaning: string | null;
  used: boolean;
  /** Used, but after a hint in that turn: the schedule does not advance. */
  hinted: boolean;
  /** The learner sentence that used it (≤160 characters). */
  quote: string | null;
}

export interface CreatePhraseRequest { text: string; origin: PhraseOrigin }
export interface CreatePhraseResponse { phrase: SavedPhrase; duplicate: boolean }
export interface UpdatePhraseRequest { archived?: boolean; relearn?: true; retryEnrichment?: true }

export const PHRASE_TEXT_LIMIT = 600;
/** Phrases in one round. */
export const PHRASE_ROUND_LIMIT = 5;
/** Phrases woven into one ordinary practice session. */
export const PHRASE_WEAVE_LIMIT = 2;
/** Days until the next practice after an independent use that reached this stage (index = new stage − 1). */
export const PHRASE_INTERVAL_DAYS = [1, 3, 7, 16, 35] as const;
export const PHRASE_LEARNED_STAGE = 5;
