'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import type { Session, Turn } from '@/lib/types';
import { BrowserLiveTranscriber, BrowserVoiceCapture, createLiveTranscriptStore, createVoiceMeter, type LiveCredential } from '../lib/browser-audio';
export type { LiveTranscriptStore, VoiceMeterStore } from '../lib/browser-audio';

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'paused';
export type RecordingDraft = { text: string; audioFile: string; originalTranscript: string; objectURL: string; contextKey?: string };
type Recording = { blob: Blob; minutes: number; contextKey?: string; objectURL: string; liveText?: string; liveMinutes: number; liveSessionId?: string };
type RetryAction =
  | { kind: 'transcribe'; recording: Recording }
  | { kind: 'send'; draft: RecordingDraft }
  | { kind: 'speech'; session: Session; turn: Turn }
  | { kind: 'played'; sessionId: string; turnId: string };
type ActiveCapture = {
  capture: BrowserVoiceCapture; live: BrowserLiveTranscriber; contextKey?: string; credential?: LiveCredential; operation: number; ending: boolean;
  /** The microphone really runs (permission granted, worklet started). */
  started: boolean;
  /** Live-text status from the transcription connection (shown once the microphone runs). */
  status: (text: string) => void;
};

const MIC_STATUS = 'Подключаю микрофон…';
const CONNECTING_STATUS = 'Микрофон пишет. Подключаю живой текст…';
const LIVE_UNAVAILABLE = 'Живого текста нет — распознаю после записи.';

// Playback elements already routed through an analyser (Web Audio allows one source node per element).
const meteredElements = new WeakSet<HTMLMediaElement>();
const RETRY_LABELS: Record<RetryAction['kind'], string> = {
  transcribe: 'Повторить распознавание записи', send: 'Вернуть текст записи',
  speech: 'Повторить озвучку', played: 'Подтвердить прослушивание',
};
async function readResponse(response: Response, isCurrent: () => boolean): Promise<Record<string, unknown> | null> {
  if (!isCurrent()) return null;
  let result: unknown;
  try { result = await response.json(); }
  catch { if (!isCurrent()) return null; throw new Error('Сервис вернул некорректный ответ. Попробуй ещё раз.'); }
  if (!isCurrent()) return null;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Не удалось прочитать ответ сервиса.');
  const data = result as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить голосовое действие.');
  return data;
}

export function useVoice(onText: (text: string, audioFile: string, draft: RecordingDraft) => Promise<void>, onError: (text: string) => void) {
  const [state, setRawState] = useState<VoiceState>('idle');
  const [retryKind, setRetryKind] = useState<RetryAction['kind'] | null>(null);
  // The partner line whose voice failed (TTS or playback): its text is shown instead (MOTION-PASS-0.5.2 §6).
  const [speechFailure, setSpeechFailure] = useState<string | null>(null);
  // Live words live outside React state: only the caption view subscribes (MOTION-PASS-0.5.2 §5).
  const transcript = useRef(createLiveTranscriptStore());
  const [recordingDraft, setRecordingDraft] = useState<RecordingDraft | null>(null);
  const [hasUnuploadedRecording, setHasUnuploadedRecording] = useState(false);
  const [playingLearnerRecording, setPlayingLearnerRecording] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [autoplayMessage, setAutoplayMessage] = useState<string | null>(null);
  const meter = useRef(createVoiceMeter());
  // Partner playback amplitude for the mascot's lip-sync: clamp(rms·4, 0, 1) every frame (MASCOT-SPEC §7).
  const speechMeter = useRef(createVoiceMeter());
  const mounted = useRef(true); const stateRef = useRef<VoiceState>('idle');
  const operation = useRef(0); const cancelled = useRef(false);
  const requests = useRef(new Set<AbortController>()); const retryAction = useRef<RetryAction | null>(null);
  const activeCapture = useRef<ActiveCapture | null>(null); const captureFinishing = useRef(false);
  const pendingRecording = useRef<Recording | null>(null); const draftRef = useRef<RecordingDraft | null>(null);
  const objectURL = useRef<string | null>(null); const stream = useRef<MediaStream | null>(null);
  const playbackContext = useRef<AudioContext | null>(null); const playback = useRef<HTMLAudioElement | null>(null);
  const frame = useRef(0); const latestText = useRef(onText); latestText.current = onText;
  const latestError = useRef(onError); latestError.current = onError;

  const setState = useCallback((next: SetStateAction<VoiceState>) => {
    const value = typeof next === 'function' ? next(stateRef.current) : next;
    stateRef.current = value; if (mounted.current) setRawState(value);
  }, []);
  const clearRetry = useCallback(() => { retryAction.current = null; if (mounted.current) setRetryKind(null); }, []);
  function rememberRetry(action: RetryAction) { retryAction.current = action; if (mounted.current) setRetryKind(action.kind); }
  const abortRequests = useCallback(() => { requests.current.forEach(controller => controller.abort()); requests.current.clear(); }, []);
  const releaseMic = useCallback(() => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }, []);
  const clearPlaybackMeter = useCallback(() => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    const context = playbackContext.current; playbackContext.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    meter.current.setLevel(0); speechMeter.current.setLevel(0);
  }, []);
  const discardPlayback = useCallback(() => {
    const audio = playback.current; playback.current = null; clearPlaybackMeter();
    if (mounted.current) setPlayingLearnerRecording(false);
    if (!audio) return;
    audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load();
  }, [clearPlaybackMeter]);
  function isCurrent(ticket: number) { return mounted.current && !cancelled.current && operation.current === ticket; }
  function beginOperation() {
    operation.current += 1; cancelled.current = false; abortRequests(); discardPlayback(); clearRetry();
    if (mounted.current) { setAutoplayBlocked(false); setAutoplayMessage(null); }
    return operation.current;
  }
  function releaseObjectURL() { if (objectURL.current) URL.revokeObjectURL(objectURL.current); objectURL.current = null; }
  async function closeLiveReservation(ticket: string | undefined, minutes: number) {
    if (!ticket) return;
    // Cleanup survives navigation and cancellation of the capture itself.
    try { await fetch('/api/audio/live-session-close', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket, minutes: Math.min(8, Math.max(0, minutes)) }), keepalive: true }); }
    catch { /* Server expires abandoned reservations conservatively. */ }
  }
  function retainRecording(recording: Recording) {
    releaseObjectURL(); objectURL.current = recording.objectURL; pendingRecording.current = recording;
    if (mounted.current) setHasUnuploadedRecording(true);
  }
  const stop = useCallback(() => {
    // 'paused' only when something was actually interrupted; a plain navigation stop stays calm ('idle').
    const interrupted = !!activeCapture.current || !!playback.current || requests.current.size > 0 || captureFinishing.current
      || ['listening', 'transcribing', 'thinking', 'speaking'].includes(stateRef.current);
    cancelled.current = true; operation.current += 1; abortRequests(); discardPlayback();
    transcript.current.update({ phase: 'idle' });
    const active = activeCapture.current; activeCapture.current = null;
    if (active) {
      // A microphone that never started (permission prompt still open) has nothing to keep.
      if (mounted.current && active.started) setHasUnuploadedRecording(true);
      active.ending = true; captureFinishing.current = true; active.live.close();
      void active.capture.finish().then(captured => {
        releaseMic();
        if (mounted.current && captured.sampleCount >= 7200) {
          const recording: Recording = { ...captured, objectURL: URL.createObjectURL(captured.blob), contextKey: active.contextKey, liveMinutes: 0 };
          retainRecording(recording); rememberRetry({ kind: 'transcribe', recording });
        } else if (mounted.current && !pendingRecording.current) setHasUnuploadedRecording(false);
        void closeLiveReservation(active.credential?.ticket, active.live.liveMinutes);
      }).catch(() => {
        releaseMic();
        if (mounted.current) latestError.current('Запись остановилась с ошибкой. Уже записанную часть не удалось открыть.');
      }).finally(() => { captureFinishing.current = false; meter.current.setLevel(0); });
    } else { releaseMic(); if (pendingRecording.current) rememberRetry({ kind: 'transcribe', recording: pendingRecording.current }); }
    setState(interrupted ? 'paused' : 'idle');
  }, [abortRequests, discardPlayback, releaseMic, setState]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(); releaseObjectURL(); }; }, [stop]);
  // Development-only QA hook: drive the live captions without a microphone or a transcription provider.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = window as Window & { __smoothTalkCaptions?: Record<string, (...args: never[]) => void> };
    const store = transcript.current;
    target.__smoothTalkCaptions = {
      open: (contextKey: string) => store.update({ phase: 'listening', contextKey, text: '', final: false, status: 'Слушаю. Текст появляется по ходу речи.' }),
      text: (text: string, final = false) => store.update({ text, final }),
      finish: () => store.update({ phase: 'finishing', status: 'Распознаю. Запись уже сохранена.' }),
      close: () => store.update({ phase: 'idle' }),
    };
    return () => { delete target.__smoothTalkCaptions; };
  }, []);

  async function post(path: string, data: unknown, ticket: number) {
    const controller = new AbortController(); requests.current.add(controller);
    try { const response = await fetch('/api/' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: controller.signal }); return await readResponse(response, () => isCurrent(ticket)); }
    finally { requests.current.delete(controller); }
  }
  async function deliverText(draft: RecordingDraft, ticket: number) {
    if (!isCurrent(ticket)) return; setState('idle');
    try { await latestText.current(draft.text, draft.audioFile, draft); }
    catch (error) { if (!isCurrent(ticket)) return; rememberRetry({ kind: 'send', draft });
      latestError.current(error instanceof Error ? error.message : 'Не удалось открыть текст записи.'); }
  }
  async function transcribeRecording(recording: Recording, ticket: number) {
    if (!isCurrent(ticket)) return; setState('transcribing');
    const captions = transcript.current;
    if (captions.getSnapshot().phase === 'idle') {
      // «Распознать ещё раз»: the caption area of that composer says what is happening.
      captions.update({ phase: 'finishing', contextKey: recording.contextKey ?? null, status: 'Распознаю сохранённую запись…' });
    }
    const controller = new AbortController(); requests.current.add(controller);
    let result: Record<string, unknown> | null;
    try {
      const form = new FormData(); form.set('audio', recording.blob, 'speech.wav'); form.set('minutes', String(recording.minutes));
      if (recording.liveText !== undefined) { form.set('liveText', recording.liveText); form.set('liveFinal', 'true'); }
      if (recording.liveSessionId) { form.set('liveSessionId', recording.liveSessionId); form.set('liveMinutes', String(recording.liveMinutes)); }
      const response = await fetch('/api/transcribe', { method: 'POST', credentials: 'same-origin', body: form, signal: controller.signal });
      result = await readResponse(response, () => isCurrent(ticket));
      if (!isCurrent(ticket) || !result) return;
      if (typeof result.text !== 'string' || !result.text.trim() || typeof result.audioFile !== 'string' || !result.audioFile) {
        throw new Error('Речь не распознана. Исходная запись сохранена. Можно повторить распознавание.');
      }
    } catch (error) {
      if (!isCurrent(ticket)) return; rememberRetry({ kind: 'transcribe', recording }); captions.update({ phase: 'idle' }); setState('idle');
      latestError.current(error instanceof Error ? error.message : 'Не удалось распознать запись. Исходное аудио осталось у тебя.'); return;
    } finally { requests.current.delete(controller); }
    if (!isCurrent(ticket)) return;
    pendingRecording.current = null; setHasUnuploadedRecording(false); clearRetry();
    const draft: RecordingDraft = { text: result.text as string, originalTranscript: result.text as string,
      audioFile: result.audioFile as string, objectURL: recording.objectURL, contextKey: recording.contextKey };
    // Live words stayed on screen since Stop; now they cross-fade to the checked text as the area folds away and the
    // same text lands in the composer in the same frame — never a blank field in between (same as the iPhone view).
    draftRef.current = draft; setRecordingDraft(draft);
    captions.update({ phase: 'idle', text: draft.originalTranscript, final: true }); await deliverText(draft, ticket);
  }
  async function connectLive(active: ActiveCapture) {
    // Runs in parallel with the microphone permission and start-up; audio queues until the socket is open.
    // Keep the short credential response readable after navigation, then immediately
    // release its reservation. Aborting a minted response loses its billing ticket.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);
    try {
      const response = await fetch('/api/audio/live-session', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal });
      // Read a credential even after cancellation to release a reservation that was minted.
      const data = await response.json() as LiveCredential & { error?: string };
      if (!response.ok || !data || typeof data.clientSecret !== 'string' || typeof data.url !== 'string') throw new Error('Live unavailable');
      active.credential = data;
      if (!isCurrent(active.operation) || active.live.isClosed || activeCapture.current !== active) { void closeLiveReservation(data.ticket, 0); return; }
      await active.live.connect(data);
    } catch { active.live.close(); if (isCurrent(active.operation)) active.status(LIVE_UNAVAILABLE); }
    finally { clearTimeout(timeout); }
  }
  async function finishRecording(active: ActiveCapture) {
    if (active.ending) return;
    active.ending = true; captureFinishing.current = true; setState('transcribing');
    transcript.current.update({ phase: 'finishing', status: 'Заканчиваю распознавание…' });
    try {
      const captured = await active.capture.finish(); releaseMic();
      if (!isCurrent(active.operation) || activeCapture.current !== active) return;
      if (captured.sampleCount < 7200) {
        active.live.close(); void closeLiveReservation(active.credential?.ticket, active.live.liveMinutes);
        activeCapture.current = null; transcript.current.update({ phase: 'idle' }); setState('idle');
        latestError.current('Запись слишком короткая. Скажи реплику и останови запись.'); return;
      }
      const recording: Recording = { ...captured, objectURL: URL.createObjectURL(captured.blob), contextKey: active.contextKey, liveMinutes: 0 };
      retainRecording(recording); transcript.current.update({ status: 'Распознаю. Запись уже сохранена.' });
      if (!captured.complete) {
        active.live.close();
        latestError.current('Запись прервалась. Распознаю сохранившуюся часть; проверь её по исходному аудио.');
      }
      const finalText = captured.complete ? await active.live.finish() : null;
      recording.liveMinutes = active.live.liveMinutes; recording.liveSessionId = active.credential?.ticket;
      if (finalText !== null) recording.liveText = finalText;
      if (!isCurrent(active.operation) || activeCapture.current !== active) {
        void closeLiveReservation(recording.liveSessionId, recording.liveMinutes); recording.liveSessionId = undefined; recording.liveMinutes = 0; return;
      }
      activeCapture.current = null; await transcribeRecording(recording, active.operation);
    } finally { captureFinishing.current = false; meter.current.setLevel(0); }
  }
  async function record(contextKey?: string) {
    if (stateRef.current === 'listening' && activeCapture.current) { await finishRecording(activeCapture.current); return; }
    if (captureFinishing.current || stateRef.current === 'transcribing' || stateRef.current === 'thinking') return;
    if (pendingRecording.current) { latestError.current('Сначала распознай сохранённую запись или явно удали её. Новая запись её не заменит.'); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { latestError.current('Микрофону нужен HTTPS или localhost. Используй защищённый адрес приложения.'); return; }
    const ticket = beginOperation(); setState('thinking');
    // The caption area opens at once at its full height; words start the moment recognition has them.
    const captions = transcript.current;
    captions.update({ phase: 'starting', contextKey: contextKey ?? null, text: '', final: false, status: MIC_STATUS });
    let micRunning = false, liveStatus: string | null = null;
    const showStatus = () => { if (isCurrent(ticket)) captions.update({ status: micRunning ? liveStatus ?? CONNECTING_STATUS : MIC_STATUS }); };
    const live = new BrowserLiveTranscriber((text, final) => { if (isCurrent(ticket)) captions.update({ text, final }); },
      text => { liveStatus = text; showStatus(); });
    const capture = new BrowserVoiceCapture(pcm => live.append(pcm), level => { if (isCurrent(ticket)) meter.current.setLevel(level); },
      () => { const active = activeCapture.current; if (active?.operation === ticket && !active.ending) void finishRecording(active); });
    const active: ActiveCapture = { capture, live, contextKey, operation: ticket, ending: false, started: false,
      status: text => { liveStatus = text; showStatus(); } };
    activeCapture.current = active;
    // The transcription ticket and socket open in parallel with the microphone (not after it), so the first words
    // are not held back behind the permission prompt and audio start-up. PCM queues until the socket is open.
    void connectLive(active);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (!isCurrent(ticket)) { mic.getTracks().forEach(track => track.stop()); return; }
      stream.current = mic;
      await capture.start(mic);
      if (!isCurrent(ticket) || activeCapture.current !== active) return;
      active.started = true; micRunning = true;
      releaseObjectURL(); draftRef.current = null; setRecordingDraft(null);
      captions.update({ phase: 'listening' }); showStatus(); setState('listening');
    } catch (error) {
      if (!isCurrent(ticket)) return;
      activeCapture.current = null; live.close(); void capture.finish();
      // A credential minted meanwhile is released now (a later one is released by connectLive).
      void closeLiveReservation(active.credential?.ticket, live.liveMinutes);
      releaseMic(); captions.update({ phase: 'idle' }); setState('idle'); latestError.current(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Разреши микрофон в настройках браузера и попробуй снова.' : error instanceof Error ? error.message : 'Не удалось подключить микрофон.');
    }
  }

  async function attachPlaybackMeter(audio: HTMLAudioElement, ticket: number) {
    const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor || meteredElements.has(audio)) return;
    let context: AudioContext | null = null;
    try {
      context = new Constructor(); await context.resume();
      if (!isCurrent(ticket) || playback.current !== audio || context.state !== 'running' || meteredElements.has(audio)) { await context.close(); return; }
      playbackContext.current = context;
      const analyser = context.createAnalyser(); analyser.fftSize = 512;
      // ONE MediaElementAudioSourceNode per playback element (a second one would throw).
      const source = context.createMediaElementSource(audio); meteredElements.add(audio); source.connect(analyser); analyser.connect(context.destination);
      const samples = new Uint8Array(analyser.fftSize); let lastRead = -Infinity;
      const monitor = (now: number) => {
        if (!isCurrent(ticket) || playback.current !== audio) return;
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        speechMeter.current.setLevel(rms * 4); // every frame for crisp lip-sync; the store clamps to 0–1
        if (now - lastRead >= 40) {
          lastRead = now;
          meter.current.setLevel(rms > 0 ? (20 * Math.log10(rms) + 55) / 55 : 0);
        }
        frame.current = requestAnimationFrame(monitor);
      };
      frame.current = requestAnimationFrame(monitor);
    } catch { if (context && context.state !== 'closed') void context.close().catch(() => undefined); }
  }
  async function confirmPlayed(action: Extract<RetryAction, { kind: 'played' }>, ticket: number) {
    if (!isCurrent(ticket)) return; setState('thinking');
    try {
      const result = await post('sessions/' + action.sessionId + '/played', { turnId: action.turnId }, ticket);
      if (!isCurrent(ticket) || !result) return;
      if (result.ok !== true) throw new Error('Сервис не подтвердил прослушивание. Повтори подтверждение.'); clearRetry();
      if (pendingRecording.current) rememberRetry({ kind: 'transcribe', recording: pendingRecording.current });
      setState('idle');
    } catch (error) { if (!isCurrent(ticket)) return; rememberRetry(action); setState('idle');
      latestError.current(error instanceof Error ? error.message : 'Не удалось сохранить факт прослушивания.'); }
  }
  async function speak(session: Session, turn: Turn, options: { autoplay?: boolean } = {}) {
    if (activeCapture.current || ['listening', 'transcribing'].includes(stateRef.current)) return;
    if (options.autoplay && pendingRecording.current) return;
    const ticket = beginOperation(); const action: Extract<RetryAction, { kind: 'speech' }> = { kind: 'speech', session, turn };
    let playbackFailed = false; setState('thinking');
    try {
      const result = await post('sessions/' + session.id + '/speech', { turnId: turn.id }, ticket);
      if (!isCurrent(ticket) || !result) return;
      if (typeof result.file !== 'string' || !result.file) throw new Error('Озвучка не подготовлена. Повтори запрос.');
      const audio = new Audio('/api/audio/' + encodeURIComponent(result.file)); playback.current = audio;
      const failPlayback = (error: unknown) => {
        if (!isCurrent(ticket) || playbackFailed) return;
        playbackFailed = true; discardPlayback(); rememberRetry(action); setState('idle');
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setAutoplayBlocked(true); setAutoplayMessage('Браузер ждёт твоего нажатия. Нажми «Слушать», чтобы включить голос.');
        } else {
          setSpeechFailure(turn.id);
          latestError.current(error instanceof Error ? error.message : 'Не удалось воспроизвести голос. Повтори озвучку.');
        }
      };
      audio.onerror = () => failPlayback(new Error('Не удалось воспроизвести голос. Повтори озвучку.'));
      audio.onended = () => {
        if (!isCurrent(ticket) || playback.current !== audio || playbackFailed) return;
        audio.onended = null; audio.onerror = null; playback.current = null; clearPlaybackMeter();
        void confirmPlayed({ kind: 'played', sessionId: session.id, turnId: turn.id }, ticket);
      };
      setState('speaking');
      try {
        await audio.play();
        if (isCurrent(ticket) && playback.current === audio) { setSpeechFailure(previous => previous === turn.id ? null : previous); void attachPlaybackMeter(audio, ticket); }
      }
      catch (error) { failPlayback(error); }
    } catch (error) {
      if (!isCurrent(ticket) || playbackFailed) return; rememberRetry(action); setState('idle');
      if (!options.autoplay || !(error instanceof DOMException && error.name === 'AbortError')) {
        // The voice could not be prepared (budget, provider): the line's text stands in for it.
        setSpeechFailure(turn.id);
        latestError.current(error instanceof Error ? error.message : 'Озвучка недоступна.');
      }
    }
  }
  async function playRecording(audioFile?: string) {
    if (activeCapture.current || ['listening', 'transcribing'].includes(stateRef.current)) return;
    const source = audioFile ? '/api/audio/' + encodeURIComponent(audioFile) : objectURL.current; if (!source) return;
    const ticket = beginOperation(); const audio = new Audio(source); playback.current = audio; setPlayingLearnerRecording(true); setState('speaking');
    const finish = () => { if (!isCurrent(ticket) || playback.current !== audio) return; discardPlayback(); setState('idle');
      if (pendingRecording.current) rememberRetry({ kind: 'transcribe', recording: pendingRecording.current }); };
    audio.onended = finish; audio.onerror = () => { finish(); latestError.current('Не удалось открыть исходную запись.'); };
    try { await audio.play(); if (isCurrent(ticket) && playback.current === audio) void attachPlaybackMeter(audio, ticket); }
    catch { finish(); latestError.current('Нажми ещё раз, чтобы прослушать исходную запись.'); }
  }
  function markSubmitted() { pendingRecording.current = null; draftRef.current = null; releaseObjectURL(); clearRetry(); setRecordingDraft(null); setHasUnuploadedRecording(false); }
  function discardRecording() {
    if (activeCapture.current || captureFinishing.current) return; stop();
    const pending = pendingRecording.current; pendingRecording.current = null; if (pending) void closeLiveReservation(pending.liveSessionId, pending.liveMinutes);
    draftRef.current = null; releaseObjectURL(); clearRetry(); setRecordingDraft(null); setHasUnuploadedRecording(false);
    transcript.current.update({ phase: 'idle' }); setState('idle');
  }
  async function retry() {
    const action = retryAction.current;
    if (!action || ['listening', 'transcribing', 'thinking', 'speaking'].includes(stateRef.current) || captureFinishing.current) return;
    if (action.kind === 'speech') { await speak(action.session, action.turn); return; }
    const ticket = beginOperation();
    if (action.kind === 'transcribe') await transcribeRecording(action.recording, ticket);
    else if (action.kind === 'send') await deliverText(action.draft, ticket);
    else await confirmPlayed(action, ticket);
  }

  // Stable action identities that always run the latest implementation, so the returned object only changes
  // with the state below (the session controller and the app context are memoised on it).
  const latest = useRef({ record, speak, retry, playRecording, discardRecording, markSubmitted });
  latest.current = { record, speak, retry, playRecording, discardRecording, markSubmitted };
  const actions = useMemo(() => ({
    record: (contextKey?: string) => latest.current.record(contextKey),
    speak: (session: Session, turn: Turn, options?: { autoplay?: boolean }) => latest.current.speak(session, turn, options),
    retry: () => latest.current.retry(),
    playRecording: (audioFile?: string) => latest.current.playRecording(audioFile),
    discardRecording: () => latest.current.discardRecording(),
    markSubmitted: () => latest.current.markSubmitted(),
  }), []);
  return useMemo(() => ({
    ...actions, stop, setState, state, get volume() { return meter.current.getSnapshot(); },
    meterStore: meter.current, speechLevelStore: speechMeter.current, transcriptStore: transcript.current,
    recordingDraft, hasUnuploadedRecording, playingLearnerRecording, autoplayBlocked, autoplayMessage,
    canRetry: retryKind !== null, retryLabel: retryKind ? RETRY_LABELS[retryKind] : null,
    /** A partner turn whose voice failed: show its text instead (cleared once it plays). */
    speechFailedTurnId: speechFailure,
  }), [actions, stop, setState, state, recordingDraft, hasUnuploadedRecording, playingLearnerRecording, autoplayBlocked, autoplayMessage, retryKind, speechFailure]);
}
