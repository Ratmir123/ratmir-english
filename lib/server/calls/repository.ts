import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { connection, dataDirectory, registerTables, transaction } from '../db';
import type { CallContext, CallMetrics, CallReview, CallSegment, CallSourceType, CallSpeaker, CallStatus, FactKind, PatternOutcome,
  PersonalDrill, ProfileFact } from '../../calls/types';
import type { PatternDefinition } from './catalog';
import { normaliseText } from './text';

/** Storage for real calls: SQLite rows (metadata, review, jobs, patterns, drills, facts) plus files in <data>/calls/<id>/. */
export type JobStage = 'process' | 'analyse';
export const JOB_MAX_ATTEMPTS: Record<JobStage, number> = { process: 3, analyse: 2 };
export const JOB_LEASE_MS = 10 * 60_000;
export const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PatternHit { patternId: string; status: PatternOutcome; quote: string | null; at: number | null; note: string | null }

export interface CallRecord {
  version: 1;
  id: string;
  title: string;
  counterpart: string | null;
  context: CallContext;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
  source: CallSourceType;
  status: CallStatus;
  progress: { stage: string; percent: number } | null;
  error: string | null;
  notes: string | null;
  upload: { fileName: string; extension: string; mime: string; bytes: number; received: number; completedAt: string | null } | null;
  transcriptFormat: string | null;
  hasReference: boolean;
  durationSeconds: number | null;
  speakers: CallSpeaker[];
  metrics: CallMetrics | null;
  review: CallReview | null;
  hits: PatternHit[];
  /** How the learner's lines were identified. */
  attribution: 'voice' | 'labels' | 'confirmed' | 'model' | null;
  /** Processed audio kept for playback until expiresAt (raw call audio retention). */
  audio: { processedAt: string; expiresAt: string } | null;
  /** Comma-joined learner speaker ids the verbatim pass was computed for. */
  verbatimFor: string | null;
  /** Bumped whenever analysis input changes; a slow worker's stale result is discarded. */
  revision: number;
  failedStage: JobStage | null;
  /** When the first review was published (kept across re-analyses, used for progression). */
  firstReviewedAt?: string | null;
}

export type StoredDrill = Omit<PersonalDrill, 'status' | 'sessionId' | 'completedAt' | 'attempts' | 'dueAt'> & { linkedSessions: string[] };
export interface StoredPattern extends PatternDefinition { userConfirmed: boolean; dismissed: boolean; userNote: string | null; createdAt: string }
export interface EventRow { patternId: string; callId: string; date: string; status: PatternOutcome; quote: string | null; at: number | null; memory: boolean }
export interface FactInput { kind: FactKind; text: string; quote: string | null; at: number | null }

export function initCallTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, occurred_at TEXT, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_jobs (
      call_id TEXT PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK(stage IN ('process','analyse')),
      state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, lease_until INTEGER, token TEXT,
      last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS call_jobs_ready ON call_jobs(state, available_at);
    CREATE TABLE IF NOT EXISTS communication_patterns (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pattern_events (
      id INTEGER PRIMARY KEY, pattern_id TEXT NOT NULL, call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      date TEXT NOT NULL, status TEXT NOT NULL, quote TEXT, at REAL, memory INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS pattern_events_pattern ON pattern_events(pattern_id);
    CREATE INDEX IF NOT EXISTS pattern_events_call ON pattern_events(call_id);
    CREATE TABLE IF NOT EXISTS personal_drills (
      id TEXT PRIMARY KEY, call_id TEXT REFERENCES calls(id) ON DELETE CASCADE, session_id TEXT,
      created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS personal_drills_call ON personal_drills(call_id);
    CREATE TABLE IF NOT EXISTS profile_facts (
      id TEXT PRIMARY KEY, call_id TEXT, status TEXT NOT NULL CHECK(status IN ('suggested','accepted','rejected')),
      normalized TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS profile_facts_call ON profile_facts(call_id);
  `);
}
registerTables(initCallTables);

export function nowIso(now = Date.now()): string { return new Date(now).toISOString(); }
export function callDate(record: Pick<CallRecord, 'occurredAt' | 'createdAt'>): string { return record.occurredAt ?? record.createdAt; }

// ---------- call records ----------

export function readCall(db: DatabaseSync, id: string): CallRecord | null {
  const row = db.prepare('SELECT data FROM calls WHERE id=?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as CallRecord : null;
}

export function writeCall(db: DatabaseSync, record: CallRecord): void {
  db.prepare(`INSERT INTO calls(id,status,source,created_at,updated_at,occurred_at,data) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, occurred_at=excluded.occurred_at, data=excluded.data`)
    .run(record.id, record.status, record.source, record.createdAt, record.updatedAt, record.occurredAt, JSON.stringify(record));
}

/** Monotonic updatedAt so clients can detect every change. */
export function touch(record: CallRecord, now = Date.now()): void {
  record.updatedAt = new Date(Math.max(now, Date.parse(record.updatedAt) + 1)).toISOString();
}

export function listCallRecords(db: DatabaseSync): CallRecord[] {
  return (db.prepare('SELECT data FROM calls ORDER BY COALESCE(occurred_at, created_at) DESC, created_at DESC, id').all() as { data: string }[])
    .map(row => JSON.parse(row.data) as CallRecord);
}

/** Read-modify-write inside one SQLite transaction (safe across the server and the import CLI). */
export function mutateCall(id: string, mutate: (record: CallRecord, db: DatabaseSync) => boolean | void, now = Date.now()): CallRecord | null {
  const { db } = connection();
  return transaction(db, () => {
    const record = readCall(db, id);
    if (!record) return null;
    if (mutate(record, db) === false) return record;
    touch(record, now);
    writeCall(db, record);
    return record;
  });
}

// ---------- jobs ----------

interface JobRow { call_id: string; stage: JobStage; state: string; attempts: number; available_at: number; lease_until: number | null; token: string | null; last_error: string | null }
export interface ClaimedJob { callId: string; stage: JobStage; attempt: number; token: string }

export function enqueueJob(db: DatabaseSync, callId: string, stage: JobStage, now = Date.now(), delayMs = 0): void {
  db.prepare(`INSERT INTO call_jobs(call_id,stage,state,attempts,available_at,lease_until,token,last_error,created_at,updated_at)
    VALUES (?,?,'pending',0,?,NULL,NULL,NULL,?,?) ON CONFLICT(call_id) DO UPDATE SET stage=excluded.stage, state='pending', attempts=0,
    available_at=excluded.available_at, lease_until=NULL, token=NULL, last_error=NULL, updated_at=excluded.updated_at`)
    .run(callId, stage, now + delayMs, now, now);
}

export function readJob(db: DatabaseSync, callId: string): JobRow | null {
  return (db.prepare('SELECT * FROM call_jobs WHERE call_id=?').get(callId) as JobRow | undefined) ?? null;
}

const STALLED = 'Обработка несколько раз прерывалась. Нажми «Повторить», когда сервер будет свободен.';

/** Claim one ready job (pending, or running with an expired lease) with a fresh token. */
export function claimJob(now = Date.now()): ClaimedJob | null {
  const { db } = connection();
  return transaction(db, () => {
    const expired = db.prepare(`SELECT * FROM call_jobs WHERE state='running' AND lease_until<=?`).all(now) as unknown as JobRow[];
    for (const job of expired) {
      if (job.attempts < JOB_MAX_ATTEMPTS[job.stage]) continue;
      db.prepare(`UPDATE call_jobs SET state='failed',lease_until=NULL,token=NULL,last_error=?,updated_at=? WHERE call_id=?`).run(STALLED, now, job.call_id);
      const record = readCall(db, job.call_id);
      if (record) {
        Object.assign(record, { status: 'error', error: STALLED, progress: null, failedStage: job.stage });
        touch(record, now); writeCall(db, record);
      }
    }
    const candidates = db.prepare(`SELECT * FROM call_jobs WHERE (state='pending' AND available_at<=?) OR (state='running' AND lease_until<=?)
      ORDER BY available_at, created_at LIMIT 20`).all(now, now) as unknown as JobRow[];
    const job = candidates.find(item => item.attempts < JOB_MAX_ATTEMPTS[item.stage]);
    if (!job) return null;
    const record = readCall(db, job.call_id);
    if (!record) { db.prepare('DELETE FROM call_jobs WHERE call_id=?').run(job.call_id); return null; }
    const token = randomUUID();
    db.prepare(`UPDATE call_jobs SET state='running',attempts=attempts+1,lease_until=?,token=?,updated_at=? WHERE call_id=?`)
      .run(now + JOB_LEASE_MS, token, now, job.call_id);
    record.status = job.stage === 'process' ? 'processing' : 'analysing';
    record.progress = { stage: job.stage === 'process' ? 'Начинаю обработку записи' : 'Готовлю разбор', percent: job.stage === 'process' ? 1 : 2 };
    record.error = null;
    touch(record, now); writeCall(db, record);
    return { callId: job.call_id, stage: job.stage, attempt: job.attempts + 1, token };
  });
}

export function ownsJob(db: DatabaseSync, callId: string, token: string): boolean {
  return !!db.prepare(`SELECT 1 FROM call_jobs WHERE call_id=? AND token=? AND state='running'`).get(callId, token);
}

/** Change the call only while this worker still owns its job; also extends the lease. False when ownership was lost. */
export function withOwnedCall(callId: string, token: string, mutate: (record: CallRecord, db: DatabaseSync) => void, now = Date.now()): boolean {
  const { db } = connection();
  return transaction(db, () => {
    if (!ownsJob(db, callId, token)) return false;
    const record = readCall(db, callId);
    if (!record) return false;
    db.prepare('UPDATE call_jobs SET lease_until=?,updated_at=? WHERE call_id=?').run(now + JOB_LEASE_MS, now, callId);
    mutate(record, db);
    touch(record, now);
    writeCall(db, record);
    return true;
  });
}

export function completeJob(db: DatabaseSync, callId: string, now = Date.now()): void {
  db.prepare(`UPDATE call_jobs SET state='completed',lease_until=NULL,token=NULL,last_error=NULL,updated_at=? WHERE call_id=?`).run(now, callId);
}
export function advanceJob(db: DatabaseSync, callId: string, stage: JobStage, now = Date.now()): void {
  db.prepare(`UPDATE call_jobs SET stage=?,state='pending',attempts=0,available_at=?,lease_until=NULL,token=NULL,last_error=NULL,updated_at=? WHERE call_id=?`)
    .run(stage, now, now, callId);
}
export function retryJobLater(db: DatabaseSync, callId: string, message: string, delayMs: number, now = Date.now()): void {
  db.prepare(`UPDATE call_jobs SET state='pending',available_at=?,lease_until=NULL,token=NULL,last_error=?,updated_at=? WHERE call_id=?`)
    .run(now + delayMs, message.slice(0, 500), now, callId);
}
export function failJob(db: DatabaseSync, callId: string, message: string, now = Date.now()): void {
  db.prepare(`UPDATE call_jobs SET state='failed',lease_until=NULL,token=NULL,last_error=?,updated_at=? WHERE call_id=?`).run(message.slice(0, 500), now, callId);
}

// ---------- facts ----------

const FACT_COLUMNS = 'SELECT data FROM profile_facts';
export function readFacts(db: DatabaseSync, filter: { callId?: string; statuses?: ProfileFact['status'][] } = {}): ProfileFact[] {
  const rows = (filter.callId
    ? db.prepare(`${FACT_COLUMNS} WHERE call_id=? ORDER BY created_at DESC, id`).all(filter.callId)
    : db.prepare(`${FACT_COLUMNS} ORDER BY created_at DESC, id`).all()) as { data: string }[];
  const facts = rows.map(row => JSON.parse(row.data) as ProfileFact);
  return filter.statuses ? facts.filter(fact => filter.statuses!.includes(fact.status)) : facts;
}

/** Replace this call's undecided suggestions; never duplicate a fact the learner already has in any status. */
export function replaceSuggestedFacts(db: DatabaseSync, callId: string, facts: FactInput[], now = Date.now()): number {
  db.prepare(`DELETE FROM profile_facts WHERE call_id=? AND status='suggested'`).run(callId);
  const existing = new Set((db.prepare('SELECT normalized FROM profile_facts').all() as { normalized: string }[]).map(row => row.normalized));
  let inserted = 0;
  facts.forEach((fact, index) => {
    const key = normaliseText(fact.text);
    if (!key || existing.has(key)) return;
    existing.add(key);
    const value: ProfileFact = { id: randomUUID(), kind: fact.kind, text: fact.text, quote: fact.quote, at: fact.at,
      source: { type: 'call', callId }, status: 'suggested', createdAt: nowIso(now + index) };
    db.prepare('INSERT INTO profile_facts(id,call_id,status,normalized,created_at,data) VALUES (?,?,?,?,?,?)')
      .run(value.id, callId, value.status, key, value.createdAt, JSON.stringify(value));
    inserted++;
  });
  return inserted;
}

export function decideFact(db: DatabaseSync, factId: string, decision: 'accept' | 'reject'): ProfileFact | null {
  const row = db.prepare('SELECT data FROM profile_facts WHERE id=?').get(factId) as { data: string } | undefined;
  if (!row) return null;
  const fact = JSON.parse(row.data) as ProfileFact;
  fact.status = decision === 'accept' ? 'accepted' : 'rejected';
  db.prepare('UPDATE profile_facts SET status=?, data=? WHERE id=?').run(fact.status, JSON.stringify(fact), factId);
  return fact;
}

// ---------- drills ----------

export function readDrills(db: DatabaseSync, callId?: string): StoredDrill[] {
  const rows = (callId
    ? db.prepare('SELECT data FROM personal_drills WHERE call_id=? ORDER BY created_at DESC, id').all(callId)
    : db.prepare('SELECT data FROM personal_drills ORDER BY created_at DESC, id').all()) as { data: string }[];
  return rows.map(row => JSON.parse(row.data) as StoredDrill);
}

export function readDrill(db: DatabaseSync, id: string): StoredDrill | null {
  const row = db.prepare('SELECT data FROM personal_drills WHERE id=?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as StoredDrill : null;
}

/** New drills replace this call's unstarted ones; drills already practised stay with their sessions. */
export function replaceCallDrills(db: DatabaseSync, callId: string, drills: StoredDrill[]): void {
  db.prepare('DELETE FROM personal_drills WHERE call_id=? AND session_id IS NULL').run(callId);
  for (const drill of drills) {
    db.prepare('INSERT INTO personal_drills(id,call_id,session_id,created_at,data) VALUES (?,?,NULL,?,?)')
      .run(drill.id, callId, drill.createdAt, JSON.stringify(drill));
  }
}

export function linkSession(db: DatabaseSync, drillId: string, sessionId: string): boolean {
  const drill = readDrill(db, drillId);
  if (!drill) return false;
  drill.linkedSessions = [...drill.linkedSessions.filter(id => id !== sessionId), sessionId].slice(-50);
  db.prepare('UPDATE personal_drills SET session_id=?, data=? WHERE id=?').run(sessionId, JSON.stringify(drill), drillId);
  return true;
}

// ---------- patterns ----------

export function readPatternDefinitions(db: DatabaseSync): StoredPattern[] {
  return (db.prepare('SELECT data FROM communication_patterns ORDER BY created_at, id').all() as { data: string }[])
    .map(row => JSON.parse(row.data) as StoredPattern);
}

export function ensurePatternDefinitions(db: DatabaseSync, definitions: PatternDefinition[], now = Date.now()): void {
  for (const definition of definitions) {
    if (db.prepare('SELECT 1 FROM communication_patterns WHERE id=?').get(definition.id)) continue;
    const stored: StoredPattern = { ...definition, userConfirmed: false, dismissed: false, userNote: null, createdAt: nowIso(now) };
    db.prepare('INSERT INTO communication_patterns(id,created_at,updated_at,data) VALUES (?,?,?,?)')
      .run(stored.id, stored.createdAt, stored.createdAt, JSON.stringify(stored));
  }
}

export function updatePatternFlags(db: DatabaseSync, id: string, patch: { confirm?: boolean; dismiss?: boolean; note?: string | null }, now = Date.now()): StoredPattern | null {
  const row = db.prepare('SELECT data FROM communication_patterns WHERE id=?').get(id) as { data: string } | undefined;
  if (!row) return null;
  const stored = JSON.parse(row.data) as StoredPattern;
  if (patch.confirm !== undefined) stored.userConfirmed = patch.confirm;
  if (patch.dismiss !== undefined) stored.dismissed = patch.dismiss;
  if (patch.note !== undefined) stored.userNote = patch.note;
  db.prepare('UPDATE communication_patterns SET updated_at=?, data=? WHERE id=?').run(nowIso(now), JSON.stringify(stored), id);
  return stored;
}

export function replaceCallEvents(db: DatabaseSync, callId: string, date: string, hits: PatternHit[], memory: boolean): void {
  db.prepare('DELETE FROM pattern_events WHERE call_id=?').run(callId);
  for (const hit of hits) {
    db.prepare('INSERT INTO pattern_events(pattern_id,call_id,date,status,quote,at,memory) VALUES (?,?,?,?,?,?,?)')
      .run(hit.patternId, callId, date, hit.status, hit.quote, hit.at, memory ? 1 : 0);
  }
}

export function setCallEventsDate(db: DatabaseSync, callId: string, date: string): void {
  db.prepare('UPDATE pattern_events SET date=? WHERE call_id=?').run(date, callId);
}

export function readPatternEvents(db: DatabaseSync): EventRow[] {
  return (db.prepare('SELECT pattern_id, call_id, date, status, quote, at, memory FROM pattern_events ORDER BY date, id').all() as
    { pattern_id: string; call_id: string; date: string; status: PatternOutcome; quote: string | null; at: number | null; memory: number }[])
    .map(row => ({ patternId: row.pattern_id, callId: row.call_id, date: row.date, status: row.status, quote: row.quote, at: row.at, memory: row.memory === 1 }));
}

/** Patterns exist only while a call still shows them (anything but no-opportunity). */
export function prunePatterns(db: DatabaseSync): void {
  db.prepare(`DELETE FROM communication_patterns WHERE id NOT IN (SELECT DISTINCT pattern_id FROM pattern_events WHERE status <> 'no-opportunity')`).run();
}

/** Delete one call's rows. Accepted facts stay in the learner's playbook. */
export function deleteCallRows(db: DatabaseSync, callId: string): boolean {
  const existed = !!db.prepare('SELECT 1 FROM calls WHERE id=?').get(callId);
  db.prepare(`DELETE FROM profile_facts WHERE call_id=? AND status <> 'accepted'`).run(callId);
  db.prepare('DELETE FROM pattern_events WHERE call_id=?').run(callId);
  db.prepare('DELETE FROM personal_drills WHERE call_id=?').run(callId);
  db.prepare('DELETE FROM call_jobs WHERE call_id=?').run(callId);
  db.prepare('DELETE FROM calls WHERE id=?').run(callId);
  prunePatterns(db);
  return existed;
}

// ---------- files ----------

export function callsRoot(): string { return join(dataDirectory(), 'calls'); }

export function callDirectory(id: string): string {
  if (!CALL_ID.test(id)) throw new Error('Некорректный идентификатор созвона.');
  return join(callsRoot(), id);
}

export function ensureCallDirectory(id: string): string {
  const directory = callDirectory(id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function writeFileAtomic(path: string, data: string | Uint8Array): void {
  const temporary = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600 });
  renameSync(temporary, path);
}

export function readTranscript(id: string): CallSegment[] {
  const path = join(callDirectory(id), 'transcript.json');
  if (!existsSync(path)) return [];
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { version?: number; segments?: CallSegment[] };
    return Array.isArray(value.segments) ? value.segments : [];
  } catch { return []; }
}

export function writeTranscript(id: string, segments: CallSegment[]): void {
  ensureCallDirectory(id);
  writeFileAtomic(join(callDirectory(id), 'transcript.json'), JSON.stringify({ version: 1, segments }));
}

export function readCallText(id: string, name: 'source.txt' | 'debrief.md' | 'reference.md'): string | null {
  const path = join(callDirectory(id), name);
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { return null; }
}

export function writeCallText(id: string, name: 'source.txt' | 'debrief.md' | 'reference.md', text: string): void {
  ensureCallDirectory(id);
  writeFileAtomic(join(callDirectory(id), name), text);
}

export function fileSize(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

/** Best effort: a file still open by ffmpeg on Windows is swept later by the worker. */
export function removeCallFiles(id: string): void {
  try { rmSync(callDirectory(id), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* swept later */ }
}

export function removeAllCallFiles(): void {
  try { rmSync(callsRoot(), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* swept later */ }
}

export function callDirectoryNames(): string[] {
  try { return readdirSync(callsRoot()).filter(name => CALL_ID.test(name)); } catch { return []; }
}
