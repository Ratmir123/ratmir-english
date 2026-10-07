import { randomUUID } from 'node:crypto';
import { codexJson } from '../codex';
import { connection, transaction } from '../db';
import { getAppState } from '../store';
import { touchedAt } from '../phrases/repository';
import { PREP_FAILED_NOTE, PREP_JSON_SCHEMA, PREP_UNUSABLE_NOTE, buildPrepPrompt, prepOutputSchema, sanitisePrep, usablePrep, type PrepResult } from './prompt';
import { type PrepJob, type StoredPrep, deleteImages, imageDataUrls, readPrep, readReadingPreps, writePrep } from './repository';

/**
 * One in-process background queue reads call preps with Sol (PASS-0.5.5 §2), like «Послушать» (phrases/listen-queue.ts): one prep
 * at a time, effort medium, the screenshots attached. Every attempt is persisted before the call; a failed first attempt is retried
 * after a few seconds, after two failures the prep is marked failed (its screenshots stay a day for «Повторить»). A prep left
 * 'reading' by a previous process is picked up eight minutes after its last attempt (a long turn may take seven).
 */
export type PrepRunner = (prompt: string, schema: Record<string, unknown>, images: string[]) => Promise<unknown>;
export const PREP_MAX_ATTEMPTS = 2;
export const PREP_STALE_MS = 8 * 60_000;
export const PREP_RETRY_MS = 5_000;

interface QueueState {
  order: string[]; queued: Set<string>; active: string | null; running: boolean; drain: Promise<void> | null;
  runner: PrepRunner | null; timers: Map<string, ReturnType<typeof setTimeout>>; started: boolean;
}
const globals = globalThis as typeof globalThis & { smoothPrepQueue?: QueueState };
function queue(): QueueState {
  return globals.smoothPrepQueue ??= { order: [], queued: new Set(), active: null, running: false, drain: null, runner: null, timers: new Map(), started: false };
}

const defaultRunner: PrepRunner = (prompt, schema, images) => codexJson<unknown>(prompt, schema, 'medium', 'prep', images);
const emptyJob = (): PrepJob => ({ attempts: 0, lastAttemptAt: null, token: null });
const time = (value: string | null | undefined) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };

/** Tests (and scripts) replace Sol; pass null to restore the default runner. */
export function setPrepRunner(runner: PrepRunner | null): void { queue().runner = runner; }

export function clearPrepQueue(): void {
  const state = queue();
  for (const timer of state.timers.values()) clearTimeout(timer);
  state.timers.clear(); state.order = []; state.queued.clear(); state.started = false;
}

function kick(state: QueueState): void {
  if (state.running) return;
  state.running = true;
  state.drain = (async () => {
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      while (state.order.length) {
        const id = state.order.shift()!;
        state.queued.delete(id);
        state.active = id;
        try { await readPrepJob(id, state.runner ?? defaultRunner); } catch { /* the queue never throws */ }
        finally { state.active = null; }
      }
    } finally { state.running = false; }
  })();
}

export function enqueuePrep(id: string): void {
  const state = queue();
  const timer = state.timers.get(id);
  if (timer) { clearTimeout(timer); state.timers.delete(id); }
  if (state.queued.has(id)) return;
  state.queued.add(id); state.order.push(id);
  kick(state);
}

export async function prepQueueIdle(): Promise<void> {
  const state = queue();
  while (state.running || state.order.length) {
    if (state.drain) await state.drain; else await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function scheduleRetry(id: string): void {
  const state = queue();
  if (state.timers.has(id)) return;
  const timer = setTimeout(() => { state.timers.delete(id); enqueuePrep(id); }, PREP_RETRY_MS);
  timer.unref?.();
  state.timers.set(id, timer);
}

function failed(prep: StoredPrep, now: number, note = PREP_FAILED_NOTE): StoredPrep {
  return { ...prep, status: 'failed', note, job: { ...(prep.job ?? emptyJob()), token: null }, updatedAt: touchedAt(prep.updatedAt, now) };
}

function claimAttempt(id: string, now: number): { token: string; prep: StoredPrep } | null {
  const { db } = connection();
  return transaction(db, () => {
    const prep = readPrep(db, id);
    if (!prep || prep.status !== 'reading') return null;
    const job = prep.job ?? emptyJob();
    if (job.attempts >= PREP_MAX_ATTEMPTS) { writePrep(db, failed(prep, now)); return null; }
    const token = randomUUID();
    const claimed: StoredPrep = { ...prep, job: { attempts: job.attempts + 1, lastAttemptAt: new Date(now).toISOString(), token } };
    writePrep(db, claimed);
    return { token, prep: claimed };
  });
}

/** Stores the result; the screenshots are deleted once read (also when they turned out to be unusable). */
function completeAttempt(id: string, token: string, result: PrepResult | null, now: number): void {
  const { db } = connection();
  const done = transaction(db, () => {
    const prep = readPrep(db, id);
    if (!prep || prep.status !== 'reading' || prep.job?.token !== token) return false;
    if (!result) { writePrep(db, { ...failed(prep, now, PREP_UNUSABLE_NOTE), images: [] }); return true; }
    const { scenario, ...fields } = result;
    writePrep(db, { ...prep, ...fields, status: 'ready', note: null, scenario, images: [], job: { ...prep.job, token: null }, updatedAt: touchedAt(prep.updatedAt, now) });
    return true;
  });
  if (done) deleteImages(id);
}

function failAttempt(id: string, token: string, now: number): 'retry' | 'failed' | 'gone' {
  const { db } = connection();
  return transaction(db, () => {
    const prep = readPrep(db, id);
    if (!prep || prep.status !== 'reading' || prep.job?.token !== token) return 'gone';
    if (prep.job.attempts >= PREP_MAX_ATTEMPTS) { writePrep(db, failed(prep, now)); return 'failed'; }
    writePrep(db, { ...prep, job: { ...prep.job, token: null } });
    return 'retry';
  });
}

/** One attempt for one prep. Never throws: a failure is recorded on the prep. */
export async function readPrepJob(id: string, runner: PrepRunner = queue().runner ?? defaultRunner, clock: () => number = Date.now): Promise<void> {
  const claim = claimAttempt(id, clock());
  if (!claim) return;
  let result: PrepResult | null;
  try {
    const images = imageDataUrls(id, claim.prep.images ?? []);
    const state = getAppState();
    const output = prepOutputSchema.parse(await runner(buildPrepPrompt(state, claim.prep, images.length, clock()), PREP_JSON_SCHEMA, images));
    const sanitised = sanitisePrep(output, state);
    result = output.usable && usablePrep(sanitised) ? sanitised : null;
  } catch {
    if (failAttempt(id, claim.token, clock()) === 'retry') scheduleRetry(id);
    return;
  }
  completeAttempt(id, claim.token, result, clock());
}

/** Preps still 'reading' eight minutes after their last attempt go back into the queue; used-up ones are marked failed. */
export function requeueStalePreps(now = Date.now()): void {
  const state = queue();
  state.started = true;
  try {
    const { db } = connection();
    for (const prep of readReadingPreps(db)) {
      if (state.queued.has(prep.id) || state.active === prep.id) continue;
      const job = prep.job ?? emptyJob();
      if (job.attempts > 0 && now - time(job.lastAttemptAt) < PREP_STALE_MS) continue;
      if (job.attempts >= PREP_MAX_ATTEMPTS) {
        transaction(db, () => {
          const current = readPrep(db, prep.id);
          if (current?.status === 'reading') writePrep(db, failed(current, now));
        });
        continue;
      }
      enqueuePrep(prep.id);
    }
  } catch { /* a read must never fail because of the background queue */ }
}

/** First touch in this process (≈ server start): pick up preps a previous process left half-read. */
export function ensurePrepQueue(): void {
  if (!queue().started) requeueStalePreps();
}
