import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { codexJson } from '../codex';
import { connection, transaction } from '../db';
import { getAppState } from '../store';
import { LISTEN_FAILED_NOTE, LISTEN_JSON_SCHEMA, LISTEN_PHRASE_CAP_NOTE, LISTEN_UNUSABLE_NOTE, buildListenPrompt, listenOutputSchema,
  sanitiseListen, type HeardPhrase, type ListenAnalysis } from './listen-prompt';
import { type ListenJob, type ListenPhraseRef, type StoredClip, readAnalyzingClips, readClip, writeClip } from './listen-repository';
import { type StoredPhrase, countPhrasesCreatedSince, normalisedPhraseText, readPhrases, touchedAt, writePhrase } from './repository';
import { PHRASE_DAILY_LIMIT, moscowDayStart } from './service';

/**
 * One in-process background queue explains «Послушать» clips with Sol (PASS-0.5.4 §1.3), like the phrase queue (queue.ts): one
 * clip at a time, effort low. Every attempt is persisted before the call, so a crash still counts it. The learner is waiting for the
 * result, so a failed first attempt is retried after a few seconds; after two failures the clip is marked failed. A clip left
 * 'analyzing' by a previous process is picked up two minutes after its last attempt (server start, /api/state, a poll). A result
 * from an attempt that was superseded is dropped by its token.
 */
export type ListenAnalysisRunner = (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;
export const LISTEN_MAX_ATTEMPTS = 2;
export const LISTEN_STALE_MS = 2 * 60_000;
export const LISTEN_RETRY_MS = 3_000;

interface QueueState {
  order: string[]; queued: Set<string>; active: string | null; running: boolean; drain: Promise<void> | null;
  runner: ListenAnalysisRunner | null; timers: Map<string, ReturnType<typeof setTimeout>>; started: boolean;
}
const globals = globalThis as typeof globalThis & { smoothListenQueue?: QueueState };
function queue(): QueueState {
  return globals.smoothListenQueue ??= { order: [], queued: new Set(), active: null, running: false, drain: null, runner: null, timers: new Map(), started: false };
}

const defaultRunner: ListenAnalysisRunner = (prompt, schema) => codexJson<unknown>(prompt, schema, 'low', 'listen');
const emptyJob = (): ListenJob => ({ attempts: 0, lastAttemptAt: null, token: null });
const time = (value: string | null | undefined) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };

/** Tests (and scripts) replace Sol; pass null to restore the default runner. */
export function setListenAnalysisRunner(runner: ListenAnalysisRunner | null): void { queue().runner = runner; }

/** Drop everything queued and every retry timer (tests, shutdown). An attempt already running finishes on its own. */
export function clearListenQueue(): void {
  const state = queue();
  for (const timer of state.timers.values()) clearTimeout(timer);
  state.timers.clear(); state.order = []; state.queued.clear(); state.started = false;
}

function kick(state: QueueState): void {
  if (state.running) return;
  state.running = true;
  state.drain = (async () => {
    try {
      // Let the request that stored the clip answer first; the queue reads the learner state for the prompt.
      await new Promise<void>(resolve => setImmediate(resolve));
      while (state.order.length) {
        const id = state.order.shift()!;
        state.queued.delete(id);
        state.active = id;
        try { await analyseClip(id, state.runner ?? defaultRunner); } catch { /* the queue never throws */ }
        finally { state.active = null; }
      }
    } finally { state.running = false; }
  })();
}

export function enqueueListenAnalysis(id: string): void {
  const state = queue();
  const timer = state.timers.get(id);
  if (timer) { clearTimeout(timer); state.timers.delete(id); }
  if (state.queued.has(id)) return;
  state.queued.add(id); state.order.push(id);
  kick(state);
}

/** Resolves once nothing is queued or running (tests). */
export async function listenQueueIdle(): Promise<void> {
  const state = queue();
  while (state.running || state.order.length) {
    if (state.drain) await state.drain; else await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function scheduleRetry(id: string): void {
  const state = queue();
  if (state.timers.has(id)) return;
  const timer = setTimeout(() => { state.timers.delete(id); enqueueListenAnalysis(id); }, LISTEN_RETRY_MS);
  timer.unref?.();
  state.timers.set(id, timer);
}

function failed(clip: StoredClip, now: number): StoredClip {
  return { ...clip, status: 'failed', note: LISTEN_FAILED_NOTE, job: { ...(clip.job ?? emptyJob()), token: null }, updatedAt: touchedAt(clip.updatedAt, now) };
}

function claimAttempt(id: string, now: number): { token: string; clip: StoredClip } | null {
  const { db } = connection();
  return transaction(db, () => {
    const clip = readClip(db, id);
    if (!clip || clip.status !== 'analyzing') return null;
    const job = clip.job ?? emptyJob();
    if (job.attempts >= LISTEN_MAX_ATTEMPTS) { writeClip(db, failed(clip, now)); return null; }
    const token = randomUUID();
    const claimed: StoredClip = { ...clip, job: { attempts: job.attempts + 1, lastAttemptAt: new Date(now).toISOString(), token } };
    writeClip(db, claimed);
    return { token, clip: claimed };
  });
}

/**
 * The clip's expressions become ordinary saved phrases (enrichment ready at once, `heard` = the clip line). One that is already
 * saved — the same normalised text or enriched expression — is pointed to with duplicate: true instead. The 200-per-day phrase
 * cap applies: past it nothing new is saved and `capped` says so. Runs inside the completing transaction.
 */
function saveHeardPhrases(db: DatabaseSync, clip: StoredClip, phrases: HeardPhrase[], now: number): { refs: ListenPhraseRef[]; capped: boolean } {
  const known = new Map<string, StoredPhrase>();
  const stored = readPhrases(db);
  // What he saved himself wins over an enriched expression of another row; the newest row wins among equals.
  for (const pick of [(phrase: StoredPhrase) => phrase.text, (phrase: StoredPhrase) => phrase.phrase]) {
    for (const phrase of stored) {
      const key = normalisedPhraseText(pick(phrase) ?? '');
      if (key && !known.has(key)) known.set(key, phrase);
    }
  }
  let created = countPhrasesCreatedSince(db, moscowDayStart(now));
  let capped = false;
  const refs: ListenPhraseRef[] = [];
  const at = new Date(now).toISOString();
  for (const fields of phrases) {
    const key = normalisedPhraseText(fields.phrase);
    const existing = known.get(key);
    if (existing) {
      if (!refs.some(ref => ref.id === existing.id)) refs.push({ id: existing.id, duplicate: true });
      continue;
    }
    if (created >= PHRASE_DAILY_LIMIT) { capped = true; continue; }
    const phrase: StoredPhrase = { id: randomUUID(), text: fields.phrase, origin: clip.origin, createdAt: at, updatedAt: at, enrichment: 'ready',
      phrase: fields.phrase, meaning: fields.meaning, note: fields.note, example: fields.example, exampleRu: fields.exampleRu, cue: fields.cue,
      situation: fields.situation, status: 'new', stage: 0, dueAt: at, lastPracticedAt: null, lastOfferedAt: null, history: [], archived: false,
      heard: fields.heard };
    writePhrase(db, phrase);
    known.set(key, phrase); created++;
    refs.push({ id: phrase.id, duplicate: false });
  }
  return { refs, capped };
}

function completeAttempt(id: string, token: string, analysis: ListenAnalysis, now: number): void {
  const { db } = connection();
  transaction(db, () => {
    const clip = readClip(db, id);
    if (!clip || clip.status !== 'analyzing' || clip.job?.token !== token) return;
    const ready: StoredClip = { ...clip, status: 'ready', gist: analysis.gist, points: analysis.points, phraseRefs: [], note: null,
      job: { ...clip.job, token: null }, updatedAt: touchedAt(clip.updatedAt, now) };
    if (!analysis.usable) { writeClip(db, { ...ready, note: LISTEN_UNUSABLE_NOTE }); return; }
    const { refs, capped } = saveHeardPhrases(db, clip, analysis.phrases, now);
    writeClip(db, { ...ready, phraseRefs: refs, note: capped ? LISTEN_PHRASE_CAP_NOTE : null });
  });
}

function failAttempt(id: string, token: string, now: number): 'retry' | 'failed' | 'gone' {
  const { db } = connection();
  return transaction(db, () => {
    const clip = readClip(db, id);
    if (!clip || clip.status !== 'analyzing' || clip.job?.token !== token) return 'gone';
    if (clip.job.attempts >= LISTEN_MAX_ATTEMPTS) { writeClip(db, failed(clip, now)); return 'failed'; }
    writeClip(db, { ...clip, job: { ...clip.job, token: null } });
    return 'retry';
  });
}

/** One attempt for one clip. Never throws: a failure is recorded on the clip. */
export async function analyseClip(id: string, runner: ListenAnalysisRunner = queue().runner ?? defaultRunner, clock: () => number = Date.now): Promise<void> {
  const claim = claimAttempt(id, clock());
  if (!claim) return;
  let analysis: ListenAnalysis;
  try {
    const output = await runner(buildListenPrompt(getAppState(), claim.clip), LISTEN_JSON_SCHEMA);
    analysis = sanitiseListen(listenOutputSchema.parse(output), claim.clip.transcript);
  } catch {
    if (failAttempt(id, claim.token, clock()) === 'retry') scheduleRetry(id);
    return;
  }
  completeAttempt(id, claim.token, analysis, clock());
}

/**
 * Clips still 'analyzing' two minutes after their last attempt (or creation) go back into the queue; ones whose attempts are used
 * up are marked failed. Runs on the first use after a server start, on every read of /api/state and on every clip poll.
 */
export function requeueStaleClips(now = Date.now()): void {
  const state = queue();
  state.started = true;
  try {
    const { db } = connection();
    for (const clip of readAnalyzingClips(db)) {
      if (state.queued.has(clip.id) || state.active === clip.id) continue;
      const job = clip.job ?? emptyJob();
      if (now - time(job.lastAttemptAt ?? clip.createdAt) < LISTEN_STALE_MS) continue;
      if (job.attempts >= LISTEN_MAX_ATTEMPTS) {
        transaction(db, () => {
          const current = readClip(db, clip.id);
          if (current?.status === 'analyzing') writeClip(db, failed(current, now));
        });
        continue;
      }
      enqueueListenAnalysis(clip.id);
    }
  } catch { /* a read must never fail because of the background queue */ }
}

/** First touch in this process (≈ server start): pick up clips a previous process left half-analysed. */
export function ensureListenQueue(): void {
  if (!queue().started) requeueStaleClips();
}
