import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { dataDirectory, registerTables } from '../db';
import type { CallPrep } from '../../preps/types';
import type { SkillId } from '../../types';
import { PHRASE_ID } from '../phrases/repository';

/**
 * «Подготовка к созвону» storage (PASS-0.5.5 §2): one row per prep in `call_preps`, the prep as JSON in `data`. The screenshots
 * live in `<data>/prep-images/<id>/` (0600) only until Sol has read them (after a failure until a retry or a day later). The
 * partner-only scene (`scenario`), the job bookkeeping and the image list never reach a client.
 */
export interface PrepJob { attempts: number; lastAttemptAt: string | null; token: string | null }
/** The hidden scene a rehearsal is planned from (English, partner-only, like a lesson's npcBrief and hidden facts). */
export interface PrepScenario {
  context: 'work' | 'life' | 'relocation';
  role: string; opening: string; npcBrief: string; hiddenFacts: string[]; pushback: string[];
  successCriteria: string[]; targetSkills: SkillId[]; patternIds: string[]; languageFocus: string;
}
export interface StoredRehearsal { sessionId: string; createdAt: string; tier: 1 | 2 | 3; mode: 'learning' | 'call' }
export interface PrepImage { file: string; type: string; bytes: number }
export type StoredPrep = Omit<CallPrep, 'rehearsals'> & {
  rehearsals: StoredRehearsal[]; scenario: PrepScenario | null; job: PrepJob; images: PrepImage[];
};

export const PREP_ID = PHRASE_ID;
/** Screenshots of a failed prep are kept this long for a retry. */
export const PREP_IMAGE_KEEP_MS = 24 * 60 * 60_000;
/** Preps in /api/state and in GET /api/preps. */
export const PREPS_IN_STATE = 10;
export const PREPS_IN_LIST = 30;

export function initPrepTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_preps (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS call_preps_created ON call_preps(created_at);
  `);
}
registerTables(initPrepTables);

type Row = { data: string };

export function readPrep(db: DatabaseSync, id: string): StoredPrep | null {
  const row = db.prepare('SELECT data FROM call_preps WHERE id=?').get(id) as Row | undefined;
  return row ? JSON.parse(row.data) as StoredPrep : null;
}

export function writePrep(db: DatabaseSync, prep: StoredPrep): void {
  db.prepare(`INSERT INTO call_preps(id,created_at,updated_at,data) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, data=excluded.data`)
    .run(prep.id, prep.createdAt, prep.updatedAt, JSON.stringify(prep));
}

/** Newest first. */
export function readPreps(db: DatabaseSync, limit = PREPS_IN_LIST): StoredPrep[] {
  return (db.prepare('SELECT data FROM call_preps ORDER BY created_at DESC, id LIMIT ?').all(limit) as Row[]).map(row => JSON.parse(row.data) as StoredPrep);
}

export function readReadingPreps(db: DatabaseSync): StoredPrep[] {
  return (db.prepare(`SELECT data FROM call_preps WHERE json_extract(data,'$.status')='reading' ORDER BY created_at, id`).all() as Row[])
    .map(row => JSON.parse(row.data) as StoredPrep);
}

/** The prep a rehearsal session belongs to. */
export function readPrepBySession(db: DatabaseSync, sessionId: string): StoredPrep | null {
  const row = db.prepare(`SELECT data FROM call_preps WHERE EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.rehearsals'))
    WHERE json_extract(value,'$.sessionId')=?) LIMIT 1`).get(sessionId) as Row | undefined;
  return row ? JSON.parse(row.data) as StoredPrep : null;
}

export function countPrepsCreatedSince(db: DatabaseSync, since: string): number {
  return Number((db.prepare('SELECT COUNT(*) AS count FROM call_preps WHERE created_at>=?').get(since) as { count: number }).count);
}

export function deletePrepRow(db: DatabaseSync, id: string): boolean {
  return Number(db.prepare('DELETE FROM call_preps WHERE id=?').run(id).changes) > 0;
}

/** «Удалить всю практику»: every prep and its screenshots. */
export function clearPreps(db: DatabaseSync): void {
  db.exec('DELETE FROM call_preps');
  rmSync(imageRoot(), { recursive: true, force: true });
}

// Screenshots on disk.
function imageRoot(): string { return join(dataDirectory(), 'prep-images'); }
function imageFolder(id: string): string {
  if (!PREP_ID.test(id)) throw new Error('Некорректная подготовка.');
  return join(imageRoot(), id);
}
const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function saveImages(id: string, images: { bytes: Uint8Array; type: string }[]): PrepImage[] {
  const folder = imageFolder(id);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return images.map((image, index) => {
    const file = `${index + 1}.${EXTENSION[image.type] ?? 'png'}`;
    writeFileSync(join(folder, file), image.bytes, { mode: 0o600 });
    return { file, type: image.type, bytes: image.bytes.length };
  });
}

/** Data URLs for Sol; a missing file is skipped (the prep then reads only what is left). */
export function imageDataUrls(id: string, images: readonly PrepImage[]): string[] {
  const folder = imageFolder(id);
  return images.flatMap(image => {
    const path = join(folder, image.file);
    if (image.file.includes('/') || image.file.includes('\\') || !existsSync(path)) return [];
    return [`data:${image.type};base64,${readFileSync(path).toString('base64')}`];
  });
}

export function hasImages(id: string, images: readonly PrepImage[]): boolean {
  return images.length > 0 && imageDataUrls(id, images.slice(0, 1)).length > 0;
}

export function deleteImages(id: string): void {
  rmSync(imageFolder(id), { recursive: true, force: true });
}

/** Folders of deleted preps and screenshots of failed preps older than a day go away (runs on create). */
export function sweepImages(db: DatabaseSync, now = Date.now()): void {
  const root = imageRoot();
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (!PREP_ID.test(name)) continue;
    const prep = readPrep(db, name);
    const folder = join(root, name);
    const stale = !prep || prep.status === 'ready' || (prep.status === 'failed' && now - statSync(folder).mtimeMs > PREP_IMAGE_KEEP_MS);
    if (stale) rmSync(folder, { recursive: true, force: true });
  }
}
