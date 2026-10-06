import type { DatabaseSync } from 'node:sqlite';
import { registerTables } from '../db';
import type { ListenClip, ListenPhrase } from '../../phrases/types';
import { PHRASE_ID, presentPhrase, readPhrase } from './repository';

/**
 * «Послушать» storage (PASS-0.5.4 §1.2): one row per clip in `listen_clips`, the clip as JSON in `data`. The audio itself is
 * never stored. The phrases a clip saved are ordinary rows of saved_phrases: the clip keeps only their ids (and whether each was
 * already there), so a phrase deleted later simply drops out of the clip. The analysis bookkeeping travels under `job` and is
 * stripped before a clip reaches a client.
 */
export interface ListenJob {
  /** Sol attempts so far (2 at most before the clip is marked failed). */
  attempts: number;
  lastAttemptAt: string | null;
  /** The attempt currently in flight; a late or superseded result with another token is dropped. */
  token: string | null;
}
export interface ListenPhraseRef { id: string; duplicate: boolean }
export type StoredClip = Omit<ListenClip, 'phrases'> & { phraseRefs: ListenPhraseRef[]; job: ListenJob };

/** Clip ids are uuids, like phrase ids. */
export const LISTEN_CLIP_ID = PHRASE_ID;
/** Clips older than this are deleted on the next create. */
export const LISTEN_RETENTION_DAYS = 30;

export function initListenTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listen_clips (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS listen_clips_created ON listen_clips(created_at);
  `);
}
registerTables(initListenTables);

type Row = { data: string };

export function readClip(db: DatabaseSync, id: string): StoredClip | null {
  const row = db.prepare('SELECT data FROM listen_clips WHERE id=?').get(id) as Row | undefined;
  return row ? JSON.parse(row.data) as StoredClip : null;
}

export function writeClip(db: DatabaseSync, clip: StoredClip): void {
  db.prepare(`INSERT INTO listen_clips(id,created_at,updated_at,data) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data`)
    .run(clip.id, clip.createdAt, clip.updatedAt, JSON.stringify(clip));
}

export function countClipsCreatedSince(db: DatabaseSync, since: string): number {
  return Number((db.prepare('SELECT COUNT(*) AS count FROM listen_clips WHERE created_at>=?').get(since) as { count: number }).count);
}

/** «Удалить всю практику»: the clips (media transcripts) go too; the phrases they saved stay in «Мои фразы». */
export function clearListenClips(db: DatabaseSync): void {
  db.exec('DELETE FROM listen_clips');
}

/** The 30-day retention; returns how many clips were deleted. */
export function deleteClipsCreatedBefore(db: DatabaseSync, before: string): number {
  return Number(db.prepare('DELETE FROM listen_clips WHERE created_at<?').run(before).changes);
}

/** Clips still waiting for Sol. */
export function readAnalyzingClips(db: DatabaseSync): StoredClip[] {
  return (db.prepare(`SELECT data FROM listen_clips WHERE json_extract(data,'$.status')='analyzing' ORDER BY created_at, id`).all() as Row[])
    .map(row => JSON.parse(row.data) as StoredClip);
}

/** The client view: the shared ListenClip shape with the CURRENT phrase rows (a phrase deleted since is omitted). */
export function presentClip(db: DatabaseSync, stored: StoredClip): ListenClip {
  const phrases: ListenPhrase[] = [];
  for (const ref of stored.phraseRefs ?? []) {
    const phrase = readPhrase(db, ref.id);
    if (phrase) phrases.push({ phrase: presentPhrase(phrase), duplicate: !!ref.duplicate });
  }
  return {
    id: stored.id, createdAt: stored.createdAt, updatedAt: stored.updatedAt, origin: stored.origin, source: stored.source,
    seconds: stored.seconds, transcript: stored.transcript, status: stored.status, gist: stored.gist ?? null,
    points: Array.isArray(stored.points) ? stored.points : [], phrases, note: stored.note ?? null,
  };
}
