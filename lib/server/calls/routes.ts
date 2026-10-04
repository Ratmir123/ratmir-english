import { createReadStream, createWriteStream, existsSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CALL_UPLOAD_CHUNK_BYTES, type CreateCallRequest } from '../../calls/types';
import { connection } from '../db';
import { ApiError, json, locked } from '../http';
import { getAppState } from '../store';
import { processCallQueue } from './pipeline';
import { CALL_ID, callDirectory, ensureCallDirectory, fileSize, mutateCall, readCall, readDrills } from './repository';
import { MAX_DEBRIEF_BYTES, MAX_NOTES_CHARS, MAX_TRANSCRIPT_BYTES, callDetail, completeUpload, confirmSpeakers, createCall, decideProfileFact,
  deleteCall, disputeSegment, reanalyseCall, retryCall, updateDetails, updatePattern } from './service';
import { listCallSummaries, listPatterns, presentDrills, summarise } from './state';

export { processCallQueue } from './pipeline';

/**
 * /api/calls/*, /api/patterns/*, /api/facts. Called by app/api/[...path]/route.ts AFTER checkAccess() (access cookie and
 * same-origin checks); `path` includes the first segment. Mutations of one call are serialised with locked('call:<id>').
 * NOTE: PUT calls/:id/upload needs `export async function PUT` in the dispatcher.
 */
const NOT_FOUND = 'Действие не найдено.';
const CONTEXT = z.enum(['work', 'life', 'relocation', 'other']);
const createSchema = z.object({
  title: z.string().max(400).nullish(), counterpart: z.string().max(400).nullish(), context: CONTEXT.nullish(),
  occurredAt: z.string().max(40).nullish(), notes: z.string().max(MAX_NOTES_CHARS * 2).nullish(),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('audio'), fileName: z.string().trim().min(1).max(1000), bytes: z.number().int(), mime: z.string().max(200).nullish() }),
    z.object({ type: z.literal('transcript'), fileName: z.string().max(1000).nullish(), text: z.string().min(1), referenceDebrief: z.string().nullish() }),
    z.object({ type: z.literal('debrief'), text: z.string().min(1) }),
    z.object({ type: z.literal('memory'), text: z.string().min(1) }),
  ]),
});
const speakersSchema = z.object({ me: z.string().min(1).max(20), labels: z.record(z.string().max(20), z.string().max(200)).nullish() });
const detailsSchema = z.object({ title: z.string().max(400).nullish(), counterpart: z.string().max(400).nullish(), context: CONTEXT.nullish(),
  occurredAt: z.string().max(40).nullish(), notes: z.string().max(MAX_NOTES_CHARS * 2).nullish() });
const reanalyseSchema = z.object({ notes: z.string().max(MAX_NOTES_CHARS * 2).nullish() });
const segmentSchema = z.object({ segmentId: z.string().min(1).max(20), disputed: z.boolean() });
const patternSchema = z.object({ confirm: z.boolean().nullish(), dismiss: z.boolean().nullish(), note: z.string().max(2000).nullish() });
const factSchema = z.object({ factId: z.string().min(1).max(100), decision: z.enum(['accept', 'reject']) });

/** JSON body with a hard cap enforced while streaming (Content-Length may be absent). Empty body → {}. */
async function readBody(req: NextRequest, limit: number): Promise<unknown> {
  if (Number(req.headers.get('content-length') || 0) > limit) throw new ApiError('Слишком большой запрос.', 413);
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => undefined); throw new ApiError('Слишком большой запрос.', 413); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError('Некорректные данные.'); }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, message = 'Проверь данные созвона.'): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(message, 400);
  return result.data;
}
const undef = <T>(value: T | null | undefined): T | undefined => value === null ? undefined : value;

function kick(): void { void processCallQueue().catch(() => undefined); }

export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null; // malformed or multi-range: serve the whole file
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : 'unsatisfiable';
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start < size && end >= start ? { start, end } : 'unsatisfiable';
}

function audioResponse(req: NextRequest, id: string): Response {
  const record = readCall(connection().db, id);
  if (!record) throw new ApiError('Созвон не найден.', 404);
  const path = join(callDirectory(id), 'audio.mp3');
  if (!record.audio || !existsSync(path)) throw new ApiError('Запись этого созвона уже удалена или ещё не готова.', 404);
  const size = statSync(path).size;
  if (!size) throw new ApiError('Запись этого созвона уже удалена или ещё не готова.', 404);
  const range = parseRange(req.headers.get('range'), size);
  const headers: Record<string, string> = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers: { ...headers, 'Content-Length': String(end - start + 1),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) } });
}

/** Append one chunk when X-Upload-Offset equals the stored size; otherwise 409 with the resume point. Streamed, never buffered. */
async function uploadChunk(req: NextRequest, id: string): Promise<Response> {
  const header = req.headers.get('x-upload-offset');
  if (!header || !/^\d{1,13}$/.test(header.trim())) throw new ApiError('Нужен заголовок X-Upload-Offset.', 400);
  const offset = Number(header.trim());
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > CALL_UPLOAD_CHUNK_BYTES) throw new ApiError('Часть файла больше 8 МБ.', 413);
  return locked(`call:${id}`, async () => {
    const record = readCall(connection().db, id);
    if (!record || record.source !== 'audio' || !record.upload) throw new ApiError('Созвон не найден.', 404);
    const path = join(ensureCallDirectory(id), `original.${record.upload.extension}`);
    const stored = fileSize(path);
    if (record.status !== 'awaiting-upload') return json({ error: 'Файл уже загружен.', received: stored }, 409);
    if (offset !== stored) return json({ error: 'Загрузка продолжится с сохранённого места.', received: stored }, 409);
    const remaining = record.upload.bytes - stored;
    if (declared !== null && Number(declared) > remaining) throw new ApiError('Часть выходит за объявленный размер файла.', 413);
    if (!req.body) throw new ApiError('Пустая часть файла.', 400);
    const limit = Math.min(CALL_UPLOAD_CHUNK_BYTES, remaining);
    let received = 0;
    let tooLarge = false;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > limit) { tooLarge = true; callback(new Error('chunk too large')); }
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(req.body as unknown as NodeReadableStream<Uint8Array>), counter, createWriteStream(path, { flags: 'a', mode: 0o600 }));
    } catch {
      try { truncateSync(path, stored); } catch { /* the size check on the next request still protects the file */ }
      if (tooLarge) throw new ApiError(received > CALL_UPLOAD_CHUNK_BYTES ? 'Часть файла больше 8 МБ.' : 'Часть выходит за объявленный размер файла.', 413);
      throw new ApiError('Загрузка части прервалась. Повтори с сохранённого места.', 400);
    }
    if (!received) throw new ApiError('Пустая часть файла.', 400);
    const total = fileSize(path);
    mutateCall(id, current => {
      if (!current.upload) return false;
      current.upload.received = total;
      current.progress = { stage: 'Загружаю файл', percent: Math.min(99, Math.floor(total / current.upload.bytes * 100)) };
    });
    return json({ received: total });
  });
}

export async function handleCallsRoute(req: NextRequest, path: string[]): Promise<Response> {
  const method = req.method;
  const { db } = connection();
  if (path[0] === 'patterns') {
    if (method === 'GET' && path.length === 1) return json({ patterns: listPatterns(db) });
    if (method === 'POST' && path.length === 2) {
      const data = parse(patternSchema, await readBody(req, 8_000), 'Проверь изменения паттерна.');
      return json({ patterns: updatePattern(path[1], { confirm: undef(data.confirm), dismiss: undef(data.dismiss), note: data.note === undefined ? undefined : data.note }) });
    }
    throw new ApiError(NOT_FOUND, 404);
  }
  if (path[0] === 'facts') {
    if (method === 'POST' && path.length === 1) return json({ profileFacts: decideProfileFact(parse(factSchema, await readBody(req, 8_000), 'Проверь решение по факту.')) });
    throw new ApiError(NOT_FOUND, 404);
  }
  if (path[0] !== 'calls') throw new ApiError(NOT_FOUND, 404);
  if (path.length === 1) {
    if (method === 'GET') return json({ calls: listCallSummaries(db) });
    if (method === 'POST') {
      const data = parse(createSchema, await readBody(req, 1_100_000 + 2 * MAX_DEBRIEF_BYTES));
      if (data.source.type === 'transcript' && Buffer.byteLength(data.source.text) > MAX_TRANSCRIPT_BYTES) throw new ApiError('Расшифровка больше 400 КБ. Загрузи часть созвона.', 413);
      const request: CreateCallRequest = { title: undef(data.title), counterpart: undef(data.counterpart), context: undef(data.context),
        occurredAt: undef(data.occurredAt), notes: undef(data.notes),
        source: data.source.type === 'audio' ? { type: 'audio', fileName: data.source.fileName, bytes: data.source.bytes, mime: data.source.mime ?? '' }
          : data.source.type === 'transcript' ? { type: 'transcript', fileName: undef(data.source.fileName), text: data.source.text, referenceDebrief: undef(data.source.referenceDebrief) }
          : { type: data.source.type, text: data.source.text } };
      const record = createCall(request, getAppState().profile.name);
      if (record.status === 'queued') kick();
      return json(callDetail(record.id));
    }
    throw new ApiError(NOT_FOUND, 404);
  }
  const id = path[1];
  if (!CALL_ID.test(id)) throw new ApiError('Созвон не найден.', 404);
  if (path.length === 2) {
    if (method === 'GET') return json(callDetail(id));
    if (method === 'DELETE') return locked(`call:${id}`, async () => { deleteCall(id); return json({ ok: true }); });
    throw new ApiError(NOT_FOUND, 404);
  }
  const action = path[2];
  if (path.length === 3 && action === 'audio' && method === 'GET') return audioResponse(req, id);
  if (path.length === 3 && action === 'upload' && method === 'PUT') return uploadChunk(req, id);
  if (path.length === 4 && action === 'upload' && path[3] === 'complete' && method === 'POST') {
    await readBody(req, 8_000);
    return locked(`call:${id}`, async () => {
      const record = completeUpload(id);
      kick();
      const { db: current } = connection();
      return json(summarise(record, presentDrills(current, readDrills(current, id))));
    });
  }
  if (path.length !== 3 || method !== 'POST') throw new ApiError(NOT_FOUND, 404);
  if (action === 'speakers') {
    const data = parse(speakersSchema, await readBody(req, 16_000), 'Выбери, какой голос твой.');
    return locked(`call:${id}`, async () => { confirmSpeakers(id, { me: data.me, labels: undef(data.labels) }); kick(); return json(callDetail(id)); });
  }
  if (action === 'details') {
    const data = parse(detailsSchema, await readBody(req, 128_000));
    return locked(`call:${id}`, async () => {
      updateDetails(id, { title: undef(data.title), counterpart: data.counterpart === null ? '' : data.counterpart, context: undef(data.context),
        occurredAt: data.occurredAt, notes: data.notes });
      return json(callDetail(id));
    });
  }
  if (action === 'retry') {
    await readBody(req, 8_000);
    return locked(`call:${id}`, async () => { retryCall(id); kick(); return json(callDetail(id)); });
  }
  if (action === 'reanalyse') {
    const data = parse(reanalyseSchema, await readBody(req, 128_000));
    return locked(`call:${id}`, async () => { reanalyseCall(id, data.notes); kick(); return json(callDetail(id)); });
  }
  if (action === 'segments') {
    const data = parse(segmentSchema, await readBody(req, 8_000), 'Проверь отмеченную реплику.');
    return locked(`call:${id}`, async () => { disputeSegment(id, data); return json(callDetail(id)); });
  }
  throw new ApiError(NOT_FOUND, 404);
}
