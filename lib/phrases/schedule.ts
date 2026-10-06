// «Мои фразы» spaced schedule (planning/v05/PASS-0.5.3.md §1.4). Pure functions shared by the server and both clients' logic;
// the iPhone mirrors the readers (mostlyLatin … duePhraseCount) in ios/Sources/PhrasesModels.swift. The update rules and the
// round/weave selection below run on the server only.
import { PHRASE_INTERVAL_DAYS, PHRASE_LEARNED_STAGE, PHRASE_ROUND_LIMIT, PHRASE_WEAVE_LIMIT, type PhraseHistoryResult, type SavedPhrase } from './types';

const time = (value: string | null | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; };
const DAY_MS = 86_400_000;
/** A phrase woven into an ordinary session is not woven again within 20 hours. */
export const PHRASE_WEAVE_COOLDOWN_MS = 20 * 3_600_000;
export const PHRASE_HISTORY_LIMIT = 12;

/** Mostly Latin letters: an English text can be its own target when Sol could not enrich it. */
export function mostlyLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  return letters.filter(letter => /[A-Za-z]/.test(letter)).length / letters.length >= 0.8;
}

/** The English expression a round or a session practises, or null when there is none yet. */
export function phraseTarget(phrase: Pick<SavedPhrase, 'enrichment' | 'phrase' | 'text'>): string | null {
  if (phrase.enrichment === 'ready' && phrase.phrase?.trim()) return phrase.phrase.trim();
  if (phrase.enrichment !== 'pending' && mostlyLatin(phrase.text)) return phrase.text.trim();
  return null;
}

/** Can come back in practice at all: not archived, not learned, has an English target. */
export function phraseIsUsable(phrase: SavedPhrase): boolean {
  return !phrase.archived && phrase.status !== 'learned' && phraseTarget(phrase) !== null;
}

/** Waiting for practice now (new phrases are due at once). */
export function isPhraseDue(phrase: SavedPhrase, now = Date.now()): boolean {
  return phraseIsUsable(phrase) && time(phrase.dueAt) <= now;
}

/** «N ждут повторения» on Today, Practice, the phrases sheet and the launch line. */
export function duePhraseCount(phrases: readonly SavedPhrase[] | null | undefined, now = Date.now()): number {
  return (phrases ?? []).filter(phrase => isPhraseDue(phrase, now)).length;
}

/** Practised phrases by due date first, then new ones, oldest first. */
function practiceOrder(phrases: readonly SavedPhrase[]): SavedPhrase[] {
  const byDue = (left: SavedPhrase, right: SavedPhrase) => time(left.dueAt) - time(right.dueAt)
    || time(left.createdAt) - time(right.createdAt) || left.id.localeCompare(right.id);
  return [...phrases.filter(phrase => phrase.status !== 'new').sort(byDue), ...phrases.filter(phrase => phrase.status === 'new').sort(byDue)];
}

/** A «Мои фразы» round (§1.5.1): up to 5 due phrases, due ones by dueAt first, then new; never archived, learned or unusable. */
export function phraseRoundCandidates(phrases: readonly SavedPhrase[] | null | undefined, now = Date.now(), limit = PHRASE_ROUND_LIMIT): SavedPhrase[] {
  return practiceOrder((phrases ?? []).filter(phrase => isPhraseDue(phrase, now))).slice(0, Math.max(0, limit));
}

/** Phrases an ordinary speaking session may weave in (§1.5.2): due, usable and not offered in the last 20 hours. */
export function phraseWeaveCandidates(phrases: readonly SavedPhrase[] | null | undefined, now = Date.now(), limit = PHRASE_WEAVE_LIMIT): SavedPhrase[] {
  return practiceOrder((phrases ?? []).filter(phrase => isPhraseDue(phrase, now)
    && (!phrase.lastOfferedAt || now - time(phrase.lastOfferedAt) >= PHRASE_WEAVE_COOLDOWN_MS))).slice(0, Math.max(0, limit));
}

/** What a finished conversation means for one phrase: said alone, said after a hint, missed in a round, or only offered. */
export function phraseOutcome(use: { used: boolean; hinted: boolean }, round: boolean): PhraseHistoryResult {
  return use.used ? (use.hinted ? 'hinted' : 'used') : round ? 'missed' : 'offered';
}

/**
 * The schedule after one practice (§1.4): an independent use climbs the 1-3-7-16-35-day ladder (stage 5 = learned); a hinted use
 * keeps the stage and comes back tomorrow; a miss in a round steps down and comes back tomorrow; a woven phrase that never came up
 * only records the offer. Pure; a session already in the history changes nothing (idempotent per session).
 */
export function applyPhraseOutcome<T extends SavedPhrase>(phrase: T, result: PhraseHistoryResult, sessionId: string, now = Date.now(),
  options: { woven?: boolean } = {}): T {
  if (phrase.history.some(item => item.sessionId === sessionId)) return phrase;
  const at = new Date(now).toISOString();
  const next: T = { ...phrase, updatedAt: at,
    history: [{ at, sessionId, result }, ...phrase.history].slice(0, PHRASE_HISTORY_LIMIT),
    ...(options.woven || result === 'offered' ? { lastOfferedAt: at } : {}) };
  const stage = Math.min(PHRASE_LEARNED_STAGE, Math.max(0, Math.floor(Number.isFinite(phrase.stage) ? phrase.stage : 0)));
  if (result === 'used') {
    const reached = Math.min(PHRASE_LEARNED_STAGE, stage + 1);
    return { ...next, stage: reached, status: reached >= PHRASE_LEARNED_STAGE ? 'learned' : 'learning',
      dueAt: new Date(now + PHRASE_INTERVAL_DAYS[reached - 1] * DAY_MS).toISOString(), lastPracticedAt: at };
  }
  if (result === 'hinted') {
    return { ...next, stage, status: phrase.status === 'new' ? 'learning' : phrase.status, dueAt: new Date(now + DAY_MS).toISOString(), lastPracticedAt: at };
  }
  if (result === 'missed') {
    const lowered = Math.max(0, stage - 1);
    return { ...next, stage: lowered, status: lowered >= PHRASE_LEARNED_STAGE ? 'learned' : 'learning',
      dueAt: new Date(now + DAY_MS).toISOString(), lastPracticedAt: at };
  }
  return next;
}
