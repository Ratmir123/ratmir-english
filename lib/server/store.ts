import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppState, LessonPlan, Mode, Profile, Session } from '../types';
import { calculateXP, deriveReviews, deriveSkillStates } from './adaptation';
import { initialProfile } from './profile';
import { baselineReportFingerprint, emptyOnboardingRecord, presentOnboarding, type OnboardingRecord } from './onboarding-data';
import type { BaselineReport } from '../types';
import { unassistedSpokenTurns } from '../onboarding';

const MAX_JOB_ATTEMPTS = 3;
const JOB_LEASE_MS = 5 * 60_000;
type JsonRow = { data: string };
type JobRow = { session_id: string; attempts: number; token: string | null };
type Connection = { db: DatabaseSync; claims: Map<string, string> };
const connectionCache = globalThis as typeof globalThis & { __ratmirTrainingConnections?: Map<string, Connection> };

function connection(): Connection {
  const filename = resolve(/* turbopackIgnore: true */ process.env.TRAINING_DB_PATH || resolve(process.cwd(), '.data', 'training.sqlite'));
  const cache = connectionCache.__ratmirTrainingConnections ??= new Map();
  const existing = cache.get(filename);
  if (existing) return existing;
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      status TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK(state IN ('pending','running','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL,
      lease_until INTEGER,
      token TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analysis_jobs_ready ON analysis_jobs(state, available_at);
    CREATE TABLE IF NOT EXISTS audio_usage (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('transcription','speech')),
      amount REAL NOT NULL CHECK(amount >= 0),
      cost_usd REAL NOT NULL CHECK(cost_usd >= 0),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audio_usage_time ON audio_usage(created_at);
    CREATE TABLE IF NOT EXISTS brain_activity (
      id INTEGER PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('success','failed','limit')),
      latency_ms INTEGER NOT NULL, retry_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS brain_activity_time ON brain_activity(created_at);
  `);
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('profile')) {
    db.prepare('INSERT INTO settings(key,data) VALUES (?,?)').run('profile', JSON.stringify(initialProfile(dirname(filename))));
  }
  const value = { db, claims: new Map<string, string>() };
  cache.set(filename, value);
  return value;
}

function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readSession(db: DatabaseSync, id: string): Session | null {
  const row = db.prepare('SELECT data FROM sessions WHERE id = ?').get(id) as JsonRow | undefined;
  return row ? JSON.parse(row.data) as Session : null;
}

function writeSession(db: DatabaseSync, session: Session): void {
  db.prepare(`INSERT INTO sessions(id,created_at,updated_at,status,data) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,status=excluded.status,data=excluded.data`)
    .run(session.id, session.createdAt, session.updatedAt, session.status, JSON.stringify(session));
}

function sourceSignature(session: Session): string {
  return JSON.stringify({ lesson: session.lesson, mode: session.mode, baseline: session.baseline, support: session.support, turns: session.turns.map((turn) => ({
    id: turn.id, role: turn.role, text: turn.text, source: turn.source, support: turn.support,
    disputed: !!turn.disputed, audioFile: turn.audioFile, originalTranscript: turn.originalTranscript, transcriptEdited: !!turn.transcriptEdited,
  })) });
}

export function getSession(id: string): Session | null {
  return readSession(connection().db, id);
}

function readLearningGeneration(db: DatabaseSync): number {
  const row = db.prepare('SELECT data FROM settings WHERE key=?').get('learning-generation') as JsonRow | undefined;
  const value = row ? JSON.parse(row.data) as unknown : 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Не удалось проверить версию учебной истории.');
  return value as number;
}
export function getLearningGeneration(): number { return readLearningGeneration(connection().db); }
export function createSession(lesson: LessonPlan, mode: Mode, clientRequestId?: string, expectedGeneration?: number): Session {
  const { db } = connection();
  return transaction(db, () => {
    if (expectedGeneration !== undefined && readLearningGeneration(db) !== expectedGeneration) {
      throw new Error('Учебная история была сброшена во время подготовки. Начни новую пробу.');
    }
    if (clientRequestId) {
      const row = db.prepare("SELECT data FROM sessions WHERE json_extract(data,'$.clientRequestId')=? LIMIT 1")
        .get(clientRequestId) as JsonRow | undefined;
      if (row) return JSON.parse(row.data) as Session;
    }
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(), lesson: structuredClone(lesson), mode, status: 'active',
      createdAt: now, updatedAt: now, turns: [], analysis: null, retries: [], support: 0,
      ...(clientRequestId ? { clientRequestId } : {}),
    };
    writeSession(db, session);
    return session;
  });
}

export function getSessionByRequestId(id: string): Session | null {
  const row = connection().db.prepare("SELECT data FROM sessions WHERE json_extract(data,'$.clientRequestId')=? LIMIT 1")
    .get(id) as JsonRow | undefined;
  return row ? JSON.parse(row.data) as Session : null;
}

/** Idempotent finish keeps a ready review intact; explicit reanalysis alone replaces it. */
export function finishConversation(id: string, reanalyse = false): Session {
  const session = getSession(id);
  if (!session) throw new Error('Занятие не найдено.');
  if (!reanalyse && (session.analysis || session.status === 'analysing' || session.status === 'completed')) return session;
  if (session.baseline && unassistedSpokenTurns(session).length < 2) {
    throw new Error('Для стартового разбора нужны хотя бы два своих ответа голосом без подсказок и изменения расшифровки. Оценка может быть любой.');
  }
  if (!session.turns.some(turn => turn.role === 'user' && !turn.disputed && turn.text.trim())) {
    throw new Error('Для разбора нужна хотя бы одна твоя подтверждённая попытка.');
  }
  if (reanalyse) { session.analysis = null; session.retries = []; session.retryDeferred = false; }
  session.status = 'analysing'; session.error = undefined;
  saveSession(session);
  enqueueAnalysis(id);
  return getSession(id)!;
}

/** With expectedSource, publish only analysis fields after atomically checking the analysed snapshot. */
export function saveSession(input: Session, expectedSource?: Session): void {
  const { db } = connection();
  transaction(db, () => {
    const previous = readSession(db, input.id);
    // A deleted session must not be resurrected by a slow analysis worker.
    if (!previous) throw new Error('Занятие не найдено или уже удалено.');
    if (expectedSource) {
      if (expectedSource.id !== input.id) throw new Error('Разбор относится к другому занятию.');
      // A completed review must not be reopened by a late worker.
      if (previous.status === 'completed') return;
      if (sourceSignature(previous) !== sourceSignature(expectedSource)) {
        throw new Error('Исходная речь изменилась во время разбора. Нужна новая попытка анализа.');
      }
    }
    if (previous.updatedAt !== input.updatedAt && sourceSignature(previous) !== sourceSignature(input)) {
      throw new Error('Занятие изменилось во время обработки. Загрузите свежую версию перед сохранением.');
    }
    // Unrelated edits (comfort/retries) remain intact when a slow analysis finishes.
    const session = expectedSource
      ? { ...structuredClone(previous), analysis: structuredClone(input.analysis), status: input.status, error: input.error, processing: input.processing }
      : structuredClone(input);
    session.createdAt = previous.createdAt;
    session.updatedAt = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
    if (previous.analysis && sourceSignature(previous) !== sourceSignature(session)
      && JSON.stringify(previous.analysis) === JSON.stringify(session.analysis)) {
      session.analysis = null;
      if (['review', 'completed'].includes(session.status)) session.status = 'active';
    }
    writeSession(db, session);
    input.createdAt = session.createdAt;
    input.updatedAt = session.updatedAt;
    input.analysis = session.analysis;
    input.status = session.status;
  });
}

export function updateProfile(profile: Profile): void {
  if (!profile.name.trim() || !Number.isFinite(profile.dailyMinutes) || profile.dailyMinutes <= 0
    || !Number.isFinite(profile.audioRetentionDays) || profile.audioRetentionDays < 0
    || !Number.isFinite(profile.budgetUsd) || profile.budgetUsd < 0) throw new Error('Некорректные настройки профиля.');
  connection().db.prepare('UPDATE settings SET data = ? WHERE key = ?').run(JSON.stringify(profile), 'profile');
}

function readOnboardingRecord(db: DatabaseSync): OnboardingRecord {
  const row = db.prepare('SELECT data FROM settings WHERE key=?').get('onboarding') as JsonRow | undefined;
  if (!row) return emptyOnboardingRecord();
  const record = JSON.parse(row.data) as OnboardingRecord;
  if (record.version !== 1 || (record.introCompletedAt !== null && !Number.isFinite(Date.parse(record.introCompletedAt)))
    || (record.russianControl !== null && (typeof record.russianControl !== 'string' || record.russianControl.length > 2000))) {
    throw new Error('Стартовый профиль повреждён. Исходные занятия сохранены.');
  }
  return record;
}
function writeOnboardingRecord(db: DatabaseSync, record: OnboardingRecord): void {
  db.prepare('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
    .run('onboarding', JSON.stringify(record));
}
export function getOnboardingRecord(): OnboardingRecord { return readOnboardingRecord(connection().db); }
export function completeOnboardingIntro(russianControl: string): void {
  const text = russianControl.trim();
  if (text.length < 20 || text.length > 2000) throw new Error('Напиши свою короткую реплику по-русски, от 20 до 2000 символов.');
  const { db } = connection();
  transaction(db, () => {
    const current = readOnboardingRecord(db);
    if (current.introCompletedAt && current.russianControl === text) return;
    writeOnboardingRecord(db, { version: 1, introCompletedAt: new Date().toISOString(), russianControl: text });
  });
}
export function saveBaselineReport(fingerprint: string, report: BaselineReport): void {
  const { db } = connection();
  transaction(db, () => {
    const current = readOnboardingRecord(db);
    if (!current.introCompletedAt) throw new Error('Сначала пройди знакомство с тренингом.');
    const sessions = (db.prepare('SELECT data FROM sessions').all() as JsonRow[]).map(row => JSON.parse(row.data) as Session);
    const profile = JSON.parse((db.prepare('SELECT data FROM settings WHERE key=?').get('profile') as JsonRow).data) as Profile;
    if (presentOnboarding(current, sessions, profile).status !== 'ready'
      || fingerprint !== baselineReportFingerprint(current, sessions, profile)) {
      throw new Error('Исходные пробы или профиль изменились во время составления результата. Загрузите свежие данные.');
    }
    writeOnboardingRecord(db, { ...current, reportCache: { fingerprint, report } });
  });
}

export function deleteSession(id: string): void {
  const { db, claims } = connection();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  claims.delete(id);
}

/** Training deletion keeps financial usage and profile: deleting history must not bypass the API budget. */
export function deleteAllTraining(): void {
  const { db, claims } = connection();
  transaction(db, () => {
    const nextGeneration = readLearningGeneration(db) + 1;
    db.exec("DELETE FROM sessions; DELETE FROM settings WHERE key='onboarding';");
    db.prepare('INSERT INTO settings(key,data) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data')
      .run('learning-generation', JSON.stringify(nextGeneration));
  });
  claims.clear();
}

export function enqueueAnalysis(id: string): void {
  const { db } = connection();
  transaction(db, () => {
    const session = readSession(db, id);
    if (!session) throw new Error('Занятие не найдено.');
    if (!session.turns.some((turn) => turn.role === 'user' && turn.text.trim())) throw new Error('Для разбора нужна собственная речевая попытка.');
    const now = Date.now();
    const existing = db.prepare('SELECT state,lease_until FROM analysis_jobs WHERE session_id = ?').get(id) as { state: string; lease_until: number | null } | undefined;
    // Expired running jobs must be reclaimed with their attempt count intact, not reset by enqueue.
    if (existing && (existing.state === 'pending' || existing.state === 'running'
      || (existing.state === 'completed' && session.analysis))) return;
    db.prepare(`INSERT INTO analysis_jobs(session_id,state,attempts,available_at,created_at,updated_at)
      VALUES (?,'pending',0,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
      state='pending',attempts=0,available_at=excluded.available_at,lease_until=NULL,token=NULL,last_error=NULL,updated_at=excluded.updated_at`)
      .run(id, now, now, now);
    session.status = 'analysing';
    session.error = undefined;
    session.processing = { stage: 'queued', startedAt: new Date(now).toISOString(), attempt: 0 };
    session.updatedAt = new Date(now).toISOString();
    writeSession(db, session);
  });
}

export function claimAnalysisJob(): { sessionId: string } | null {
  const { db, claims } = connection();
  return transaction(db, () => {
    const now = Date.now();
    const exhausted = db.prepare(`SELECT session_id FROM analysis_jobs WHERE state='running' AND lease_until<=? AND attempts>=?`)
      .all(now, MAX_JOB_ATTEMPTS) as { session_id: string }[];
    for (const job of exhausted) {
      db.prepare(`UPDATE analysis_jobs SET state='failed',lease_until=NULL,token=NULL,last_error=?,updated_at=? WHERE session_id=?`)
        .run('Разбор не завершился после нескольких попыток.', now, job.session_id);
      const session = readSession(db, job.session_id);
      if (session) {
        session.status = 'error';
        session.error = 'Разбор не завершился после нескольких попыток. Исходная речь сохранена.';
        session.updatedAt = new Date(now).toISOString();
        writeSession(db, session);
      }
    }
    const job = db.prepare(`SELECT session_id,attempts,token FROM analysis_jobs
      WHERE attempts<? AND ((state='pending' AND available_at<=?) OR (state='running' AND lease_until<=?))
      ORDER BY created_at,session_id LIMIT 1`).get(MAX_JOB_ATTEMPTS, now, now) as JobRow | undefined;
    if (!job) return null;
    const token = randomUUID();
    db.prepare(`UPDATE analysis_jobs SET state='running',attempts=attempts+1,lease_until=?,token=?,updated_at=? WHERE session_id=?`)
      .run(now + JOB_LEASE_MS, token, now, job.session_id);
    claims.set(job.session_id, token);
    const session = readSession(db, job.session_id);
    if (session) {
      session.processing = { stage: 'evaluating', startedAt: new Date(now).toISOString(), attempt: job.attempts + 1 };
      session.updatedAt = new Date(Math.max(now, Date.parse(session.updatedAt) + 1)).toISOString();
      writeSession(db, session);
    }
    return { sessionId: job.session_id };
  });
}

export function finishAnalysisJob(id: string, error?: string | Error, retryable = true): void {
  const { db, claims } = connection();
  const token = claims.get(id);
  if (!token) return;
  transaction(db, () => {
    const job = db.prepare(`SELECT session_id,attempts,token FROM analysis_jobs WHERE session_id=? AND state='running' AND token=?`)
      .get(id, token) as JobRow | undefined;
    if (!job) return;
    const now = Date.now();
    if (!error) {
      db.prepare(`UPDATE analysis_jobs SET state='completed',lease_until=NULL,token=NULL,last_error=NULL,updated_at=? WHERE session_id=? AND token=?`)
        .run(now, id, token);
      return;
    }
    const message = (error instanceof Error ? error.message : error).slice(0, 2000);
    const terminal = !retryable || job.attempts >= MAX_JOB_ATTEMPTS;
    db.prepare(`UPDATE analysis_jobs SET state=?,available_at=?,lease_until=NULL,token=NULL,last_error=?,updated_at=? WHERE session_id=? AND token=?`)
      .run(terminal ? 'failed' : 'pending', now + 1000 * 2 ** job.attempts, message, now, id, token);
    const session = readSession(db, id);
    if (session) {
      session.status = terminal ? 'error' : 'analysing';
      session.error = terminal ? message + ' Исходная речь сохранена.' : undefined;
      session.processing = terminal ? undefined : { stage: 'waiting-retry', startedAt: new Date(now).toISOString(), attempt: job.attempts,
        nextAttemptAt: new Date(now + 1000 * 2 ** job.attempts).toISOString() };
      session.updatedAt = new Date(now).toISOString();
      writeSession(db, session);
    }
  });
  claims.delete(id);
}

export function addBrainActivity(state: 'success' | 'failed' | 'limit', latencyMs: number, retryAt: string | null = null): void {
  if (!['success', 'failed', 'limit'].includes(state) || !Number.isFinite(latencyMs) || latencyMs < 0) return;
  const validRetry = retryAt && Number.isFinite(Date.parse(retryAt)) ? new Date(retryAt).toISOString() : null;
  connection().db.prepare('INSERT INTO brain_activity(state,latency_ms,retry_at,created_at) VALUES (?,?,?,?)')
    .run(state, Math.round(latencyMs), validRetry, new Date().toISOString());
}

/** These are this app's measured requests, never the account's remaining quota. */
export function getBrainActivity() {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = connection().db.prepare('SELECT state,latency_ms,retry_at,created_at FROM brain_activity WHERE created_at>=? ORDER BY id')
    .all(cutoff) as { state: string; latency_ms: number; retry_at: string | null; created_at: string }[];
  const lastLimit = rows.findLast(row => row.state === 'limit');
  return { scope: 'app' as const, periodDays: 30, requests: rows.length,
    successful: rows.filter(row => row.state === 'success').length, failed: rows.filter(row => row.state !== 'success').length,
    lastRequestAt: rows.at(-1)?.created_at ?? null, lastLimitAt: lastLimit?.created_at ?? null,
    retryAt: lastLimit?.retry_at ?? null,
    averageLatencyMs: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.latency_ms, 0) / rows.length) : null };
}

export function addAudioUsage(kind: 'transcription' | 'speech', amount: number, costUsd: number): void {
  if (!['transcription', 'speech'].includes(kind) || !Number.isFinite(amount) || amount < 0
    || !Number.isFinite(costUsd) || costUsd < 0) throw new Error('Некорректные данные расхода аудио.');
  connection().db.prepare('INSERT INTO audio_usage(kind,amount,cost_usd,created_at) VALUES (?,?,?,?)')
    .run(kind, amount, costUsd, new Date().toISOString());
}

function moscowMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit' }).format(date);
}

export function getAppState(): AppState {
  const { db } = connection();
  return transaction(db, () => {
    const profile = JSON.parse((db.prepare('SELECT data FROM settings WHERE key = ?').get('profile') as JsonRow).data) as Profile;
    const sessions = (db.prepare('SELECT data FROM sessions ORDER BY created_at DESC,id').all() as JsonRow[])
      .map((row) => JSON.parse(row.data) as Session);
    const month = moscowMonth(new Date());
    const usage = (db.prepare('SELECT kind,amount,cost_usd,created_at FROM audio_usage').all() as { kind: string; amount: number; cost_usd: number; created_at: string }[])
      .filter((row) => moscowMonth(new Date(row.created_at)) === month);
    const completed = sessions.filter((session) => session.status === 'completed' && session.turns.some((turn) => turn.role === 'user' && turn.text.trim()));
    const onboarding = presentOnboarding(readOnboardingRecord(db), sessions, profile);
    return {
      profile, sessions, skills: deriveSkillStates(sessions), reviews: deriveReviews(sessions), xp: calculateXP(sessions),
      onboarding,
      completed: completed.length,
      calibrationCompleted: onboarding.introCompletedAt ? onboarding.completedStages
        : completed.filter((session) => session.lesson.kind === 'calibration').length,
      audioUsage: {
        usedUsd: usage.reduce((sum, row) => sum + row.cost_usd, 0), estimated: true, budgetUsd: profile.budgetUsd,
        recordedMinutes: usage.filter((row) => row.kind === 'transcription').reduce((sum, row) => sum + row.amount, 0),
        spokenCharacters: usage.filter((row) => row.kind === 'speech').reduce((sum, row) => sum + row.amount, 0),
      },
    };
  });
}
