import { randomUUID } from 'node:crypto';
import { codexJson } from '../codex';
import { connection, transaction } from '../db';
import { getAppState } from '../store';
import { ENRICHMENT_JSON_SCHEMA, FAILED_NOTE, UNUSABLE_NOTE, buildEnrichmentPrompt, enrichmentOutputSchema, sanitiseEnrichment,
  type EnrichedFields } from './prompt';
import { type EnrichmentJob, type StoredPhrase, readPendingPhrases, readPhrase, touchedAt, writePhrase } from './repository';

/**
 * One in-process background queue enriches saved phrases with Sol (PASS-0.5.3 §1.3): one phrase at a time, effort low.
 * Every attempt is persisted before the call, so a crash still counts it. A failed attempt stays pending and is retried after
 * two minutes (timer, server start or a read of /api/state); after three failures the phrase is marked failed and stays usable
 * when its text is English. A result from an attempt that was superseded (retry, deletion) is dropped by its token.
 */
export type PhraseEnrichmentRunner = (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;
export const ENRICHMENT_MAX_ATTEMPTS = 3;
export const ENRICHMENT_STALE_MS = 2 * 60_000;

interface QueueState {
  order: string[]; queued: Set<string>; active: string | null; running: boolean; drain: Promise<void> | null;
  runner: PhraseEnrichmentRunner | null; timers: Map<string, ReturnType<typeof setTimeout>>; started: boolean;
}
const globals = globalThis as typeof globalThis & { smoothPhraseQueue?: QueueState };
function queue(): QueueState {
  return globals.smoothPhraseQueue ??= { order: [], queued: new Set(), active: null, running: false, drain: null, runner: null, timers: new Map(), started: false };
}

const defaultRunner: PhraseEnrichmentRunner = (prompt, schema) => codexJson<unknown>(prompt, schema, 'low', 'phrase');
const emptyJob = (): EnrichmentJob => ({ attempts: 0, lastAttemptAt: null, token: null });
const time = (value: string | null | undefined) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };

/** Tests (and scripts) replace Sol; pass null to restore the default runner. */
export function setPhraseEnrichmentRunner(runner: PhraseEnrichmentRunner | null): void { queue().runner = runner; }

/** Drop everything queued and every retry timer (tests, shutdown). An attempt already running finishes on its own. */
export function clearPhraseQueue(): void {
  const state = queue();
  for (const timer of state.timers.values()) clearTimeout(timer);
  state.timers.clear(); state.order = []; state.queued.clear(); state.started = false;
}

function kick(state: QueueState): void {
  if (state.running) return;
  state.running = true;
  state.drain = (async () => {
    try {
      // Let the request that queued the phrase answer first; the queue reads the learner state for the prompt.
      await new Promise<void>(resolve => setImmediate(resolve));
      while (state.order.length) {
        const id = state.order.shift()!;
        state.queued.delete(id);
        state.active = id;
        try { await enrichPhrase(id, state.runner ?? defaultRunner); } catch { /* the queue never throws */ }
        finally { state.active = null; }
      }
    } finally { state.running = false; }
  })();
}

export function enqueuePhraseEnrichment(id: string): void {
  const state = queue();
  const timer = state.timers.get(id);
  if (timer) { clearTimeout(timer); state.timers.delete(id); }
  if (state.queued.has(id)) return;
  state.queued.add(id); state.order.push(id);
  kick(state);
}

/** Resolves once nothing is queued or running (tests). */
export async function phraseQueueIdle(): Promise<void> {
  const state = queue();
  while (state.running || state.order.length) {
    if (state.drain) await state.drain; else await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function scheduleRetry(id: string): void {
  const state = queue();
  if (state.timers.has(id)) return;
  const timer = setTimeout(() => { state.timers.delete(id); enqueuePhraseEnrichment(id); }, ENRICHMENT_STALE_MS);
  timer.unref?.();
  state.timers.set(id, timer);
}

function withoutEnrichment(phrase: StoredPhrase, note: string, now: number): StoredPhrase {
  return { ...phrase, enrichment: 'failed', phrase: null, meaning: null, note, example: null, exampleRu: null, cue: null, situation: null,
    enrichJob: { ...(phrase.enrichJob ?? emptyJob()), token: null }, updatedAt: touchedAt(phrase.updatedAt, now) };
}

function claimAttempt(id: string, now: number): { token: string; text: string; origin: StoredPhrase['origin'] } | null {
  const { db } = connection();
  return transaction(db, () => {
    const phrase = readPhrase(db, id);
    if (!phrase || phrase.enrichment !== 'pending') return null;
    const job = phrase.enrichJob ?? emptyJob();
    if (job.attempts >= ENRICHMENT_MAX_ATTEMPTS) { writePhrase(db, withoutEnrichment(phrase, FAILED_NOTE, now)); return null; }
    const token = randomUUID();
    writePhrase(db, { ...phrase, enrichJob: { attempts: job.attempts + 1, lastAttemptAt: new Date(now).toISOString(), token } });
    return { token, text: phrase.text, origin: phrase.origin };
  });
}

function completeAttempt(id: string, token: string, fields: EnrichedFields | null, now: number): void {
  const { db } = connection();
  transaction(db, () => {
    const phrase = readPhrase(db, id);
    if (!phrase || phrase.enrichment !== 'pending' || phrase.enrichJob?.token !== token) return;
    if (!fields) { writePhrase(db, withoutEnrichment(phrase, UNUSABLE_NOTE, now)); return; }
    writePhrase(db, { ...phrase, ...fields, enrichment: 'ready', enrichJob: { ...phrase.enrichJob, token: null }, updatedAt: touchedAt(phrase.updatedAt, now) });
  });
}

function failAttempt(id: string, token: string, now: number): 'retry' | 'failed' | 'gone' {
  const { db } = connection();
  return transaction(db, () => {
    const phrase = readPhrase(db, id);
    if (!phrase || phrase.enrichment !== 'pending' || phrase.enrichJob?.token !== token) return 'gone';
    if (phrase.enrichJob.attempts >= ENRICHMENT_MAX_ATTEMPTS) { writePhrase(db, withoutEnrichment(phrase, FAILED_NOTE, now)); return 'failed'; }
    writePhrase(db, { ...phrase, enrichJob: { ...phrase.enrichJob, token: null } });
    return 'retry';
  });
}

/** One attempt for one phrase. Never throws: a failure is recorded on the phrase. */
export async function enrichPhrase(id: string, runner: PhraseEnrichmentRunner = queue().runner ?? defaultRunner, clock: () => number = Date.now): Promise<void> {
  const claim = claimAttempt(id, clock());
  if (!claim) return;
  let fields: EnrichedFields | null;
  try {
    const output = await runner(buildEnrichmentPrompt(getAppState(), claim), ENRICHMENT_JSON_SCHEMA);
    fields = sanitiseEnrichment(enrichmentOutputSchema.parse(output));
  } catch {
    if (failAttempt(id, claim.token, clock()) === 'retry') scheduleRetry(id);
    return;
  }
  completeAttempt(id, claim.token, fields, clock());
}

/**
 * Pending phrases older than two minutes (since creation or their last attempt) go back into the queue; ones whose attempts are
 * used up are marked failed. Runs on the first use after a server start and on every read of /api/state.
 */
export function requeueStalePhrases(now = Date.now()): void {
  const state = queue();
  state.started = true;
  try {
    const { db } = connection();
    for (const phrase of readPendingPhrases(db)) {
      if (state.queued.has(phrase.id) || state.active === phrase.id) continue;
      const job = phrase.enrichJob ?? emptyJob();
      if (now - time(job.lastAttemptAt ?? phrase.createdAt) < ENRICHMENT_STALE_MS) continue;
      if (job.attempts >= ENRICHMENT_MAX_ATTEMPTS) {
        transaction(db, () => {
          const current = readPhrase(db, phrase.id);
          if (current?.enrichment === 'pending') writePhrase(db, withoutEnrichment(current, FAILED_NOTE, now));
        });
        continue;
      }
      enqueuePhraseEnrichment(phrase.id);
    }
  } catch { /* a read must never fail because of the background queue */ }
}

/** First touch in this process (≈ server start): pick up phrases a previous process left pending. */
export function ensurePhraseQueue(): void {
  if (!queue().started) requeueStalePhrases();
}
