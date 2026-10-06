'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Context, Mode, Session, Turn } from '@/lib/types';
import { useVoice, type RecordingDraft } from '../use-voice';
import { messageOf, request } from './api';
import { useDrafts, type DraftIntent } from './use-drafts';
import { voiceAvailability, type AppData } from './use-app-data';
import type { Navigation } from './use-navigation';
import type { TabId } from './labels';
import { diffProgress, improvedCelebration, progressSnapshot, type Celebration } from './celebrations';

export type StartOptions = {
  familyId?: string; context?: Context; topic?: string; mode?: Mode; minutes?: number;
  /** v0.5: start from a personal drill (instant, no planning call). */
  drillId?: string;
  /** 0.5.3: a round of «Мои фразы» (POST /api/sessions { phraseRound: true }; exclusive with drillId, familyId and topic). */
  phraseRound?: boolean;
  from?: TabId;
};
/** `life` (ms) overrides how long the toast stays: an undo window («Факт убран · Вернуть») ends with its action. */
export type ToastAction = { label: string; run: () => void; life?: number };
export type Feedback = {
  error: (message: string, action?: ToastAction) => void;
  notice: (message: string, action?: ToastAction) => void;
  celebrate: (items: Celebration[], origin?: Element | null) => void;
};
type SentPacket = { sessionId: string; id: string; text: string; source: 'text' | 'audio'; audioFile?: string; originalTranscript?: string };
type SessionActionName = 'finish' | 'complete' | 'retry' | 'edit' | 'reanalyse';

const POLL_MS = 3000;
const recordingBusy = (state: string) => state === 'listening' || state === 'transcribing';

/**
 * Partner text (MOTION-PASS-0.5.2 §6): every partner line arrives hidden, in every mode. `shown` = lines the learner
 * revealed (and did not hide again); `unvoiced` = lines whose voice failed, shown for good; `seen` = lines whose text
 * was ever on screen, which is what support counts.
 */
type PartnerText = { shown: ReadonlySet<string>; unvoiced: ReadonlySet<string>; seen: ReadonlySet<string> };
const NO_PARTNER_TEXT: PartnerText = { shown: new Set(), unvoiced: new Set(), seen: new Set() };
const withItem = (set: ReadonlySet<string>, id: string) => set.has(id) ? set : new Set([...set, id]);
const withoutItem = (set: ReadonlySet<string>, id: string) => { if (!set.has(id)) return set; const next = new Set(set); next.delete(id); return next; };

/**
 * The single owner of the open lesson: one useVoice instance (audit §5.3 invariant 1), drafts, idempotency
 * refs, polling, autoplay and every session action. Screens read it through the app context.
 */
export function useSessionController(data: AppData, navigation: Navigation, feedback: Feedback) {
  const drafts = useDrafts();
  // Navigation/data objects are rebuilt every render; callbacks read them through refs so timers and effects stay put.
  const navRef = useRef(navigation);
  navRef.current = navigation;
  const { refresh: refreshState, setState: setAppState, stateRef: appStateRef } = data;
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [busy, setBusy] = useState('');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [busySince, setBusySince] = useState<number | null>(null);
  const [starting, setStarting] = useState<{ label: string; since: number } | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [hintText, setHintText] = useState('');
  const [hintLevel, setHintLevel] = useState(0);
  const [partnerText, setPartnerText] = useState<PartnerText>(NO_PARTNER_TEXT);
  const partnerTextRef = useRef(partnerText);
  partnerTextRef.current = partnerText;
  // Until /api/status answers the voice is unknown and partner lines stay hidden (like the iPhone); only a status that
  // says «no voice», or a failed status check, makes the text stand in for it.
  const voiceUnavailable = voiceAvailability(data.status, data.statusFailed) === 'unavailable';
  const voiceUnavailableRef = useRef(voiceUnavailable);
  voiceUnavailableRef.current = voiceUnavailable;
  const [comfort, setComfortMap] = useState<Record<string, number>>({});
  const [glowRetryId, setGlowRetryId] = useState<string | null>(null);
  /** The session completed by this action (not opened from history): its outcome celebrates once. */
  const [lastCompletedId, setLastCompletedId] = useState<string | null>(null);
  const lastSent = useRef<SentPacket | null>(null);
  const lessonStart = useRef<{ optionsKey: string; requestId: string; pending: boolean } | null>(null);
  const lastAutoplay = useRef<string | null>(null);
  const actionLock = useRef(false);
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;

  const reportSessionError = useCallback((message: string) => {
    setSessionError(message);
    if (!navRef.current.sessionOpenRef.current) feedbackRef.current.error(message);
  }, []);

  const voice = useVoice(async (text: string, audioFile: string, recording: RecordingDraft) => {
    const [sessionId, intent, retryId] = (recording.contextKey || '').split(':');
    if (!sessionId || !['message', 'retry', 'pushback'].includes(intent)) { reportSessionError('Не удалось связать запись с разговором. Исходная запись сохранена.'); return; }
    drafts.save(sessionId, { text, audioFile, originalTranscript: recording.originalTranscript, intent: intent as DraftIntent, id: crypto.randomUUID(), ...(retryId ? { retryId } : {}) });
    feedbackRef.current.notice('Запись готова. Проверь текст и отправь, когда будешь готов.');
  }, message => reportSessionError(message));
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const action = useCallback(async <T,>(name: string, task: () => Promise<T>, options: { scope?: 'session' | 'global'; propagate?: boolean } = {}): Promise<T | undefined> => {
    setBusy(name); setBusySince(Date.now()); setSessionError('');
    try { return await task(); }
    catch (error) {
      const message = messageOf(error);
      if (options.scope === 'global') feedbackRef.current.error(message); else reportSessionError(message);
      if (options.propagate) throw error;
      return undefined;
    } finally { setBusy(''); setBusySince(null); }
  }, [reportSessionError]);

  const resetSessionView = useCallback((value: Session) => {
    setHintText(''); setHintLevel(0); setSessionError(''); setGlowRetryId(null);
    // Partner lines start hidden in every mode; lines already marked as read on the server stay counted as seen.
    const marked = value.turns.filter(turn => turn.role === 'assistant' && turn.support >= 1).map(turn => turn.id);
    setPartnerText({ shown: new Set(), unvoiced: new Set(), seen: new Set(marked) });
  }, []);

  // ---------- partner text (MOTION-PASS-0.5.2 §6) ----------
  /** He cannot hear this line (no voice configured, or its speech failed): its text stands in and cannot be hidden. */
  const speechFailedTurnId = voice.speechFailedTurnId;
  const partnerTextForced = useCallback((turn: Pick<Turn, 'id'>) =>
    voiceUnavailable || speechFailedTurnId === turn.id || partnerText.unvoiced.has(turn.id), [voiceUnavailable, speechFailedTurnId, partnerText]);
  const partnerTextShown = useCallback((turn: Pick<Turn, 'id'>) =>
    partnerTextForced(turn) || partnerText.shown.has(turn.id), [partnerTextForced, partnerText]);
  // A line whose voice failed stays readable (and counts as read) even after a later replay works.
  useEffect(() => {
    if (!speechFailedTurnId) return;
    setPartnerText(previous => ({ ...previous, unvoiced: withItem(previous.unvoiced, speechFailedTurnId), seen: withItem(previous.seen, speechFailedTurnId) }));
  }, [speechFailedTurnId]);
  const revealPartnerText = useCallback(async (turnId: string) => {
    const current = sessionRef.current;
    if (!current || current.baseline) return;
    setPartnerText(previous => ({ ...previous, shown: withItem(previous.shown, turnId), seen: withItem(previous.seen, turnId) }));
    // The line he is about to answer is marked as read right away (that very turn); while busy or recording, the next
    // message's textVisible marks it instead. A failed mark is covered the same way, so it stays quiet.
    const last = current.turns.at(-1);
    if (current.status !== 'active' || last?.role !== 'assistant' || last.id !== turnId || last.support >= 1) return;
    if (busyRef.current || recordingBusy(voiceRef.current.state)) return;
    const next = await request<Session>(`sessions/${current.id}/show-text`, { turnId }).catch(() => null);
    const latest = sessionRef.current;
    if (next && latest?.id === current.id && next.updatedAt >= latest.updatedAt) setSession(next);
  }, []);
  const hidePartnerText = useCallback((turnId: string) => {
    setPartnerText(previous => previous.shown.has(turnId) ? { ...previous, shown: withoutItem(previous.shown, turnId) } : previous);
  }, []);

  // ---------- drafts (the composer value is the persisted draft) ----------
  const draftFor = useCallback((sessionId: string | undefined, intent: DraftIntent, retryId?: string) => {
    if (!sessionId) return undefined;
    const draft = drafts.drafts[sessionId];
    return draft && draft.intent === intent && (intent !== 'pushback' || draft.retryId === retryId) ? draft : undefined;
  }, [drafts.drafts]);
  const changeDraft = useCallback((intent: DraftIntent, text: string, retryId?: string) => {
    const current = sessionRef.current; if (!current) return;
    const previous = drafts.draftsRef.current[current.id];
    const same = previous && previous.intent === intent && (intent !== 'pushback' || previous.retryId === retryId);
    if (!text && !(same && previous.audioFile)) { drafts.save(current.id, null); return; }
    drafts.save(current.id, same
      ? { ...previous, text }
      : { text, intent, id: crypto.randomUUID(), ...(retryId ? { retryId } : {}) });
  }, [drafts]);
  const discardDraft = useCallback(() => {
    const current = sessionRef.current; if (!current) return;
    drafts.save(current.id, null);
    if (voiceRef.current.recordingDraft?.contextKey?.startsWith(current.id + ':') || voiceRef.current.hasUnuploadedRecording) voiceRef.current.discardRecording();
  }, [drafts]);

  // ---------- polling of the open session ----------
  useEffect(() => {
    if (!session || (session.status !== 'analysing' && !session.processing)) return;
    const sessionId = session.id;
    let disposed = false;
    let fetching = false;
    const poll = async () => {
      if (fetching || disposed || document.hidden) return;
      fetching = true;
      try {
        const next = await request<Session>(`sessions/${sessionId}`);
        if (disposed || sessionRef.current?.id !== sessionId) return;
        setSession(next);
        if (next.status !== 'analysing' && !next.processing) {
          void refreshState();
          if (!navRef.current.sessionOpenRef.current && next.status === 'review') {
            feedbackRef.current.notice('Разбор готов.', { label: 'Открыть', run: () => navRef.current.openSession() });
          }
        }
      } catch (error) { if (!disposed && sessionRef.current?.id === sessionId) setSessionError(messageOf(error, 'Не удалось обновить разговор.')); }
      finally { fetching = false; }
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => { disposed = true; clearInterval(timer); };
  }, [session?.id, session?.status, session?.processing?.stage, refreshState]);

  // Keep the open session in sync with background refreshes (e.g. finished on the phone).
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || !data.state) return;
    const fresh = data.state.sessions.find(item => item.id === current.id);
    if (fresh && fresh.updatedAt > current.updatedAt) setSession(fresh);
  }, [data.state]);

  // ---------- autoplay: once per partner turn (invariant 6) ----------
  const lastTurnId = session?.turns.at(-1)?.id;
  useEffect(() => {
    const current = sessionRef.current;
    const live = voiceRef.current;
    const turn = current?.turns.at(-1);
    if (!navigation.sessionOpen || !data.status?.audio.configured || !current || current.processing || current.analysis
      || ['reading', 'writing'].includes(current.lesson.activity || '')
      || turn?.role !== 'assistant' || !['idle', 'paused'].includes(live.state)
      || live.hasUnuploadedRecording || drafts.draftsRef.current[current.id]?.audioFile) return;
    const key = current.id + ':' + turn.id;
    if (lastAutoplay.current === key) return;
    lastAutoplay.current = key;
    void live.speak(current, turn, { autoplay: true });
  }, [navigation.sessionOpen, session?.id, lastTurnId, session?.processing?.stage, data.status?.audio.configured, voice.state, voice.hasUnuploadedRecording, drafts.draftsRef]);

  // Desktop: hiding the window stops capture/playback, and says so (audit C-10).
  useEffect(() => {
    const onHide = () => {
      if (!window.ratmirDesktop || !document.hidden) return;
      const wasRecording = voiceRef.current.state === 'listening';
      voiceRef.current.stop();
      if (wasRecording) feedbackRef.current.notice('Запись остановлена, потому что окно скрылось. Она сохранена — можно распознать.');
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  // An unsent recording exists only in this window: guard reload/close (audit U-07).
  useEffect(() => {
    if (!voice.hasUnuploadedRecording) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [voice.hasUnuploadedRecording]);

  // ---------- actions ----------
  const recordingBlocks = () => recordingBusy(voiceRef.current.state) || voiceRef.current.hasUnuploadedRecording;

  const open = useCallback((value: Session, from?: TabId) => {
    if (sessionRef.current?.id !== value.id && busy) { feedbackRef.current.notice('Подожди: собеседник ещё отвечает в текущем занятии.'); return; }
    if (sessionRef.current?.id !== value.id && recordingBlocks()) {
      feedbackRef.current.error('Сначала закончи текущую запись. Она останется в своём разговоре.', { label: 'К записи', run: () => navRef.current.openSession() });
      return;
    }
    const same = sessionRef.current?.id === value.id;
    voiceRef.current.stop(); lastAutoplay.current = same ? lastAutoplay.current : null;
    setSession(same && sessionRef.current && sessionRef.current.updatedAt > value.updatedAt ? sessionRef.current : value);
    if (!same) resetSessionView(value);
    voiceRef.current.setState('idle');
    navRef.current.openSession(from);
  }, [busy, resetSessionView]);

  const start = useCallback(async (options: StartOptions = {}) => {
    if (busy || lessonStart.current?.pending) return;
    if (recordingBlocks()) {
      feedbackRef.current.error('Сначала закончи запись и распознавание. Потом можно начать новый разговор.', sessionRef.current ? { label: 'К записи', run: () => navRef.current.openSession() } : undefined);
      return;
    }
    const mode: Mode = options.mode ?? 'learning';
    // A phrase round is planned from the saved phrases alone (PASS-0.5.3 §1.5): no family, topic or drill goes with it.
    const payload = options.phraseRound
      ? { mode, phraseRound: true as const, minutes: options.minutes }
      : { mode, familyId: options.familyId, context: options.context, topic: options.topic?.trim() || undefined, minutes: options.minutes, drillId: options.drillId };
    const optionsKey = JSON.stringify(payload);
    const attempt = lessonStart.current?.optionsKey === optionsKey ? lessonStart.current : { optionsKey, requestId: crypto.randomUUID(), pending: false };
    lessonStart.current = attempt;
    attempt.pending = true;
    const tabAtStart = navRef.current.tabRef.current;
    const label = options.phraseRound ? 'Собираю твои фразы' : options.drillId ? 'Открываю тренировку' : 'Готовлю занятие';
    setStarting({ label, since: Date.now() });
    voiceRef.current.stop();
    try {
      const result = await action(label, () => request<Session>('sessions', { ...payload, intent: 'new', requestId: attempt.requestId }), { scope: 'global' });
      if (!result) return;
      lessonStart.current = null; lastAutoplay.current = null;
      setSession(result); resetSessionView(result); voiceRef.current.setState('idle');
      void refreshState();
      // Do not teleport if he moved on while the lesson was being prepared (audit C-06).
      if (navRef.current.tabRef.current !== tabAtStart && !navRef.current.sessionOpenRef.current) {
        feedbackRef.current.notice('Занятие готово.', { label: 'Открыть', run: () => navRef.current.openSession(options.from) });
      } else navRef.current.openSession(options.from ?? tabAtStart);
    } finally { attempt.pending = false; setStarting(null); }
  }, [action, busy, refreshState, resetSessionView]);

  /** «Повторить» in «Мои фразы» (Practice, Today, the phrases sheet): a phrase round, «С опорами» by default. A 409 («Сейчас
   *  нечего повторять…») arrives as the usual error toast. */
  const startPhraseRound = useCallback((mode: Mode = 'learning', from?: TabId) => { void start({ phraseRound: true, mode, from }); }, [start]);

  const send = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current; if (!current) return false;
    const draft = drafts.draftsRef.current[current.id];
    if (!draft || draft.intent !== 'message' || !draft.text.trim()) return false;
    const text = draft.text.trim();
    const packet: SentPacket = lastSent.current?.sessionId === current.id && lastSent.current.text === text && lastSent.current.audioFile === draft.audioFile
      ? lastSent.current
      : { sessionId: current.id, id: draft.id, text, source: draft.audioFile ? 'audio' : 'text', audioFile: draft.audioFile, originalTranscript: draft.originalTranscript };
    lastSent.current = packet;
    // Support is per line: the partner line he answers counts as read only if its text was on screen at any point
    // (revealed, or voice unavailable / failed). The server marks just that line. A reading/writing task prompt is
    // not partner speech (same rule as the iPhone client).
    const heard = current.turns.findLast(turn => turn.role === 'assistant');
    const textVisible = !current.baseline && !!heard && !['reading', 'writing'].includes(current.lesson.activity || '')
      && (voiceUnavailableRef.current || voiceRef.current.speechFailedTurnId === heard.id || partnerTextRef.current.seen.has(heard.id));
    const result = await action('Собеседник отвечает', async () => {
      const { sessionId: ignored, ...body } = packet;
      void ignored;
      try { return await request<Session>(`sessions/${current.id}/message`, { ...body, textVisible }); }
      catch (error) {
        const saved = await request<Session>(`sessions/${current.id}`).catch(() => null);
        if (saved?.turns.some(turn => turn.role === 'user' && turn.id === packet.id)) {
          drafts.save(current.id, null);
          if (voiceRef.current.recordingDraft?.contextKey === current.id + ':message') voiceRef.current.markSubmitted();
        }
        if (saved && sessionRef.current?.id === current.id) setSession(saved);
        throw error;
      }
    });
    if (!result) return false;
    drafts.save(current.id, null);
    if (voiceRef.current.recordingDraft?.contextKey === current.id + ':message') voiceRef.current.markSubmitted();
    if (sessionRef.current?.id === current.id) { setSession(result); setHintText(''); setHintLevel(0); lastSent.current = null; }
    void refreshState();
    return true;
  }, [action, refreshState, drafts]);

  const resend = useCallback(() => {
    const current = sessionRef.current; const last = current?.turns.at(-1);
    if (!current || last?.role !== 'user') return;
    lastSent.current = { sessionId: current.id, id: last.id, text: last.text, source: last.source, audioFile: last.audioFile, originalTranscript: last.originalTranscript };
    drafts.save(current.id, { text: last.text, intent: 'message', id: last.id, audioFile: last.audioFile, originalTranscript: last.originalTranscript });
    void send();
  }, [drafts, send]);

  const sessionAction = useCallback(async (name: SessionActionName, payload: Record<string, unknown> = {}, origin?: Element | null): Promise<Session | undefined> => {
    const current = sessionRef.current;
    if (!current || busy || actionLock.current) return undefined;
    actionLock.current = true;
    try {
      const sessionId = current.id;
      if (recordingBlocks()) { reportSessionError('Сначала закончи запись: распознай её или удали.'); return undefined; }
      const draft = drafts.draftsRef.current[sessionId];
      if ((name === 'finish' || name === 'complete') && draft?.text.trim() && draft.intent !== 'pushback') {
        reportSessionError('Есть неотправленный черновик. Отправь его или удали.'); return undefined;
      }
      if (name !== 'retry') voiceRef.current.stop();
      const body = name === 'retry'
        ? { text: draft?.intent === 'retry' ? draft.text.trim() : '', id: draft?.intent === 'retry' ? draft.id : crypto.randomUUID(),
          audioFile: draft?.intent === 'retry' ? draft.audioFile : undefined, originalTranscript: draft?.intent === 'retry' ? draft.originalTranscript : undefined }
        : payload;
      if (name === 'retry' && !body.text) return undefined;
      const before = progressSnapshot(appStateRef.current?.progression);
      const label = name === 'finish' || name === 'reanalyse' ? 'Готовлю разбор' : name === 'retry' ? 'Сравниваю твою попытку' : name === 'edit' ? 'Пересчитываю разбор' : 'Сохраняю результат';
      const next = await action(label, () => request<Session>(`sessions/${sessionId}/${name}`, body));
      if (!next) return undefined;
      if (name === 'retry') {
        drafts.save(sessionId, null);
        if (voiceRef.current.recordingDraft?.contextKey === sessionId + ':retry') voiceRef.current.markSubmitted();
        const latest = next.retries.at(-1);
        if (latest?.improved === true) {
          setGlowRetryId(latest.id ?? String(next.retries.length - 1));
          feedbackRef.current.celebrate([improvedCelebration()], origin);
        }
      }
      if (sessionRef.current?.id === sessionId) setSession(next);
      voiceRef.current.setState('idle');
      const deferred = name === 'complete' && payload.deferRetry === true;
      const fresh = await refreshState();
      if (name === 'complete' && next.status === 'completed' && current.status !== 'completed') {
        if (deferred) {
          feedbackRef.current.notice('Попытка отложена. Занятие ждёт в «Незаконченных занятиях» на главной.');
          if (sessionRef.current?.id === sessionId) navRef.current.go('today');
        } else {
          setLastCompletedId(sessionId);
          feedbackRef.current.celebrate(diffProgress(before, fresh?.progression), origin);
          // The outcome card sits at the top of the lesson: bring it into view.
          if (sessionRef.current?.id === sessionId && navRef.current.sessionOpenRef.current) {
            window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          }
        }
      }
      return next;
    } finally { actionLock.current = false; }
  }, [action, busy, appStateRef, refreshState, drafts, reportSessionError]);

  const finishWithDraft = useCallback(async (choice: 'send' | 'discard') => {
    if (choice === 'send') { const ok = await send(); if (!ok) return; }
    else discardDraft();
    await sessionAction('finish');
  }, [discardDraft, send, sessionAction]);

  const hint = useCallback(async (level: 1 | 2 | 3) => {
    const current = sessionRef.current; if (!current) return;
    const result = await action('Подбираю подсказку', () => request<{ text: string }>(`sessions/${current.id}/hint`, { level }));
    if (result) { setHintText(result.text); setHintLevel(level); }
  }, [action]);

  // ---------- pushback round (CONTRACT §3): optional, never blocks completion ----------
  const pushbackSpeech = useCallback(async (retryId: string): Promise<string | null> => {
    const current = sessionRef.current; if (!current) return null;
    try { return (await request<{ file: string }>(`sessions/${current.id}/pushback-speech`, { retryId })).file || null; }
    catch (error) { reportSessionError(messageOf(error, 'Озвучка возражения недоступна. Прочитай его текстом.')); return null; }
  }, [reportSessionError]);
  const pushback = useCallback(async (retryId: string, origin?: Element | null) => {
    const current = sessionRef.current; if (!current || busy) return;
    if (recordingBlocks()) { reportSessionError('Сначала закончи запись: распознай её или удали.'); return; }
    const draft = drafts.draftsRef.current[current.id];
    if (!draft || draft.intent !== 'pushback' || draft.retryId !== retryId || !draft.text.trim()) return;
    const next = await action('Собеседник слушает ответ', () => request<Session>(`sessions/${current.id}/pushback`, {
      retryId, text: draft.text.trim(), ...(draft.audioFile ? { audioFile: draft.audioFile, originalTranscript: draft.originalTranscript } : {}),
    }));
    if (!next) return;
    drafts.save(current.id, null);
    if (voiceRef.current.recordingDraft?.contextKey?.startsWith(current.id + ':pushback')) voiceRef.current.markSubmitted();
    if (sessionRef.current?.id === current.id) setSession(next);
    const held = next.retries.find(retry => (retry.id ?? '') === retryId)?.pushback?.held;
    if (held) feedbackRef.current.celebrate([improvedCelebration()], origin);
    void refreshState();
  }, [action, busy, refreshState, drafts, reportSessionError]);

  const deleteSession = useCallback(async (id: string) => {
    const done = await action('Удаляю занятие', async () => { await request('sessions/' + id, undefined, 'DELETE'); return true; }, { scope: 'global' });
    if (!done) return false;
    drafts.save(id, null);
    if (sessionRef.current?.id === id) { voiceRef.current.discardRecording(); setSession(null); navRef.current.closeSession(); }
    await refreshState();
    return true;
  }, [action, refreshState, drafts]);

  const resetAll = useCallback(async () => {
    const next = await action('Удаляю историю', () => request<NonNullable<AppData['state']>>('reset', { confirmation: 'DELETE' }), { scope: 'global' });
    if (!next) return false;
    drafts.clearAll(); lastSent.current = null; voiceRef.current.discardRecording(); setSession(null);
    setAppState(next);
    feedbackRef.current.notice('История удалена. Можно начать заново с теста уровня.');
    return true;
  }, [action, setAppState, drafts]);

  const setComfort = useCallback((value: number) => {
    const current = sessionRef.current; if (!current) return;
    setComfortMap(previous => ({ ...previous, [current.id]: value }));
  }, []);

  // Memoised: the object (and with it the app context) changes only when lesson state does. Live caption deltas and
  // microphone levels never pass through here — they live in the voice stores (MOTION-PASS-0.5.2 §5).
  const sessionComfort = session ? comfort[session.id] : undefined;
  return useMemo(() => ({
    voice, session, setSession, busy, busySince, starting, sessionError, setSessionError,
    hintText, hintLevel, comfort: sessionComfort, setComfort, glowRetryId, lastCompletedId,
    voiceUnavailable, partnerTextShown, partnerTextForced, revealPartnerText, hidePartnerText,
    drafts, draftFor, changeDraft, discardDraft,
    open, start, startPhraseRound, send, resend, sessionAction, finishWithDraft, hint, pushbackSpeech, pushback, deleteSession, resetAll,
  }), [voice, session, busy, busySince, starting, sessionError, hintText, hintLevel, sessionComfort, setComfort, glowRetryId, lastCompletedId,
    voiceUnavailable, partnerTextShown, partnerTextForced, revealPartnerText, hidePartnerText, drafts, draftFor, changeDraft, discardDraft,
    open, start, startPhraseRound, send, resend, sessionAction, finishWithDraft, hint, pushbackSpeech, pushback, deleteSession, resetAll]);
}
export type SessionController = ReturnType<typeof useSessionController>;
