'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import type { CatalogSection } from '@/lib/training';
import type { AchievementTarget } from '@/lib/achievement-targets';
import type { Session } from '@/lib/types';
import type { CallSummary } from '@/lib/calls/types';
import type { PlacementView } from '@/lib/placement/types';
import { PlacementFlow } from './placement/placement-flow';
import { QuickCoach } from './quick-coach';
import { StartupWelcome } from './startup-welcome';
import { AppContext, type AppContextValue, type PracticeTarget } from './app/app-context';
import { messageOf, request } from './app/api';
import { diffProgress, progressSnapshot, type Celebration } from './app/celebrations';
import type { TabId } from './app/labels';
import { useAppData } from './app/use-app-data';
import { useNavigation, withViewTransition } from './app/use-navigation';
import { useSessionController, type Feedback, type SessionController } from './app/use-session-controller';
import { CelebrationLayer } from './shell/celebration-layer';
import { LoginScreen } from './shell/login-screen';
import { PreparationPanel, SessionPill, Sidebar, TabBar } from './shell/navigation';
import { ToastRegion, useToasts } from './shell/toasts';
import { CallsTab } from './screens/calls-tab';
import { PracticeScreen } from './screens/practice-screen';
import { ProfileScreen } from './screens/profile-screen';
import { ProgressScreen } from './screens/progress-screen';
import { TodayScreen } from './screens/today-screen';
import { SessionScreen } from './session/session-screen';
import { useGlassPointer, useInputModality } from './ui/use-glass-pointer';

const GREETED_KEY = 'ratmir:greeted:v1';
const SEEN_REVIEWS_KEY = 'ratmir:seen-reviews:v1';

function Ambient({ mood }: { mood?: string }) {
  return <div className="ambient" aria-hidden="true" data-mood={mood}><i /><i /><i /></div>;
}

/** Remove `?entry=` so a reload never replays the cold open; `/` stays inside the Electron URL allowlist. */
function dropEntryParameter() {
  const address = new URL(window.location.href);
  if (!address.searchParams.has('entry')) return;
  address.searchParams.delete('entry');
  // `null` state lets the Next.js router sync its URL; passing its own internal state would make it restore `?entry=` later.
  window.history.replaceState(null, '', address.pathname + address.search + address.hash);
}

function useSeenReviews() {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    try { const stored: unknown = JSON.parse(localStorage.getItem(SEEN_REVIEWS_KEY) || '[]'); if (Array.isArray(stored)) setSeen(new Set(stored.filter((item): item is string => typeof item === 'string').slice(-300))); }
    catch { /* Optional convenience. */ }
  }, []);
  const mark = useCallback((id: string) => {
    setSeen(previous => {
      if (previous.has(id)) return previous;
      const next = new Set(previous); next.add(id);
      try { localStorage.setItem(SEEN_REVIEWS_KEY, JSON.stringify([...next].slice(-300))); } catch { /* Optional. */ }
      return next;
    });
  }, []);
  return { seen, mark };
}

function App() {
  const toasts = useToasts();
  const nav = useNavigation();
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [celebrationOrigin, setCelebrationOrigin] = useState<DOMRect | null>(null);
  const push = toasts.push;
  const feedback = useMemo<Feedback>(() => ({
    error: (message, action) => push('error', message, action),
    notice: (message, action) => push('success', message, action),
    celebrate: (items, origin) => {
      if (!items.length) return;
      setCelebrationOrigin(origin?.getBoundingClientRect() ?? null);
      setCelebrations(previous => [...previous, ...items]);
    },
  }), [push]);
  const lessonRef = useRef<SessionController | null>(null);
  const navRef = useRef(nav);
  navRef.current = nav;

  const data = useAppData({
    openSessionId: () => lessonRef.current?.session?.id ?? null,
    onSessionSettled: (session: Session) => {
      const lesson = lessonRef.current;
      const visible = navRef.current.sessionOpenRef.current && lesson?.session?.id === session.id && !document.hidden;
      if (visible || session.status !== 'review') return;
      push('success', `Разбор готов: ${session.lesson.title}`, { label: 'Открыть', run: () => lessonRef.current?.open(session) });
      if (document.hidden) void window.ratmirDesktop?.notify?.({ kind: 'review-ready', title: 'Разбор готов', body: session.lesson.title }).catch(() => undefined);
    },
    onCallSettled: (call: CallSummary) => {
      const open = () => navRef.current.go('calls', { callId: call.id });
      if (call.status === 'ready') {
        push('success', `Разбор созвона готов: ${call.title}`, { label: 'Открыть', run: open });
        if (document.hidden) void window.ratmirDesktop?.notify?.({ kind: 'call-ready', title: 'Разбор созвона готов', body: call.title }).catch(() => undefined);
      } else if (call.status === 'needs-speaker') push('success', 'Подтверди, кто из собеседников ты — и разбор продолжится.', { label: 'Подтвердить', run: open });
      else if (call.status === 'error') push('error', `Созвон «${call.title}» не обработан.`, { label: 'Открыть', run: open });
    },
  });
  const lesson = useSessionController(data, nav, feedback);
  lessonRef.current = lesson;
  // Development-only QA hook: replay a celebration without completing a real lesson.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = window as Window & { __smoothTalkCelebrate?: (items: Celebration[]) => void };
    target.__smoothTalkCelebrate = items => feedback.celebrate(items);
    return () => { delete target.__smoothTalkCelebrate; };
  }, [feedback]);
  const seen = useSeenReviews();

  const [quickVisible, setQuickVisible] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [startupVisible, setStartupVisible] = useState(false);
  const startupDecided = useRef(false);
  const placementBefore = useRef(progressSnapshot(null));
  const [catalog, setCatalog] = useState<CatalogSection[] | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [practiceTarget, setPracticeTarget] = useState<PracticeTarget>({ familyId: null, freeTopic: false, nonce: 0 });

  // Cold open (once per launch): the placement test comes first until a result exists; otherwise a short greeting.
  useLayoutEffect(() => {
    if (!data.state || startupDecided.current) return;
    startupDecided.current = true;
    const entry = new URLSearchParams(window.location.search).get('entry');
    const placement = data.state.placement;
    let greeted = false;
    try { greeted = sessionStorage.getItem(GREETED_KEY) === '1'; sessionStorage.setItem(GREETED_KEY, '1'); } catch { /* Optional. */ }
    // Once per launch: Electron opens a fresh window (fresh sessionStorage) on every start; a reload never replays it (audit U-33).
    if (placement && !placement.result && placement.status !== 'scoring') { placementBefore.current = progressSnapshot(data.state.progression); setPlacementOpen(true); }
    else if (!greeted && entry !== 'quick') setStartupVisible(true);
    dropEntryParameter();
  }, [data.state]);

  const loadCatalog = useCallback(async () => {
    setCatalogError('');
    try { setCatalog((await request<{ catalog: CatalogSection[] }>('families')).catalog ?? []); }
    catch (error) { setCatalogError(messageOf(error, 'Не удалось загрузить список ситуаций.')); }
  }, []);
  const hasState = !!data.state;
  useEffect(() => { if (hasState && !catalog) void loadCatalog(); }, [hasState, catalog, loadCatalog]);

  const go = useCallback((tab: TabId, options?: Parameters<AppContextValue['go']>[1]) => {
    lessonRef.current?.voice.stop();
    lessonRef.current?.setSessionError('');
    setStartupVisible(false);
    toasts.clearErrors();
    nav.go(tab, options);
  }, [nav, toasts]);
  const openPlacement = useCallback(() => {
    lessonRef.current?.voice.stop();
    placementBefore.current = progressSnapshot(data.stateRef.current?.progression);
    withViewTransition(() => setPlacementOpen(true));
  }, [data.stateRef]);
  const closePlacement = useCallback(async (done: boolean) => {
    withViewTransition(() => setPlacementOpen(false));
    const fresh = await data.refresh();
    if (done && fresh) {
      feedback.celebrate(diffProgress(placementBefore.current, fresh.progression));
      // «Начать практику» from the result: Today's primary card is now the plan built from this result.
      nav.go('today');
    }
  }, [data, feedback, nav]);
  const openFamily = useCallback((familyId: string | null, freeTopic = false) => {
    setPracticeTarget(previous => ({ familyId, freeTopic, nonce: previous.nonce + 1 }));
    if (navRef.current.tab !== 'practice' || navRef.current.sessionOpenRef.current) go('practice');
  }, [go]);
  const launchQuick = useCallback(() => {
    lessonRef.current?.voice.stop();
    if (window.ratmirDesktop) void window.ratmirDesktop.openQuick().catch(() => push('error', 'Не удалось открыть быстрый разбор.'));
    else setQuickVisible(true);
  }, [push]);
  const onAchievementTarget = useCallback((target: AchievementTarget) => {
    if (!target.available) return;
    const state = data.stateRef.current;
    if (target.sessionId) {
      const saved = state?.sessions.find(session => session.id === target.sessionId);
      if (saved) lessonRef.current?.open(saved, 'progress'); else push('error', 'Это занятие не найдено. Обнови данные и попробуй снова.');
      return;
    }
    if (target.destination === 'placement') { openPlacement(); return; }
    if (target.destination === 'calls' || target.destination === 'patterns') { go('calls'); return; }
    if (target.familyId) { openFamily(target.familyId); return; }
    go('practice');
    const section = target.track === 'ielts-foundation' ? 'ielts' : target.track;
    setTimeout(() => document.getElementById(`practice-section-${section}`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 160);
  }, [data.stateRef, go, openFamily, openPlacement, push]);

  const context = useMemo<AppContextValue>(() => ({
    data, nav, lesson, go,
    start: options => void lesson.start({ from: navRef.current.tab, ...options }),
    startDrill: (drillId, mode) => void lesson.start({ drillId, mode, from: navRef.current.tab }),
    openPlacement, openFamily, practiceTarget, catalog, catalogError, reloadCatalog: () => void loadCatalog(),
    toast: { error: feedback.error, notice: feedback.notice }, launchQuick, onAchievementTarget,
    seenReviews: seen.seen, markReviewSeen: seen.mark,
  }), [data, nav, lesson, go, openPlacement, openFamily, practiceTarget, catalog, catalogError, loadCatalog, feedback, launchQuick, onAchievementTarget, seen.seen, seen.mark]);

  if (data.needLogin) return <><Ambient /><LoginScreen onLoggedIn={async () => { await data.refresh(); await data.refreshStatus(); void data.refreshUsage(); }} /></>;
  if (quickVisible) return <><Ambient /><QuickCoach onDismiss={() => setQuickVisible(false)} /></>;
  if (!data.state) return <><Ambient />
    <main className="boot" aria-busy={!data.loadError}>
      {data.loadError ? <div className="glass card" role="alert" style={{ display: 'grid', gap: 12, maxWidth: 420, margin: 16 }}>
        <strong>Не удалось открыть тренинг</strong><p className="caption">{data.loadError}</p>
        <button type="button" className="button primary" onClick={() => void data.refresh()}><ArrowsClockwiseIcon size={17} />Повторить</button>
      </div> : <div className="boot-dot" />}
    </main></>;

  const sessionView = nav.sessionOpen && !!lesson.session;
  const covered = startupVisible || placementOpen;
  const mood = sessionView ? (lesson.voice.state === 'listening' ? 'listening' : lesson.voice.state === 'speaking' ? 'speaking' : undefined) : undefined;
  const placement: PlacementView | undefined = data.state.placement;
  return <AppContext.Provider value={context}>
    <Ambient mood={mood} />
    <div className="app-shell" data-session={sessionView} inert={covered} aria-hidden={covered || undefined}>
      <Sidebar />
      <main className="workspace" id="content">
        <div className="workspace-inner">
          {sessionView ? <SessionScreen key={lesson.session!.id} />
            : nav.tab === 'today' ? <TodayScreen />
              : nav.tab === 'practice' ? <PracticeScreen />
                : nav.tab === 'calls' ? <CallsTab />
                  : nav.tab === 'progress' ? <ProgressScreen />
                    : <ProfileScreen />}
        </div>
      </main>
      <TabBar />
      <SessionPill />
    </div>
    <PreparationPanel />
    <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} raised={sessionView} />
    <CelebrationLayer queue={celebrations} origin={celebrationOrigin} onDone={id => setCelebrations(previous => previous.filter(item => item.id !== id))}
      onOpenRewards={() => go('progress', { progress: 'rewards' })} />
    {/* W3's PlacementFlow is its own full-screen layer (with «Продолжу позже»); the shell beneath is inert. */}
    {placementOpen && placement && <PlacementFlow state={placement}
      onState={view => data.setState(previous => previous ? { ...previous, placement: view } : previous)}
      onClose={() => void closePlacement(false)} onDone={() => void closePlacement(true)} />}
    {startupVisible && <StartupWelcome state={data.state} onReveal={() => undefined} onFinished={() => setStartupVisible(false)} />}
  </AppContext.Provider>;
}

/**
 * Composition root. The SSR/first paint is a neutral boot screen, so the 420 px quick window never flashes
 * the full app (audit C-18); the quick coach also never waits for /api/state.
 */
export function TrainingApp() {
  useInputModality();
  useGlassPointer();
  const [mode, setMode] = useState<'boot' | 'quick' | 'app'>('boot');
  useLayoutEffect(() => {
    setMode(new URLSearchParams(window.location.search).get('entry') === 'quick' ? 'quick' : 'app');
  }, []);
  if (mode === 'boot') return <><Ambient /><main className="boot" aria-busy="true"><div className="boot-dot" /></main></>;
  if (mode === 'quick') return <><Ambient /><QuickCoach onDismiss={() => { dropEntryParameter(); setMode('app'); }} /></>;
  return <App />;
}
