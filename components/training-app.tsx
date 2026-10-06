'use client';

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CatalogSection } from '@/lib/training';
import type { AchievementTarget } from '@/lib/achievement-targets';
import type { Session } from '@/lib/types';
import type { CallSummary } from '@/lib/calls/types';
import type { PlacementView } from '@/lib/placement/types';
import { bootMotivation, deriveOpeningGreeting } from '@/lib/startup-welcome';
import { applyThemePreference, followThemeChanges, readThemePreference } from '@/lib/client/theme';
import { PlacementFlow } from './placement/placement-flow';
import { CaptureSheet } from './capture/capture-card';
import { CaptureOverlay } from './capture/capture-overlay';
import { PhrasesSheet } from './phrases/phrases-sheet';
import { LaunchBackdrop, LaunchLayer, type LaunchCopy } from './startup-welcome';
import { AppContext, type AppContextValue, type PracticeTarget } from './app/app-context';
import { messageOf, request } from './app/api';
import { diffProgress, progressSnapshot, type Celebration } from './app/celebrations';
import type { TabId } from './app/labels';
import { launchAssetUrls, loadUiFont, waitForLaunchReady } from './app/preload-assets';
import { useAppData } from './app/use-app-data';
import { useNavigation, withViewTransition, type NavigationOptions } from './app/use-navigation';
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
import { afterLaunch, ENTRANCE_MS, markLaunchSettled, markShellRevealed, useEntrance, type EntranceVariant } from './ui/entrance';
import { prefersReducedMotion } from './ui/motion';
import { setShellCovered } from './ui/shell-cover';
import { useGlassPointer, useInputModality } from './ui/use-glass-pointer';

const GREETED_KEY = 'ratmir:greeted:v1';
const SEEN_REVIEWS_KEY = 'ratmir:seen-reviews:v1';

/**
 * The launch layer's life (MOTION-PASS-0.5.2 §4, PASS-0.5.3 §6): 'boot' is the preloader (companion + motivation line),
 * 'greeting' the personal hello, 'leaving' the hand-off fade, 'done' = unmounted. `skipped`: a key or click cut the greeting.
 */
type Launch = { phase: 'boot' | 'greeting' | 'leaving' | 'done'; copy: LaunchCopy | null; skipped: boolean };
/** If the launch never reaches a staircase (an error that stays up), waiting background results land after this anyway. */
const LAUNCH_SETTLE_FALLBACK_MS = 15_000;
const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

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

/** `openPhrasesAtStart`: «Мои фразы» was pressed on the capture page in a plain browser (Practice with the phrases sheet). */
function App({ openPhrasesAtStart = false }: { openPhrasesAtStart?: boolean }) {
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
      } else if (call.status === 'needs-speaker') push('success', 'Подтверди, кто из собеседников ты — и разбор продолжится.', { label: 'Выбрать, кто я', run: open });
      else if (call.status === 'error') push('error', `Созвон «${call.title}» не обработан.`, { label: 'Открыть', run: open });
    },
    // PASS-0.5.3 §5: fetched data renders in a transition (sliced, never one long task under an animation); limits
    // wait until the launch has played, so a banner never drops into the staircase.
    background: startTransition,
    afterLaunch,
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

  // 0.5.3 «Запомнить» and «Мои фразы» (PASS-0.5.3 §1.6): sheets over the shell; `focus` opens one phrase in place.
  const [captureOpen, setCaptureOpen] = useState(false);
  const [phrasesSheet, setPhrasesSheet] = useState(() => ({ open: openPhrasesAtStart, focus: null as string | null, nonce: 0 }));
  const [placementOpen, setPlacementOpen] = useState(false);
  const placementBefore = useRef(progressSnapshot(null));
  const [catalog, setCatalog] = useState<CatalogSection[] | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [practiceTarget, setPracticeTarget] = useState<PracticeTarget>({ familyId: null, freeTopic: false, nonce: 0 });

  // ── Launch: one layer from the first paint until the shell takes over (MOTION-PASS-0.5.2 §4) ──
  // Boot is the preloader (PASS-0.5.3 §6): the companion idles on the compositor with a motivation line that needs no
  // data while the state loads and the shell mounts hidden beneath; the greeting starts only once everything is ready.
  const [launch, setLaunch] = useState<Launch>({ phase: 'boot', copy: null, skipped: false });
  const launchPhase = useRef(launch.phase);
  launchPhase.current = launch.phase;
  const [retrying, setRetrying] = useState(false);
  const startupDecided = useRef(false);
  const [boot] = useState(() => ({ at: performance.now(), line: bootMotivation(new Date(), localTimeZone()) }));
  const [ready, setReady] = useState(false);
  /** The layer fades out over whatever comes next (shell, placement test, sign-in); `skip` removes it at once. */
  const handOff = useCallback((skip = false) => setLaunch(current => current.phase === 'done' ? current
    : skip ? { ...current, phase: 'done', skipped: true }
      : current.phase === 'leaving' ? current : { ...current, phase: 'leaving' }), []);
  const retryLaunch = useCallback(async () => {
    setRetrying(true);
    try { await data.refresh(); void data.refreshStatus(); } finally { setRetrying(false); }
  }, [data.refresh, data.refreshStatus]);

  // Ready = the state has landed and the shell is mounted under the layer (this effect runs after that commit), the UI
  // font is loaded, the art of the first screens is decoded (≤ 1.5 s after the state; the rest keeps loading in the
  // background) and one idle moment has passed. Never later than 6 s after the first frame (components/app/preload-assets).
  const hasState = !!data.state;
  const booting = launch.phase === 'boot';
  useEffect(() => { void loadUiFont(); }, []);
  useEffect(() => {
    if (!hasState || !booting || ready) return;
    let live = true;
    void waitForLaunchReady({ bootAt: boot.at, stateAt: performance.now(), urls: launchAssetUrls(data.stateRef.current?.progression) })
      .then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [hasState, booting, ready, boot.at, data.stateRef]);

  // Cold open (once per launch): the placement test comes first until a result exists; otherwise a short greeting
  // next to the same companion that waited for the state. A sign-in in between goes straight to the shell.
  useLayoutEffect(() => {
    if (!data.state || startupDecided.current) return;
    // The launch layer waits for the preloader; after a sign-in (the layer is gone) the decision is immediate.
    if (launchPhase.current === 'boot' && !ready) return;
    startupDecided.current = true;
    const entry = new URLSearchParams(window.location.search).get('entry');
    const placement = data.state.placement;
    let greeted = false;
    try { greeted = sessionStorage.getItem(GREETED_KEY) === '1'; sessionStorage.setItem(GREETED_KEY, '1'); } catch { /* Optional. */ }
    // Once per launch: Electron opens a fresh window (fresh sessionStorage) on every start; a reload never replays it (audit U-33).
    if (placement && !placement.result && placement.status !== 'scoring') {
      placementBefore.current = progressSnapshot(data.state.progression);
      setPlacementOpen(true);
      handOff();
    } else if (launchPhase.current === 'boot' && !greeted && entry !== 'quick' && !prefersReducedMotion() && !document.hidden) {
      const copy = deriveOpeningGreeting(data.state, new Date(), localTimeZone());
      setLaunch(current => current.phase === 'boot' ? { ...current, phase: 'greeting', copy } : current);
    } else handOff();
    dropEntryParameter();
  }, [data.state, ready, handOff]);
  useLayoutEffect(() => { if (data.needLogin) handOff(); }, [data.needLogin, handOff]);

  // The catalog renders only on Practice: it lands after the launch has played, in a transition (PASS-0.5.3 §5).
  const loadCatalog = useCallback(async () => {
    setCatalogError('');
    try {
      const list = (await request<{ catalog: CatalogSection[] }>('families')).catalog ?? [];
      afterLaunch('catalog', () => startTransition(() => setCatalog(list)));
    } catch (error) {
      const message = messageOf(error, 'Не удалось загрузить список ситуаций.');
      afterLaunch('catalog', () => startTransition(() => setCatalogError(message)));
    }
  }, []);
  useEffect(() => { if (hasState && !catalog) void loadCatalog(); }, [hasState, catalog, loadCatalog]);

  const clearErrors = toasts.clearErrors;
  const go = useCallback((tab: TabId, options?: NavigationOptions) => {
    lessonRef.current?.voice.stop();
    lessonRef.current?.setSessionError('');
    if (launchPhase.current === 'greeting') handOff(true);
    clearErrors();
    nav.go(tab, options);
  }, [nav, clearErrors, handOff]);
  const openPlacement = useCallback(() => {
    lessonRef.current?.voice.stop();
    placementBefore.current = progressSnapshot(data.stateRef.current?.progression);
    withViewTransition(() => setPlacementOpen(true), 'layer');
  }, [data.stateRef]);
  const closePlacement = useCallback(async (done: boolean) => {
    withViewTransition(() => setPlacementOpen(false), 'layer');
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
  // «Запомнить» (PASS-0.5.3 §1.6, §7): the desktop shell summons its floating overlay; a browser (or a shell that cannot)
  // shows the same capture card in a sheet.
  const openCapture = useCallback(() => {
    setPhrasesSheet(previous => previous.open ? { ...previous, open: false } : previous);
    setCaptureOpen(true);
  }, []);
  const launchQuick = useCallback(() => {
    lessonRef.current?.voice.stop();
    if (window.ratmirDesktop) void window.ratmirDesktop.openQuick().catch(() => openCapture());
    else openCapture();
  }, [openCapture]);
  const openPhrases = useCallback((phraseId?: string) => {
    setCaptureOpen(false);
    setPhrasesSheet(previous => ({ open: true, focus: phraseId ?? null, nonce: previous.nonce + 1 }));
  }, []);
  // Tray «Мои фразы» and the overlay's «Мои фразы» (the shell shows this window, then asks for the place): Practice with
  // the phrases sheet on top. The subscription stays put; the handler reads the latest navigation.
  const showPhrases = useRef(() => {});
  showPhrases.current = () => { go('practice'); openPhrases(); };
  useEffect(() => window.ratmirDesktop?.onNavigate?.(target => { if (target === 'phrases') showPhrases.current(); }), []);
  useEffect(() => { if (openPhrasesAtStart) nav.go('practice'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onAchievementTarget = useCallback((target: AchievementTarget) => {
    if (!target.available) return;
    const state = data.stateRef.current;
    if (target.sessionId) {
      const saved = state?.sessions.find(session => session.id === target.sessionId);
      if (saved) lessonRef.current?.open(saved, 'progress'); else push('error', 'Это занятие не найдено. Обнови данные и попробуй снова.');
      return;
    }
    if (target.destination === 'placement') { openPlacement(); return; }
    if (target.destination === 'calls' || target.destination === 'patterns') { go('calls', target.destination === 'patterns' ? { calls: 'patterns' } : undefined); return; }
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
    toast: { error: feedback.error, notice: feedback.notice }, launchQuick, openPhrases, openCapture, onAchievementTarget,
    seenReviews: seen.seen, markReviewSeen: seen.mark,
  }), [data, nav, lesson, go, openPlacement, openFamily, practiceTarget, catalog, catalogError, loadCatalog, feedback, launchQuick, openPhrases, openCapture, onAchievementTarget, seen.seen, seen.mark]);

  // ── Staircase entrances (MOTION-PASS-0.5.2 §2) ──
  // The shell rises once, the first time it is actually seen: at the launch hand-off, or when the placement test that
  // the launch opened is closed. A skipped greeting gets the shorter screen wave.
  const shellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const shellShown = !!data.state && !data.needLogin && !placementOpen && (launch.phase === 'leaving' || launch.phase === 'done');
  const [revealed, setRevealed] = useState<EntranceVariant | null>(null);
  if (shellShown && !revealed) setRevealed(launch.skipped ? 'screen' : 'launch');
  useEntrance(shellRef, revealed ? 'shell' : null, revealed ?? 'launch');
  useEffect(() => { if (revealed) markShellRevealed(); }, [revealed]);
  // After that, every tab switch and every lesson opening or closing runs the screen wave on the content column.
  const sessionView = nav.sessionOpen && !!lesson.session;
  const viewKey = sessionView ? `session:${lesson.session!.id}` : `tab:${nav.tab}`;
  const [view, setView] = useState({ key: viewKey, serial: 0 });
  if (view.key !== viewKey) setView({ key: viewKey, serial: view.serial + 1 });
  useEntrance(workspaceRef, revealed && view.serial > 0 ? `${view.key}#${view.serial}` : null, 'screen');

  const covered = launch.phase === 'boot' || launch.phase === 'greeting' || placementOpen;
  // The covered shell sleeps (PASS-0.5.3 §5): its mascots and medals hold still while the launch layer or the level test
  // lies over it. Set from the very first frame, before the shell mounts, so nothing in it starts animating unseen;
  // cleared at the hand-off reveal, when they wake one per frame.
  useLayoutEffect(() => { setShellCovered(covered); }, [covered]);
  useEffect(() => () => setShellCovered(false), []);
  // The launch has played once its staircase is over, or at once when it ended without one (sign-in, the level test):
  // then the background results that waited (limits, the catalog) land.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(markLaunchSettled, ENTRANCE_MS[revealed] + 120);
    return () => clearTimeout(timer);
  }, [revealed]);
  const launchEndedUnseen = data.needLogin || (launch.phase === 'done' && !revealed);
  useEffect(() => { if (launchEndedUnseen) markLaunchSettled(); }, [launchEndedUnseen]);
  // Safety net for a launch that stalls (an error left up): counted from the last step it took, so a slow server never
  // releases the waiting results into the greeting.
  useEffect(() => { const timer = setTimeout(markLaunchSettled, LAUNCH_SETTLE_FALLBACK_MS); return () => clearTimeout(timer); }, [launch.phase, hasState]);
  const mood = sessionView ? (lesson.voice.state === 'listening' ? 'listening' : lesson.voice.state === 'speaking' ? 'speaking' : undefined) : undefined;
  const placement: PlacementView | undefined = data.state?.placement;

  let body: ReactNode = null;
  if (data.needLogin) body = <LoginScreen onLoggedIn={async () => { await data.refresh(); await data.refreshStatus(); void data.refreshUsage(); }} />;
  else if (data.state) body = <AppContext.Provider value={context}>
    <div ref={shellRef} className="app-shell" data-shell="" data-session={sessionView} data-pill={!!lesson.session && !nav.sessionOpen && lesson.session.status !== 'completed' && nav.tab !== 'today'}
      inert={covered} aria-hidden={covered || undefined}>
      <Sidebar />
      <main className="workspace" id="content">
        <div ref={workspaceRef} className="workspace-inner">
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
    {/* «Запомнить» / «Мои фразы» (PASS-0.5.3 §1.6): only once the shell has been revealed and no level test lies over it. */}
    <CaptureSheet open={captureOpen && !!revealed && !placementOpen} onClose={() => setCaptureOpen(false)} onOpenPhrases={() => openPhrases()} />
    <PhrasesSheet open={phrasesSheet.open && !!revealed && !placementOpen} focus={phrasesSheet.focus} nonce={phrasesSheet.nonce}
      onClose={() => setPhrasesSheet(previous => ({ ...previous, open: false }))} />
    {/* W3's PlacementFlow is its own full-screen layer (with «Продолжу позже»); the shell beneath is inert. */}
    {placementOpen && placement && <PlacementFlow state={placement}
      onState={next => data.setState(previous => previous ? { ...previous, placement: next } : previous)}
      onClose={() => void closePlacement(false)} onDone={() => void closePlacement(true)} />}
  </AppContext.Provider>;

  return <>
    <Ambient mood={mood} />
    {body}
    {launch.phase !== 'done' && <LaunchLayer phase={launch.phase} line={boot.line} copy={launch.copy}
      error={!data.state && !data.needLogin && data.loadError ? data.loadError : null} retrying={retrying} onRetry={() => void retryLaunch()}
      onSkip={() => handOff(true)} onGreeted={() => handOff()} onLeft={() => setLaunch(current => ({ ...current, phase: 'done' }))} />}
  </>;
}

/**
 * Composition root. The SSR/first paint is the launch layer's background only, so the quick window never flashes the
 * full app (audit C-18); `?entry=quick` is the «Запомнить» capture page (PASS-0.5.3 §7), which never waits for
 * /api/state — in the quick window that first paint stays transparent (components/capture/capture-overlay.module.css).
 */
export function TrainingApp() {
  useInputModality();
  useGlassPointer();
  // A theme picked in one window (main or the capture window) applies to the other at once.
  useEffect(() => { applyThemePreference(readThemePreference()); return followThemeChanges(() => undefined); }, []);
  const [mode, setMode] = useState<'boot' | 'quick' | 'app'>('boot');
  const [phrasesAtStart, setPhrasesAtStart] = useState(false);
  useLayoutEffect(() => {
    setMode(new URLSearchParams(window.location.search).get('entry') === 'quick' ? 'quick' : 'app');
  }, []);
  if (mode === 'boot') return <><Ambient /><LaunchBackdrop /></>;
  // A plain browser leaves the capture page into the app; its «Мои фразы» lands on Practice with the phrases sheet.
  if (mode === 'quick') return <CaptureOverlay onDismiss={target => { dropEntryParameter(); setPhrasesAtStart(target === 'phrases'); setMode('app'); }} />;
  return <App openPhrasesAtStart={phrasesAtStart} />;
}
