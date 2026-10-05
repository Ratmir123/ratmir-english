import type { NextRequest } from 'next/server';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connection, transaction } from '../db';
import { ApiError, json, locked } from '../http';
import { SiwcError } from '../siwc-protocol';
import type { PlacementView } from '../../placement/types';
import { claimScoringJob, completeScoringJob, deleteAttempt, enqueueScoringJob, failScoringJob, hasScoringWork, ownsScoringJob, readActiveAttempt,
  readAttempt, readCompletedAttempts, readExposure, recordExposure, writeAttempt, type ScoringClaim } from './attempts';
import { placementBank } from './bank-source';
import { ensureClip, resolveClip } from './clips';
import { answerChoice, answerSpoken, createAttempt, resumeAttempt, skipSection, type FlowContext, type Shown } from './flow';
import { iso, type AttemptRecord } from './model';
import { buildPlacementResult } from './results';
import { placementRuntime } from './runtime';
import { scoreSpokenAnswers } from './scorer';
import { presentPlacement } from './state';

const LOCK = 'placement';
const sectionSchema = z.enum(['listening', 'reading', 'language', 'speaking', 'interaction']);
const startSchema = z.object({ retake: z.boolean().optional() });
const answerSchema = z.object({ taskId: z.string().min(1).max(200), choice: z.number().int().min(0).max(9),
  plays: z.number().int().min(0).max(50).optional(), elapsedMs: z.number().min(0).max(86_400_000).optional() });
const speakSchema = z.object({ taskId: z.string().min(1).max(200), text: z.string().trim().min(1).max(7000),
  audioFile: z.string().min(1).max(100), originalTranscript: z.string().max(7000).optional() });
const skipSchema = z.object({ section: sectionSchema, reason: z.string().max(300).optional() });

/** Bounded JSON body; an empty body counts as {} (start, rescore and abandon carry no fields). */
async function readBody(req: NextRequest): Promise<unknown> {
  if (Number(req.headers.get('content-length') || 0) > 64_000) throw new ApiError('Слишком большой запрос.', 413);
  const raw = await req.text();
  if (raw.length > 64_000) throw new ApiError('Слишком большой запрос.', 413);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new ApiError('Некорректные данные.'); }
}

function flowContext(db: DatabaseSync, attemptId: string | null): FlowContext {
  return { bank: placementBank(), exposure: readExposure(db, attemptId), now: placementRuntime().now() };
}

/** Persist one flow step: attempt, newly shown items (exposure) and a scoring job when the attempt just finished. */
function persist(db: DatabaseSync, attempt: AttemptRecord, shown: Shown, before: AttemptRecord['status'], now: number) {
  writeAttempt(db, attempt);
  if (shown.length) recordExposure(db, attempt.id, shown, now);
  if (attempt.status === 'scoring' && before !== 'scoring') enqueueScoringJob(db, attempt.id, now);
}

function activeInProgress(db: DatabaseSync): AttemptRecord {
  const attempt = readActiveAttempt(db);
  if (!attempt) throw new ApiError('Тест ещё не начат.', 409);
  return attempt;
}

/** Run one serialised state change, then return the fresh view and start background work it needs. */
async function change(step: (db: DatabaseSync) => void): Promise<Response> {
  const view = await locked(LOCK, async () => {
    const { db } = connection();
    transaction(db, () => step(db));
    return presentPlacement(db);
  });
  afterChange(view);
  return json(view);
}

function afterChange(view: PlacementView) {
  const runtime = placementRuntime();
  if (view.status === 'scoring' && runtime.kickScoring) void processPlacementQueue();
  const url = view.task?.kind === 'choice' ? view.task.audio?.url : view.task?.kind === 'roleplay' ? view.task.partnerLine.audioUrl : null;
  if (!url || !runtime.prefetchAudio || !view.audioAvailable) return;
  const clipId = decodeURIComponent(url.split('/').pop() ?? '');
  // Synthesize the clip while the learner reads the question; the GET then streams it from the cache.
  void (async () => {
    try {
      const attempt = readActiveAttempt(connection().db);
      const spec = attempt ? resolveClip(attempt, placementBank(), clipId) : null;
      if (spec) await ensureClip(spec, runtime);
    } catch { /* the audio GET reports provider or budget errors */ }
  })();
}

/** mp3 bytes with single-range support (iOS players stream remote audio with byte ranges). */
function audioResponse(bytes: Buffer, range: string | null): Response {
  const total = bytes.byteLength;
  const headers = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
  const match = range?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Length': String(total) } });
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || start > end) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` } });
  }
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${total}` } });
}

async function serveClip(clipId: string, range: string | null): Promise<Response> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(clipId)) throw new ApiError('Запись недоступна.', 404);
  const { db } = connection();
  const attempt = readActiveAttempt(db);
  const spec = attempt ? resolveClip(attempt, placementBank(), clipId) : null;
  if (!attempt || !spec) throw new ApiError('Запись недоступна.', 404);
  const runtime = placementRuntime();
  const bytes = await ensureClip(spec, runtime);
  // The first playback of the current listening question is remembered: a resume after it gets a parallel clip.
  await locked(LOCK, async () => transaction(db, () => {
    const latest = readAttempt(db, attempt.id);
    const record = latest?.status === 'in-progress' && latest.current?.taskId === clipId
      ? latest.objective.find(item => item.taskId === clipId && item.section === 'listening' && !item.answeredAt && !item.voided) : undefined;
    if (latest && record && !record.audioServedAt) { record.audioServedAt = iso(runtime.now()); writeAttempt(db, latest); }
  }));
  return audioResponse(bytes, range);
}

/** Called by app/api/[...path]/route.ts after checkAccess() for every /api/placement/* request (path excludes 'placement'). */
export async function handlePlacementRoute(req: NextRequest, path: string[]): Promise<Response> {
  if (req.method === 'GET' && path.length === 0) return json(presentPlacement(connection().db));
  if (req.method === 'GET' && path.length === 2 && path[0] === 'audio') return serveClip(path[1], req.headers.get('range'));
  if (req.method !== 'POST' || path.length !== 1) throw new ApiError('Действие не найдено.', 404);
  const runtime = placementRuntime();
  switch (path[0]) {
    case 'start': {
      const data = startSchema.parse(await readBody(req));
      return change(db => {
        const active = readActiveAttempt(db);
        if (active) {
          if (active.status !== 'in-progress') return;
          const before = active.status;
          const context = flowContext(db, active.id);
          // A resume can finish the attempt (an interrupted last task is dropped): compare with the status before it.
          persist(db, active, resumeAttempt(active, context), before, context.now);
          return;
        }
        if (readCompletedAttempts(db).length && !data.retake) return;
        const id = randomUUID();
        const context = flowContext(db, id);
        let audioAvailable = false;
        try { audioAvailable = runtime.audioConfigured(); } catch { audioAvailable = false; }
        const { attempt, shown } = createAttempt(context, { id, seed: runtime.seed(), audioAvailable });
        persist(db, attempt, shown, 'in-progress', context.now);
      });
    }
    case 'answer': {
      const data = answerSchema.parse(await readBody(req));
      return change(db => {
        const attempt = activeInProgress(db);
        const before = attempt.status;
        const context = flowContext(db, attempt.id);
        const { replay, shown } = answerChoice(attempt, context, data);
        if (!replay) persist(db, attempt, shown, before, context.now);
      });
    }
    case 'speak': {
      const data = speakSchema.parse(await readBody(req));
      return change(db => {
        const attempt = activeInProgress(db);
        const repeated = attempt.spoken.find(record => record.audioFile === data.audioFile && record.answeredAt && !record.voided);
        if (repeated && repeated.taskId !== data.taskId) throw new ApiError('Эта запись уже использована для другого ответа.', 409);
        runtime.checkRecording(data.audioFile);
        const integrity = runtime.recordedSubmission(data.audioFile, data.text, data.originalTranscript);
        const before = attempt.status;
        const context = flowContext(db, attempt.id);
        const { replay, shown } = answerSpoken(attempt, context, { ...data, integrity });
        if (!replay) persist(db, attempt, shown, before, context.now);
      });
    }
    case 'skip': {
      const data = skipSchema.parse(await readBody(req));
      return change(db => {
        const attempt = activeInProgress(db);
        const before = attempt.status;
        const context = flowContext(db, attempt.id);
        const shown = skipSection(attempt, context, data.section, data.reason);
        persist(db, attempt, shown, before, context.now);
      });
    }
    case 'rescore': {
      await readBody(req);
      return change(db => {
        const attempt = readActiveAttempt(db);
        if (attempt?.status === 'scoring') return;
        if (attempt?.status !== 'error') throw new ApiError('Пересчитывать нечего: нет результата с ошибкой.', 409);
        const now = runtime.now();
        attempt.status = 'scoring'; attempt.error = null; attempt.updatedAt = iso(now);
        writeAttempt(db, attempt);
        enqueueScoringJob(db, attempt.id, now);
      });
    }
    case 'abandon': {
      await readBody(req);
      return change(db => {
        const attempt = readActiveAttempt(db);
        if (attempt?.status === 'scoring') throw new ApiError('Результат уже считается. Дождись его, это займёт пару минут.', 409);
        if (attempt) deleteAttempt(db, attempt.id);
      });
    }
    default: throw new ApiError('Действие не найдено.', 404);
  }
}

const globals = globalThis as typeof globalThis & { trainingPlacementBusy?: boolean };

function failureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  const text = raw && /[А-Яа-яЁё]/.test(raw) ? raw : 'Не удалось оценить устные ответы.';
  return text.includes('можно пересчитать') ? text.slice(0, 600) : `${text.slice(0, 500)} Ответы сохранены, можно пересчитать.`;
}

function settle(db: DatabaseSync, claim: ScoringClaim, update: (attempt: AttemptRecord, now: number) => void) {
  const now = placementRuntime().now();
  transaction(db, () => {
    if (!ownsScoringJob(db, claim)) return;
    const attempt = readAttempt(db, claim.attemptId);
    if (!attempt || attempt.status !== 'scoring') { completeScoringJob(db, claim, now); return; }
    update(attempt, now);
  });
}

/** Background step driven by the shared worker tick (scoring jobs). Idempotent, own busy flag, never throws. */
export async function processPlacementQueue(): Promise<void> {
  if (globals.trainingPlacementBusy) return;
  globals.trainingPlacementBusy = true;
  try {
    const { db } = connection();
    if (!hasScoringWork(db)) return;
    const claim = transaction(db, () => claimScoringJob(db, placementRuntime().now()));
    if (!claim) return;
    const attempt = readAttempt(db, claim.attemptId);
    if (!attempt || attempt.status !== 'scoring') {
      transaction(db, () => completeScoringJob(db, claim, placementRuntime().now()));
      return;
    }
    const bank = placementBank();
    try {
      const rated = await scoreSpokenAnswers(attempt, bank);
      settle(db, claim, (latest, now) => {
        latest.result = buildPlacementResult(latest, bank, rated, now);
        latest.status = 'completed'; latest.completedAt = iso(now); latest.updatedAt = iso(now); latest.error = null;
        writeAttempt(db, latest);
        completeScoringJob(db, claim, now);
      });
    } catch (error) {
      const message = failureMessage(error);
      // Limits, expired grants and provider timeouts need an explicit retry: resubmitting could consume another paid turn.
      settle(db, claim, (latest, now) => {
        if (failScoringJob(db, claim, message, !(error instanceof SiwcError), now)) {
          latest.status = 'error'; latest.error = message; latest.updatedAt = iso(now);
          writeAttempt(db, latest);
        }
      });
    }
  } catch { /* the worker tick must never throw */ }
  finally { globals.trainingPlacementBusy = false; }
}
