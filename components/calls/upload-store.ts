'use client';

/**
 * Background call-audio uploads that survive tab switches (module singleton, read with useSyncExternalStore).
 * Electron: the desktop shell extracts compact mono audio first (window.ratmirDesktop.prepareCallAudio);
 * otherwise the original file is uploaded. Chunks: PUT calls/:id/upload (resumable), then upload/complete.
 */
import { api, ApiRequestError, mediaUrl } from '@/lib/client/api';
import { MAX_CALL_UPLOAD_BYTES, type CallContext, type CallDetail, type CallSummary } from '@/lib/calls/types';
import type {} from '@/components/desktop-bridge';
import { browserPut, isAbortError, uploadChunks, UploadError } from './upload-engine';
import { guessMime } from './format';

export type UploadPhase = 'preparing' | 'creating' | 'uploading' | 'completing' | 'done' | 'error' | 'cancelled';
export interface UploadJob {
  key: string;
  callId: string | null;
  title: string;
  fileName: string;
  phase: UploadPhase;
  sent: number;
  total: number;
  error: string | null;
  startedAt: number;
  bytesPerSecond: number | null;
  /** Compact audio was extracted locally by the desktop shell. */
  prepared: boolean;
  note: string | null;
}
export interface CallMeta { title?: string; counterpart?: string; context?: CallContext; occurredAt?: string; notes?: string }

type Internal = { job: UploadJob; file: File; blob: Blob | null; uploadName: string; mime: string; controller: AbortController | null; meta: CallMeta };
type Fingerprint = { name: string; size: number; lastModified: number; prepared: boolean; uploadBytes: number };

const FINGERPRINTS = 'smooth-talk:call-uploads:v1';
const jobs = new Map<string, Internal>();
const listeners = new Set<() => void>();
let snapshot: UploadJob[] = [];
let sequence = 0;

function emit() {
  snapshot = [...jobs.values()].map(item => item.job);
  listeners.forEach(listener => listener());
}
function update(item: Internal, patch: Partial<UploadJob>) { item.job = { ...item.job, ...patch }; emit(); }

export function subscribeUploads(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getUploadsSnapshot(): UploadJob[] { return snapshot; }
const EMPTY: UploadJob[] = [];
export function getServerUploadsSnapshot(): UploadJob[] { return EMPTY; }

function readFingerprints(): Record<string, Fingerprint> {
  try { const value = JSON.parse(localStorage.getItem(FINGERPRINTS) || '{}'); return value && typeof value === 'object' ? value : {}; }
  catch { return {}; }
}
function writeFingerprint(callId: string, value: Fingerprint | null) {
  try {
    const all = readFingerprints();
    if (value) all[callId] = value; else delete all[callId];
    localStorage.setItem(FINGERPRINTS, JSON.stringify(all));
  } catch { /* storage unavailable: resume then relies on the server offset only */ }
}
/** Name of the file a stale upload was started with (to ask for the same file again). */
export function pendingUploadFileName(callId: string): string | null { return readFingerprints()[callId]?.name ?? null; }

function message(error: unknown, fallback: string) {
  if (error instanceof UploadError || error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

async function prepare(item: Internal) {
  item.blob = item.file; item.uploadName = item.file.name; item.mime = guessMime(item.file.name, item.file.type);
  const bridge = typeof window === 'undefined' ? undefined : window.ratmirDesktop;
  if (!bridge?.prepareCallAudio) return;
  update(item, { phase: 'preparing' });
  try {
    const prepared = await bridge.prepareCallAudio(item.file);
    if (prepared.ok && prepared.bytes > 0) {
      item.blob = new Blob([new Uint8Array(prepared.data)], { type: prepared.mime });
      item.uploadName = prepared.name; item.mime = prepared.mime;
      update(item, { prepared: true, total: item.blob.size, note: null });
    } else if (!prepared.ok) {
      // The desktop shell explains in Russian (no ffmpeg, unreadable file…); the original file is uploaded instead.
      update(item, { note: prepared.message || 'Звук не извлёкся на компьютере — загружаю исходный файл целиком.' });
    }
  } catch {
    update(item, { note: 'Звук не извлёкся на компьютере — загружаю исходный файл целиком.' });
  }
}

async function run(item: Internal, startOffset: number) {
  const controller = new AbortController(); item.controller = controller;
  const blob = item.blob!;
  let lastTime = performance.now(); let lastSent = startOffset;
  try {
    update(item, { phase: 'uploading', error: null, total: blob.size, sent: startOffset });
    await uploadChunks({
      blob, start: startOffset, signal: controller.signal, put: browserPut(mediaUrl(`calls/${item.job.callId}/upload`)),
      onProgress(sent, total) {
        const now = performance.now(); const elapsed = (now - lastTime) / 1000;
        let speed = item.job.bytesPerSecond;
        if (elapsed > 0.2 && sent > lastSent) {
          const sample = (sent - lastSent) / elapsed;
          speed = speed === null ? sample : speed * 0.6 + sample * 0.4;
          lastTime = now; lastSent = sent;
        }
        update(item, { sent, total, bytesPerSecond: speed });
      },
    });
    update(item, { phase: 'completing' });
    try { await api<CallSummary>(`calls/${item.job.callId}/upload/complete`, {}, undefined, controller.signal); }
    catch (error) {
      // Already completed on another attempt: the call moved past awaiting-upload.
      if (!(error instanceof ApiRequestError && error.status === 409)) throw error;
    }
    writeFingerprint(item.job.callId!, null);
    update(item, { phase: 'done', sent: blob.size });
  } catch (error) {
    if (isAbortError(error)) return;
    update(item, { phase: 'error', error: message(error, 'Загрузка остановилась. Можно продолжить с того же места.') });
  } finally { if (item.controller === controller) item.controller = null; }
}

/** Starts a background upload. Resolves with the new call id once the call exists (null if creation failed). */
export async function startAudioUpload(file: File, meta: CallMeta, onJobKey?: (key: string) => void): Promise<string | null> {
  const key = `upload-${Date.now()}-${++sequence}`;
  const item: Internal = {
    file, blob: null, uploadName: file.name, mime: guessMime(file.name, file.type), controller: null, meta,
    job: { key, callId: null, title: meta.title || file.name, fileName: file.name, phase: 'creating', sent: 0, total: file.size,
      error: null, startedAt: Date.now(), bytesPerSecond: null, prepared: false, note: null },
  };
  jobs.set(key, item); emit();
  onJobKey?.(key);
  await prepare(item);
  const blob = item.blob!;
  if (blob.size > MAX_CALL_UPLOAD_BYTES) {
    update(item, { phase: 'error', error: 'Файл больше 2 ГБ. Обрежь запись или сохрани только звук.' });
    return null;
  }
  update(item, { phase: 'creating' });
  let detail: CallDetail;
  try {
    detail = await api<CallDetail>('calls', {
      ...meta, source: { type: 'audio', fileName: item.uploadName, bytes: blob.size, mime: item.mime },
    });
  } catch (error) {
    update(item, { phase: 'error', error: message(error, 'Не удалось создать звонок. Попробуй ещё раз.') });
    return null;
  }
  update(item, { callId: detail.id });
  writeFingerprint(detail.id, { name: file.name, size: file.size, lastModified: file.lastModified, prepared: item.job.prepared, uploadBytes: blob.size });
  void run(item, Math.max(0, detail.uploadedBytes ?? 0));
  return detail.id;
}

/**
 * Continues an upload that was interrupted by a reload: the learner picks the same file again.
 * Returns an error message when the file does not match the original one.
 */
export async function resumeAudioUpload(call: Pick<CallSummary, 'id' | 'title' | 'uploadedBytes'>, file: File): Promise<string | null> {
  const fingerprint = readFingerprints()[call.id];
  if (fingerprint && (fingerprint.name !== file.name || fingerprint.size !== file.size)) {
    return `Это другой файл. Нужен «${fingerprint.name}».`;
  }
  const existing = [...jobs.values()].find(item => item.job.callId === call.id);
  if (existing?.controller) return null;
  if (existing) jobs.delete(existing.job.key);
  const key = `upload-${Date.now()}-${++sequence}`;
  const item: Internal = {
    file, blob: null, uploadName: file.name, mime: guessMime(file.name, file.type), controller: null, meta: {},
    job: { key, callId: call.id, title: call.title, fileName: file.name, phase: 'uploading', sent: call.uploadedBytes ?? 0, total: file.size,
      error: null, startedAt: Date.now(), bytesPerSecond: null, prepared: false, note: null },
  };
  jobs.set(key, item); emit();
  await prepare(item);
  if (fingerprint && item.blob!.size !== fingerprint.uploadBytes) {
    jobs.delete(key); emit();
    return 'Файл изменился с прошлой попытки. Удали звонок и загрузи его заново.';
  }
  void run(item, Math.max(0, call.uploadedBytes ?? 0));
  return null;
}

/** Retry after an error: re-reads the server offset from the call and continues. */
export async function retryUpload(key: string): Promise<void> {
  const item = jobs.get(key);
  if (!item || item.controller) return;
  if (!item.job.callId) {
    jobs.delete(key); emit();
    await startAudioUpload(item.file, item.meta);
    return;
  }
  let offset = item.job.sent;
  try { offset = (await api<CallDetail>(`calls/${item.job.callId}`)).uploadedBytes ?? offset; } catch { /* keep the local offset */ }
  void run(item, offset);
}

/** Cancels an upload and deletes the half-created call (nothing useful is stored yet). */
export async function cancelUpload(key: string): Promise<void> {
  const item = jobs.get(key);
  if (!item) return;
  item.controller?.abort();
  update(item, { phase: 'cancelled' });
  if (item.job.callId) {
    writeFingerprint(item.job.callId, null);
    try { await api(`calls/${item.job.callId}`, undefined, 'DELETE'); } catch { /* the list shows it as awaiting upload */ }
  }
  jobs.delete(key); emit();
}

export function dismissUpload(key: string) {
  const item = jobs.get(key);
  if (!item || item.controller) return;
  jobs.delete(key); emit();
}

export function forgetCallUpload(callId: string) {
  writeFingerprint(callId, null);
  for (const item of jobs.values()) if (item.job.callId === callId) { item.controller?.abort(); jobs.delete(item.job.key); }
  emit();
}

export function uploadForCall(list: readonly UploadJob[], callId: string): UploadJob | null {
  return list.find(job => job.callId === callId) ?? null;
}
