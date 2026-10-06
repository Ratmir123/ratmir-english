'use client';

/*
 * «Послушать» (planning/v05/PASS-0.5.4.md §1.4): record what he is listening to — the computer's own sound inside the Smooth
 * Talk shell (getDisplayMedia → the shell answers 'loopback', the video track is dropped at once), the microphone in a plain
 * browser — then POST /api/phrases/listen (transcribed in the request) and poll GET /api/phrases/listen/:id while Sol explains
 * it. Audio never leaves the page except in that one upload. Phases: idle → starting → recording → uploading → analyzing →
 * ready | failed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LISTEN_MAX_SECONDS, LISTEN_MIN_SECONDS, LISTEN_POLL_LIMIT_MS, LISTEN_POLL_MS,
  type ListenClip, type ListenResponse, type ListenSource, type PhraseOrigin, type SavedPhrase,
} from '@/lib/phrases/types';
import type { MascotLevelStore } from '../mascot/mascot';
import { request, statusOf } from '../app/api';

export type ListenPhase = 'idle' | 'starting' | 'recording' | 'uploading' | 'analyzing' | 'ready' | 'failed';

/** The pill warns this many seconds before the clip stops by itself. */
export const LISTEN_WARN_SECONDS = 10;
/** Below this RMS for the whole clip nothing was playing: not sent. */
export const LISTEN_SILENCE_RMS = 0.004;
const LEVEL_MS = 50;

export const LISTEN_COPY = {
  system: { action: 'Послушать', hint: 'Включи видео — я послушаю звук компьютера.', silent: 'Не слышу звука компьютера. Включи видео и попробуй ещё раз.' },
  microphone: { action: 'Послушать через микрофон', hint: 'Поднеси микрофон к звуку: видео, подкаст, разговор.', silent: 'Ничего не слышно. Сделай звук громче и попробуй ещё раз.' },
  short: 'Слишком коротко — запиши хотя бы пару секунд.',
  offline: 'Нет связи с сервером тренинга. Проверь подключение и повтори.',
  failed: 'Не получилось разобрать. Попробуй ещё раз.',
  denied: { system: 'Не удалось записать звук компьютера. Попробуй ещё раз.', microphone: 'Нет доступа к микрофону. Разреши его в браузере и попробуй ещё раз.' },
} as const;

export type Listen = {
  phase: ListenPhase;
  source: ListenSource;
  /** Whole seconds recorded (updated while recording). */
  elapsed: number;
  /** The last ten seconds before the clip stops by itself. */
  warn: boolean;
  clip: ListenClip | null;
  /** Sol is still at it after 90 s: the card stops waiting (the phrases still land in «Мои фразы»). */
  slow: boolean;
  /** Why it failed (Russian). */
  error: string;
  /** Captured sound level 0–1 for the companion (read once per frame). */
  levelStore: MascotLevelStore;
  /** True while a clip is being recorded or worked on. */
  busy: boolean;
  start: () => Promise<void>;
  stop: () => void;
  /** Drops the recording (or stops waiting for the server) and goes back to idle. */
  cancel: () => void;
  /** Back to idle after a result or a failure. */
  reset: () => void;
  /** × on a saved phrase: deletes it from «Мои фразы». */
  removePhrase: (id: string) => Promise<void>;
};

/** m:ss */
export const listenTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** The recorder format this engine supports (opus first). */
function recorderType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

function createLevelStore() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    store: { subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => value } as MascotLevelStore,
    set(next: number) { if (Math.abs(next - value) < 0.01) return; value = next; listeners.forEach(listener => listener()); },
  };
}

type Take = {
  stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; context: AudioContext | null; timer: ReturnType<typeof setInterval> | null;
  startedAt: number; peak: number; cancelled: boolean;
};

/** Upload of one clip; the server's Russian `error` when it gave one. */
async function uploadClip(blob: Blob, seconds: number, origin: PhraseOrigin, source: ListenSource, signal: AbortSignal): Promise<ListenClip> {
  const form = new FormData();
  const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  form.set('audio', blob, `listen.${extension}`);
  form.set('seconds', String(Math.max(1, Math.min(LISTEN_MAX_SECONDS, Math.round(seconds)))));
  form.set('origin', origin);
  form.set('source', source);
  let response: Response;
  try { response = await fetch('/api/phrases/listen', { method: 'POST', body: form, signal }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new Error(LISTEN_COPY.offline); }
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch { /* a proxy page or an empty body */ }
  if (!response.ok) throw new Error(typeof data.error === 'string' && response.status < 500 ? data.error : response.status >= 500 ? `Сервер не ответил (код ${response.status}). Повтори через минуту.` : LISTEN_COPY.failed);
  const clip = (data as Partial<ListenResponse>).clip;
  if (!clip || typeof clip.id !== 'string') throw new Error(LISTEN_COPY.failed);
  return clip;
}

export function useListen({ source, origin, onPhrase, onRemoved }: {
  source: ListenSource;
  origin: PhraseOrigin;
  /** Every phrase the clip saved (in-app: keeps «Мои фразы» in step). */
  onPhrase?: (phrase: SavedPhrase) => void;
  onRemoved?: (id: string) => void;
}): Listen {
  const [phase, setPhase] = useState<ListenPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<ListenClip | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [level] = useState(createLevelStore);
  const take = useRef<Take | null>(null);
  const work = useRef<AbortController | null>(null);
  const ticket = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const options = useRef({ source, origin, onPhrase, onRemoved });
  options.current = { source, origin, onPhrase, onRemoved };

  const release = useCallback((current: Take | null) => {
    if (!current) return;
    if (current.timer) clearInterval(current.timer);
    current.stream.getTracks().forEach(track => track.stop());
    void current.context?.close().catch(() => undefined);
    level.set(0);
  }, [level]);

  const fail = useCallback((message: string) => { setError(message); setPhase('failed'); }, []);

  /** Sends the finished take, then follows Sol until the clip is explained. */
  const send = useCallback(async (blob: Blob, seconds: number, mine: number) => {
    const controller = new AbortController();
    work.current = controller;
    setPhase('uploading');
    try {
      let current = await uploadClip(blob, seconds, options.current.origin, options.current.source, controller.signal);
      if (ticket.current !== mine) return;
      setClip(current); setPhase('analyzing');
      const began = Date.now();
      while (current.status === 'analyzing') {
        if (Date.now() - began + LISTEN_POLL_MS > LISTEN_POLL_LIMIT_MS) { setSlow(true); break; }
        await new Promise(resolve => setTimeout(resolve, LISTEN_POLL_MS));
        if (ticket.current !== mine) return;
        try {
          const answer = await request<ListenResponse>(`phrases/listen/${encodeURIComponent(current.id)}`, undefined, 'GET', controller.signal);
          if (ticket.current !== mine) return;
          current = answer.clip;
          setClip(current);
        } catch (reason) {
          if (ticket.current !== mine || controller.signal.aborted) return;
          if (statusOf(reason) === 404) { fail(LISTEN_COPY.failed); return; }
        }
      }
      current.phrases.forEach(item => options.current.onPhrase?.(item.phrase));
      setPhase(current.status === 'failed' ? 'failed' : 'ready');
      if (current.status === 'failed') setError(current.note || LISTEN_COPY.failed);
    } catch (reason) {
      if (ticket.current !== mine || controller.signal.aborted) return;
      fail(reason instanceof Error && reason.message ? reason.message : LISTEN_COPY.failed);
    } finally {
      if (work.current === controller) work.current = null;
    }
  }, [fail]);

  const finish = useCallback((current: Take) => {
    if (take.current !== current) return;
    take.current = null;
    const seconds = (performance.now() - current.startedAt) / 1000;
    const done = () => {
      release(current);
      if (current.cancelled) return;
      const mine = ticket.current;
      if (seconds < LISTEN_MIN_SECONDS) { fail(LISTEN_COPY.short); return; }
      if (current.peak < LISTEN_SILENCE_RMS) { fail(LISTEN_COPY[options.current.source].silent); return; }
      const blob = new Blob(current.chunks, { type: current.recorder.mimeType || current.chunks[0]?.type || 'audio/webm' });
      if (blob.size < 2048) { fail(LISTEN_COPY.short); return; }
      void send(blob, seconds, mine);
    };
    if (current.recorder.state === 'inactive') { done(); return; }
    current.recorder.addEventListener('stop', done, { once: true });
    try { current.recorder.stop(); } catch { done(); }
  }, [fail, release, send]);

  const stop = useCallback(() => { if (take.current) finish(take.current); }, [finish]);

  const start = useCallback(async () => {
    if (phaseRef.current === 'starting' || phaseRef.current === 'recording') return;
    const mine = ++ticket.current;
    work.current?.abort();
    setClip(null); setError(''); setSlow(false); setElapsed(0);
    setPhase('starting');
    const kind = options.current.source;
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    const type = recorderType();
    if (!media || !type) { fail(LISTEN_COPY.denied[kind]); return; }
    let stream: MediaStream;
    try {
      stream = kind === 'system'
        // The shell answers with the primary screen and its sound; only the sound is kept.
        ? await media.getDisplayMedia({ video: true, audio: true })
        : await media.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    } catch {
      if (ticket.current === mine) fail(LISTEN_COPY.denied[kind]);
      return;
    }
    stream.getVideoTracks().forEach(track => { track.stop(); stream.removeTrack(track); });
    const track = stream.getAudioTracks()[0];
    if (ticket.current !== mine || !track) {
      stream.getTracks().forEach(item => item.stop());
      if (ticket.current === mine) fail(LISTEN_COPY.denied[kind]);
      return;
    }
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(new MediaStream([track]), { mimeType: type, audioBitsPerSecond: 64_000 }); }
    catch { stream.getTracks().forEach(item => item.stop()); fail(LISTEN_COPY.denied[kind]); return; }
    const current: Take = { stream, recorder, chunks: [], context: null, timer: null, startedAt: performance.now(), peak: 0, cancelled: false };
    recorder.addEventListener('dataavailable', event => { if (event.data.size) current.chunks.push(event.data); });
    // The level for the companion and the silence check; the clip stops by itself at three minutes.
    let analyser: AnalyserNode | null = null;
    try {
      current.context = new AudioContext();
      analyser = current.context.createAnalyser();
      analyser.fftSize = 1024;
      current.context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    } catch { analyser = null; }
    const samples = new Float32Array(1024);
    let smooth = 0, shown = -1;
    current.timer = setInterval(() => {
      if (take.current !== current) return;
      const seconds = (performance.now() - current.startedAt) / 1000;
      if (analyser) {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        current.peak = Math.max(current.peak, rms);
        smooth = smooth * 0.5 + Math.min(1, rms * 7) * 0.5;
        level.set(smooth);
      } else current.peak = 1;
      if (Math.floor(seconds) !== shown) { shown = Math.floor(seconds); setElapsed(shown); }
      if (seconds >= LISTEN_MAX_SECONDS) finish(current);
    }, LEVEL_MS);
    // Sharing ended from outside (the OS, a device change): what was recorded is still sent.
    track.addEventListener('ended', () => finish(current), { once: true });
    take.current = current;
    recorder.start(1000);
    setPhase('recording');
  }, [fail, finish, level]);

  const cancel = useCallback(() => {
    ticket.current++;
    const current = take.current;
    take.current = null;
    if (current) {
      current.cancelled = true;
      try { if (current.recorder.state !== 'inactive') current.recorder.stop(); } catch { /* already stopped */ }
      release(current);
    }
    work.current?.abort();
    work.current = null;
    setPhase('idle'); setClip(null); setError(''); setSlow(false); setElapsed(0);
  }, [release]);

  const reset = useCallback(() => {
    if (take.current) return;
    ticket.current++;
    work.current?.abort();
    setPhase('idle'); setClip(null); setError(''); setSlow(false); setElapsed(0);
  }, []);

  const removePhrase = useCallback(async (id: string) => {
    await request(`phrases/${encodeURIComponent(id)}/delete`, {}, 'POST');
    options.current.onRemoved?.(id);
    setClip(current => current ? { ...current, phrases: current.phrases.filter(item => item.phrase.id !== id) } : current);
  }, []);

  // Leaving the page (or the component) never keeps the microphone or the screen capture open.
  useEffect(() => () => {
    const current = take.current;
    take.current = null;
    if (current) { current.cancelled = true; try { current.recorder.stop(); } catch { /* stopped */ } release(current); }
    work.current?.abort();
  }, [release]);

  const busy = phase === 'starting' || phase === 'recording' || phase === 'uploading' || phase === 'analyzing';
  const warn = phase === 'recording' && elapsed >= LISTEN_MAX_SECONDS - LISTEN_WARN_SECONDS;
  return useMemo(() => ({ phase, source, elapsed, warn, clip, slow, error, levelStore: level.store, busy, start, stop, cancel, reset, removePhrase }),
    [phase, source, elapsed, warn, clip, slow, error, level.store, busy, start, stop, cancel, reset, removePhrase]);
}
