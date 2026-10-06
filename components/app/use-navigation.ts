'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { TabId } from './labels';

type ViewTransition = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void };
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => ViewTransition };
let running: ViewTransition | null = null;

/**
 * 'screen' = the content column cross-fades (a lesson opening or closing; the sidebar swaps at once).
 * 'layer' = the whole page cross-fades under a full-screen layer (the level test opening or closing).
 */
export type TransitionKind = 'screen' | 'layer';

/**
 * A soft view transition where continuity matters (MOTION-PASS-0.5.2 §2: 220 ms out, 520 ms in). Tab switches never
 * use it — they swap at once and the new screen runs its staircase (components/ui/entrance.ts). Instant with reduced
 * motion, a hidden page or no View Transitions support. `after` runs once the new view is in the DOM (focus moves).
 */
export function withViewTransition(update: () => void, kind: TransitionKind = 'screen', after?: () => void) {
  if (typeof document === 'undefined') { update(); return; }
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || document.hidden || typeof doc.startViewTransition !== 'function') { update(); if (after) requestAnimationFrame(after); return; }
  // A quick second tap must not leave a half-finished transition (or an unhandled abort) behind.
  running?.skipTransition();
  const root = document.documentElement;
  root.dataset.transition = kind;
  // The update waits for a rendering frame to capture the old view. If frames stall (occluded or throttled
  // window), a tap must still switch the screen: skip the animation, then apply directly as a last resort.
  let applied = false;
  const apply = () => { if (applied) return; applied = true; flushSync(update); after?.(); };
  try {
    const transition = doc.startViewTransition(apply);
    running = transition;
    const quiet = () => undefined;
    transition.ready.catch(quiet); transition.updateCallbackDone.catch(quiet);
    transition.finished.catch(quiet).finally(() => { if (running === transition) { running = null; delete root.dataset.transition; } });
    window.setTimeout(() => {
      if (applied) return;
      transition.skipTransition();
      window.setTimeout(() => { if (!applied) { apply(); if (running === transition) { running = null; delete root.dataset.transition; } } }, 120);
    }, 300);
  } catch { delete root.dataset.transition; apply(); }
}

/** Focus the new screen's heading so keyboard and screen-reader users land in the content (audit C-21). Call it once
 * the new screen is in the DOM: after a view transition applied it, or a frame after a plain state change. */
function focusHeading() {
  const heading = document.querySelector<HTMLElement>('[data-screen-heading]') ?? document.querySelector<HTMLElement>('.screen h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) { heading.tabIndex = -1; heading.style.outline = 'none'; }
  heading.focus({ preventScroll: true });
}

const toTop = () => window.scrollTo({ top: 0, behavior: 'auto' });

/** Sections reachable by navigation: Созвоны → Звонки · Паттерны · Плейбук; Прогресс → its tabs or the full test report. */
export type CallsSection = 'calls' | 'patterns' | 'playbook';
export type ProgressSection = 'overview' | 'skills' | 'history' | 'rewards' | 'report';
/** Profile rows a link can open (PASS-0.5.3 §3: a limit notice opens «Тренер и лимиты» or «Голос»). */
export type ProfileSection = 'voice' | 'reminders' | 'limits' | 'data';
export type NavigationOptions = { callId?: string | null; calls?: CallsSection; progress?: ProgressSection; profileSection?: ProfileSection };

/**
 * In-memory navigation only: the Electron bridge trusts just `/` and `/?entry=` URLs (audit C-19),
 * so tabs never touch the address bar.
 */
export function useNavigation() {
  const [tab, setTab] = useState<TabId>('today');
  const [sessionOpen, setSessionOpen] = useState(false);
  const [returnTab, setReturnTab] = useState<TabId>('today');
  const [callTarget, setCallTarget] = useState<{ id: string | null; section: CallsSection | null; nonce: number }>({ id: null, section: null, nonce: 0 });
  const [progressSection, setProgressSection] = useState<{ id: ProgressSection; nonce: number }>({ id: 'overview', nonce: 0 });
  const [profileTarget, setProfileTarget] = useState<{ id: ProfileSection | null; nonce: number }>({ id: null, nonce: 0 });
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const sessionOpenRef = useRef(sessionOpen);
  sessionOpenRef.current = sessionOpen;

  const go = useCallback((next: TabId, options: NavigationOptions = {}) => {
    const update = () => {
      setSessionOpen(false); setTab(next);
      if (next === 'calls') setCallTarget(previous => ({ id: options.callId ?? null, section: options.calls ?? null, nonce: previous.nonce + 1 }));
      if (next === 'progress' && options.progress) setProgressSection(previous => ({ id: options.progress!, nonce: previous.nonce + 1 }));
      if (next === 'profile' && options.profileSection) setProfileTarget(previous => ({ id: options.profileSection!, nonce: previous.nonce + 1 }));
      toTop();
    };
    // Leaving an open lesson keeps the soft cross-fade; a plain tab switch swaps at once and the staircase takes over.
    if (sessionOpenRef.current) withViewTransition(update, 'screen', focusHeading);
    else { update(); requestAnimationFrame(focusHeading); }
  }, []);

  const openSession = useCallback((from?: TabId) => {
    withViewTransition(() => {
      if (!sessionOpenRef.current) setReturnTab(from ?? tabRef.current);
      setSessionOpen(true);
      toTop();
    }, 'screen', focusHeading);
  }, []);

  const closeSession = useCallback(() => {
    withViewTransition(() => { setSessionOpen(false); setTab(previous => previous); toTop(); }, 'screen', focusHeading);
  }, []);

  // Stable identity unless a value changes, so the app context is not rebuilt on unrelated renders.
  return useMemo(() => ({ tab, tabRef, sessionOpen, sessionOpenRef, returnTab, callTarget, progressSection, profileTarget, go, openSession, closeSession }),
    [tab, sessionOpen, returnTab, callTarget, progressSection, profileTarget, go, openSession, closeSession]);
}
export type Navigation = ReturnType<typeof useNavigation>;
