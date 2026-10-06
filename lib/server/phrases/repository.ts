import type { DatabaseSync } from 'node:sqlite';
import { registerTables } from '../db';
import type { SavedPhrase } from '../../phrases/types';

/**
 * «Мои фразы» storage (PASS-0.5.3 §1.1): one row per saved phrase in `saved_phrases`, the phrase itself as JSON in `data`.
 * The enrichment bookkeeping travels in the same JSON under `enrichJob` and is stripped before a phrase reaches a client.
 */
export interface EnrichmentJob {
  /** Sol attempts so far (3 at most before the phrase is marked failed). */
  attempts: number;
  lastAttemptAt: string | null;
  /** The attempt currently in flight; a late or superseded result with another token is dropped. */
  token: string | null;
}
export type StoredPhrase = SavedPhrase & { enrichJob?: EnrichmentJob };

export const PHRASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Phrases in /api/state: newest first, archived included. */
export const PHRASES_IN_STATE = 500;

export function initPhraseTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_phrases (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS saved_phrases_created ON saved_phrases(created_at);
  `);
}
registerTables(initPhraseTables);

type Row = { data: string };

export function readPhrase(db: DatabaseSync, id: string): StoredPhrase | null {
  const row = db.prepare('SELECT data FROM saved_phrases WHERE id=?').get(id) as Row | undefined;
  return row ? JSON.parse(row.data) as StoredPhrase : null;
}

export function writePhrase(db: DatabaseSync, phrase: StoredPhrase): void {
  db.prepare(`INSERT INTO saved_phrases(id,created_at,updated_at,data) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data`)
    .run(phrase.id, phrase.createdAt, phrase.updatedAt, JSON.stringify(phrase));
}

export function deletePhraseRow(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare('DELETE FROM saved_phrases WHERE id=?').run(id).changes) > 0;
}

/** Every stored phrase, newest first. */
export function readPhrases(db: DatabaseSync, limit?: number): StoredPhrase[] {
  const rows = (limit === undefined
    ? db.prepare('SELECT data FROM saved_phrases ORDER BY created_at DESC, id').all()
    : db.prepare('SELECT data FROM saved_phrases ORDER BY created_at DESC, id LIMIT ?').all(limit)) as Row[];
  return rows.map(row => JSON.parse(row.data) as StoredPhrase);
}

/** Phrases still waiting for Sol. */
export function readPendingPhrases(db: DatabaseSync): StoredPhrase[] {
  return (db.prepare(`SELECT data FROM saved_phrases WHERE json_extract(data,'$.enrichment')='pending' ORDER BY created_at, id`).all() as Row[])
    .map(row => JSON.parse(row.data) as StoredPhrase);
}

export function countPhrasesCreatedSince(db: DatabaseSync, since: string): number {
  return Number((db.prepare('SELECT COUNT(*) AS count FROM saved_phrases WHERE created_at>=?').get(since) as { count: number }).count);
}

/** Monotonic updatedAt so clients can see every change. */
export function touchedAt(previous: string, now = Date.now()): string {
  const before = Date.parse(previous);
  return new Date(Math.max(now, Number.isFinite(before) ? before + 1 : now)).toISOString();
}

/** The client view: the shared SavedPhrase shape only (no enrichment bookkeeping), with safe defaults for old rows. */
export function presentPhrase(stored: StoredPhrase): SavedPhrase {
  return {
    id: stored.id, text: stored.text, origin: stored.origin, createdAt: stored.createdAt, updatedAt: stored.updatedAt,
    enrichment: stored.enrichment, phrase: stored.phrase ?? null, meaning: stored.meaning ?? null, note: stored.note ?? null,
    example: stored.example ?? null, exampleRu: stored.exampleRu ?? null, cue: stored.cue ?? null, situation: stored.situation ?? null,
    status: stored.status, stage: stored.stage ?? 0, dueAt: stored.dueAt, lastPracticedAt: stored.lastPracticedAt ?? null,
    lastOfferedAt: stored.lastOfferedAt ?? null, history: Array.isArray(stored.history) ? stored.history : [], archived: !!stored.archived,
    // 0.5.4: the clip line a «Послушать» phrase was heard in; typed phrases and old rows have none.
    heard: stored.heard ?? null,
  };
}

/** For getAppState(): newest first, at most 500, archived included. */
export function listPhrasesForState(db: DatabaseSync): SavedPhrase[] {
  return readPhrases(db, PHRASES_IN_STATE).map(presentPhrase);
}

/** «Удалить всю практику» keeps the phrases but forgets their history: the sessions it pointed to are gone. */
export function clearPhraseHistory(db: DatabaseSync, now = Date.now()): void {
  for (const phrase of readPhrases(db)) {
    if (!phrase.history?.length) continue;
    writePhrase(db, { ...phrase, history: [], updatedAt: touchedAt(phrase.updatedAt, now) });
  }
}

/** A deleted session leaves no history entry behind (the schedule it caused stays). */
export function forgetPhraseSession(db: DatabaseSync, sessionId: string, now = Date.now()): void {
  const rows = db.prepare(`SELECT data FROM saved_phrases WHERE instr(data, ?) > 0`).all(JSON.stringify(sessionId)) as Row[];
  for (const row of rows) {
    const phrase = JSON.parse(row.data) as StoredPhrase;
    const history = (phrase.history ?? []).filter(item => item.sessionId !== sessionId);
    if (history.length === (phrase.history ?? []).length) continue;
    writePhrase(db, { ...phrase, history, updatedAt: touchedAt(phrase.updatedAt, now) });
  }
}

/** Duplicate check: case, quotes, punctuation, ё/е and spacing do not make a new phrase. */
export function normalisedPhraseText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/['’‘ʼ`´]/gu, "'").replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/(^|\s)'+|'+(?=\s|$)/gu, '$1').replace(/\s+/gu, ' ').trim();
}
