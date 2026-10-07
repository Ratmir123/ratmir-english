import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ApiError } from '../http';
import { connection, transaction } from '../db';
import { moscowDayStart } from '../phrases/service';
import { touchedAt } from '../phrases/repository';
import type { Session } from '../../types';
import type { LessonPlanV05 } from '../../training';
import { PREP_DAILY_LIMIT, PREP_GOAL_LIMIT, PREP_IMAGE_TYPES, PREP_MAX_IMAGES, PREP_MAX_IMAGE_BYTES, PREP_MAX_TOTAL_BYTES, PREP_MIN_TEXT,
  PREP_REMINDER_LIMIT, PREP_TEXT_LIMIT, type CallPrep, type PrepOrigin, type PrepRehearsal, type PrepReminder } from '../../preps/types';
import { PREP_ID, PREPS_IN_LIST, PREPS_IN_STATE, type StoredPrep, countPrepsCreatedSince, deleteImages, deletePrepRow, hasImages, readPrep,
  readPreps, saveImages, sweepImages, writePrep } from './repository';

/**
 * «Подготовка к созвону» requests (PASS-0.5.5 §2): validation of the upload, the client view with each rehearsal's reminders, retry
 * and delete. Reading the screenshots happens in the background queue (queue.ts).
 */
export const PREP_NOT_FOUND = 'Подготовка не найдена.';
export const PREP_EMPTY = 'Добавь скриншоты переписки или пару фраз о созвоне.';
export const PREP_BAD_IMAGE = 'Скриншоты принимаются в PNG, JPEG или WebP, до 8 МБ каждый.';
export const PREP_TOO_MANY = 'Не больше 8 скриншотов за раз.';
export const PREP_TOO_LARGE = 'Скриншоты слишком тяжёлые: до 32 МБ вместе.';
export const PREP_LIMIT = 'На сегодня хватит подготовок: 20 в сутки. Завтра снова можно.';
export const PREP_BAD_UPLOAD = 'Не удалось прочитать загрузку. Попробуй ещё раз.';

export interface PrepUpload { images: unknown[]; text: unknown; goal: unknown; callAt: unknown; origin: unknown }
type SessionLookup = (id: string) => Session | null | undefined;

const ORIGINS: PrepOrigin[] = ['web', 'desktop', 'ios'];
const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/png': bytes => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  'image/jpeg': bytes => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': bytes => bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
};

function field(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length > limit) throw new ApiError(`Слишком длинный текст: до ${limit} символов.`, 400);
  return text || null;
}

/** The call time: a real date from a day ago to 60 days ahead, else ignored. */
function callTime(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < now - 24 * 60 * 60_000 || time > now + 60 * 24 * 60 * 60_000) return null;
  return new Date(time).toISOString();
}

/** Each screenshot is checked by its declared type AND its first bytes; HEIC and anything else are refused. */
async function readImages(values: unknown[]): Promise<{ bytes: Uint8Array; type: string }[]> {
  const files = values.filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length !== values.filter(value => value !== '' && value !== null && value !== undefined).length) throw new ApiError(PREP_BAD_IMAGE, 400);
  if (files.length > PREP_MAX_IMAGES) throw new ApiError(PREP_TOO_MANY, 400);
  if (files.reduce((sum, file) => sum + file.size, 0) > PREP_MAX_TOTAL_BYTES) throw new ApiError(PREP_TOO_LARGE, 413);
  const images: { bytes: Uint8Array; type: string }[] = [];
  for (const file of files) {
    const type = file.type.toLowerCase();
    if (!(PREP_IMAGE_TYPES as readonly string[]).includes(type) || file.size > PREP_MAX_IMAGE_BYTES) throw new ApiError(PREP_BAD_IMAGE, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!SIGNATURES[type](bytes)) throw new ApiError(PREP_BAD_IMAGE, 400);
    images.push({ bytes, type });
  }
  return images;
}

function rehearsalStatus(session: Session | null | undefined): PrepRehearsal['status'] {
  return session ? session.status : 'deleted';
}

/**
 * What the rehearsal showed, most expensive first (§1.4): its priorities (quote → example), repeated patterns not already covered,
 * then English errors that change meaning or sound junior. At most PREP_REMINDER_LIMIT.
 */
export function rehearsalReminders(session: Session | null | undefined): PrepReminder[] {
  const analysis = session?.analysis;
  if (!session || !analysis) return [];
  const items: PrepReminder[] = analysis.priorities.map(priority => ({ kind: 'cost' as const, title: priority.title,
    said: priority.quote || null, better: priority.example || null }));
  const covered = new Set(analysis.priorities.flatMap(priority => priority.patternId ? [priority.patternId] : []));
  const titles = new Map(((session.lesson as LessonPlanV05).coaching?.patterns ?? []).map(pattern => [pattern.id, pattern.title]));
  for (const hit of analysis.patternHits ?? []) {
    if (hit.outcome !== 'repeated' || covered.has(hit.patternId) || !titles.has(hit.patternId)) continue;
    covered.add(hit.patternId);
    items.push({ kind: 'pattern', title: titles.get(hit.patternId)!, said: hit.quote || null, better: null });
  }
  const errors = [...(analysis.languageErrors ?? [])].filter(error => error.impact !== 'minor')
    .sort((left, right) => Number(right.impact === 'meaning') - Number(left.impact === 'meaning'));
  for (const error of errors) items.push({ kind: 'language', title: 'Английский', said: error.quote, better: error.correction });
  return items.slice(0, PREP_REMINDER_LIMIT);
}

/** The shared CallPrep shape: no scene, job or image list; each rehearsal with its session's status and reminders. */
export function presentPrep(stored: StoredPrep, lookup: SessionLookup): CallPrep {
  const { scenario: _scenario, job: _job, images: _images, rehearsals, ...rest } = stored;
  return {
    ...rest,
    watchouts: rest.watchouts ?? [], questions: rest.questions ?? [], avoid: rest.avoid ?? [], risks: rest.risks ?? [], limitations: rest.limitations ?? [],
    rehearsals: (rehearsals ?? []).map(rehearsal => {
      const session = lookup(rehearsal.sessionId);
      return { ...rehearsal, status: rehearsalStatus(session), remember: rehearsalReminders(session) };
    }),
  };
}

export function listPrepsForState(db: DatabaseSync, sessions: readonly Session[]): CallPrep[] {
  const byId = new Map(sessions.map(session => [session.id, session]));
  return readPreps(db, PREPS_IN_STATE).map(prep => presentPrep(prep, id => byId.get(id)));
}

export function listPreps(lookup: SessionLookup): CallPrep[] {
  return readPreps(connection().db, PREPS_IN_LIST).map(prep => presentPrep(prep, lookup));
}

function existing(db: DatabaseSync, id: string): StoredPrep {
  const prep = PREP_ID.test(id) ? readPrep(db, id) : null;
  if (!prep) throw new ApiError(PREP_NOT_FOUND, 404);
  return prep;
}

export function getPrep(id: string, lookup: SessionLookup): CallPrep {
  return presentPrep(existing(connection().db, id), lookup);
}

/** The stored prep (with its hidden scene) for planning a rehearsal. */
export function getStoredPrep(id: string): StoredPrep {
  return existing(connection().db, id);
}

/** §2: validate, keep the screenshots on disk until they are read, store the prep as 'reading'. */
export async function createPrep(upload: PrepUpload, now = Date.now()): Promise<StoredPrep> {
  const images = await readImages(upload.images);
  const text = field(upload.text, PREP_TEXT_LIMIT);
  const goal = field(upload.goal, PREP_GOAL_LIMIT);
  if (!images.length && (text?.length ?? 0) < PREP_MIN_TEXT) throw new ApiError(PREP_EMPTY, 400);
  const origin = ORIGINS.includes(upload.origin as PrepOrigin) ? upload.origin as PrepOrigin : 'web';
  const { db } = connection();
  if (countPrepsCreatedSince(db, moscowDayStart(now)) >= PREP_DAILY_LIMIT) throw new ApiError(PREP_LIMIT, 429);
  try { sweepImages(db, now); } catch { /* a sweep failure never blocks a new prep */ }
  const id = randomUUID();
  const at = new Date(now).toISOString();
  const saved = saveImages(id, images);
  const prep: StoredPrep = {
    id, createdAt: at, updatedAt: at, status: 'reading',
    input: { images: saved.length, text, goal, callAt: callTime(upload.callAt, now), origin },
    title: null, counterpart: null, when: null, situation: null, goal: null, watchouts: [], questions: [], lines: null, price: null,
    avoid: [], risks: [], limitations: [], note: null, rehearsals: [], scenario: null,
    job: { attempts: 0, lastAttemptAt: null, token: null }, images: saved,
  };
  try {
    transaction(db, () => {
      if (countPrepsCreatedSince(db, moscowDayStart(now)) >= PREP_DAILY_LIMIT) throw new ApiError(PREP_LIMIT, 429);
      writePrep(db, prep);
    });
  } catch (error) { deleteImages(id); throw error; }
  return prep;
}

/** A failed prep reads again while its screenshots (or a usable note) are still there. */
export function retryPrep(id: string, now = Date.now()): StoredPrep {
  const { db } = connection();
  return transaction(db, () => {
    const prep = existing(db, id);
    if (prep.status !== 'failed') throw new ApiError('Эта подготовка не требует повтора.', 409);
    if (!hasImages(id, prep.images) && (prep.input.text?.length ?? 0) < PREP_MIN_TEXT) {
      throw new ApiError('Скриншоты уже удалены. Создай подготовку заново.', 409);
    }
    const next: StoredPrep = { ...prep, status: 'reading', note: null, job: { attempts: 0, lastAttemptAt: null, token: null }, updatedAt: touchedAt(prep.updatedAt, now) };
    writePrep(db, next);
    return next;
  });
}

/** Deleting a prep keeps its rehearsal sessions in the history. */
export function deletePrep(id: string): void {
  const { db } = connection();
  transaction(db, () => { existing(db, id); deletePrepRow(db, id); });
  deleteImages(id);
}

/** A rehearsal session belongs to its prep from the moment it is created. */
export function linkRehearsal(prepId: string, rehearsal: { sessionId: string; tier: 1 | 2 | 3; mode: 'learning' | 'call' }, now = Date.now()): void {
  const { db } = connection();
  transaction(db, () => {
    const prep = readPrep(db, prepId);
    if (!prep) return;
    writePrep(db, { ...prep, rehearsals: [...(prep.rehearsals ?? []), { ...rehearsal, createdAt: new Date(now).toISOString() }], updatedAt: touchedAt(prep.updatedAt, now) });
  });
}
