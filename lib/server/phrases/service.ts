import { randomUUID } from 'node:crypto';
import { connection, transaction } from '../db';
import { ApiError } from '../security';
import { PHRASES_FAMILY, type LessonPlanV05 } from '../../training';
import type { Session } from '../../types';
import { PHRASE_TEXT_LIMIT, type PhraseOrigin, type PhraseResult, type SavedPhrase, type UpdatePhraseRequest } from '../../phrases/types';
import { applyPhraseOutcome, phraseOutcome, phraseRoundCandidates, phraseTarget, phraseWeaveCandidates } from '../../phrases/schedule';
import { findPhraseUse } from '../../phrases/usage';
import { enqueuePhraseEnrichment } from './queue';
import { type StoredPhrase, countPhrasesCreatedSince, deletePhraseRow, normalisedPhraseText, presentPhrase, readPhrase, readPhrases,
  touchedAt, writePhrase } from './repository';

/** «Запомнить» → «Мои фразы» on the server (PASS-0.5.3 §1.1–§1.5). Errors are short and Russian. */
export const PHRASE_DAILY_LIMIT = 200;
export const PHRASE_ORIGINS: readonly PhraseOrigin[] = ['desktop', 'iphone', 'web'];
export const PHRASE_NOT_FOUND = 'Фраза не найдена.';
export const PHRASE_DAILY_LIMIT_MESSAGE = 'На сегодня хватит — завтра продолжим.';

/** The current Moscow day (the daily cap), as the UTC instant it starts. Moscow is UTC+3 all year. */
export function moscowDayStart(now = Date.now()): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  return new Date(`${day}T00:00:00+03:00`).toISOString();
}

/** §1.2: 1–600 characters after trimming, with at least one letter. */
export function validPhraseText(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new ApiError('Напиши, что запомнить.', 400);
  const text = input.trim();
  if (text.length > PHRASE_TEXT_LIMIT) throw new ApiError('Слишком длинно: до 600 символов.', 400);
  if (!/\p{L}/u.test(text)) throw new ApiError('Нужны слова, а не только знаки.', 400);
  return text;
}

function validOrigin(input: unknown): PhraseOrigin {
  if (typeof input === 'string' && (PHRASE_ORIGINS as readonly string[]).includes(input)) return input as PhraseOrigin;
  throw new ApiError('Проверь введённые данные.', 400);
}

/**
 * Save a phrase instantly; Sol enriches it in the background. The same normalised text already saved (archived included) returns
 * that phrase with duplicate: true. At most 200 new phrases per Moscow day.
 */
export function createPhrase(input: { text: unknown; origin: unknown }, now = Date.now()): { phrase: SavedPhrase; duplicate: boolean } {
  const text = validPhraseText(input.text);
  const origin = validOrigin(input.origin);
  const key = normalisedPhraseText(text);
  const { db } = connection();
  const result = transaction(db, () => {
    const existing = readPhrases(db).find(phrase => normalisedPhraseText(phrase.text) === key);
    if (existing) return { phrase: presentPhrase(existing), duplicate: true };
    if (countPhrasesCreatedSince(db, moscowDayStart(now)) >= PHRASE_DAILY_LIMIT) throw new ApiError(PHRASE_DAILY_LIMIT_MESSAGE, 429);
    const at = new Date(now).toISOString();
    const stored: StoredPhrase = { id: randomUUID(), text, origin, createdAt: at, updatedAt: at, enrichment: 'pending',
      phrase: null, meaning: null, note: null, example: null, exampleRu: null, cue: null, situation: null,
      status: 'new', stage: 0, dueAt: at, lastPracticedAt: null, lastOfferedAt: null, history: [], archived: false,
      enrichJob: { attempts: 0, lastAttemptAt: null, token: null } };
    writePhrase(db, stored);
    return { phrase: presentPhrase(stored), duplicate: false };
  });
  // After the commit: the queue opens its own transactions.
  if (!result.duplicate) enqueuePhraseEnrichment(result.phrase.id);
  return result;
}

export function getPhrase(id: string): SavedPhrase {
  const stored = readPhrase(connection().db, id);
  if (!stored) throw new ApiError(PHRASE_NOT_FOUND, 404);
  return presentPhrase(stored);
}

/**
 * «Уже знаю» / «Вернуть в повторение» / «Повторить разбор». relearn → learning, stage 3, due now (and no longer archived).
 * retryEnrichment re-runs Sol for a phrase that is not ready, with a fresh set of attempts.
 */
export function updatePhrase(id: string, patch: UpdatePhraseRequest, now = Date.now()): SavedPhrase {
  const { db } = connection();
  let requeue = false;
  const phrase = transaction(db, () => {
    const stored = readPhrase(db, id);
    if (!stored) throw new ApiError(PHRASE_NOT_FOUND, 404);
    let next: StoredPhrase = { ...stored };
    let changed = false;
    if (typeof patch.archived === 'boolean' && patch.archived !== !!stored.archived) { next.archived = patch.archived; changed = true; }
    if (patch.relearn === true) {
      next = { ...next, archived: false, status: 'learning', stage: 3, dueAt: new Date(now).toISOString() };
      changed = true;
    }
    if (patch.retryEnrichment === true && stored.enrichment !== 'ready') {
      next = { ...next, enrichment: 'pending', phrase: null, meaning: null, note: null, example: null, exampleRu: null, cue: null,
        situation: null, enrichJob: { attempts: 0, lastAttemptAt: null, token: null } };
      changed = true; requeue = true;
    }
    if (!changed) return presentPhrase(stored);
    next.updatedAt = touchedAt(stored.updatedAt, now);
    writePhrase(db, next);
    return presentPhrase(next);
  });
  if (requeue) enqueuePhraseEnrichment(id);
  return phrase;
}

/** Idempotent: deleting a phrase that is already gone is not an error (the client's undo queue may resend). */
export function deletePhrase(id: string): boolean {
  return deletePhraseRow(connection().db, id);
}

/** Every saved phrase (not only the 500 in /api/state), for eligibility. */
export function allPhrases(): SavedPhrase[] {
  return readPhrases(connection().db).map(presentPhrase);
}

/** §1.5.1: what POST /api/sessions { phraseRound: true } practises (empty → 409). */
export function phraseRoundSelection(now = Date.now()): SavedPhrase[] {
  return phraseRoundCandidates(allPhrases(), now);
}

/** §1.5.2: what an ordinary speaking session may weave in. */
export function phraseWeaveSelection(now = Date.now()): SavedPhrase[] {
  return phraseWeaveCandidates(allPhrases(), now);
}

/**
 * The finish hook (§1.5.3): when a conversation with phraseIds finishes, the learner's own turns are checked for every phrase,
 * each phrase's schedule moves (§1.4) and session.phraseResults is stored, in one transaction. Idempotent per session: a session
 * that already has results (a repeated finish, a reanalysis) changes nothing. Returns the updated session, or null when nothing
 * was recorded. Never throws: the finish itself must not fail because of phrases.
 */
export function recordPhraseResults(sessionId: string, now = Date.now()): Session | null {
  try {
    const { db } = connection();
    return transaction(db, () => {
      const row = db.prepare('SELECT data FROM sessions WHERE id=?').get(sessionId) as { data: string } | undefined;
      if (!row) return null;
      const session = JSON.parse(row.data) as Session;
      const lesson = session.lesson as LessonPlanV05;
      const ids = lesson.phraseIds ?? [];
      if (!ids.length || session.phraseResults) return null;
      const round = lesson.familyId === PHRASES_FAMILY.id;
      const turns = session.turns.filter(turn => turn.role === 'user' && !turn.disputed);
      const results: PhraseResult[] = [];
      ids.forEach((id, index) => {
        if (ids.indexOf(id) !== index) return;
        const stored = readPhrase(db, id);
        if (!stored) return;
        // A phrase re-enriched mid-round still has the target the round was planned with.
        const target = phraseTarget(stored) ?? (round ? lesson.mustInclude?.[index]?.trim() || null : null);
        if (!target) return;
        const use = findPhraseUse(target, turns);
        const updated = applyPhraseOutcome(stored, phraseOutcome(use, round), session.id, now, { woven: !round });
        if (updated !== stored) writePhrase(db, { ...updated, updatedAt: touchedAt(stored.updatedAt, now) });
        results.push({ phraseId: id, phrase: target, meaning: stored.meaning ?? null, used: use.used, hinted: use.hinted, quote: use.quote });
      });
      session.phraseResults = results;
      session.updatedAt = touchedAt(session.updatedAt, now);
      db.prepare('UPDATE sessions SET updated_at=?, data=? WHERE id=?').run(session.updatedAt, JSON.stringify(session), session.id);
      return session;
    });
  } catch {
    return null;
  }
}
