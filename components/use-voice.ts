'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { Session, Turn } from '@/lib/types';

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'paused';
type RetryAction =
  | { kind: 'transcribe'; blob: Blob; minutes: number }
  | { kind: 'send'; text: string; audioFile: string }
  | { kind: 'speech'; session: Session; turn: Turn }
  | { kind: 'played'; sessionId: string; turnId: string };

const RETRY_LABELS: Record<RetryAction['kind'], string> = {
  transcribe: 'Повторить распознавание записи',
  send: 'Повторить отправку реплики',
  speech: 'Повторить озвучку',
  played: 'Подтвердить прослушивание',
};

async function readResponse(response: Response, isCurrent: () => boolean): Promise<Record<string, unknown> | null> {
  if (!isCurrent()) return null;
  let result: unknown;
  try { result = await response.json(); }
  catch {
    if (!isCurrent()) return null;
    throw new Error('Сервис вернул некорректный ответ. Попробуй ещё раз.');
  }
  if (!isCurrent()) return null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Не удалось прочитать ответ сервиса.');
  const data = result as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить голосовое действие.');
  return data;
}

export function useVoice(onText: (text: string, audioFile: string) => Promise<void>, onError: (text: string) => void) {
  const [state, setRawState] = useState<VoiceState>('idle');
  const [volume, setVolume] = useState(0);
  const [retryKind, setRetryKind] = useState<RetryAction['kind'] | null>(null);
  const mounted = useRef(true);
  const stateRef = useRef<VoiceState>('idle');
  const operation = useRef(0);
  const cancelled = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const retryAction = useRef<RetryAction | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null);
  const frame = useRef(0);
  const latestText = useRef(onText); latestText.current = onText;
  const latestError = useRef(onError); latestError.current = onError;

  const setState = useCallback((next: SetStateAction<VoiceState>) => {
    const value = typeof next === 'function' ? next(stateRef.current) : next;
    stateRef.current = value;
    if (mounted.current) setRawState(value);
  }, []);

  const clearRetry = useCallback(() => {
    retryAction.current = null;
    if (mounted.current) setRetryKind(null);
  }, []);

  function rememberRetry(action: RetryAction) {
    retryAction.current = action;
    if (mounted.current) setRetryKind(action.kind);
  }

  const abortRequests = useCallback(() => {
    requests.current.forEach(controller => controller.abort());
    requests.current.clear();
  }, []);

  const discardPlayback = useCallback(() => {
    const audio = playback.current;
    playback.current = null;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }, []);

  const releaseMic = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    const context = audioContext.current;
    audioContext.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => { /* Browser may already be closing the context. */ });
    if (mounted.current) setVolume(0);
  }, []);

  const stop = useCallback(() => {
    cancelled.current = true;
    operation.current += 1;
    abortRequests();
    const media = recorder.current;
    recorder.current = null;
    if (media) {
      media.ondataavailable = null;
      media.onstop = null;
      media.onerror = null;
      if (media.state === 'recording') media.stop();
    }
    discardPlayback();
    releaseMic();
    clearRetry();
    setState('paused');
  }, [abortRequests, clearRetry, discardPlayback, releaseMic, setState]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  function isCurrent(ticket: number) {
    return mounted.current && !cancelled.current && operation.current === ticket;
  }

  function beginOperation() {
    operation.current += 1;
    cancelled.current = false;
    abortRequests();
    discardPlayback();
    clearRetry();
    return operation.current;
  }

  async function post(path: string, data: unknown, ticket: number) {
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const response = await fetch('/api/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: controller.signal,
      });
      if (!isCurrent(ticket)) return null;
      return await readResponse(response, () => isCurrent(ticket));
    } finally { requests.current.delete(controller); }
  }

  async function deliverText(text: string, audioFile: string, ticket: number) {
    if (!isCurrent(ticket)) return;
    setState('thinking');
    try {
      await latestText.current(text, audioFile);
      // send() can start speaking before it resolves. Never overwrite that new operation.
      if (isCurrent(ticket) && stateRef.current === 'thinking') setState('idle');
    } catch (error) {
      if (!isCurrent(ticket)) return;
      rememberRetry({ kind: 'send', text, audioFile });
      setState('idle');
      latestError.current(error instanceof Error ? error.message : 'Не удалось отправить голосовую реплику.');
    }
  }

  async function transcribeRecording(blob: Blob, minutes: number, ticket: number) {
    if (!isCurrent(ticket)) return;
    setState('transcribing');
    const controller = new AbortController();
    requests.current.add(controller);
    let result: Record<string, unknown> | null;
    try {
      const form = new FormData();
      form.set('audio', blob, 'speech');
      form.set('minutes', String(minutes));
      const response = await fetch('/api/transcribe', { method: 'POST', body: form, signal: controller.signal });
      if (!isCurrent(ticket)) return;
      result = await readResponse(response, () => isCurrent(ticket));
      if (!isCurrent(ticket) || !result) return;
      if (typeof result.text !== 'string' || !result.text.trim() || typeof result.audioFile !== 'string' || !result.audioFile) {
        throw new Error('Речь не распознана. Можно повторить распознавание или сделать новую запись.');
      }
    } catch (error) {
      if (!isCurrent(ticket)) return;
      rememberRetry({ kind: 'transcribe', blob, minutes });
      setState('idle');
      latestError.current(error instanceof Error ? error.message : 'Не удалось распознать запись.');
      return;
    } finally { requests.current.delete(controller); }
    if (!isCurrent(ticket)) return;
    await deliverText(result.text as string, result.audioFile as string, ticket);
  }

  async function record() {
    if (stateRef.current === 'listening') {
      const media = recorder.current;
      if (media?.state === 'recording') { setState('transcribing'); media.stop(); }
      return;
    }
    if (stateRef.current === 'transcribing' || stateRef.current === 'thinking') return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      latestError.current('Микрофону нужен HTTPS или localhost. На телефоне используй защищённый адрес.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      latestError.current('Этот браузер не поддерживает запись. Открой современный браузер или используй текст.');
      return;
    }
    const ticket = beginOperation();
    setState('thinking');
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      // Permission may finish after navigation, pause, or another operation.
      if (!isCurrent(ticket)) { mic.getTracks().forEach(track => track.stop()); return; }
      stream.current = mic;
      const AudioContextConstructor = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        const context = new AudioContextConstructor();
        audioContext.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(mic).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let lastRead = -Infinity;
        function monitor(now: number) {
          if (!isCurrent(ticket) || stream.current !== mic) return;
          if (now - lastRead >= 1000 / 15) {
            lastRead = now;
            analyser.getByteTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
            setVolume(Math.round(Math.min(1, rms * 8) * 100) / 100);
          }
          frame.current = requestAnimationFrame(monitor);
        }
        frame.current = requestAnimationFrame(monitor);
      }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
      recorder.current = media;
      const chunks: Blob[] = [];
      const started = Date.now();
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onerror = () => {
        if (!isCurrent(ticket)) return;
        stop();
        setState('idle');
        latestError.current('Запись прервалась. Проверь микрофон и сделай новую попытку.');
      };
      media.onstop = () => {
        if (!isCurrent(ticket)) return;
        const minutes = (Date.now() - started) / 60000;
        if (recorder.current === media) recorder.current = null;
        releaseMic();
        if (!chunks.length || minutes < 0.005) {
          setState('idle');
          latestError.current('Запись слишком короткая. Скажи реплику и отправь её ещё раз.');
          return;
        }
        void transcribeRecording(new Blob(chunks, { type: media.mimeType }), minutes, ticket);
      };
      media.start();
      if (isCurrent(ticket)) setState('listening');
    } catch (error) {
      if (!isCurrent(ticket)) return;
      stop();
      setState('idle');
      latestError.current(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Разреши микрофон в настройках браузера и попробуй снова.' : 'Не удалось подключить микрофон.');
    }
  }

  async function confirmPlayed(action: Extract<RetryAction, { kind: 'played' }>, ticket: number) {
    if (!isCurrent(ticket)) return;
    setState('thinking');
    try {
      const result = await post('sessions/' + action.sessionId + '/played', { turnId: action.turnId }, ticket);
      if (!isCurrent(ticket) || !result) return;
      if (result.ok !== true) throw new Error('Сервис не подтвердил прослушивание. Повтори подтверждение.');
      clearRetry();
      setState('idle');
    } catch (error) {
      if (!isCurrent(ticket)) return;
      rememberRetry(action);
      setState('idle');
      latestError.current(error instanceof Error ? error.message : 'Не удалось сохранить факт прослушивания.');
    }
  }

  async function speak(session: Session, turn: Turn) {
    if (stateRef.current === 'listening' || stateRef.current === 'transcribing') return;
    const ticket = beginOperation();
    const action: Extract<RetryAction, { kind: 'speech' }> = { kind: 'speech', session, turn };
    let playbackFailed = false;
    setState('thinking');
    try {
      const result = await post('sessions/' + session.id + '/speech', { turnId: turn.id }, ticket);
      if (!isCurrent(ticket) || !result) return;
      if (typeof result.file !== 'string' || !result.file) throw new Error('Озвучка не подготовлена. Повтори запрос.');
      const audio = new Audio('/api/audio/' + encodeURIComponent(result.file));
      playback.current = audio;
      const failPlayback = (error: unknown) => {
        if (!isCurrent(ticket) || playbackFailed) return;
        playbackFailed = true;
        discardPlayback();
        setVolume(0);
        rememberRetry(action);
        setState('idle');
        latestError.current(error instanceof Error ? error.message : 'Не удалось воспроизвести голос. Повтори озвучку.');
      };
      audio.onerror = () => failPlayback(new Error('Не удалось воспроизвести голос. Повтори озвучку.'));
      audio.onended = () => {
        if (!isCurrent(ticket) || playback.current !== audio || playbackFailed) return;
        audio.onended = null;
        audio.onerror = null;
        playback.current = null;
        setVolume(0);
        // Only a natural full playback may mark the turn as heard. Stay pending until saved.
        void confirmPlayed({ kind: 'played', sessionId: session.id, turnId: turn.id }, ticket);
      };
      setState('speaking');
      setVolume(0.18);
      try { await audio.play(); }
      catch (error) { failPlayback(error); }
    } catch (error) {
      if (!isCurrent(ticket) || playbackFailed) return;
      setVolume(0);
      rememberRetry(action);
      setState('idle');
      latestError.current(error instanceof Error ? error.message : 'Озвучка недоступна.');
    }
  }

  async function retry() {
    const action = retryAction.current;
    if (!action || ['listening', 'transcribing', 'thinking', 'speaking'].includes(stateRef.current)) return;
    if (action.kind === 'speech') { await speak(action.session, action.turn); return; }
    const ticket = beginOperation();
    if (action.kind === 'transcribe') await transcribeRecording(action.blob, action.minutes, ticket);
    else if (action.kind === 'send') await deliverText(action.text, action.audioFile, ticket);
    else await confirmPlayed(action, ticket);
  }

  return {
    state, volume, record, speak, stop, setState, retry,
    canRetry: retryKind !== null,
    retryLabel: retryKind ? RETRY_LABELS[retryKind] : null,
  };
}
