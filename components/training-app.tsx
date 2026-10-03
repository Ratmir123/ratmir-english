'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StartupWelcome } from './startup-welcome';
import { QuickCoach } from './quick-coach';
import {
  ArrowRightIcon as ArrowRight, ArrowUpRightIcon as ArrowUpRight,
  WaveformIcon as AudioLines, BookOpenIcon as BookOpen, CheckIcon as Check,
  CaretRightIcon as ChevronRight, QuestionIcon as CircleHelp,
  DownloadSimpleIcon as Download, EarIcon as Ear, GraduationCapIcon as GraduationCap,
  ClockCounterClockwiseIcon as History, HouseIcon as Home, LightbulbIcon as Lightbulb,
  MicrophoneIcon as Mic, PlayIcon as Play,
  ArrowsClockwiseIcon as RefreshCw, PaperPlaneRightIcon as Send, GearIcon as Settings,
  ShieldCheckIcon as ShieldCheck, SparkleIcon as Sparkles, SquareIcon as Square,
  TargetIcon as Target, TrashIcon as Trash2, TrendUpIcon as TrendingUp, XIcon as X,
} from '@phosphor-icons/react';
import { SKILLS, type AppState, type BaselineStepId, type BrainStatus, type Context, type LearningTrackId, type Mode, type OnboardingState, type PracticeResult, type Profile, type ProgressionState, type Session, type SubscriptionUsage } from '@/lib/types';
import { FAMILIES, LEARNING_ACTIVITIES, LEARNING_TRACKS, type ScenarioFamily } from '@/lib/training';
import { VoiceOrb } from './voice-orb';
import { useVoice, type RecordingDraft } from './use-voice';
import { SubscriptionLimits } from './subscription-limits';
import { BaselineProfile, OnboardingFlow } from './onboarding-flow';
import { PracticeModeSwitch as ModeSwitch } from './practice-mode-switch';
import { useContentEntrance, useHomeStagger, useInputModality, useNavigationHighlight } from './use-interface-motion';
import motionStyles from './training-app.module.css';
import { Achievements, CurriculumOverview, EvidenceCoverage, PracticeLevel, SessionOutcome } from './learning-path';
import { SpeechTimingPanel } from './speech-timing';
import { LiveCaptions } from './live-captions';
import { PracticeTrackSwitch } from './practice-track-switch';
import { ReminderSettings } from './reminder-settings';
import type { AchievementTarget } from '@/lib/achievement-targets';

type Tab = 'today' | 'practice' | 'progress' | 'history' | 'settings' | 'session';
type Status = { brain: BrainStatus; hosting?: 'local' | 'server'; audio: { configured: boolean; model: string } };
const NAV = [{ id: 'today', name: 'Сегодня', icon: Home }, { id: 'practice', name: 'Практика', icon: AudioLines }, { id: 'progress', name: 'Прогресс', icon: TrendingUp }, { id: 'history', name: 'История', icon: History }] as const;
const contextNames = { work: 'Работа', life: 'Обычная жизнь', relocation: 'Релокация' };
const stateNames = { unknown: 'Не проверено', supported: 'С опорой', provisional: 'Предварительно', independent: 'Самостоятельно', recheck: 'Перепроверим' };
const voiceNames = { idle: 'Готов к разговору', listening: 'Слушаю тебя', transcribing: 'Распознаю речь', thinking: 'Обдумываю ответ', speaking: 'Собеседник говорит', paused: 'Разговор на паузе' };
type SessionDraft = { text: string; intent: 'message' | 'retry'; id: string; audioFile?: string; originalTranscript?: string };
const DRAFT_STORAGE = 'ratmir:session-drafts:v1';

function ElapsedTime({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span className="operation-time" aria-label="Прошло времени">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}

function PreparationPanel({ startedAt, stage }: { startedAt: number | null; stage: string }) {
  return <section className="preparation-panel" aria-label="Подготовка занятия">
    <VoiceOrb state="thinking" statusDescription="Готовим твой разговор" />
    <div><span className="eyebrow">СЕЙЧАС</span><h2>{stage || 'Готовим твой разговор'}</h2>
      <p>Подбираем задачу по твоим ответам и последней практике. Когда она будет готова, можно начать.</p>
      <ElapsedTime startedAt={startedAt} />
    </div>
  </section>;
}
async function request<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await res.json(); if (!res.ok) throw Object.assign(new Error(data.error || 'Не удалось выполнить действие.'), { status: res.status });
  return data;
}
function date(value: string) { return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(value)); }

function SkillRows({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const skills = SKILLS.filter(skill => !compact || ['grammar', 'coherence', 'reciprocity', 'initiative'].includes(skill.id));
  return <div className={'skill-rows ' + (compact ? 'compact' : '')}>
    {(['language', 'dialogue'] as const).map(group => <section className="skill-group" key={group}>
      <h3 className="skill-group-label">{group === 'language' ? 'Английский' : 'Разговор'}</h3>
      {skills.filter(skill => skill.group === group).map(skill => {
        const value = state.skills.find(item => item.id === skill.id);
        const label = skill.id === 'clarity' ? 'Акустическая оценка пока недоступна' : stateNames[value?.state || 'unknown'];
        return <div className="skill-row" key={skill.id}>
          <div><span>{skill.label}</span><small>{label}</small></div>
          {skill.id === 'clarity' ? <p className="skill-limitation">По расшифровке нельзя надёжно оценить произношение. Этот навык пока не получает баллы.</p> : <div className="skill-steps" aria-label={skill.label + ': ' + label}>
            <i className={value?.state === 'supported' || value?.independentSuccesses ? 'lit' : ''} title="Опора или успешная попытка" />
            <i className={value?.state === 'independent' ? 'lit' : ''} title="Самостоятельно" />
            <i className={value?.transfer ? 'lit' : ''} title="Новый контекст" />
            <i className={value?.retention ? 'lit' : ''} title="Проверено спустя время" />
          </div>}
        </div>;
      })}
    </section>)}
  </div>;
}

function ScenarioPreview({ family, mode, minutes, topic, busy, onStart, inline = false }: {
  family?: ScenarioFamily; mode: Mode; minutes: number; topic: string; busy: string;
  onStart: (family: ScenarioFamily) => void; inline?: boolean;
}) {
  const previewRef = useContentEntrance<HTMLDivElement>(family?.id || 'empty', 4, 180, inline);
  return <aside className={'scenario-preview ' + (inline ? 'scenario-preview-inline' : 'scenario-preview-desktop') + (!family ? ' scenario-preview-empty' : '')}><div ref={previewRef} className="scenario-preview-content">
    {family ? <>
      <span className="eyebrow">{family.track === 'ielts-foundation' ? 'ОСНОВА ДЛЯ IELTS · ' + LEARNING_ACTIVITIES.find(activity => activity.id === family.activity)?.title : contextNames[family.context]}</span>
      <h2>{family.title}</h2><p>{family.description}</p>
      <div className="scenario-skills"><span className="caption">Что потренируем</span>{family.skills.map(skill => <span className="quiet-tag" key={skill}>{SKILLS.find(item => item.id === skill)?.label}</span>)}</div>
      <div className="daily-controls"><span className="duration"><History size={16} /> {minutes} минут</span><span className="quiet-tag">{mode === 'call' ? 'Созвон' : 'С опорами'}</span></div>
      {topic.trim() && <p className="caption">Тема: {topic.trim()}</p>}
      <button className="button primary" disabled={!!busy} onClick={() => onStart(family)}>{busy || (['reading', 'writing'].includes(family.activity) ? 'Начать задание' : inline ? 'Начать разговор' : 'Начать этот разговор')} <ArrowRight size={18} /></button>
      <small className="daily-note">{family.activity === 'reading' ? 'Прочитаешь учебный текст и покажешь, что понял. Ответ можно написать.' : family.activity === 'writing' ? 'Напишешь короткий текст и переработаешь его по разбору. Микрофон не нужен.' : family.activity === 'listening' ? 'Услышанное пригодится в твоём ответе. Текст сначала скрыт.' : 'Сначала попробуешь сам. Потом разберём конкретные реплики.'}</small>
    </> : <>
      <span className="round-icon"><AudioLines size={25} /></span><h2>Какая ситуация тебе ближе?</h2>
      <p>Выбери её в списке. Здесь появятся цель разговора и навыки, которые он тренирует.</p>
      <span className="quiet-tag">Можно начать со своей темы</span>
    </>}
  </div></aside>;
}

function sessionStatus(value: Session) {
  if (value.retryDeferred) return 'Улучшенная попытка на потом';
  if (value.status === 'completed') return 'Завершено';
  if (value.status === 'analysing') return 'Готовится разбор';
  if (value.status === 'review') return 'Своя улучшенная попытка';
  if (value.status === 'error') return 'Можно повторить';
  return 'Можно продолжить';
}

function dayKey(value: Date | string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function TrainingApp() {
  useInputModality();
  const [state, setState] = useState<AppState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [subscriptionUsage, setSubscriptionUsage] = useState<SubscriptionUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const usageRequest = useRef<Promise<void> | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [startupVisible, setStartupVisible] = useState(false);
  const [homeEntry, setHomeEntry] = useState(0);
  const startupHandled = useRef(false);
  const [quickVisible, setQuickVisible] = useState(false);
  const [mode, setMode] = useState<Mode>('learning');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState('');
  const [busySince, setBusySince] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needLogin, setNeedLogin] = useState(false);
  const [code, setCode] = useState('');
  const [input, setInput] = useState('');
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const [hintText, setHintText] = useState('');
  const [transcript, setTranscript] = useState(false);
  const [textMode, setTextMode] = useState(true);
  const [topic, setTopic] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<LearningTrackId | 'all'>('all');
  const [rewardsRequested, setRewardsRequested] = useState(false);
  const [completionMoment, setCompletionMoment] = useState<{ sessionId: string; previousUnlocks: string[] } | null>(null);
  const [search, setSearch] = useState('');
  const [key, setKey] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reset, setReset] = useState('');
  const [deleting, setDeleting] = useState('');
  const [comfort, setComfort] = useState(3);
  const [editing, setEditing] = useState('');
  const [editText, setEditText] = useState('');
  const lastSent = useRef<{ sessionId: string; id: string; text: string; source: 'text' | 'audio'; audioFile?: string; originalTranscript?: string } | null>(null);
  const lessonStart = useRef<{ optionsKey: string; requestId: string; pending: boolean } | null>(null);
  const lastAutoplay = useRef<string | null>(null);
  const sessionActionLock = useRef(false);
  const tabRef = useRef(tab); tabRef.current = tab;
  const screenRef = useContentEntrance<HTMLDivElement>(tab);
  useHomeStagger(screenRef, homeEntry);
  const desktopNavigation = useNavigationHighlight(tab);
  const mobileNavigation = useNavigationHighlight(tab);
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [tab]);
  useEffect(() => {
    if (!rewardsRequested || tab !== 'progress') return;
    const target = document.getElementById('practice-achievements');
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: document.documentElement.dataset.input === 'keyboard'
      || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setRewardsRequested(false);
  }, [rewardsRequested, tab]);
  useEffect(() => {
    const entry = new URLSearchParams(window.location.search).get('entry');
    setQuickVisible(entry === 'quick');
  }, []);
  useLayoutEffect(() => {
    if (!state || startupHandled.current) return;
    startupHandled.current = true;
    const entry = new URLSearchParams(window.location.search).get('entry');
    const ordinaryHome = entry !== 'quick' && !quickVisible && tab === 'today' && !busy && !starting
      && (!state.onboarding || state.onboarding.status === 'ready');
    if (ordinaryHome) setStartupVisible(true);
  }, [state, quickVisible, tab, busy, starting]);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(DRAFT_STORAGE) || '{}');
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
      const valid = Object.fromEntries(Object.entries(stored).filter(([id, draft]) => {
        const value = draft as Partial<SessionDraft> | null;
        return /^[\da-f-]{36}$/i.test(id) && value && typeof value.text === 'string' && value.text.length <= 7000
          && typeof value.id === 'string' && (value.intent === 'message' || value.intent === 'retry')
          && (value.audioFile === undefined || typeof value.audioFile === 'string')
          && (value.originalTranscript === undefined || typeof value.originalTranscript === 'string');
      })) as Record<string, SessionDraft>;
      draftsRef.current = valid; setDrafts(valid);
    } catch { /* A private draft is optional when browser storage is unavailable. */ }
  }, []);
  function saveDraft(sessionId: string, value: SessionDraft | null) {
    const next = { ...draftsRef.current };
    if (value) next[sessionId] = value; else delete next[sessionId];
    draftsRef.current = next; setDrafts(next);
    try { localStorage.setItem(DRAFT_STORAGE, JSON.stringify(next)); } catch { /* Keep the in-memory draft. */ }
  }
  function changeInput(text: string) {
    setInput(text);
    const current = sessionRef.current; if (!current) return;
    const previous = draftsRef.current[current.id];
    saveDraft(current.id, {
      ...previous, text, id: previous?.id || crypto.randomUUID(),
      intent: previous?.intent || (current.analysis && (current.status === 'review' || current.retryDeferred) ? 'retry' : 'message'),
    });
  }
  function restoreDraft(value: Session) { setInput(draftsRef.current[value.id]?.text || ''); }
  function clearDrafts() {
    draftsRef.current = {}; setDrafts({}); setInput(''); lastSent.current = null;
    try { localStorage.removeItem(DRAFT_STORAGE); } catch { /* In-memory drafts are still cleared. */ }
    voice.discardRecording();
  }
  const sessionRef = useRef(session); sessionRef.current = session;
  const textModeRef = useRef(textMode); textModeRef.current = textMode;
  const transcriptRef = useRef(transcript); transcriptRef.current = transcript;
  const action = useCallback(async <T,>(name: string, task: () => Promise<T>, propagate = false): Promise<T | undefined> => {
    setBusy(name); setBusySince(Date.now()); setError(''); setNotice('');
    try { return await task(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); if (propagate) throw e; } finally { setBusy(''); setBusySince(null); }
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await request<AppState>('state'); setState(next); setProfile(previous => previous || next.profile); setNeedLogin(false);
    } catch (e) { if ((e as { status?: number }).status === 401) setNeedLogin(true); else setError(e instanceof Error ? e.message : 'Не удалось загрузить историю.'); }
  }, []);
  const refreshStatus = useCallback(async () => {
    try { const next = await request<Status>('status'); setStatus(next); } catch { /* state route owns auth/error display */ }
  }, []);
  const refreshUsage = useCallback((force = false) => {
    if (usageRequest.current) return usageRequest.current;
    setUsageLoading(true);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 45_000);
    const work = (async () => {
      try { setSubscriptionUsage(await request<SubscriptionUsage>('usage' + (force ? '?refresh=1' : ''), undefined, 'GET', controller.signal)); }
      catch (error) {
        if ((error as { status?: number }).status === 401) {
          setSubscriptionUsage(null); setNeedLogin(true);
        } else setSubscriptionUsage(previous => previous
          ? { ...previous, stale: true, error: 'Не удалось обновить лимиты. Последние данные сохранены.' }
          : { source: 'codex', scope: 'unknown', available: false, checkedAt: null, stale: true, windows: [], plan: null, error: 'Лимиты временно недоступны. Попробуй обновить.' });
      } finally { clearTimeout(deadline); usageRequest.current = null; setUsageLoading(false); }
    })();
    usageRequest.current = work;
    return work;
  }, []);
  useEffect(() => { void refresh(); void refreshStatus(); }, [refresh, refreshStatus]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') void refreshUsage(); };
    update();
    const timer = setInterval(update, 60_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [refreshUsage]);
  useEffect(() => {
    if (!session || (session.status !== 'analysing' && !session.processing)) return;
    const sessionId = session.id;
    let disposed = false, fetching = false;
    const poll = async () => {
      if (fetching || disposed) return;
      fetching = true;
      try {
        const next = await request<Session>(`sessions/${sessionId}`);
        if (disposed || sessionRef.current?.id !== sessionId) return;
        setSession(next);
        if (next.status !== 'analysing' && !next.processing) void refresh();
      } catch (e) { if (!disposed && sessionRef.current?.id === sessionId) setError(e instanceof Error ? e.message : 'Не удалось обновить разговор.'); }
      finally { fetching = false; }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, [session?.id, session?.status, session?.processing?.stage, refresh]);

  async function send(text: string, audioFile?: string, propagate = false, originalTranscript?: string) {
    const current = sessionRef.current; if (!current || !text.trim()) return;
    const draft = draftsRef.current[current.id];
    if (!audioFile && draft?.intent === 'message') { audioFile = draft.audioFile; originalTranscript = draft.originalTranscript; }
    const packet = lastSent.current?.sessionId === current.id && lastSent.current.text === text.trim() && lastSent.current.audioFile === audioFile
      ? lastSent.current : { sessionId: current.id, id: draft?.id || crypto.randomUUID(), text: text.trim(), source: audioFile ? 'audio' as const : 'text' as const, audioFile, originalTranscript };
    lastSent.current = packet;
    const result = await action('Ответ собеседника', async () => {
      const { sessionId: ignoredSessionId, ...payload } = packet;
      void ignoredSessionId;
      try { return await request<Session>(`sessions/${current.id}/message`, { ...payload, textVisible: current.baseline ? false : textModeRef.current || transcriptRef.current }); }
      catch (error) {
        const saved = await request<Session>(`sessions/${current.id}`).catch(() => null);
        if (saved?.turns.some(turn => turn.role === 'user' && turn.id === packet.id)) {
          saveDraft(current.id, null);
          if (voice.recordingDraft?.contextKey === current.id + ':message') voice.markSubmitted();
          if (sessionRef.current?.id === current.id) setInput('');
        }
        if (saved && sessionRef.current?.id === current.id) setSession(saved);
        throw error;
      }
    }, propagate);
    if (result) {
      saveDraft(current.id, null);
      if (voice.recordingDraft?.contextKey === current.id + ':message') voice.markSubmitted();
      if (sessionRef.current?.id !== current.id) { void refresh(); return; }
      setSession(result); setInput(''); setHintText(''); lastSent.current = null; void refresh();
    }
  }
  const voice = useVoice(async (text, audioFile, recording: RecordingDraft) => {
    const [sessionId, intent] = (recording.contextKey || '').split(':');
    if (!sessionId || (intent !== 'message' && intent !== 'retry')) { setError('Не удалось связать запись с разговором. Исходная запись сохранена.'); return; }
    saveDraft(sessionId, { text, audioFile, originalTranscript: recording.originalTranscript, intent, id: crypto.randomUUID() });
    if (sessionRef.current?.id === sessionId) setInput(text);
    setNotice('Запись готова. Проверь расшифровку и отправь, когда будешь готов.');
  }, setError);
  useEffect(() => {
    const current = sessionRef.current;
    const turn = current?.turns.at(-1);
    if (tab !== 'session' || !status?.audio.configured || !current || current.processing || current.analysis
      || ['reading', 'writing'].includes(current.lesson.activity || '')
      || turn?.role !== 'assistant' || !['idle', 'paused'].includes(voice.state)
      || voice.hasUnuploadedRecording || draftsRef.current[current.id]?.audioFile) return;
    const key = current.id + ':' + turn.id;
    if (lastAutoplay.current === key) return;
    lastAutoplay.current = key;
    void voice.speak(current, turn, { autoplay: true });
  }, [tab, session?.id, session?.turns.at(-1)?.id, session?.processing?.stage, status?.audio.configured, voice.state, voice.hasUnuploadedRecording, voice.speak]);
  useEffect(() => {
    const pauseHiddenWindow = () => {
      if (window.ratmirDesktop && document.hidden) voice.stop();
    };
    document.addEventListener('visibilitychange', pauseHiddenWindow);
    return () => document.removeEventListener('visibilitychange', pauseHiddenWindow);
  }, [voice.stop]);
  function dismissStartup() {
    startupHandled.current = true;
    setStartupVisible(false);
    setQuickVisible(false);
    const address = new URL(window.location.href);
    if (address.searchParams.has('entry')) {
      address.searchParams.delete('entry');
      window.history.replaceState(window.history.state, '', address.pathname + address.search + address.hash);
    }
  }
  function launchQuick() {
    voice.stop();
    if (window.ratmirDesktop) void window.ratmirDesktop.openQuick().catch(() => setError('Не удалось открыть быстрый разбор.'));
    else setQuickVisible(true);
  }
  async function completeIntro(russianControl: string) {
    const next = await action('Сохраняем точку сравнения', () => request<OnboardingState>('onboarding/intro', { confirmed: true, russianControl }));
    if (next) { setState(previous => previous ? { ...previous, onboarding: next } : previous); dismissStartup(); await refresh(); }
  }
  async function buildBaselineReport() {
    if (busy) return;
    const next = await action('Собираем стартовый профиль', () => request<OnboardingState>('onboarding/report', {}));
    if (next) { setState(previous => previous ? { ...previous, onboarding: next } : previous); await refresh(); }
  }
  async function start(familyId?: string, context?: Context, minutes?: number, baselineStepId?: BaselineStepId) {
    if (busy || lessonStart.current?.pending) return;
    if (!baselineStepId && state?.onboarding && state.onboarding.status !== 'ready') { dismissStartup(); setTab('today'); return; }
    if (voice.state === 'listening' || voice.state === 'transcribing' || voice.hasUnuploadedRecording) {
      setError('Сначала закончи запись и распознавание. Потом можно начать отдельный разговор.');
      if (session) setTab('session'); return;
    }
    const family = FAMILIES.find(value => value.id === familyId);
    const options = { mode: baselineStepId ? 'call' as const : family?.track === 'ielts-foundation' ? family.preferredMode : mode, familyId, context, topic, minutes, baselineStepId };
    const optionsKey = JSON.stringify(options);
    const attempt = lessonStart.current?.optionsKey === optionsKey
      ? lessonStart.current
      : { optionsKey, requestId: crypto.randomUUID(), pending: false };
    lessonStart.current = attempt;
    attempt.pending = true;
    setStarting(true);
    voice.stop();
    try {
      const result = await action('Готовлю твоё занятие', async () => request<Session>('sessions', { ...options, intent: 'new', requestId: attempt.requestId }));
      if (result) { lessonStart.current = null; lastAutoplay.current = null; dismissStartup(); setSession(result); setTab('session'); restoreDraft(result); setHintText(''); setTranscript(result.mode === 'learning' || !status?.audio.configured); setTextMode(result.mode === 'learning' || !status?.audio.configured); voice.setState('idle'); void refresh(); }
    } finally { attempt.pending = false; setStarting(false); }
  }
  function open(value: Session) {
    if (busy) return;
    if (sessionRef.current?.id !== value.id && (voice.state === 'listening' || voice.state === 'transcribing' || voice.hasUnuploadedRecording)) {
      setError('Сначала закончи текущую запись. Она останется в своём разговоре.'); return;
    }
    setCompletionMoment(null); voice.stop(); lastAutoplay.current = null; setSession(value); setTab('session'); restoreDraft(value); setHintText('');
    setTranscript(value.mode === 'learning' || !status?.audio.configured); setTextMode(value.mode === 'learning' || !status?.audio.configured); setError(''); voice.setState('idle');
  }
  async function sessionAction(name: string, data: unknown = {}) {
    if (!session || busy || sessionActionLock.current) return;
    sessionActionLock.current = true;
    try {
    const sessionId = session.id;
    if (voice.state === 'listening' || voice.state === 'transcribing' || voice.hasUnuploadedRecording) {
      setError('Сначала закончи запись. Можно распознать её повторно или удалить явно.'); return;
    }
    if ((name === 'finish' || name === 'complete') && draftsRef.current[sessionId]?.text.trim()) {
      setError('У тебя есть неотправленный черновик. Отправь его или удали перед завершением.'); return;
    }
    if (name === 'finish' || name === 'complete' || name === 'edit') voice.stop();
    const draft = draftsRef.current[sessionId];
    const payload = name === 'retry' ? { ...(data as Record<string, unknown>), id: draft?.id || crypto.randomUUID(),
      audioFile: draft?.intent === 'retry' ? draft.audioFile : undefined, originalTranscript: draft?.intent === 'retry' ? draft.originalTranscript : undefined } : data;
    const next = await action(name === 'finish' ? 'Готовлю разбор' : name === 'retry' ? 'Сравниваем твою попытку' : 'Сохраняю результат', () => request<Session>(`sessions/${sessionId}/${name}`, payload));
    if (next) {
      const deferHome = name === 'complete' && (data as { deferRetry?: boolean }).deferRetry === true && next.status === 'completed';
      if (name === 'complete' && next.status === 'completed' && session.status !== 'completed') {
        setCompletionMoment(deferHome ? null : { sessionId: next.id, previousUnlocks: state?.progression?.achievements.filter(item => item.unlocked).map(item => item.id) || [] });
        if (!deferHome && sessionRef.current?.id === sessionId && tabRef.current === 'session') window.scrollTo({ top: 0, behavior: 'auto' });
      }
      if (name === 'retry') { saveDraft(sessionId, null); if (voice.recordingDraft?.contextKey === sessionId + ':retry') voice.markSubmitted(); }
      if (sessionRef.current?.id === sessionId) { setSession(next); if (name === 'retry') setInput(''); }
      if (deferHome && sessionRef.current?.id === sessionId && tabRef.current === 'session') navigation('today');
      void refresh();
    }
    } finally { sessionActionLock.current = false; }
  }
  async function showTranscript() {
    if (!session) return;
    const next = await action('Показываю текст', () => request<Session>(`sessions/${session.id}/show-text`, {}));
    if (next) { setSession(next); setTranscript(true); }
  }
  function resend() {
    if (!session) return;
    const last = session?.turns.at(-1); if (last?.role !== 'user') return;
    lastSent.current = { sessionId: session.id, id: last.id, text: last.text, source: last.source, audioFile: last.audioFile, originalTranscript: last.originalTranscript };
    void send(last.text, last.audioFile, false, last.originalTranscript);
  }
  const active = state?.sessions.find(s => (!s.baseline || state.onboarding?.status !== 'ready') && (s.status === 'active' || s.status === 'analysing' || s.status === 'review' || s.retryDeferred));
  const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(new Date());
  const pending = !!busy;
  const navigation = (next: Tab) => { voice.stop(); dismissStartup(); setTab(next); setError(''); };
  const chosenFamily = FAMILIES.find(family => family.id === selectedFamily);
  const chooseTrack = (track: LearningTrackId) => { setSelectedTrack(track); setSelectedFamily(''); navigation('practice'); };
  const targetAchievement = (target: AchievementTarget) => {
    if (!target.available || busy) return;
    if (target.sessionId) {
      const saved = state?.sessions.find(value => value.id === target.sessionId);
      if (saved) open(saved); else { setError('Это занятие пока не загружено. Обнови историю и попробуй снова.'); }
      return;
    }
    chooseTrack(target.track);
    if (target.activity) setSelectedFamily('ielts-' + target.activity);
  };
  const visibleSessions = state?.sessions.filter(value => (value.lesson.title + ' ' + value.lesson.goal).toLowerCase().includes(search.toLowerCase())) || [];
  const calibration = Math.min(3, state?.onboarding?.completedStages ?? state?.calibrationCompleted ?? 0);
  const independent = state?.skills.filter(skill => skill.state === 'independent').length || 0;
  const recommendation = state?.progression?.recommendation;

  if (needLogin) return (
    <main className="login-screen">
      <h2>Smooth English</h2>
      <h1>Твой английский. Твоя практика.</h1>
      <p>Введи личный код, который настроен на компьютере.</p>
      <form onSubmit={event => {
        event.preventDefault();
        void action('Подключаю', async () => { await request('login', { code }); setCode(''); await refresh(); await refreshStatus(); await refreshUsage(); });
      }}>
        <label htmlFor="access-code">Код доступа</label>
        <input id="access-code" type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required />
        <button className="button primary" disabled={pending}>Открыть тренинг <ArrowRight size={18} /></button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
      <small>Личный код защищает твой профиль, занятия и записи.</small>
    </main>
  );

  if (state && quickVisible) return <QuickCoach onDismiss={dismissStartup} />;

  return <><div className={`app-shell ${motionStyles.motionShell}`} inert={startupVisible} aria-hidden={startupVisible || undefined}>
    <aside className="sidebar">
      <a href="/" className="brand"><span>smooth<span>english</span></span></a>
      <div className="sidebar-caption">ТВОЯ ПРОГРАММА</div>
      <nav ref={desktopNavigation.nav} className="desktop-navigation" aria-label="Основная навигация">
        <span ref={desktopNavigation.highlight} className="navigation-highlight" aria-hidden="true" />
        {NAV.map(item => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => navigation(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
          <item.icon size={19} /><span>{item.name}</span>{item.id === 'today' && active && <span className="nav-dot" />}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={launchQuick}><BookOpen size={19} /><span>Быстрый разбор</span></button>
        <div className="engine-label">
          <span className={'status-dot ' + (status?.brain.authenticated ? 'connected' : '')} />
          <span>GPT‑6.1 Sol<small>{status ? status.brain.authenticated ? status.brain.mode === 'siwc' ? 'Подписка ChatGPT' : 'Подписка Codex' : 'Нужно подключение' : 'Проверяем подключение'}</small></span>
        </div>
        <button className={'nav-item ' + (tab === 'settings' ? 'active' : '')} onClick={() => navigation('settings')} aria-current={tab === 'settings' ? 'page' : undefined}><Settings size={19} /><span>Настройки</span></button>
      </div>
    </aside>
    <div className="workspace"><div className="workspace-content">
      {tab !== 'today' && <header className="topbar">
        <span className="eyebrow">ЛИЧНАЯ ПРАКТИКА АНГЛИЙСКОГО</span>
        <div><span className="private-label"><ShieldCheck size={14} /> Только для тебя</span><time>{day}</time></div>
      </header>}
      {error && <div className="message-banner error" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть сообщение"><X size={18} /></button></div>}
      {notice && <div className="message-banner success" role="status"><Check size={18} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть сообщение"><X size={18} /></button></div>}
      <div ref={screenRef} className="screen-content" data-screen={tab}>
      {!state ? <div className="page-loading"><div className="skeleton title-skeleton" /><div className="skeleton panel-skeleton" /><p>Открываю твой тренинг…</p>{error && <button className="button secondary" onClick={() => void refresh()}>Повторить загрузку</button>}</div> : <>
      {starting && <PreparationPanel startedAt={busySince} stage={busy} />}
      {state.onboarding && state.onboarding.status !== 'ready' && ['today', 'practice', 'progress'].includes(tab) && <OnboardingFlow state={state} onboarding={state.onboarding} busy={busy} audioReady={!!status?.audio.configured} onIntro={text => void completeIntro(text)} onStart={stepId => void start(undefined, undefined, undefined, stepId)} onResume={open} onSettings={() => navigation('settings')} />}
      {tab === 'today' && (!state.onboarding || state.onboarding.status === 'ready') && <>
        {state.onboarding?.status === 'ready' && !state.onboarding.report && <BaselineProfile report={null} busy={busy === 'Собираем стартовый профиль' ? busy : ''} disabled={pending} activity={busy === 'Собираем стартовый профиль' ? <div className="baseline-build-status" role="status"><p>Сравниваем три разговора и выбираем, что тренировать первым.</p><ElapsedTime startedAt={busySince} /></div> : undefined} onBuild={() => void buildBaselineReport()} onOpenEvidence={() => {}} />}
        {state.onboarding?.report && <button className="text-button baseline-profile-link" onClick={() => navigation('progress')}>Твой стартовый профиль<ArrowUpRight size={16} /></button>}
        <div className="page-heading">
          <div><h1>Сегодня</h1><p>Короткая практика. Конкретный следующий шаг.</p></div>
          <span className="quiet-tag">{calibration < 3 ? 'Знакомимся с твоим уровнем' : 'Личная программа'}</span>
        </div>
        <div className="home-grid">
          <div className="home-main">
            <section className="daily-panel today-lesson">
              <div className="panel-kicker">
                <span className="round-icon"><Target size={20} /></span>
                <span>{active ? 'ТВОЁ ТЕКУЩЕЕ ЗАНЯТИЕ' : calibration < 3 ? 'КАЛИБРОВКА · ' + (calibration + 1) + ' ИЗ 3' : 'СЛЕДУЮЩИЙ ШАГ'}</span>
                {active && <span className="session-status">{sessionStatus(active)}</span>}
              </div>
              <div className="lesson-copy">
                <h2>{active?.lesson.title || (calibration < 3 ? 'Узнаем, как ты говоришь' : recommendation?.title || state.reviews[0]?.focus || 'Новый разговор на английском')}</h2>
                <p>{active?.lesson.goal || (calibration < 3 ? 'Знакомая тема и живой диалог. Найдём твои сильные стороны и то, что стоит потренировать первым.' : 'Следующее занятие учтёт твои последние попытки и ближайшие цели.')}</p>
              </div>
              <div className="daily-controls lesson-meta">
                <span className="duration"><History size={16} /> {active?.lesson.minutes || state.profile.dailyMinutes} минут</span>
                {active ? <span className="quiet-tag">{active.mode === 'call' ? 'Созвон' : 'Учебный режим'}</span> : recommendation?.track === 'ielts-foundation' ? <span className="quiet-tag">{recommendation.activity === 'writing' ? 'Письменная практика' : recommendation.activity === 'reading' ? 'Чтение и ответ' : recommendation.preferredMode === 'call' ? 'Без текста' : 'С опорами'}</span> : <ModeSwitch mode={mode} setMode={setMode} />}
              </div>
              <button className="button primary large" disabled={pending} onClick={() => active ? open(active) : void start(recommendation?.familyId, FAMILIES.find(family => family.id === recommendation?.familyId)?.context)}>
                <Play size={18} /><span>{pending ? busy : active ? 'Продолжить занятие' : calibration < 3 ? 'Начать калибровку' : 'Начать практику'}</span><ArrowRight size={21} />
              </button>
              {active && <button className="text-button new-session-link" disabled={pending} onClick={() => navigation('practice')}>Начать другую практику<ArrowRight size={16} /></button>}
              {!active && recommendation && <button className="text-button new-session-link" disabled={pending} onClick={() => { setSelectedTrack('all'); setSelectedFamily(''); navigation('practice'); }}>Выбрать другую ситуацию<ArrowRight size={16} /></button>}
              {!active && recommendation && <div className={motionStyles.recommendationReason}><span>Почему сегодня</span><p>{recommendation.why}</p>{recommendation.track === 'ielts-foundation' && <small>Основа для IELTS. Сложность учитывает текущий профиль, экзаменационный band не выставляется.</small>}</div>}
              <div className="lesson-steps" aria-label="Как проходит занятие">
                <span><small>01</small> {['reading', 'writing'].includes(active?.lesson.activity || recommendation?.activity || '') ? 'Задача' : 'Разговор'}</span><span><small>02</small> Разбор</span><span><small>03</small> Своя версия</span>
              </div>
              <small className="daily-note">{status?.audio.configured ? 'Можно говорить или писать. Разбор по-русски.' : 'Начни текстом. Голос можно подключить в настройках.'}</small>
              <button type="button" className="text-button" onClick={launchQuick}><BookOpen size={16} />Быстрый разбор фразы</button>
            </section>
            {state.progression && <CurriculumOverview value={state.progression} onChoose={chooseTrack} />}
            <Activity state={state} />
            <section className="recent-section">
              <div className="section-title"><h3>Недавние занятия</h3><button className="text-button" onClick={() => navigation('history')}>Вся история <ArrowUpRight size={15} /></button></div>
              {state.sessions.length ? state.sessions.slice(0, 3).map(value => <button className="recent-row" key={value.id} onClick={() => open(value)}>
                <span className={'context-icon ' + value.lesson.context}><AudioLines size={18} /></span>
                <span className="session-row-copy"><strong>{value.lesson.title}</strong><small>{contextNames[value.lesson.context]} · {sessionStatus(value)}</small></span>
                <time>{date(value.createdAt)}</time><ChevronRight size={16} />
              </button>) : <div className="empty-row recent-empty">
                <span className="round-icon"><History size={22} /></span>
                <div><strong>Первый разговор впереди</strong><p>Твоя попытка, разбор и новая версия сохранятся здесь.</p></div>
              </div>}
            </section>
          </div>
          <aside className="profile-column">
            <section className="profile-overview">
              <div className="section-title"><h3>Твой профиль</h3><Sparkles size={18} /></div>
              <div className="profile-summary">
                <div className="calibration-ring">
                  <svg viewBox="0 0 100 100" role="img" aria-label={'Стартовая проверка: ' + calibration + ' из 3 этапов с наблюдениями'}>
                    <circle className="ring-track" cx="50" cy="50" r="42" fill="none" />
                    <circle className="ring-value" cx="50" cy="50" r="42" fill="none" strokeDasharray="263.9" strokeDashoffset={263.9 * (1 - calibration / 3)} transform="rotate(-90 50 50)" />
                  </svg>
                  <div><strong>{calibration}<small>/3</small></strong><span>этапа</span></div>
                </div>
                <div><h2>{state.profile.name}</h2><span className="profile-level">{calibration < 3 ? 'Калибруем навыки' : 'Калибровка завершена'}</span><p className="caption">{calibration < 3 ? 'Сначала реальные попытки, затем оценка.' : 'Следующие занятия уточняют профиль.'}</p></div>
              </div>
              {state.progression ? <PracticeLevel value={state.progression} compact onRewards={() => { setRewardsRequested(true); navigation('progress'); }} /> : <div className="profile-stats"><div><strong>{state.xp}<small> XP</small></strong><span>за практику</span></div><div><strong>{state.completed}</strong><span>занятий завершено</span></div></div>}
            </section>
            <SubscriptionLimits usage={subscriptionUsage} loading={usageLoading} onRefresh={() => void refreshUsage(true)} compact />
            <section className="skills-panel">
              <div className="section-title"><h3>Карта навыков</h3><button className="icon-button" onClick={() => navigation('progress')} aria-label="Открыть подробный прогресс"><ArrowUpRight size={17} /></button></div>
              <SkillRows state={state} compact />
              <p className="caption">Опора, самостоятельность, новый контекст и проверка спустя время.</p>
            </section>
            <div className="learning-note"><Ear size={22} /><h3>Услышать и подхватить</h3><p>Не просто задать вопрос, а использовать деталь собеседника в своём ответе.</p></div>
          </aside>
        </div>
      </>}
      {tab === 'practice' && (!state.onboarding || state.onboarding.status === 'ready') && <>
        <div className="page-heading"><div><h1>Выбери практику</h1><p>Ситуация твоя. Задачу и сложность подберёт Sol.</p></div><ModeSwitch mode={mode} setMode={setMode} /></div>
        <PracticeTrackSwitch value={selectedTrack} onChange={track => { setSelectedTrack(track); setSelectedFamily(''); }} />
        {selectedTrack !== 'all' && <div className={motionStyles.pathPurpose}><strong>{LEARNING_TRACKS.find(track => track.id === selectedTrack)?.title}</strong><p>{LEARNING_TRACKS.find(track => track.id === selectedTrack)?.description}</p>{state.progression?.tracks.find(track => track.id === selectedTrack) && <><span className="caption">Завершено: {state.progression.tracks.find(track => track.id === selectedTrack)?.completedSessions}. Стартовый ориентир: {state.progression.tracks.find(track => track.id === selectedTrack)?.targetSessions}. Это счётчик практики, не оценка уровня.</span>{selectedTrack === 'ielts-foundation' && <div className={motionStyles.activityMilestones} aria-label="Практика основ IELTS">{state.progression.tracks.find(track => track.id === selectedTrack)?.activities.map(activity => <span key={activity.id}><strong>{activity.title}</strong>Завершено: {activity.completedSessions} / {activity.targetSessions}</span>)}</div>}</>}</div>}
        <div className="topic-bar">
          <Lightbulb size={18} />
          <input aria-label="Тема для следующего занятия" placeholder="О чём поговорим? AI, игра, спорт, идея проекта…" value={topic} onChange={event => setTopic(event.target.value)} maxLength={300} />
          <button className="button secondary" disabled={pending} onClick={() => void start()}>Подобрать мне <ArrowRight size={16} /></button>
        </div>
        <div className="practice-layout">
          <div className="practice-groups">
            {LEARNING_TRACKS.filter(track => selectedTrack === 'all' || selectedTrack === track.id).map(track => {
              const families = FAMILIES.filter(family => family.track === track.id);
              return <section className="practice-group" key={track.id}>
                <div className="section-title practice-group-title"><h2>{track.title}</h2><span className="quiet-tag">{families.length} {families.length < 5 ? 'сценария' : 'сценариев'}</span></div>
                {track.id === 'ielts-foundation' && <p className={motionStyles.foundationNote}>Сначала короткие задачи, затем более связные ответы и повторная проверка. Здесь тренируем основу IELTS. Экзаменационный band не выставляем.</p>}
                <div className="scenario-list">{families.map(family => <div key={family.id}>
                  <button className={'family-row ' + (chosenFamily?.id === family.id ? 'selected' : '')} aria-pressed={chosenFamily?.id === family.id} onClick={() => setSelectedFamily(family.id)}>
                    <span className={'context-icon ' + family.context}>{track.id === 'ielts-foundation' ? <GraduationCap size={19} /> : family.context === 'life' ? <Ear size={19} /> : family.context === 'work' ? <AudioLines size={19} /> : <ArrowUpRight size={19} />}</span>
                    <span className="family-copy"><strong>{family.title}</strong><small>{family.description}</small></span>
                    <span className="selection-marker" aria-hidden="true">{chosenFamily?.id === family.id ? <Check size={17} /> : <ChevronRight size={17} />}</span>
                  </button>
                  {chosenFamily?.id === family.id && <ScenarioPreview family={family} mode={family.track === 'ielts-foundation' ? family.preferredMode : mode} minutes={state.profile.dailyMinutes} topic={topic} busy={busy} inline onStart={value => void start(value.id, value.context)} />}
                </div>)}</div>
              </section>;
            })}
          </div>
          <ScenarioPreview family={chosenFamily} mode={chosenFamily?.track === 'ielts-foundation' ? chosenFamily.preferredMode : mode} minutes={state.profile.dailyMinutes} topic={topic} busy={busy} onStart={value => void start(value.id, value.context)} />
        </div>
        <p className="caption">Работа и обычная жизнь примерно поровну. Ближайшие интервью могут временно менять акцент.</p>
      </>}
      {tab === 'progress' && (!state.onboarding || state.onboarding.status === 'ready') && <>
        <div className="page-heading"><div><h1>Твой прогресс</h1><p>Что получается самому и на каких попытках это основано.</p></div><span className="quiet-tag">{calibration < 3 ? 'Калибровка ' + calibration + '/3' : 'Профиль по твоим данным'}</span></div>
        {state.onboarding?.status === 'ready' && <BaselineProfile report={state.onboarding.report} busy={busy === 'Собираем стартовый профиль' ? busy : ''} disabled={pending} activity={busy === 'Собираем стартовый профиль' ? <div className="baseline-build-status" role="status"><p>Сравниваем три разговора и выбираем, что тренировать первым.</p><ElapsedTime startedAt={busySince} /></div> : undefined} onBuild={() => void buildBaselineReport()} onOpenEvidence={sessionId => { const source = state.sessions.find(value => value.id === sessionId); if (source) open(source); }} />}
        {state.progression ? <><PracticeLevel value={state.progression} /><EvidenceCoverage value={state.progression} /><button className="text-button" onClick={() => navigation('practice')}>Посмотреть маршрут и выбрать тему<ArrowRight size={16} /></button></> : <div className="progress-summary progress-metrics">
          <div><strong>{state.completed}</strong><span>занятий завершено</span></div>
          <div><strong>{state.xp}<small> XP</small></strong><span>за практику и свои попытки</span></div>
          <div><strong>{independent}<small>/{SKILLS.length}</small></strong><span>навыков проверено самостоятельно</span></div>
        </div>}
        <div className="progress-layout">
          <div className="progress-primary">
            <section className="progress-panel">
              <div className="section-title"><h2>Карта навыков</h2><span className="caption">Каждый навык проверяется отдельно</span></div>
              <SkillRows state={state} />
              <p className="caption">Четыре отметки: опора, самостоятельность, перенос и удержание. «Не проверено» означает, что данных ещё недостаточно.</p>
              {state.skills.some(skill => skill.examples.length > 0) && <details className="evidence-details">
                <summary>Открыть основания оценки</summary>
                {state.skills.map(skill => skill.examples.length ? <div key={skill.id}>
                  <h3>{SKILLS.find(item => item.id === skill.id)?.label}</h3>
                  {skill.examples.slice(0, 2).map((example, index) => <button className="evidence-row" key={index} onClick={() => { const found = state.sessions.find(value => value.id === example.sessionId); if (found) open(found); }}>
                    <q lang="en">{example.quote}</q><span>{example.reason}</span><ArrowUpRight size={15} />
                  </button>)}
                </div> : null)}
              </details>}
            </section>
            <Activity state={state} />
          </div>
          <aside className="progress-side">
            {state.progression && <Achievements value={state.progression} state={state} onTarget={targetAchievement} />}
            <section className="review-list">
              <div className="section-title"><h3>Вернуться к навыку</h3><RefreshCw size={18} /></div>
              <p className="caption">Повторения появляются из твоих разборов.</p>
              {state.reviews.length ? <>{state.reviews.slice(0, 8).map(review => {
                const source = state.sessions.find(value => value.id === review.sourceSessionId);
                return <div className="review-row actionable-review" key={review.id}>
                  <span><strong>{review.focus}</strong><small>{SKILLS.find(skill => skill.id === review.skill)?.label}</small>{source && <button className="text-button" disabled={pending} onClick={() => open(source)}>Посмотреть свою попытку<ArrowUpRight size={14} /></button>}</span>
                  <time>{date(review.dueAt)}</time>
                </div>;
              })}<button className="button secondary" disabled={pending} onClick={() => void start()}>Подобрать повторение<RefreshCw size={16} /></button></> : <div className="review-empty"><Target size={27} /><h3>Сначала найдём цель</h3><p>После первых занятий здесь появятся подходящие повторения.</p></div>}
            </section>
            <div className="learning-note"><GraduationCap size={23} /><h3>Рост видно по ответам</h3><p>XP показывает практику. Самостоятельность подтверждают новые ситуации и повторная проверка.</p></div>
          </aside>
        </div>
      </>}
      {tab === 'history' && <>
        <div className="page-heading"><div><h1>Твоя практика</h1><p>Исходная попытка, разбор и то, что ты смог улучшить.</p></div><a className="button secondary" href="/api/export" download><Download size={16} /> Скачать историю</a></div>
        <label className="search-field"><span className="caption">Найти занятие</span><input className="search-input" placeholder="По названию или цели занятия…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="history-list">
          {visibleSessions.map(value => <div className="history-row" key={value.id}>
            <button onClick={() => open(value)}>
              <span className={'context-icon ' + value.lesson.context}><AudioLines size={19} /></span>
              <span className="session-row-copy"><strong>{value.lesson.title}</strong><small>{date(value.createdAt)} · {contextNames[value.lesson.context]} · {sessionStatus(value)}</small></span><ChevronRight size={17} />
            </button>
            <button className={deleting === value.id ? 'text-button danger' : 'icon-button'} aria-label={deleting === value.id ? 'Подтвердить удаление занятия' : 'Удалить занятие'} onClick={() => {
              if (deleting !== value.id) { setDeleting(value.id); return; }
              void action('Удаляю занятие', async () => {
                await request('sessions/' + value.id, undefined, 'DELETE'); saveDraft(value.id, null);
                if (sessionRef.current?.id === value.id) { voice.discardRecording(); setSession(null); setInput(''); }
                setDeleting(''); await refresh();
              });
            }}>{deleting === value.id ? 'Удалить?' : <Trash2 size={16} />}</button>
          </div>)}
          {!state.sessions.length && <div className="large-empty"><History size={32} /><h2>Начнём с первого разговора</h2><p>Он станет отправной точкой твоей программы.</p><button className="button primary" onClick={() => void start()} disabled={pending}>Начать калибровку <ArrowRight size={17} /></button></div>}
          {state.sessions.length > 0 && !visibleSessions.length && <div className="large-empty"><BookOpen size={28} /><h2>Таких занятий пока нет</h2><p>Попробуй другую часть названия или цели.</p><button className="text-button" onClick={() => setSearch('')}>Показать всю историю</button></div>}
        </div>
      </>}
      {tab === 'settings' && profile && <>
        <div className="page-heading settings-intro">
          <div><h1>Настроить под себя</h1><p>Цели, привычный ритм и голос для твоей практики.</p></div>
          <div className="settings-status" aria-label="Подключения">
            <span className={'quiet-tag ' + (status?.brain.authenticated ? 'positive' : '')}>{status ? status.brain.authenticated ? 'Вход в подписку сохранён' : 'Нужен вход в подписку' : 'Проверяем подключение'}</span>
            <span className={'quiet-tag ' + (status?.audio.configured ? 'positive' : '')}>{status?.audio.configured ? 'Ключ голоса добавлен' : 'Голос без ключа'}</span>
          </div>
        </div>
        <div className="settings-layout">
          <div className="settings-connections">
            <section className="settings-section">
              <div className="section-title"><h2>Учебная модель</h2><Sparkles size={20} /></div>
              <p className="model-name">GPT‑6.1 Sol</p><p>Подбирает занятие, ведёт диалог и разбирает твои ответы. {status?.brain.mode === 'siwc' ? 'Использует твою подписку через Sign in with ChatGPT.' : 'Работает через локальный Codex и общие лимиты подписки.'}</p>
              {status?.brain.error && <p className="error-text">{status.brain.error}</p>}
              <button className="text-button" onClick={() => void action('Проверяю подключение', refreshStatus)} disabled={pending}><RefreshCw size={15} /> Проверить подключение</button>
            </section>
            <SubscriptionLimits usage={subscriptionUsage} loading={usageLoading} onRefresh={() => void refreshUsage(true)} />
            <section className="settings-section">
              <div className="section-title"><h2>Голос собеседника</h2><AudioLines size={20} /></div>
              <p>Распознавание твоей речи и озвучка ответов оплачиваются отдельно через OpenAI API.</p>
              <form className="key-form" onSubmit={event => {
                event.preventDefault();
                void action('Сохраняю ключ', async () => { await request('audio-key', { key }); setKey(''); await refreshStatus(); setNotice('Ключ сохранён. Голос проверим при первой озвучке.'); });
              }}>
                <label htmlFor="audio-key">OpenAI API-ключ</label>
                <div><input id="audio-key" type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={event => setKey(event.target.value)} /><button className="button secondary" disabled={pending || !key}>Сохранить</button></div>
                <small className="form-help">Ключ хранится {status?.hosting === 'server' ? 'на твоём сервере' : 'на твоём ПК'} и не возвращается в браузер.</small>
              </form>
              <div className="usage-line"><span>Голос за месяц · оценка</span><strong>{'$'}{state.audioUsage.usedUsd.toFixed(2)} <span>/ {'$'}{state.audioUsage.budgetUsd}</span></strong></div>
              <p className="caption">Фактические списания проверяй в OpenAI. Без ключа можно заниматься текстом.</p>
            </section>
          </div>

          <ReminderSettings />
          <section className="settings-section settings-profile">
            <div className="section-title"><h2>Твоя программа</h2><Target size={20} /></div>
            <p className="caption">Следующие занятия учитывают этот профиль и твои реальные попытки.</p>
            <form className="profile-form" onSubmit={event => {
              event.preventDefault();
              void action('Сохраняю профиль', async () => { const next = await request<AppState>('profile', profile); setState(next); setNotice('Профиль обновлён. Следующие занятия учтут изменения.'); });
            }}>
              <fieldset className="profile-fieldset">
                <legend>Ты и твои цели</legend>
                <label>Имя<input value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })} /></label>
                <label>Что хочешь развивать<textarea rows={3} value={profile.goals} onChange={event => setProfile({ ...profile, goals: event.target.value })} /></label>
                <label>Интересы<input value={profile.interests.join(', ')} onChange={event => setProfile({ ...profile, interests: event.target.value.split(',').map(value => value.trim()) })} /><small className="form-help">Через запятую: темы, о которых тебе нравится говорить.</small></label>
              </fieldset>
              <fieldset className="profile-fieldset">
                <legend>Твои ситуации</legend>
                <label>Работа и проекты<textarea rows={2} value={profile.professionalContext} onChange={event => setProfile({ ...profile, professionalContext: event.target.value })} /></label>
                <label>Релокация и ближайшие интервью<textarea rows={2} value={profile.relocation} onChange={event => setProfile({ ...profile, relocation: event.target.value })} /></label>
              </fieldset>
              <fieldset className="profile-fieldset">
                <legend>Ритм и расход</legend>
                <div className="form-pair">
                  <label>Минут на занятие<input type="number" min={5} max={60} value={profile.dailyMinutes} onChange={event => setProfile({ ...profile, dailyMinutes: Number(event.target.value) })} /></label>
                  <label>Бюджет голоса, $/месяц<input type="number" min={1} max={50} value={profile.budgetUsd} onChange={event => setProfile({ ...profile, budgetUsd: Number(event.target.value) })} /></label>
                </div>
                <label>Хранить аудио<select value={profile.audioRetentionDays} onChange={event => setProfile({ ...profile, audioRetentionDays: Number(event.target.value) })}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>3 месяца</option><option value={180}>6 месяцев</option></select></label>
                <p className="form-help">Бюджет ограничивает приблизительный расход аудио. Текст использует твою подписку.</p>
              </fieldset>
              <div className="form-actions"><button className="button primary" disabled={pending}>Сохранить профиль <Check size={17} /></button></div>
            </form>
          </section>

          <section className="settings-section settings-data">
            <div className="section-title"><h2>История и данные</h2><ShieldCheck size={20} /></div>
            <p>{status?.hosting === 'server' ? 'Компьютер и телефон используют одну историю на твоём сервере. Основной ПК можно выключать.' : 'Записи пока хранятся на этом компьютере. Для доступа с телефона он должен работать, а микрофону нужен доверенный HTTPS.'}</p>
            <a className="button secondary" href="/api/export" download><Download size={16} /> Скачать историю в JSON</a>
            <details className="delete-details">
              <summary>Удалить историю тренировок</summary><p>Удалятся занятия, аудио, разборы и основанный на них прогресс. Личный профиль останется.</p>
              <label>Введи DELETE<input value={reset} onChange={event => setReset(event.target.value)} autoComplete="off" /></label>
              <button className="button danger-button" disabled={pending || reset !== 'DELETE'} onClick={() => void action('Удаляю историю', async () => { const next = await request<AppState>('reset', { confirmation: reset }); clearDrafts(); setState(next); setReset(''); setSession(null); setNotice('История удалена. Можно начать новую стартовую проверку.'); })}>Удалить историю</button>
            </details>
          </section>
        </div>
      </>}
      {tab === 'session' && session && <SessionView session={session} result={state.progression?.recentResults.find(result => result.sessionId === session.id)} progression={state.progression} confirmedCompletion={completionMoment?.sessionId === session.id} previousUnlocks={completionMoment?.sessionId === session.id ? completionMoment.previousUnlocks : []} onNext={() => navigation("practice")} onDone={() => navigation("today")} setSession={setSession} busy={busy} busySince={busySince} input={input} setInput={changeInput} draft={drafts[session.id]} onDiscardDraft={() => { saveDraft(session.id, null); setInput(''); if (voice.recordingDraft?.contextKey?.startsWith(session.id + ':')) voice.discardRecording(); }} textMode={textMode} setTextMode={setTextMode} transcript={transcript} showTranscript={showTranscript} hintText={hintText} comfort={comfort} setComfort={setComfort} voice={voice} audioReady={!!status?.audio.configured} onSend={() => void send(input)} onResend={resend} onAction={sessionAction} onHint={level => void action('Подбираю опору', async () => { const result = await request<{ text: string }>(`sessions/${session.id}/hint`, { level }); setHintText(result.text); })} onBack={() => navigation('today')} onSettings={() => navigation('settings')} editing={editing} setEditing={setEditing} editText={editText} setEditText={setEditText} />}
      </>}
      </div><footer className="page-footer"><span>Своя попытка → разбор → новая практика</span><span>Личный тренинг · 0.4.4 alpha</span></footer></div></div>{tab !== 'session' && <nav ref={mobileNavigation.nav} className="mobile-nav" aria-label="Навигация телефона"><span ref={mobileNavigation.highlight} className="navigation-highlight" aria-hidden="true" />{NAV.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => navigation(item.id)} aria-current={tab === item.id ? 'page' : undefined}><item.icon size={21} /><span>{item.name}</span></button>)}<button className={tab === 'settings' ? 'active' : ''} onClick={() => navigation('settings')} aria-current={tab === 'settings' ? 'page' : undefined}><Settings size={21} /><span>Настройки</span></button></nav>}
  </div>{state && startupVisible && <StartupWelcome state={state} onReveal={() => setHomeEntry(value => value + 1)} onFinished={dismissStartup} />}</>;
}

function Activity({ state }: { state: AppState }) {
  const completed = state.sessions.filter(session => session.status === 'completed' && session.turns.some(turn => turn.role === 'user' && turn.text.trim()));
  const points = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 6 + index);
    return { day, count: completed.filter(session => dayKey(session.createdAt) === dayKey(day)).length };
  });
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const days = points.filter(point => point.count > 0).length;
  const maximum = Math.max(1, ...points.map(point => point.count));
  return <section className="activity-panel">
    <div className="section-title"><h3>Твой ритм</h3><span className="caption">Последние 7 дней</span></div>
    <div className="activity-body">
      <div className="activity-copy">
        <div className="activity-stat"><strong className="activity-value">{total}</strong><span>занятий завершено</span></div>
        <p>{total ? days + ' из 7 дней с практикой. Продолжай в своём темпе.' : 'После первой практики здесь появится твой ритм.'}</p>
        <small className="caption">По дате начала занятия</small>
      </div>
      <div className={'activity-chart ' + (!total ? 'activity-empty' : '')} role="img" aria-label={points.map(point => date(point.day.toISOString()) + ': ' + point.count + ' · завершено').join(', ')}>
        {points.map((point, index) => <div className="activity-day" key={index}>
          <div className="bar-area">{point.count > 0 && <small className="bar-count">{point.count}</small>}<span style={{ height: point.count / maximum * 100 + '%' }} className={point.count ? 'filled' : ''} /></div>
          <small>{new Intl.DateTimeFormat('ru', { weekday: 'short', timeZone: 'Europe/Moscow' }).format(point.day)}</small>
        </div>)}
      </div>
    </div>
    <div className="activity-key"><span><Target size={17} /> Своя попытка</span><span><Ear size={17} /> Учитывать собеседника</span><span><ArrowRight size={17} /> Новый контекст</span></div>
  </section>;
}

type SessionProps = {
  session: Session; setSession: (s: Session) => void; busy: string; busySince: number | null;
  result?: PracticeResult; progression?: ProgressionState; confirmedCompletion: boolean; previousUnlocks: string[]; onNext: () => void; onDone: () => void;
  input: string; setInput: (s: string) => void; draft?: SessionDraft; onDiscardDraft: () => void;
  textMode: boolean; setTextMode: (v: boolean) => void; transcript: boolean; showTranscript: () => Promise<void>;
  hintText: string; comfort: number; setComfort: (n: number) => void; voice: ReturnType<typeof useVoice>; audioReady: boolean;
  onSend: () => void; onResend: () => void; onAction: (name: string, data?: unknown) => Promise<void>; onHint: (level: 1 | 2 | 3) => void;
  onBack: () => void; onSettings: () => void; editing: string; setEditing: (s: string) => void; editText: string; setEditText: (s: string) => void;
};

function RecordingEvidence({ p, intent }: { p: SessionProps; intent: 'message' | 'retry' }) {
  const draft = p.draft;
  if (!draft?.audioFile || draft.intent !== intent) return null;
  const edited = draft.originalTranscript !== undefined && draft.originalTranscript.trim() !== p.input.trim();
  return <div className="recording-evidence" data-testid="recording-draft">
    <div className="recording-evidence-heading"><span className="eyebrow">ТВОЯ ЗАПИСЬ</span><span className="quiet-tag">{edited ? 'Текст исправлен' : 'Можно отправлять'}</span></div>
    <p>Послушай оригинал и проверь слова. Правки расшифровки учитываются отдельно от твоей речи.</p>
    <div className="recording-evidence-actions">
      <button type="button" className="button secondary" data-testid="replay-recording" onClick={() => p.voice.playingLearnerRecording ? p.voice.stop() : void p.voice.playRecording(draft.audioFile)} disabled={p.voice.state === 'listening' || !!p.busy}>
        {p.voice.playingLearnerRecording ? <Square size={16} /> : <Play size={16} />}{p.voice.playingLearnerRecording ? 'Стоп' : 'Моя запись'}
      </button>
      <button type="button" className="text-button" onClick={p.onDiscardDraft} disabled={!!p.busy}>Удалить черновик</button>
    </div>
    {edited && <details><summary>Исходная расшифровка</summary><p lang="en">{draft.originalTranscript}</p></details>}
  </div>;
}

function UnuploadedRecording({ p }: { p: SessionProps }) {
  if (!p.voice.hasUnuploadedRecording || p.voice.state === 'listening' || p.voice.state === 'transcribing') return null;
  return <div className="unuploaded-recording" role="status">
    <strong>Исходная запись сохранена</strong><p>Распознавание не завершилось. Её можно послушать и попробовать снова.</p><p>Запись пока только в этом окне. Не закрывай приложение до сохранения.</p>
    <div className="recording-evidence-actions">
      <button className="button secondary" data-testid="replay-recording" disabled={!!p.busy} onClick={() => p.voice.playingLearnerRecording ? p.voice.stop() : void p.voice.playRecording()}>
        {p.voice.playingLearnerRecording ? <Square size={16} /> : <Play size={16} />}{p.voice.playingLearnerRecording ? 'Стоп' : 'Моя запись'}
      </button>
      <button className="button secondary" disabled={!!p.busy || p.voice.state === 'thinking'} onClick={() => void p.voice.retry()}><RefreshCw size={16} />Распознать ещё раз</button>
      <button className="text-button" disabled={!!p.busy} onClick={() => { p.voice.discardRecording(); p.onDiscardDraft(); }}>Удалить запись</button>
    </div>
  </div>;
}

function DraftComposer({ p, intent, pending }: { p: SessionProps; intent: 'message' | 'retry'; pending: boolean }) {
  const listening = p.voice.state === 'listening';
  const last = p.session.turns.at(-1);
  const canSend = !pending && !listening && !p.voice.hasUnuploadedRecording && !!p.input.trim()
    && (intent === 'retry' || last?.role !== 'user') && (!p.session.baseline || intent === 'retry' || !!p.draft?.audioFile);
  const submit = () => { if (canSend) { p.voice.stop(); if (intent === 'retry') void p.onAction('retry', { text: p.input }); else p.onSend(); } };
  return <form className="reply-form" onSubmit={e => { e.preventDefault(); submit(); }}>
    <RecordingEvidence p={p} intent={intent} />
    <label className="draft-label" htmlFor={'draft-' + p.session.id}>{intent === 'retry' ? 'Твоя улучшенная попытка' : p.draft?.audioFile ? 'Проверь расшифровку' : p.session.lesson.activity === 'writing' ? 'Твой текст на английском' : 'Твой ответ'}</label>
    <textarea id={'draft-' + p.session.id} aria-label={intent === 'retry' ? 'Улучшенная попытка' : 'Твой ответ по-английски'} lang="en" placeholder={intent === 'retry' ? 'My improved reply…' : p.session.lesson.activity === 'writing' ? 'Write your first version here…' : 'Your reply…'} rows={p.session.lesson.activity === 'writing' ? 7 : 3} value={p.input} onChange={e => p.setInput(e.target.value)} disabled={pending || listening || (intent === 'message' && last?.role === 'user')}
      onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} />
    <div className={motionStyles.composerActions}><small>Черновик сохраняется.<span className={motionStyles.desktopShortcut}>Ctrl + Enter, чтобы отправить</span></small>
      <button className="button primary" data-testid="send-draft" disabled={!canSend}>{intent === 'retry' ? 'Проверить попытку' : 'Отправить'}<Send size={17} /></button>
    </div>
  </form>;
}

function LessonMaterial({ material }: { material: NonNullable<Session['lesson']['material']> }) {
  return <section className={motionStyles.lessonMaterial} aria-label={material.type === 'reading-passage' ? 'Текст для чтения' : 'Задание для письма'}><span className="eyebrow">{material.type === 'reading-passage' ? 'ТЕКСТ ДЛЯ ЧТЕНИЯ' : 'ЗАДАНИЕ ДЛЯ ПИСЬМА'}</span><p lang="en">{material.text}</p><p lang="en" className={motionStyles.materialInstruction}>{material.instruction}</p><small>Учебный материал создан для этой практики. Это не официальный экзаменационный вариант.</small></section>;
}

type FinishIntent = 'finish' | 'complete' | 'defer';
function FinishConfirmation({ intent, textActivity, onCancel, onConfirm }: { intent: FinishIntent; textActivity: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const accepted = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (element?.isConnected && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  const title = intent === 'finish' ? textActivity ? 'Перейти к разбору задания?' : 'Закончить разговор?' : intent === 'defer' ? 'На сегодня всё?' : 'Сохранить результат занятия?';
  const detail = intent === 'finish' ? `Твои ответы останутся в истории. После этого подготовим разбор; ${textActivity ? 'добавить ответы в эту попытку' : 'продолжить этот разговор'} уже не получится.` : intent === 'defer' ? 'Сохраним занятие и вернёмся на главную. Улучшенная попытка останется доступна на потом; её успех пока не подтверждён.' : 'Сохраним разбор и твои попытки. Данные об улучшении учитываются только там, где оно подтверждено.';
  const submit = () => { if (accepted.current) return; accepted.current = true; onConfirm(); };
  return <dialog ref={dialog} className={motionStyles.confirmationSheet} aria-labelledby="finish-confirm-title" aria-describedby="finish-confirm-detail" onCancel={onCancel} onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className={motionStyles.confirmationContent}>
      <span className="eyebrow">ЗАВЕРШЕНИЕ ЗАНЯТИЯ</span>
      <h2 id="finish-confirm-title">{title}</h2><p id="finish-confirm-detail">{detail}</p>
      <div className={motionStyles.confirmationActions}><button type="button" className="button primary" data-testid="confirm-finish" onClick={submit}>{intent === 'finish' ? 'Получить разбор' : intent === 'defer' ? 'Сохранить и на главную' : 'Сохранить результат'}<Check size={18} /></button><button type="button" className="button secondary" autoFocus onClick={onCancel}>Продолжить занятие</button></div>
    </div>
  </dialog>;
}

function SessionView(p: SessionProps) {
  const { session: s, voice, busy } = p;
  const [showListeningCheck, setShowListeningCheck] = useState(false);
  const [finishIntent, setFinishIntent] = useState<FinishIntent | null>(null);
  useEffect(() => { setFinishIntent(null); }, [s.id, s.status]);
  const active = s.status === 'active' || (s.status === 'error' && !s.analysis);
  const baseline = !!s.baseline;
  const textActivity = s.lesson.activity === 'reading' || s.lesson.activity === 'writing';
  const baselineReplies = s.turns.filter(turn => turn.role === 'user' && turn.source === 'audio' && turn.audioFile && turn.support === 0 && !turn.transcriptEdited && !turn.disputed).length;
  const retryAllowed = s.status === 'review' || (s.status === 'completed' && !!s.retryDeferred);
  const last = s.turns.at(-1);
  const lastPartner = s.turns.findLast(turn => turn.role === 'assistant');
  const listening = voice.state === 'listening';
  const pending = !!busy || !!s.processing || voice.state === 'thinking' || voice.state === 'transcribing';
  const unresolvedRecording = voice.hasUnuploadedRecording || !!p.draft?.text.trim();
  const hasImprovedRetry = !!s.analysis && s.retries.some(retry => retry.improved === true
    && !!retry.text.trim() && (retry.analysisVersion === undefined || retry.analysisVersion === s.analysis?.version))
    && (!s.completion || (s.completion.canComplete && !s.completion.needsRetry));
  const completion = s.completion ?? {
    canComplete: !!s.analysis && (!s.analysis.priorities.length || hasImprovedRetry),
    needsRetry: !!s.analysis?.priorities.length && !hasImprovedRetry,
    reason: 'Попробуй выразить мысль заново или сохрани правку на потом.',
  };
  const stage = s.processing?.stage;
  const analysisStage = stage === 'queued' ? 'Разбор в очереди. Твои ответы сохранены.'
    : stage === 'evaluating' ? 'Сравниваем реплики и выбираем ближайшую правку.'
      : stage === 'waiting-retry' ? 'Сервис задержал разбор. Попробуем ещё раз.'
        : 'Проверяем смысл, английский и то, как ты использовал ответы собеседника.';
  const parsedStart = Date.parse(s.processing?.startedAt || '');
  const startedAt = Number.isFinite(parsedStart) ? parsedStart : p.busySince;
  const voiceLabel = listening ? 'Слушаю тебя' : textActivity && voice.state === 'idle' ? s.lesson.activity === 'writing' ? 'Твой текст, твой ход' : 'Читай и проверь понимание' : voice.playingLearnerRecording ? 'Слушаем твою запись'
    : busy || (s.processing ? 'Собеседник готовит ответ' : voiceNames[voice.state]);
  const orbState = listening ? 'listening' : busy || s.processing ? 'thinking' : voice.state;
  const emotion = s.error ? 'supportive' : voice.playingLearnerRecording ? 'attentive' : hasImprovedRetry ? 'pleased' : undefined;
  const recordDisabled = !listening && (pending || !p.audioReady || voice.hasUnuploadedRecording || !!p.draft?.audioFile || last?.role === 'user');

  return <div className={`session-page ${motionStyles.sessionPage}`}>
    {finishIntent && <FinishConfirmation intent={finishIntent} textActivity={textActivity} onCancel={() => setFinishIntent(null)} onConfirm={() => { setFinishIntent(null); void p.onAction(finishIntent === 'finish' ? 'finish' : 'complete', finishIntent === 'finish' ? {} : { comfort: p.comfort, ...(finishIntent === 'defer' ? { deferRetry: true } : {}) }); }} />}
    <div className="session-heading"><button className="text-button" onClick={p.onBack}><ChevronRight className="back-icon" size={17} />{baseline ? 'Стартовая проверка' : 'Сегодня'}</button><span className="quiet-tag">{baseline ? 'Без подсказок' : s.mode === 'call' ? 'Созвон без опор' : 'Учебный режим'}</span></div>
    <div className="page-heading"><div><h1>{s.lesson.title}</h1><p>{baseline ? 'Сначала твои ответы голосом. Оценка будет после разговора.' : s.lesson.track === 'ielts-foundation' ? 'Основа для IELTS · ' + LEARNING_ACTIVITIES.find(activity => activity.id === s.lesson.activity)?.title : contextNames[s.lesson.context]}</p></div></div>
    {s.status === 'completed' && <SessionOutcome key={s.id} session={s} result={p.result} progression={p.progression} confirmed={p.confirmedCompletion} previousUnlocks={p.previousUnlocks} onNext={p.onNext} onDone={p.onDone} />}
    {active && <div className="conversation-layout">
      <section className={`conversation-stage ${p.textMode ? 'text-mode' : ''} ${textActivity ? motionStyles.materialStage : ''}`}>
        <VoiceOrb state={orbState} meterStore={voice.meterStore} emotion={emotion} statusDescription={voiceLabel} />
        <h2 className="voice-state" aria-live="polite">{voiceLabel}</h2>
        <p className="voice-caption">{listening ? 'Я не перебиваю. Закончи мысль и нажми «Стоп».' : p.draft?.audioFile ? 'Твоя запись готова. Проверь её перед отправкой.' : 'Скажи реплику, проверь расшифровку и отправь. Твой ход.'}</p>
        {(busy || s.processing) && <div className="conversation-progress"><ElapsedTime startedAt={startedAt} /><p>Твоя реплика сохранена. Ответ появится здесь.</p></div>}
        {(textActivity || p.textMode) && !baseline && last?.role === 'assistant' && <div className="current-prompt"><span>Собеседник</span><p lang="en">{last.text}</p></div>}
        {s.lesson.material && <LessonMaterial material={s.lesson.material} />}
        <LiveCaptions text={voice.liveTranscript} status={voice.liveTranscriptStatus} state={voice.state} />
        <UnuploadedRecording p={p} />
        {last?.role === 'user' && !busy && !s.processing && <div className="pending-reply"><p>Твоя реплика сохранена. Можно повторить получение ответа.</p><button className="button secondary" disabled={pending} onClick={p.onResend}><RefreshCw size={17} />Повторить ответ собеседника</button></div>}
        {!textActivity && <div className="voice-controls">
          <button className="voice-control" disabled={listening || !['speaking', 'thinking'].includes(voice.state)} onClick={() => voice.stop()} aria-label="Остановить голос"><Square size={22} /><span>Стоп голоса</span></button>
          <button className={`voice-control main ${listening ? 'recording' : ''}`} data-testid="record-toggle" disabled={recordDisabled} onClick={() => void voice.record(s.id + ':message')} aria-label={listening ? 'Закончить запись' : 'Говорить'}>
            {listening ? <Square size={23} /> : <Mic size={27} />}<span>{listening ? 'Стоп' : 'Говорить'}</span>
          </button>
        </div>}

        {!p.audioReady && <button className="text-button audio-setup" onClick={p.onSettings}>Подключить голос <ArrowUpRight size={15} /></button>}
        {voice.autoplayBlocked && last?.role === 'assistant' && <div className="autoplay-notice"><p>Браузер ждёт твоего нажатия, чтобы включить звук.</p><button className="button secondary" disabled={pending || listening} onClick={() => void voice.speak(s, last)}><Play size={16} />Включить голос</button></div>}
        {voice.canRetry && !voice.hasUnuploadedRecording && <button className="button secondary voice-retry" disabled={pending || listening} onClick={() => void voice.retry()}><RefreshCw size={16} />{voice.retryLabel || 'Повторить'}</button>}
        <div className="conversation-mode">
          {!baseline && !textActivity && <><button className={p.textMode ? 'selected' : ''} aria-pressed={p.textMode} disabled={pending || listening} onClick={() => { p.setTextMode(true); void p.showTranscript(); }}>С текстом</button>
          <button className={!p.textMode ? 'selected' : ''} aria-pressed={!p.textMode} disabled={!p.audioReady || pending || listening} onClick={() => p.setTextMode(false)}>Без текста</button></>}
          {last?.role === 'assistant' && p.audioReady && <button disabled={pending || listening} onClick={() => voice.state === 'speaking' ? voice.stop() : void voice.speak(s, last)}>{voice.state === 'speaking' ? <Square size={14} /> : <Play size={14} />}{voice.state === 'speaking' ? 'Стоп' : 'Ещё раз'}</button>}
        </div>
        {(textActivity || (p.textMode && !baseline) || p.input.trim() || p.draft?.audioFile) && <DraftComposer p={p} intent="message" pending={pending} />}
        <div className={motionStyles.sessionFinishAction}>{textActivity && <p>Ответ можно написать. Голос для этого задания не обязателен.</p>}<button type="button" className="button secondary" data-testid="request-finish" disabled={pending || listening || unresolvedRecording || !s.turns.some(turn => turn.role === 'user') || (baseline && baselineReplies < 2)} onClick={() => setFinishIntent('finish')}>Закончить {textActivity ? 'задание' : 'разговор'} и получить разбор<Check size={18} /></button>{baseline && baselineReplies < 2 && <small>Сначала хотя бы два своих ответа голосом.</small>}</div>
      </section>
      <aside className="conversation-inspector">
        <div className="goal-block"><span className="eyebrow">ТВОЯ ЗАДАЧА</span><h3>{s.lesson.goal}</h3><p>{s.lesson.why}</p></div>
        {!baseline && s.mode === 'learning' && <section className="support-section"><h3><Lightbulb size={17} />Поддержка</h3><p>Сначала попробуй сам. Опора учитывается в разборе.</p><div className="support-buttons"><button disabled={pending || listening} onClick={() => p.onHint(1)}>Намёк</button><button disabled={pending || listening} onClick={() => p.onHint(2)}>Конструкция</button><button disabled={pending || listening} onClick={() => p.onHint(3)}>Пример</button></div>{p.hintText && <div className="hint-text">{p.hintText}</div>}</section>}
        {!baseline && <details className="transcript" open={p.transcript} onToggle={e => { if (e.currentTarget.open && !p.transcript && !pending && !listening) void p.showTranscript(); }}><summary>{textActivity ? 'Текст задания и твои ответы' : 'Текст разговора'}<BookOpen size={17} /></summary><div className="turn-list">{s.turns.map(turn => <div className={`turn ${turn.role}`} key={turn.id}><span>{turn.role === 'user' ? 'Ты' : 'Собеседник'}</span><p lang="en">{turn.text}</p></div>)}</div></details>}
        {baseline && <div className="baseline-session-note"><strong>Проверяем настоящую речь</strong><p>Нужны хотя бы два своих ответа голосом. Попросить повторить или пояснить сказанное можно. Текст собеседника и готовые формулировки появятся после разбора.</p><span className="caption">Своих ответов без опоры: {baselineReplies}/2</span></div>}
        <div className="inspector-note"><GraduationCap size={18} /><p>Подробный разбор будет после {textActivity ? 'задания' : 'разговора'}. {!textActivity && (p.textMode || p.transcript) && 'Текст помогает ответить. Понимание на слух проверим без текста. '}Произношение по одному тексту не оценивается.</p></div>
      </aside>
    </div>}
    {s.status === 'analysing' && <section className="analysis-loading">
      <VoiceOrb state="thinking" emotion={s.error ? 'supportive' : undefined} statusDescription="Готовим разбор" />
      <h2>Разбираем твою попытку</h2><p aria-live="polite">{analysisStage}</p><ElapsedTime startedAt={startedAt} />
      {!textActivity && lastPartner && <div className="listening-recall"><strong>Пока ждём</strong><p>Что было важно собеседнику? Вспомни одну конкретную деталь.</p><button className="button secondary" onClick={() => setShowListeningCheck(!showListeningCheck)}>{showListeningCheck ? 'Скрыть ответ' : 'Проверить себя'}</button>{showListeningCheck && <p lang="en">{lastPartner.text}</p>}</div>}
      <p>Можно свернуть занятие. Готовый разбор останется в истории.</p><button className="button secondary" onClick={p.onBack}>Вернусь чуть позже</button>
    </section>}
    {s.status === 'error' && s.error && <div className="message-banner error"><p>{s.error}</p>{s.analysis && <button className="button secondary" disabled={pending} onClick={() => void p.onAction('reanalyse')}>Повторить разбор</button>}</div>}
    {s.analysis && <div className="analysis-layout"><div>
      <section className="analysis-intro"><div className="review-orb-heading"><VoiceOrb state="idle" emotion={hasImprovedRetry ? 'pleased' : 'calm'} statusDescription={hasImprovedRetry ? 'Твоя улучшенная попытка подтверждена' : 'Разбор готов'} /><div><span className="eyebrow">{s.retryDeferred ? 'ПОПЫТКА НА ПОТОМ' : hasImprovedRetry ? 'ЕСТЬ УЛУЧШЕНИЕ' : 'ТВОЙ РАЗБОР'}</span><h2>{hasImprovedRetry ? 'Вот, уже сильнее.' : s.retryDeferred ? 'Осталась одна попытка.' : !s.analysis.priorities.length ? 'Разбор готов.' : textActivity ? 'Сделаем твой ответ сильнее.' : 'Сделаем одну реплику сильнее.'}</h2></div></div><p className="analysis-summary">{s.analysis.summary}</p>{s.analysis.strengths.length > 0 && <div className="strengths">{s.analysis.strengths.map((value, i) => <p key={i}><Check size={17} />{value}</p>)}</div>}</section>
      {s.analysis.priorities.map((priority, i) => <section className="priority" key={i}><div className="priority-heading"><span className="priority-number">0{i + 1}</span><span className="quiet-tag">{priority.type === 'language' ? 'Английский' : 'Диалог'}</span></div><h3>{priority.title}</h3><blockquote lang="en">{priority.quote}</blockquote><p>{priority.explanation}</p><details><summary>Возможная формулировка</summary><p className="example" lang="en">{priority.example}</p><small>Один из вариантов. Свою попытку формулируй своими словами.</small></details><div className="retry-prompt"><Target size={17} /><span>{priority.retryInstruction}</span></div></section>)}
      {retryAllowed && <section className={`retry-section ${motionStyles.retrySurface}`}><span className="eyebrow">СЛЕДУЮЩИЙ ШАГ</span><h2>Теперь твоя версия</h2><p>{textActivity ? 'Вырази свою мысль заново. Сравним её с исходной попыткой.' : 'Повтори важный эпизод своими словами. Сравним его с исходной попыткой.'}</p>
        {p.audioReady && s.lesson.activity !== 'writing' && <><VoiceOrb state={orbState} meterStore={voice.meterStore} emotion={emotion} statusDescription={voiceLabel} /><div className="retry-voice"><button className="button secondary" data-testid="record-toggle" disabled={!listening && (pending || voice.hasUnuploadedRecording || !!p.draft?.audioFile)} onClick={() => void voice.record(s.id + ':retry')}>{listening ? <Square size={17} /> : <Mic size={17} />}{listening ? 'Стоп' : 'Сказать голосом'}</button><span aria-live="polite">{voiceLabel}</span></div></>}
        <LiveCaptions text={voice.liveTranscript} status={voice.liveTranscriptStatus} state={voice.state} /><UnuploadedRecording p={p} />
        {voice.canRetry && !voice.hasUnuploadedRecording && <button className="text-button" disabled={pending || listening} onClick={() => void voice.retry()}>{voice.retryLabel || 'Повторить'}</button>}
        {busy && <div className="retry-progress" role="status"><strong>{busy}</strong><ElapsedTime startedAt={p.busySince} /></div>}
        <DraftComposer p={p} intent="retry" pending={pending} />
      </section>}
      {s.retries.map((retry, i) => <section className="retry-result" key={retry.id || i}><span className="eyebrow">СОБСТВЕННАЯ ПОПЫТКА {i + 1} · {retry.improved === true ? 'Есть улучшение' : 'Продолжаем работу'}</span><blockquote lang="en">{retry.text}</blockquote>{retry.audioFile && <audio controls preload="none" src={'/api/audio/' + encodeURIComponent(retry.audioFile)} />}<p>{retry.feedback}</p></section>)}
      {s.status !== 'completed' && <section className={`finish-section ${motionStyles.finishSurface}`}><h3>Как ощущалась {textActivity ? 'задача' : 'беседа'}?</h3><div className="comfort-choice" aria-label="Комфорт от 1 до 5">{[1, 2, 3, 4, 5].map(n => <button key={n} aria-pressed={p.comfort === n} className={p.comfort === n ? 'selected' : ''} onClick={() => p.setComfort(n)}>{n}</button>)}<span>Сложно → комфортно</span></div>{completion.canComplete && <button type="button" className="button primary" data-testid="request-complete" disabled={pending || listening || unresolvedRecording || s.status !== 'review'} onClick={() => setFinishIntent('complete')}>Завершить занятие<Check size={18} /></button>}{s.status === 'review' && completion.needsRetry && <><p className={motionStyles.nextAttemptReason}>{completion.reason}</p><button type="button" className="button secondary" data-testid="request-defer" disabled={pending || listening || unresolvedRecording} onClick={() => setFinishIntent('defer')}>На сегодня всё<ArrowRight size={18} /></button><small>Сохраним занятие. К своей новой попытке можно вернуться позже.</small></>}</section>}
      <SpeechTimingPanel session={s} />
    </div><aside className="analysis-aside">
      <section><h3>Следующий шаг</h3><p>{s.analysis.nextFocus}</p><span className="caption">{date(s.analysis.createdAt)}</span></section>
      <details><summary>Наблюдения по навыкам</summary>{s.analysis.evidence.map((evidence, i) => <div className="observation" key={i}><strong>{SKILLS.find(skill => skill.id === evidence.skill)?.label}</strong><span>{evidence.result === 'success' ? 'Получилось' : evidence.result === 'partial' ? 'Частично' : evidence.result === 'difficulty' ? 'Есть трудность' : evidence.result === 'disputed' ? 'Спорно' : 'Не проверено'}</span><p>{evidence.reason}</p></div>)}</details>
      <details><summary>Ограничения оценки</summary>{s.analysis.limitations.map((value, i) => <p key={i}>{value}</p>)}</details>
      <details><summary>{textActivity ? 'Исходное задание и ответы' : 'Исходный разговор'}</summary>{s.lesson.material && <LessonMaterial material={s.lesson.material} />}{s.turns.map(turn => <div className="turn" key={turn.id}><span>{turn.role === 'user' ? 'Ты' : 'Собеседник'}</span><p lang="en">{turn.text}</p>{turn.audioFile && <audio controls preload="none" src={'/api/audio/' + encodeURIComponent(turn.audioFile)} />}{turn.role === 'user' && <button className="text-button" disabled={pending || listening} onClick={() => { p.setEditing(turn.id); p.setEditText(turn.text); }}>Исправить расшифровку</button>}{p.editing === turn.id && <div className="edit-turn"><textarea value={p.editText} onChange={e => p.setEditText(e.target.value)} aria-label="Исправленный транскрипт" /><button className="button secondary" disabled={pending} onClick={() => { void p.onAction('edit', { turnId: turn.id, text: p.editText, disputed: false }); p.setEditing(''); }}>Сохранить и пересчитать</button><button className="text-button" disabled={pending} onClick={() => { void p.onAction('edit', { turnId: turn.id, text: p.editText, disputed: true }); p.setEditing(''); }}>Исключить как спорное</button></div>}</div>)}</details>
    </aside></div>}
  </div>;
}
