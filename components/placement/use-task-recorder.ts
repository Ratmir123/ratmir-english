'use client';

/**
 * Microphone recorder for timed placement tasks. Unlike the session voice hook it never opens live
 * recognition (no extra cost) and never allows transcript editing: record → WAV → /api/audio/transcribe.
 * The microphone stream is acquired once per voice section, so auto-started recordings begin instantly
 * and the leading silence measures real response latency.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, mediaUrl } from '@/lib/client/api';
import { BrowserVoiceCapture, PCM_RATE, createVoiceMeter } from '@/lib/browser-audio';

export type MicState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable';
export interface TaskRecording { blob: Blob; minutes: number; seconds: number; complete: boolean }

export function micMessage(state: MicState): string | null {
  if (state === 'denied') return 'Браузер не дал доступ к микрофону. Разреши его в настройках сайта и попробуй снова — или пропусти голосовой раздел.';
  if (state === 'unavailable') return 'Микрофон недоступен: нужен защищённый адрес (HTTPS или localhost) и подключённый микрофон.';
  return null;
}

export function useTaskRecorder() {
  const meter = useRef(createVoiceMeter());
  const stream = useRef<MediaStream | null>(null);
  const capture = useRef<BrowserVoiceCapture | null>(null);
  const mounted = useRef(true);
  const [mic, setMic] = useState<MicState>('idle');
  const [recording, setRecording] = useState(false);

  const live = () => !!stream.current && stream.current.getAudioTracks().some(track => track.readyState === 'live');

  const acquire = useCallback(async (): Promise<boolean> => {
    if (live()) { setMic('ready'); return true; }
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setMic('unavailable'); return false; }
    setMic('requesting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (!mounted.current) { media.getTracks().forEach(track => track.stop()); return false; }
      stream.current = media;
      setMic('ready');
      return true;
    } catch (error) {
      setMic(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'unavailable');
      return false;
    }
  }, []);

  /** Starts capturing immediately (mic must be acquired). `onLimit` fires at the worklet's hard 8-minute cap. */
  const start = useCallback(async (onLimit?: () => void): Promise<boolean> => {
    if (capture.current) return true;
    if (!live() && !(await acquire())) return false;
    const next = new BrowserVoiceCapture(() => undefined, level => meter.current.setLevel(level), () => onLimit?.());
    capture.current = next;
    try {
      await next.start(stream.current!);
      if (capture.current !== next) return false;
      setRecording(true);
      return true;
    } catch {
      capture.current = null;
      void next.finish().catch(() => undefined);
      setMic('unavailable');
      return false;
    }
  }, [acquire]);

  const stop = useCallback(async (): Promise<TaskRecording | null> => {
    const current = capture.current; capture.current = null;
    setRecording(false);
    if (!current) return null;
    const captured = await current.finish();
    meter.current.setLevel(0);
    return { blob: captured.blob, minutes: captured.minutes, seconds: captured.sampleCount / PCM_RATE, complete: captured.complete };
  }, []);

  /** Stops any capture and frees the microphone (leaving the voice sections, closing the test). */
  const release = useCallback(() => {
    const current = capture.current; capture.current = null;
    if (current) void current.finish().catch(() => undefined);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    meter.current.setLevel(0);
    if (mounted.current) { setRecording(false); setMic('idle'); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; release(); };
  }, [release]);

  return { mic, recording, acquire, start, stop, release, meterStore: meter.current };
}
export type TaskRecorder = ReturnType<typeof useTaskRecorder>;

/** Uploads a test answer for transcription (no editing during the test). */
export async function transcribeAnswer(recording: TaskRecording, signal?: AbortSignal): Promise<{ text: string; audioFile: string }> {
  const form = new FormData();
  form.set('audio', recording.blob, 'speech.wav');
  form.set('minutes', String(Math.min(10, Math.max(0.01, recording.minutes))));
  const response = await fetch(mediaUrl('audio/transcribe'), { method: 'POST', credentials: 'same-origin', body: form, signal });
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch { /* non-JSON */ }
  if (!response.ok) throw new ApiRequestError(typeof data.error === 'string' ? data.error : 'Не удалось распознать ответ.', response.status, data);
  if (typeof data.text !== 'string' || !data.text.trim() || typeof data.audioFile !== 'string' || !data.audioFile) {
    throw new ApiRequestError('Речь не распознана. Проверь микрофон и запиши ответ ещё раз.', 422, data);
  }
  return { text: data.text.trim(), audioFile: data.audioFile };
}

/* ───────── partner / listening audio with a level meter (lip-sync) ───────── */

let sharedContext: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  if (!sharedContext || sharedContext.state === 'closed') {
    try { sharedContext = new Constructor(); } catch { sharedContext = null; }
  }
  return sharedContext;
}

export interface MeteredPlayback {
  /** Resolves 'ended' when the clip finished, 'stopped' when stopped, rejects on load/playback errors. */
  done: Promise<'ended' | 'stopped'>;
  stop(): void;
  audio: HTMLAudioElement;
}

/**
 * Plays a clip and feeds its level (clamp(rms·4, 0, 1)) into `level` for the mascot's mouth.
 * `NotAllowedError` from autoplay policy is surfaced as a rejection so the UI can show a "Слушать" button.
 */
export function playMetered(url: string, level?: { setLevel(value: number): void }, onProgress?: (fraction: number) => void): MeteredPlayback {
  const audio = new Audio(url);
  audio.preload = 'auto';
  let frame = 0; let finished = false;
  let source: MediaElementAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let resolveDone!: (value: 'ended' | 'stopped') => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<'ended' | 'stopped'>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const cleanup = () => {
    finished = true; cancelAnimationFrame(frame); level?.setLevel(0);
    try { source?.disconnect(); analyser?.disconnect(); } catch { /* already disconnected */ }
    audio.onended = null; audio.onerror = null;
  };
  const tick = () => {
    if (finished) return;
    if (analyser) {
      const samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) { const centred = (value - 128) / 128; sum += centred * centred; }
      level?.setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    }
    if (onProgress && Number.isFinite(audio.duration) && audio.duration > 0) onProgress(Math.min(1, audio.currentTime / audio.duration));
    frame = requestAnimationFrame(tick);
  };
  audio.onended = () => { onProgress?.(1); cleanup(); resolveDone('ended'); };
  audio.onerror = () => { cleanup(); rejectDone(new Error('Не удалось загрузить запись.')); };
  void (async () => {
    try {
      const context = level ? audioContext() : null;
      if (context) {
        try {
          // resume() can stay pending without a user gesture — never let it block playback.
          if (context.state === 'suspended') await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, 250))]);
          // A suspended context would swallow the sound: route through it only while it runs.
          if (context.state !== 'running') throw new Error('suspended');
          source = context.createMediaElementSource(audio);
          analyser = context.createAnalyser(); analyser.fftSize = 512;
          source.connect(analyser); analyser.connect(context.destination);
        } catch { source = null; analyser = null; }
      }
      await audio.play();
      if (!finished) frame = requestAnimationFrame(tick);
    } catch (error) { cleanup(); rejectDone(error); }
  })();
  return {
    done, audio,
    stop() { if (finished) return; audio.pause(); cleanup(); resolveDone('stopped'); },
  };
}
