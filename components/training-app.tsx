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
  MicrophoneIcon as Mic, PauseIcon as Pause, PlayIcon as Play,
  ArrowsClockwiseIcon as RefreshCw, PaperPlaneRightIcon as Send, GearIcon as Settings,
  ShieldCheckIcon as ShieldCheck, SparkleIcon as Sparkles, SquareIcon as Square,
  TargetIcon as Target, TrashIcon as Trash2, TrendUpIcon as TrendingUp, XIcon as X,
} from '@phosphor-icons/react';
import { SKILLS, type AppState, type BrainStatus, type Context, type Mode, type Profile, type Session, type SubscriptionUsage, type Turn } from '@/lib/types';
import { FAMILIES, type ScenarioFamily } from '@/lib/training';
import { VoiceOrb } from './voice-orb';
import { useVoice } from './use-voice';
import { SubscriptionLimits } from './subscription-limits';
import { PracticeModeSwitch as ModeSwitch } from './practice-mode-switch';
import { useContentEntrance, useInputModality, useNavigationHighlight } from './use-interface-motion';

type Tab = 'today' | 'practice' | 'progress' | 'history' | 'settings' | 'session';
type Status = { brain: BrainStatus; hosting?: 'local' | 'server'; audio: { configured: boolean; model: string } };
const NAV = [{ id: 'today', name: 'Сегодня', icon: Home }, { id: 'practice', name: 'Практика', icon: AudioLines }, { id: 'progress', name: 'Прогресс', icon: TrendingUp }, { id: 'history', name: 'История', icon: History }] as const;
const contextNames = { work: 'Работа', life: 'Обычная жизнь', relocation: 'Релокация' };
const stateNames = { unknown: 'Не проверено', supported: 'С опорой', provisional: 'Предварительно', independent: 'Самостоятельно', recheck: 'Перепроверим' };
const voiceNames = { idle: 'Готов к разговору', listening: 'Слушаю тебя', transcribing: 'Распознаю речь', thinking: 'Обдумываю ответ', speaking: 'Собеседник говорит', paused: 'Разговор на паузе' };
async function request<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await res.json(); if (!res.ok) throw Object.assign(new Error(data.error || 'Не удалось выполнить действие.'), { status: res.status });
  return data;
}
function date(value: string) { return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).format(new Date(value)); }

function SkillRows({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const skills = SKILLS.filter(skill => !compact || ['grammar', 'coherence', 'reciprocity', 'initiative'].includes(skill.id));
  return <div className={'skill-rows ' + (compact ? 'compact' : '')}>
    {(['language', 'dialogue'] as const).map(group => <section className="skill-group" key={group}>
      <h3 className="skill-group-label">{group === 'language' ? 'Английский' : 'Разговор'}</h3>
      {skills.filter(skill => skill.group === group).map(skill => {
        const value = state.skills.find(item => item.id === skill.id);
        const label = stateNames[value?.state || 'unknown'];
        return <div className="skill-row" key={skill.id}>
          <div><span>{skill.label}</span><small>{label}</small></div>
          <div className="skill-steps" aria-label={skill.label + ': ' + label}>
            <i className={value?.state === 'supported' || value?.independentSuccesses ? 'lit' : ''} title="Опора или успешная попытка" />
            <i className={value?.state === 'independent' ? 'lit' : ''} title="Самостоятельно" />
            <i className={value?.transfer ? 'lit' : ''} title="Новый контекст" />
            <i className={value?.retention ? 'lit' : ''} title="Проверено спустя время" />
          </div>
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
      <span className="eyebrow">{contextNames[family.context]}</span>
      <h2>{family.title}</h2><p>{family.description}</p>
      <div className="scenario-skills"><span className="caption">Что потренируем</span>{family.skills.map(skill => <span className="quiet-tag" key={skill}>{SKILLS.find(item => item.id === skill)?.label}</span>)}</div>
      <div className="daily-controls"><span className="duration"><History size={16} /> {minutes} минут</span><span className="quiet-tag">{mode === 'call' ? 'Созвон' : 'С опорами'}</span></div>
      {topic.trim() && <p className="caption">Тема: {topic.trim()}</p>}
      <button className="button primary" disabled={!!busy} onClick={() => onStart(family)}>{busy || (inline ? 'Начать разговор' : 'Начать этот разговор')} <ArrowRight size={18} /></button>
      <small className="daily-note">Сначала попробуешь сам. Потом разберём конкретные реплики.</small>
    </> : <>
      <span className="round-icon"><AudioLines size={25} /></span><h2>Какая ситуация тебе ближе?</h2>
      <p>Выбери её в списке. Здесь появятся цель разговора и навыки, которые он тренирует.</p>
      <span className="quiet-tag">Можно начать со своей темы</span>
    </>}
  </div></aside>;
}

function sessionStatus(value: Session) {
  if (value.status === 'completed') return 'Завершено';
  if (value.status === 'analysing') return 'Готовится разбор';
  if (value.status === 'review') return 'Своя улучшенная попытка';
  if (value.status === 'error') return 'Можно повторить';
  return 'Можно продолжить';
}

function dayKey(value: Date | string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(value));
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
  const [quickVisible, setQuickVisible] = useState(false);
  const [mode, setMode] = useState<Mode>('learning');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needLogin, setNeedLogin] = useState(false);
  const [code, setCode] = useState('');
  const [input, setInput] = useState('');
  const [retryAudioFile, setRetryAudioFile] = useState<string>();
  const [hintText, setHintText] = useState('');
  const [transcript, setTranscript] = useState(false);
  const [textMode, setTextMode] = useState(true);
  const [topic, setTopic] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('');
  const [search, setSearch] = useState('');
  const [key, setKey] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reset, setReset] = useState('');
  const [deleting, setDeleting] = useState('');
  const [comfort, setComfort] = useState(3);
  const [editing, setEditing] = useState('');
  const [editText, setEditText] = useState('');
  const lastSent = useRef<{ id: string; text: string; source: 'text' | 'audio'; audioFile?: string } | null>(null);
  const speechRef = useRef<(s: Session, turn: Turn) => Promise<void>>(() => Promise.resolve());
  const tabRef = useRef(tab); tabRef.current = tab;
  const screenRef = useContentEntrance<HTMLDivElement>(startupVisible ? 'startup' : tab);
  const desktopNavigation = useNavigationHighlight(tab);
  const mobileNavigation = useNavigationHighlight(tab);
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [tab]);
  useEffect(() => {
    const entry = new URLSearchParams(window.location.search).get('entry');
    setStartupVisible(entry === 'startup');
    setQuickVisible(entry === 'quick');
  }, []);
  const sessionRef = useRef(session); sessionRef.current = session;
  const textModeRef = useRef(textMode); textModeRef.current = textMode;
  const transcriptRef = useRef(transcript); transcriptRef.current = transcript;
  const action = useCallback(async <T,>(name: string, task: () => Promise<T>, propagate = false): Promise<T | undefined> => {
    setBusy(name); setError(''); setNotice('');
    try { return await task(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); if (propagate) throw e; } finally { setBusy(''); }
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
    if (!session || session.status !== 'analysing') return;
    const timer = setInterval(() => { void request<Session>(`sessions/${session.id}`).then(next => { setSession(next); if (next.status !== 'analysing') void refresh(); }).catch(e => setError(e.message)); }, 2500);
    return () => clearInterval(timer);
  }, [session?.id, session?.status, refresh]);

  async function send(text: string, audioFile?: string, propagate = false) {
    const current = sessionRef.current; if (!current || !text.trim()) return;
    const packet = lastSent.current?.text === text.trim() && lastSent.current.audioFile === audioFile ? lastSent.current : { id: crypto.randomUUID(), text: text.trim(), source: audioFile ? 'audio' as const : 'text' as const, audioFile };
    lastSent.current = packet;
    const result = await action('Ответ собеседника', async () => {
      try { return await request<Session>(`sessions/${current.id}/message`, { ...packet, textVisible: textModeRef.current || transcriptRef.current }); }
      catch (error) {
        const saved = await request<Session>(`sessions/${current.id}`).catch(() => null);
        if (saved && sessionRef.current?.id === current.id) setSession(saved);
        throw error;
      }
    }, propagate);
    if (result) { if (sessionRef.current?.id !== current.id) return; setSession(result); setInput(''); setHintText(''); lastSent.current = null; void refresh(); if (!textModeRef.current && tabRef.current === 'session') { const turn = result.turns.at(-1); if (turn?.role === 'assistant') void speechRef.current(result, turn); } }
  }
  const voice = useVoice(async (text, audioFile) => {
    if (tabRef.current !== 'session') return;
    if (sessionRef.current?.status === 'review') { setInput(text); setRetryAudioFile(audioFile); setNotice('Речь распознана. Проверь текст и отправь свою попытку на разбор.'); return; }
    await send(text, audioFile, true);
  }, setError);
  speechRef.current = voice.speak;
  useEffect(() => {
    const pauseHiddenWindow = () => {
      if (window.ratmirDesktop && document.hidden) voice.stop();
    };
    document.addEventListener('visibilitychange', pauseHiddenWindow);
    return () => document.removeEventListener('visibilitychange', pauseHiddenWindow);
  }, [voice.stop]);
  function dismissStartup() {
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
  async function start(familyId?: string, context?: Context, minutes?: number) {
    voice.stop();
    const result = await action('Готовлю твоё занятие', async () => request<Session>('sessions', { mode, familyId, context, topic, minutes }));
    if (result) { dismissStartup(); setSession(result); setTab('session'); setInput(''); setRetryAudioFile(undefined); setHintText(''); setTranscript(!status?.audio.configured); setTextMode(!status?.audio.configured); voice.setState('idle'); void refresh(); }
  }
  function open(value: Session) { voice.stop(); setSession(value); setTab('session'); setInput(''); setRetryAudioFile(undefined); setHintText(''); setTranscript(true); setTextMode(!status?.audio.configured); setError(''); voice.setState('idle'); }
  async function sessionAction(name: string, data: unknown = {}) {
    if (!session) return;
    if (name === 'finish' || name === 'complete' || name === 'edit') voice.stop();
    const payload = name === 'retry' ? { ...(data as Record<string, unknown>), audioFile: retryAudioFile } : data;
    const next = await action(name === 'finish' ? 'Готовлю разбор' : 'Сохраняю результат', () => request<Session>(`sessions/${session.id}/${name}`, payload));
    if (next) { setSession(next); setInput(''); setRetryAudioFile(undefined); void refresh(); }
  }
  async function showTranscript() {
    if (!session) return;
    const next = await action('Показываю текст', () => request<Session>(`sessions/${session.id}/show-text`, {}));
    if (next) { setSession(next); setTranscript(true); }
  }
  function resend() {
    const last = session?.turns.at(-1); if (last?.role !== 'user') return;
    lastSent.current = { id: last.id, text: last.text, source: last.source, audioFile: last.audioFile };
    void send(last.text, last.audioFile);
  }
  const active = state?.sessions.find(s => s.status === 'active' || s.status === 'analysing' || s.status === 'review');
  const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(new Date());
  const pending = !!busy;
  const navigation = (next: Tab) => { voice.stop(); dismissStartup(); setTab(next); setError(''); };
  const chosenFamily = FAMILIES.find(family => family.id === selectedFamily);
  const visibleSessions = state?.sessions.filter(value => (value.lesson.title + ' ' + value.lesson.goal).toLowerCase().includes(search.toLowerCase())) || [];
  const calibration = Math.min(3, state?.calibrationCompleted || 0);
  const independent = state?.skills.filter(skill => skill.state === 'independent').length || 0;

  if (needLogin) return (
    <main className="login-screen">
      <div className="brand-symbol">R<span>·</span></div>
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
  if (state && startupVisible) return <StartupWelcome state={state} busy={busy} error={error} onStart={minutes => void start(undefined, undefined, minutes)} onResume={value => { dismissStartup(); open(value); }} onDismiss={dismissStartup} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand"><span className="brand-symbol">R<span>·</span></span><span>ratmir<span>english</span></span></a>
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
      <header className="topbar">
        <span className="eyebrow">ЛИЧНАЯ ПРАКТИКА АНГЛИЙСКОГО</span>
        <div><span className="private-label"><ShieldCheck size={14} /> Только для тебя</span><time>{day}</time></div>
      </header>
      {error && <div className="message-banner error" role="alert"><CircleHelp size={18} /><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть сообщение"><X size={18} /></button></div>}
      {notice && <div className="message-banner success" role="status"><Check size={18} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть сообщение"><X size={18} /></button></div>}
      <div ref={screenRef} className="screen-content" data-screen={startupVisible ? 'startup' : tab}>
      {!state ? <div className="page-loading"><div className="skeleton title-skeleton" /><div className="skeleton panel-skeleton" /><p>Открываю твой тренинг…</p>{error && <button className="button secondary" onClick={() => void refresh()}>Повторить загрузку</button>}</div> : <>
      {tab === 'today' && <>
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
                <h2>{active?.lesson.title || (calibration < 3 ? 'Узнаем, как ты говоришь' : state.reviews[0]?.focus || 'Новый разговор на английском')}</h2>
                <p>{active?.lesson.goal || (calibration < 3 ? 'Знакомая тема и живой диалог. Найдём твои сильные стороны и то, что стоит потренировать первым.' : 'Sol учтёт твои попытки, повторения и ближайшие цели — и подберёт новую ситуацию.')}</p>
              </div>
              <div className="lesson-steps" aria-label="Как проходит занятие">
                <span><small>01</small> Разговор</span><span><small>02</small> Разбор</span><span><small>03</small> Своя версия</span>
              </div>
              <div className="daily-controls lesson-meta">
                <span className="duration"><History size={16} /> {active?.lesson.minutes || state.profile.dailyMinutes} минут</span>
                {active ? <span className="quiet-tag">{active.mode === 'call' ? 'Созвон' : 'Учебный режим'}</span> : <ModeSwitch mode={mode} setMode={setMode} />}
              </div>
              <button className="button primary large" disabled={pending} onClick={() => active ? open(active) : void start()}>
                <Play size={18} /><span>{pending ? busy : active ? 'Продолжить занятие' : calibration < 3 ? 'Начать калибровку' : 'Начать практику'}</span><ArrowRight size={21} />
              </button>
              <small className="daily-note">{status?.audio.configured ? 'Можно говорить или писать. Разбор по-русски.' : 'Начни текстом. Голос можно подключить в настройках.'}</small>
              <button type="button" className="text-button" onClick={launchQuick}><BookOpen size={16} />Быстрый разбор фразы</button>
            </section>
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
                  <svg viewBox="0 0 100 100" role="img" aria-label={'Калибровка: ' + calibration + ' из 3 завершённых занятий'}>
                    <circle className="ring-track" cx="50" cy="50" r="42" fill="none" />
                    <circle className="ring-value" cx="50" cy="50" r="42" fill="none" strokeDasharray="263.9" strokeDashoffset={263.9 * (1 - calibration / 3)} transform="rotate(-90 50 50)" />
                  </svg>
                  <div><strong>{calibration}<small>/3</small></strong><span>этапа</span></div>
                </div>
                <div><h2>{state.profile.name}</h2><span className="profile-level">{calibration < 3 ? 'Калибруем навыки' : 'Калибровка завершена'}</span><p className="caption">{calibration < 3 ? 'Сначала реальные попытки, затем оценка.' : 'Следующие занятия уточняют профиль.'}</p></div>
              </div>
              <div className="profile-stats">
                <div><strong>{state.xp}<small> XP</small></strong><span>за практику</span></div>
                <div><strong>{state.completed}</strong><span>занятий завершено</span></div>
              </div>
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
      {tab === 'practice' && <>
        <div className="page-heading"><div><h1>Выбери разговор</h1><p>Ситуация твоя. Задачу и сложность подберёт Sol.</p></div><ModeSwitch mode={mode} setMode={setMode} /></div>
        <div className="topic-bar">
          <Lightbulb size={18} />
          <input aria-label="Тема для следующего занятия" placeholder="О чём поговорим? AI, игра, спорт, идея проекта…" value={topic} onChange={event => setTopic(event.target.value)} maxLength={300} />
          <button className="button secondary" disabled={pending} onClick={() => void start()}>Подобрать мне <ArrowRight size={16} /></button>
        </div>
        <div className="practice-layout">
          <div className="practice-groups">
            {(['life', 'work', 'relocation'] as const).map(context => {
              const families = FAMILIES.filter(family => family.context === context);
              return <section className="practice-group" key={context}>
                <div className="section-title practice-group-title"><h2>{contextNames[context]}</h2><span className="quiet-tag">{families.length} {families.length < 5 ? 'сценария' : 'сценариев'}</span></div>
                <div className="scenario-list">{families.map(family => <div key={family.id}>
                  <button className={'family-row ' + (chosenFamily?.id === family.id ? 'selected' : '')} aria-pressed={chosenFamily?.id === family.id} onClick={() => setSelectedFamily(family.id)}>
                    <span className={'context-icon ' + context}>{context === 'life' ? <Ear size={19} /> : context === 'work' ? <AudioLines size={19} /> : <ArrowUpRight size={19} />}</span>
                    <span className="family-copy"><strong>{family.title}</strong><small>{family.description}</small></span>
                    <span className="selection-marker" aria-hidden="true">{chosenFamily?.id === family.id ? <Check size={17} /> : <ChevronRight size={17} />}</span>
                  </button>
                  {chosenFamily?.id === family.id && <ScenarioPreview family={family} mode={mode} minutes={state.profile.dailyMinutes} topic={topic} busy={busy} inline onStart={value => void start(value.id, value.context)} />}
                </div>)}</div>
              </section>;
            })}
          </div>
          <ScenarioPreview family={chosenFamily} mode={mode} minutes={state.profile.dailyMinutes} topic={topic} busy={busy} onStart={value => void start(value.id, value.context)} />
        </div>
        <p className="caption">Работа и обычная жизнь примерно поровну. Ближайшие интервью могут временно менять акцент.</p>
      </>}
      {tab === 'progress' && <>
        <div className="page-heading"><div><h1>Твой прогресс</h1><p>Что получается самому и на каких попытках это основано.</p></div><span className="quiet-tag">{calibration < 3 ? 'Калибровка ' + calibration + '/3' : 'Профиль по твоим данным'}</span></div>
        <div className="progress-summary progress-metrics">
          <div><strong>{state.completed}</strong><span>завершённых занятий</span></div>
          <div><strong>{state.xp}<small> XP</small></strong><span>за практику и свои попытки</span></div>
          <div><strong>{independent}<small>/{SKILLS.length}</small></strong><span>навыков проверено самостоятельно</span></div>
        </div>
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
            <section className="review-list">
              <div className="section-title"><h3>Вернуться к навыку</h3><RefreshCw size={18} /></div>
              <p className="caption">Повторения появляются из твоих разборов.</p>
              {state.reviews.length ? state.reviews.slice(0, 8).map(review => <div className="review-row" key={review.id}>
                <span><strong>{review.focus}</strong><small>{SKILLS.find(skill => skill.id === review.skill)?.label}</small></span><time>{date(review.dueAt)}</time>
              </div>) : <div className="review-empty"><Target size={27} /><h3>Сначала найдём цель</h3><p>После первых разговоров здесь появятся подходящие повторения.</p></div>}
            </section>
            <div className="learning-note"><GraduationCap size={23} /><h3>Рост — в твоих ответах</h3><p>XP показывает практику. Самостоятельность подтверждают новые ситуации и повторная проверка.</p></div>
          </aside>
        </div>
      </>}
      {tab === 'history' && <>
        <div className="page-heading"><div><h1>Твои разговоры</h1><p>Исходная попытка, разбор и то, что ты смог улучшить.</p></div><a className="button secondary" href="/api/export" download><Download size={16} /> Скачать историю</a></div>
        <label className="search-field"><span className="caption">Найти занятие</span><input className="search-input" placeholder="По названию или цели разговора…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="history-list">
          {visibleSessions.map(value => <div className="history-row" key={value.id}>
            <button onClick={() => open(value)}>
              <span className={'context-icon ' + value.lesson.context}><AudioLines size={19} /></span>
              <span className="session-row-copy"><strong>{value.lesson.title}</strong><small>{date(value.createdAt)} · {contextNames[value.lesson.context]} · {sessionStatus(value)}</small></span><ChevronRight size={17} />
            </button>
            <button className={deleting === value.id ? 'text-button danger' : 'icon-button'} aria-label={deleting === value.id ? 'Подтвердить удаление занятия' : 'Удалить занятие'} onClick={() => {
              if (deleting !== value.id) { setDeleting(value.id); return; }
              void action('Удаляю занятие', async () => { await request('sessions/' + value.id, undefined, 'DELETE'); setDeleting(''); await refresh(); });
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
              <button className="button danger-button" disabled={pending || reset !== 'DELETE'} onClick={() => void action('Удаляю историю', async () => { const next = await request<AppState>('reset', { confirmation: reset }); setState(next); setReset(''); setSession(null); setNotice('История удалена. Можно начать новую калибровку.'); })}>Удалить историю</button>
            </details>
          </section>
        </div>
      </>}
      {tab === 'session' && session && <SessionView session={session} setSession={setSession} busy={busy} input={input} setInput={setInput} textMode={textMode} setTextMode={setTextMode} transcript={transcript} showTranscript={showTranscript} hintText={hintText} comfort={comfort} setComfort={setComfort} voice={voice} audioReady={!!status?.audio.configured} onSend={() => void send(input)} onResend={resend} onAction={sessionAction} onHint={level => void action('Подбираю опору', async () => { const result = await request<{ text: string }>(`sessions/${session.id}/hint`, { level }); setHintText(result.text); })} onBack={() => navigation('today')} onSettings={() => navigation('settings')} editing={editing} setEditing={setEditing} editText={editText} setEditText={setEditText} />}
      </>}
      </div><footer className="page-footer"><span>Своя попытка → разбор → новый разговор</span><span>Личный тренинг · v0.1</span></footer></div></div>{tab !== 'session' && <nav ref={mobileNavigation.nav} className="mobile-nav" aria-label="Навигация телефона"><span ref={mobileNavigation.highlight} className="navigation-highlight" aria-hidden="true" />{NAV.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => navigation(item.id)} aria-current={tab === item.id ? 'page' : undefined}><item.icon size={21} /><span>{item.name}</span></button>)}<button className={tab === 'settings' ? 'active' : ''} onClick={() => navigation('settings')} aria-current={tab === 'settings' ? 'page' : undefined}><Settings size={21} /><span>Настройки</span></button></nav>}
  </div>;
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
        <div className="activity-stat"><strong className="activity-value">{total}</strong><span>завершённых занятий</span></div>
        <p>{total ? days + ' из 7 дней с практикой. Продолжай в своём темпе.' : 'После первой практики здесь появится твой ритм.'}</p>
        <small className="caption">По дате начала занятия</small>
      </div>
      <div className={'activity-chart ' + (!total ? 'activity-empty' : '')} role="img" aria-label={points.map(point => date(point.day.toISOString()) + ': ' + point.count + ' завершённых занятий').join(', ')}>
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
  session: Session; setSession: (s: Session) => void; busy: string; input: string; setInput: (s: string) => void;
  textMode: boolean; setTextMode: (v: boolean) => void; transcript: boolean; showTranscript: () => Promise<void>;
  hintText: string; comfort: number; setComfort: (n: number) => void; voice: ReturnType<typeof useVoice>; audioReady: boolean;
  onSend: () => void; onResend: () => void; onAction: (name: string, data?: unknown) => Promise<void>; onHint: (level: 1 | 2 | 3) => void;
  onBack: () => void; onSettings: () => void; editing: string; setEditing: (s: string) => void; editText: string; setEditText: (s: string) => void;
};
function SessionView(p: SessionProps) {
  const { session: s, voice, busy } = p;
  const active = s.status === 'active' || s.status === 'error';
  const last = s.turns.at(-1);
  const pending = !!busy || voice.state === 'thinking' || voice.state === 'transcribing';
  return <div className="session-page"><div className="session-heading"><button className="text-button" onClick={p.onBack}><ChevronRight className="back-icon" size={17} /> Сегодня</button><span className="quiet-tag">{s.mode === 'call' ? 'Созвон без опор' : 'Учебный режим'}</span></div><div className="page-heading"><div><h1>{s.lesson.title}</h1><p>{s.lesson.role}</p></div></div>
    {active && <div className="conversation-layout"><section className={`conversation-stage ${p.textMode ? 'text-mode' : ''}`}>{p.textMode && last?.role === 'assistant' && <div className="current-prompt"><span>Собеседник</span><p lang="en">{last.text}</p></div>}<VoiceOrb state={busy ? 'thinking' : voice.state} volume={voice.volume} /><h2 className="voice-state" aria-live="polite">{busy || voiceNames[voice.state]}</h2><p className="voice-caption">{p.textMode ? 'Ответь по-английски, собеседник продолжит разговор.' : 'Голос AI. Нажми микрофон, скажи реплику и нажми ещё раз, чтобы отправить.'}</p>{last?.role === 'user' && <div className="pending-reply"><p>Твоя реплика сохранена. Повтори получение ответа собеседника.</p><button className="button secondary" disabled={pending} onClick={p.onResend}><RefreshCw size={17} />Повторить ответ собеседника</button></div>}<div className="voice-controls"><button className="voice-control" onClick={() => voice.stop()} aria-label="Пауза"><Pause size={22} /><span>Пауза</span></button><button className={`voice-control main ${voice.state === 'listening' ? 'recording' : ''}`} disabled={pending || !p.audioReady || last?.role === 'user'} onClick={() => void voice.record()} aria-label={voice.state === 'listening' ? 'Отправить запись' : 'Говорить'}>{voice.state === 'listening' ? <Square size={23} /> : <Mic size={27} />}<span>{voice.state === 'listening' ? 'Отправить' : 'Говорить'}</span></button><button className="voice-control" disabled={pending || !s.turns.some(t => t.role === 'user')} onClick={() => { voice.stop(); void p.onAction('finish'); }} aria-label="Завершить и получить разбор"><Check size={23} /><span>Разбор</span></button></div>{!p.audioReady && <button className="text-button audio-setup" onClick={p.onSettings}>Подключить качественный голос <ArrowUpRight size={15} /></button>}{voice.canRetry && <button className="button secondary voice-retry" disabled={pending} onClick={() => void voice.retry()}><RefreshCw size={16} />{voice.retryLabel || 'Повторить'}</button>}<div className="conversation-mode"><button className={p.textMode ? 'selected' : ''} onClick={() => { p.setTextMode(true); void p.showTranscript(); }}>Текст</button><button className={!p.textMode ? 'selected' : ''} disabled={!p.audioReady} onClick={() => p.setTextMode(false)}>Голос</button>{last?.role === 'assistant' && p.audioReady && <button disabled={pending} onClick={() => void voice.speak(s, last)}><Play size={14} /> Послушать</button>}</div>{p.textMode && <form className="reply-form" onSubmit={e => { e.preventDefault(); p.onSend(); }}><textarea aria-label="Твой ответ по-английски" lang="en" placeholder="Your reply…" rows={3} value={p.input} onChange={e => p.setInput(e.target.value)} disabled={pending} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); p.onSend(); } }} /><div><small>Ctrl + Enter, чтобы отправить</small><button className="button primary" disabled={pending || !p.input.trim() || last?.role === 'user'}><Send size={17} /> Отправить</button></div></form>}</section><aside className="conversation-inspector"><div className="goal-block"><span className="eyebrow">ЦЕЛЬ ЭТОГО РАЗГОВОРА</span><h3>{s.lesson.goal}</h3><p>{s.lesson.why}</p></div>{s.mode === 'learning' && <section className="support-section"><h3><Lightbulb size={17} /> Поддержка</h3><p>Сначала попробуй сам. Опора учитывается в разборе.</p><div className="support-buttons"><button disabled={pending} onClick={() => p.onHint(1)}>Намёк</button><button disabled={pending} onClick={() => p.onHint(2)}>Конструкция</button><button disabled={pending} onClick={() => p.onHint(3)}>Пример</button></div>{p.hintText && <div className="hint-text">{p.hintText}</div>}</section>}<details className="transcript" open={p.transcript} onToggle={e => { if (e.currentTarget.open && !p.transcript) void p.showTranscript(); }}><summary>Текст разговора <BookOpen size={17} /></summary><div className="turn-list">{s.turns.map(t => <div className={`turn ${t.role}`} key={t.id}><span>{t.role === 'user' ? 'Ты' : 'Собеседник'}</span><p lang="en">{t.text}</p></div>)}</div></details><div className="inspector-note"><GraduationCap size={18} /><p>Подробный разбор после разговора. {(p.textMode || p.transcript) && 'Текст помогает ответить; понимание на слух проверим без текста. '}Произношение по одному тексту не оценивается.</p></div></aside></div>}
    {s.status === 'analysing' && <div className="analysis-loading"><VoiceOrb state="thinking" /><h2>Разбираю твою попытку</h2><p>Sol ищет конкретные основания и выбирает ближайшие цели. Можно закрыть экран, результат сохранится.</p><button className="button secondary" onClick={p.onBack}>Вернуться на главную</button></div>}
    {s.status === 'error' && s.error && <div className="message-banner error"><p>{s.error}</p><button className="button secondary" onClick={() => void p.onAction('reanalyse')}>Повторить разбор</button></div>}
    {s.analysis && <div className="analysis-layout"><div><section className="analysis-intro"><span className="eyebrow">РАЗБОР ТВОЕЙ ПОПЫТКИ</span><p className="analysis-summary">{s.analysis.summary}</p>{s.analysis.strengths.length > 0 && <div className="strengths">{s.analysis.strengths.map((v, i) => <p key={i}><Check size={17} />{v}</p>)}</div>}</section>{s.analysis.priorities.map((priority, i) => <section className="priority" key={i}><div className="priority-heading"><span className="priority-number">0{i + 1}</span><span className="quiet-tag">{priority.type === 'language' ? 'Английский' : 'Диалог'}</span></div><h3>{priority.title}</h3><blockquote lang="en">{priority.quote}</blockquote><p>{priority.explanation}</p><details><summary>Возможная формулировка</summary><p className="example" lang="en">{priority.example}</p><small>Один из вариантов. Свою попытку формулируй своими словами.</small></details><div className="retry-prompt"><Target size={17} /><span>{priority.retryInstruction}</span></div></section>)}{s.status !== 'completed' && <section className="retry-section"><h2>Теперь твоя версия</h2><p>Повтори важный эпизод своими словами. Sol сравнит его с исходной попыткой.</p>{p.audioReady && <div className="retry-voice"><button className="button secondary" disabled={pending} onClick={() => void voice.record()}>{voice.state === 'listening' ? <Square size={17} /> : <Mic size={17} />}{voice.state === 'listening' ? 'Закончить запись' : 'Сказать голосом'}</button><span aria-live="polite">{voiceNames[voice.state]}</span></div>}{voice.canRetry && <button className="text-button" disabled={pending} onClick={() => void voice.retry()}>{voice.retryLabel || 'Повторить'}</button>}<form onSubmit={e => { e.preventDefault(); void p.onAction('retry', { text: p.input }); }}><textarea lang="en" aria-label="Улучшенная попытка" rows={4} placeholder="My improved reply…" value={p.input} onChange={e => p.setInput(e.target.value)} /><button className="button primary" disabled={pending || voice.state === 'listening' || !p.input.trim()}>Проверить свою попытку <ArrowRight size={18} /></button></form></section>}{s.retries.map((retry, i) => <section className="retry-result" key={i}><span className="eyebrow">СОБСТВЕННАЯ ПОПЫТКА {i + 1} · {retry.improved === true ? 'Есть улучшение' : 'Продолжаем работу'}</span><blockquote lang="en">{retry.text}</blockquote>{retry.audioFile && <audio controls preload="none" src={`/api/audio/${retry.audioFile}`} />}<p>{retry.feedback}</p></section>)}{s.status !== 'completed' && <section className="finish-section"><h3>Как ощущался разговор?</h3><div className="comfort-choice" aria-label="Комфорт от 1 до 5">{[1, 2, 3, 4, 5].map(n => <button key={n} aria-pressed={p.comfort === n} className={p.comfort === n ? 'selected' : ''} onClick={() => p.setComfort(n)}>{n}</button>)}<span>Сложно → комфортно</span></div><button className="button primary" disabled={pending || voice.state === 'listening' || (!!s.analysis.priorities.length && s.retries.at(-1)?.improved !== true)} onClick={() => void p.onAction('complete', { comfort: p.comfort })}>Завершить занятие <Check size={18} /></button></section>}{s.status === 'completed' && <div className="completed-note"><Check size={22} /><span>Занятие завершено. Свой повтор сохранён отдельно от независимой проверки.</span></div>}</div><aside className="analysis-aside"><section><h3>Следующий шаг</h3><p>{s.analysis.nextFocus}</p><span className="caption">GPT‑6.1 Sol · {date(s.analysis.createdAt)}</span></section><details><summary>Наблюдения по навыкам</summary>{s.analysis.evidence.map((e, i) => <div className="observation" key={i}><strong>{SKILLS.find(k => k.id === e.skill)?.label}</strong><span>{e.result === 'success' ? 'Получилось' : e.result === 'partial' ? 'Частично' : e.result === 'difficulty' ? 'Есть трудность' : e.result === 'disputed' ? 'Спорно' : 'Не проверено'}</span><p>{e.reason}</p></div>)}</details><details><summary>Ограничения оценки</summary>{s.analysis.limitations.map((v, i) => <p key={i}>{v}</p>)}</details><details><summary>Исходный разговор</summary>{s.turns.map(t => <div className="turn" key={t.id}><span>{t.role === 'user' ? 'Ты' : 'Собеседник'}</span><p lang="en">{t.text}</p>{t.audioFile && <audio controls preload="none" src={`/api/audio/${t.audioFile}`} />}{t.role === 'user' && <button className="text-button" onClick={() => { p.setEditing(t.id); p.setEditText(t.text); }}>Исправить расшифровку</button>}{p.editing === t.id && <div className="edit-turn"><textarea value={p.editText} onChange={e => p.setEditText(e.target.value)} aria-label="Исправленный транскрипт" /><button className="button secondary" onClick={() => { void p.onAction('edit', { turnId: t.id, text: p.editText, disputed: false }); p.setEditing(''); }}>Сохранить и пересчитать</button><button className="text-button" onClick={() => { void p.onAction('edit', { turnId: t.id, text: p.editText, disputed: true }); p.setEditing(''); }}>Исключить как спорное</button></div>}</div>)}</details></aside></div>}
  </div>;
}
