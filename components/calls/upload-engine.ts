/**
 * Resumable chunked upload for call recordings (CONTRACT §2: PUT calls/:id/upload with X-Upload-Offset).
 * Transport-agnostic: the caller injects `put`, so the resume/retry logic is unit-tested without a server
 * (tests/web-calls-upload.test.ts).
 */
import { CALL_UPLOAD_CHUNK_BYTES, MAX_CALL_UPLOAD_BYTES } from '@/lib/calls/types';

export interface ChunkRange { start: number; end: number }

/** Sequential chunk ranges [start, end) from `from` to `total`. */
export function planChunks(total: number, chunkBytes: number = CALL_UPLOAD_CHUNK_BYTES, from = 0): ChunkRange[] {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(chunkBytes) || chunkBytes <= 0) return [];
  const ranges: ChunkRange[] = [];
  for (let start = Math.max(0, Math.min(Math.floor(from), total)); start < total; start += chunkBytes) {
    ranges.push({ start, end: Math.min(total, start + chunkBytes) });
  }
  return ranges;
}

/** Result of one PUT. `received` is the server's stored size (the resume point). */
export type PutResult =
  | { ok: true; received: number | null }
  | { ok: false; status: number; received: number | null; error: string | null };

export type PutChunk = (offset: number, chunk: Blob, signal?: AbortSignal) => Promise<PutResult>;

export class UploadError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly offset: number) { super(message); }
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
}

/** Where to continue after a server answer. Never moves backwards past 0 or forwards past `total`. */
export function nextOffset(result: PutResult, offset: number, chunkEnd: number, total: number): number | null {
  const clamp = (value: number) => Math.max(0, Math.min(total, Math.floor(value)));
  if (result.ok) return clamp(result.received !== null && Number.isFinite(result.received) ? result.received : chunkEnd);
  if (result.status === 409 && result.received !== null && Number.isFinite(result.received)) return clamp(result.received);
  void offset;
  return null;
}

export interface UploadOptions {
  blob: Blob;
  /** Bytes already stored on the server (CallSummary.uploadedBytes) — resume point. */
  start?: number;
  chunkBytes?: number;
  put: PutChunk;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
  /** Consecutive transient failures (network, 5xx) tolerated per chunk before giving up. */
  maxRetries?: number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultWait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function uploadErrorMessage(status: number | null, serverMessage: string | null): string {
  if (status === 413) return serverMessage || 'Файл больше 2 ГБ. Обрежь запись или сохрани только звук.';
  if (status === 409) return serverMessage || 'Сервер уже не ждёт этот файл. Удали звонок и загрузи заново.';
  if (status === 401 || status === 403) return 'Сессия истекла. Обнови страницу и войди снова.';
  if (status === 404) return 'Звонок не найден. Возможно, его удалили на другом устройстве.';
  if (status !== null && status >= 400 && status < 500) return serverMessage || 'Сервер не принял часть файла.';
  return serverMessage || 'Связь прервалась. Загрузка продолжится с того же места.';
}

/**
 * Uploads `blob` from `start` in sequential chunks. Resumes from the server's `received` on 409,
 * retries transient failures with backoff, and resolves with the final stored size (= blob.size).
 */
export async function uploadChunks(options: UploadOptions): Promise<number> {
  const total = options.blob.size;
  const chunkBytes = options.chunkBytes ?? CALL_UPLOAD_CHUNK_BYTES;
  const maxRetries = options.maxRetries ?? 4;
  const wait = options.wait ?? defaultWait;
  if (total > MAX_CALL_UPLOAD_BYTES) throw new UploadError(uploadErrorMessage(413, null), 413, 0);
  let offset = Math.max(0, Math.min(total, Math.floor(options.start ?? 0)));
  let failures = 0;
  let resyncs = 0;
  options.onProgress?.(offset, total);
  while (offset < total) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(total, offset + chunkBytes);
    let result: PutResult;
    try {
      result = await options.put(offset, options.blob.slice(offset, end), options.signal);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      result = { ok: false, status: 0, received: null, error: null };
    }
    const next = nextOffset(result, offset, end, total);
    if (result.ok && next !== null) {
      // A successful PUT must move forward; a server that does not is treated like a stale offset.
      if (next <= offset) {
        resyncs++;
        if (resyncs > 3) throw new UploadError('Сервер не сохраняет части файла. Попробуй позже.', null, offset);
      } else { resyncs = 0; }
      offset = next; failures = 0;
      options.onProgress?.(offset, total);
      continue;
    }
    if (!result.ok && result.status === 409 && next !== null) {
      // Offset mismatch: the server tells us how much it already has; continue from there.
      resyncs++;
      if (resyncs > 3) throw new UploadError(uploadErrorMessage(409, result.error), 409, offset);
      offset = next;
      options.onProgress?.(offset, total);
      continue;
    }
    // 400 here means the server dropped a half-received chunk (connection cut): retry from the stored size.
    if (!result.ok && (result.status === 0 || result.status >= 500 || result.status === 400 || result.status === 408 || result.status === 429)) {
      failures++;
      if (failures > maxRetries) throw new UploadError(uploadErrorMessage(null, result.error), result.status || null, offset);
      await wait(Math.min(8000, 600 * 2 ** (failures - 1)), options.signal);
      continue;
    }
    const status = result.ok ? null : result.status;
    throw new UploadError(uploadErrorMessage(status, result.ok ? null : result.error), status, offset);
  }
  return offset;
}

/** Real transport for the browser: PUT /api/calls/:id/upload with the raw bytes. */
export function browserPut(url: string): PutChunk {
  return async (offset, chunk, signal) => {
    const response = await fetch(url, {
      method: 'PUT', credentials: 'same-origin', signal, body: chunk,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset) },
    });
    let data: Record<string, unknown> = {};
    try { data = await response.json(); } catch { /* empty body */ }
    const received = typeof data.received === 'number' && Number.isFinite(data.received) ? data.received : null;
    if (response.ok) return { ok: true, received };
    return { ok: false, status: response.status, received, error: typeof data.error === 'string' ? data.error : null };
  };
}
