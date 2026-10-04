import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { registerTables } from '../db';
import type { Exposure } from '../../placement/engine';
import type { AttemptRecord } from './model';

/** Placement storage: one JSON row per attempt, an exposure history (contamination rule) and scoring jobs. */
function initialisePlacementTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS placement_attempts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('in-progress','scoring','completed','error')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS placement_attempts_status ON placement_attempts(status, created_at);
    CREATE TABLE IF NOT EXISTS placement_exposure (
      item_id TEXT NOT NULL, attempt_id TEXT NOT NULL, shown_at INTEGER NOT NULL,
      PRIMARY KEY(item_id, attempt_id)
    );
    CREATE TABLE IF NOT EXISTS placement_jobs (
      attempt_id TEXT PRIMARY KEY REFERENCES placement_attempts(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
      lease_until INTEGER, token TEXT, last_error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS placement_jobs_ready ON placement_jobs(state, available_at);
  `);
}
registerTables(initialisePlacementTables);

export const MAX_SCORING_ATTEMPTS = 3;
/** One scoring run is at most two model calls of up to 3 minutes each (a rejected output is retried once). */
export const SCORING_LEASE_MS = 8 * 60_000;
export const SCORING_FAILED_MESSAGE = 'Оценка устных ответов не завершилась после нескольких попыток. Ответы сохранены, можно пересчитать.';
type DataRow = { data: string };

function parse(row: DataRow | undefined): AttemptRecord | null {
  if (!row) return null;
  try {
    const value = JSON.parse(row.data) as AttemptRecord;
    return value && value.version === 1 && typeof value.id === 'string' ? value : null;
  } catch { return null; }
}

export function readAttempt(db: DatabaseSync, id: string): AttemptRecord | null {
  return parse(db.prepare('SELECT data FROM placement_attempts WHERE id=?').get(id) as DataRow | undefined);
}

/** The attempt that is not finished yet (in progress, waiting for scoring, or failed scoring). */
export function readActiveAttempt(db: DatabaseSync): AttemptRecord | null {
  return parse(db.prepare(`SELECT data FROM placement_attempts WHERE status IN ('in-progress','scoring','error')
    ORDER BY created_at DESC, id DESC LIMIT 1`).get() as DataRow | undefined);
}

/** Completed attempts, oldest first. */
export function readCompletedAttempts(db: DatabaseSync): AttemptRecord[] {
  return (db.prepare(`SELECT data FROM placement_attempts WHERE status='completed' ORDER BY completed_at, created_at, id`).all() as DataRow[])
    .map(parse).filter((value): value is AttemptRecord => !!value && !!value.result);
}

export function readAllAttempts(db: DatabaseSync): AttemptRecord[] {
  return (db.prepare('SELECT data FROM placement_attempts ORDER BY created_at, id').all() as DataRow[])
    .map(parse).filter((value): value is AttemptRecord => !!value);
}

export function writeAttempt(db: DatabaseSync, attempt: AttemptRecord): void {
  db.prepare(`INSERT INTO placement_attempts(id,status,created_at,updated_at,completed_at,data) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, completed_at=excluded.completed_at, data=excluded.data`)
    .run(attempt.id, attempt.status, attempt.startedAt, attempt.updatedAt, attempt.completedAt, JSON.stringify(attempt));
}

/** Discarding an attempt keeps its exposure rows: the learner has seen those items. */
export function deleteAttempt(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM placement_jobs WHERE attempt_id=?').run(id);
  db.prepare('DELETE FROM placement_attempts WHERE id=?').run(id);
}

export function recordExposure(db: DatabaseSync, attemptId: string, ids: readonly string[], at: number): void {
  const statement = db.prepare('INSERT OR IGNORE INTO placement_exposure(item_id,attempt_id,shown_at) VALUES (?,?,?)');
  for (const id of new Set(ids)) statement.run(id, attemptId, at);
}

/** Exposure of items, prompts and scripts in OTHER attempts (count and latest time). */
export function readExposure(db: DatabaseSync, excludeAttemptId: string | null = null): Map<string, Exposure> {
  const rows = db.prepare(`SELECT item_id, COUNT(*) AS count, MAX(shown_at) AS last FROM placement_exposure
    WHERE attempt_id <> ? GROUP BY item_id`).all(excludeAttemptId ?? '') as { item_id: string; count: number; last: number }[];
  return new Map(rows.map(row => [row.item_id, { count: Number(row.count), lastShownAt: Number(row.last) }]));
}

/** Called inside deleteAllTraining()'s transaction. Cached TTS clips on disk are content-addressed and may stay. */
export function clearPlacementTables(db: DatabaseSync): void {
  db.exec('DELETE FROM placement_jobs; DELETE FROM placement_attempts; DELETE FROM placement_exposure;');
}

// ---------------------------------------------------------------------------------------------------------------------
// Scoring jobs: leases and a bounded attempt counter, like analysis_jobs. Callers wrap these in a transaction.

export function enqueueScoringJob(db: DatabaseSync, attemptId: string, now: number): void {
  db.prepare(`INSERT INTO placement_jobs(attempt_id,state,attempts,available_at,created_at,updated_at) VALUES (?,'pending',0,?,?,?)
    ON CONFLICT(attempt_id) DO UPDATE SET state='pending', attempts=0, available_at=excluded.available_at, lease_until=NULL,
    token=NULL, last_error=NULL, updated_at=excluded.updated_at`).run(attemptId, now, now, now);
}

export interface ScoringClaim { attemptId: string; token: string; attempt: number }

/** Cheap read for the worker tick: skip the write lock when no scoring job is waiting or leased. */
export function hasScoringWork(db: DatabaseSync): boolean {
  return !!db.prepare(`SELECT 1 FROM placement_jobs WHERE state IN ('pending','running') LIMIT 1`).get();
}

/** Fail expired exhausted jobs, then lease the next ready job. */
export function claimScoringJob(db: DatabaseSync, now: number): ScoringClaim | null {
  const exhausted = db.prepare(`SELECT attempt_id FROM placement_jobs WHERE state='running' AND lease_until<=? AND attempts>=?`)
    .all(now, MAX_SCORING_ATTEMPTS) as { attempt_id: string }[];
  for (const job of exhausted) {
    db.prepare(`UPDATE placement_jobs SET state='failed', lease_until=NULL, token=NULL, last_error=?, updated_at=? WHERE attempt_id=?`)
      .run(SCORING_FAILED_MESSAGE, now, job.attempt_id);
    const attempt = readAttempt(db, job.attempt_id);
    if (attempt?.status === 'scoring') {
      attempt.status = 'error'; attempt.error = SCORING_FAILED_MESSAGE; attempt.updatedAt = new Date(now).toISOString();
      writeAttempt(db, attempt);
    }
  }
  const job = db.prepare(`SELECT attempt_id, attempts FROM placement_jobs
    WHERE attempts<? AND ((state='pending' AND available_at<=?) OR (state='running' AND lease_until<=?))
    ORDER BY created_at, attempt_id LIMIT 1`).get(MAX_SCORING_ATTEMPTS, now, now) as { attempt_id: string; attempts: number } | undefined;
  if (!job) return null;
  const token = randomUUID();
  db.prepare(`UPDATE placement_jobs SET state='running', attempts=attempts+1, lease_until=?, token=?, updated_at=? WHERE attempt_id=?`)
    .run(now + SCORING_LEASE_MS, token, now, job.attempt_id);
  return { attemptId: job.attempt_id, token, attempt: job.attempts + 1 };
}

/** True when this claim still owns the running job. */
export function ownsScoringJob(db: DatabaseSync, claim: ScoringClaim): boolean {
  return !!db.prepare(`SELECT 1 FROM placement_jobs WHERE attempt_id=? AND state='running' AND token=?`).get(claim.attemptId, claim.token);
}

export function completeScoringJob(db: DatabaseSync, claim: ScoringClaim, now: number): void {
  db.prepare(`UPDATE placement_jobs SET state='completed', lease_until=NULL, token=NULL, last_error=NULL, updated_at=? WHERE attempt_id=? AND token=?`)
    .run(now, claim.attemptId, claim.token);
}

/** Returns true when the failure is terminal (the attempt must show an error). */
export function failScoringJob(db: DatabaseSync, claim: ScoringClaim, message: string, retryable: boolean, now: number): boolean {
  const row = db.prepare(`SELECT attempts FROM placement_jobs WHERE attempt_id=? AND state='running' AND token=?`)
    .get(claim.attemptId, claim.token) as { attempts: number } | undefined;
  if (!row) return false;
  const terminal = !retryable || row.attempts >= MAX_SCORING_ATTEMPTS;
  db.prepare(`UPDATE placement_jobs SET state=?, available_at=?, lease_until=NULL, token=NULL, last_error=?, updated_at=? WHERE attempt_id=? AND token=?`)
    .run(terminal ? 'failed' : 'pending', now + 1000 * 2 ** row.attempts, message.slice(0, 2000), now, claim.attemptId, claim.token);
  return terminal;
}
