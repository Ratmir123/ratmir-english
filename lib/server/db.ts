import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initialProfile } from './profile';

export type Connection = { db: DatabaseSync; claims: Map<string, string>; filename: string };
const connectionCache = globalThis as typeof globalThis & { __ratmirTrainingConnections?: Map<string, Connection> };
type TableInitializer = (db: DatabaseSync) => void;
const initializers: TableInitializer[] = [];

/** Feature modules register their own tables; they run once per connection, after the core schema. */
export function registerTables(initializer: TableInitializer): void {
  if (initializers.includes(initializer)) return;
  initializers.push(initializer);
  for (const value of connectionCache.__ratmirTrainingConnections?.values() ?? []) initializer(value.db);
}

export function dataDirectory(): string {
  return dirname(databaseFilename());
}

function databaseFilename(): string {
  return resolve(/* turbopackIgnore: true */ process.env.TRAINING_DB_PATH || resolve(process.cwd(), '.data', 'training.sqlite'));
}

export function connection(): Connection {
  const filename = databaseFilename();
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
  for (const initializer of initializers) initializer(db);
  const value: Connection = { db, claims: new Map<string, string>(), filename };
  cache.set(filename, value);
  return value;
}

export function transaction<T>(db: DatabaseSync, operation: () => T): T {
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

/** Run inside an existing transaction when one is open; otherwise open one. */
export function maybeTransaction<T>(db: DatabaseSync, operation: () => T): T {
  return db.isTransaction ? operation() : transaction(db, operation);
}
