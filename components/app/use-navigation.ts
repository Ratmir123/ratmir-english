'use client';

import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { TabId } from './labels';

type ViewTransition = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void };
type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => ViewTransition };
let running: ViewTransition | null = null;

/** Cross-fade + slight slide via View Transitions when available; instant with reduced motion. */
export function withViewTransition(update: () => void) {
  if (typeof document === 'undefined') { update(); return; }
  const doc = document as ViewTransitionDocument;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || document.hidden || typeof doc.startViewTransition !== 'function') { update(); return; }
  // A quick second tap must not leave a half-finished transition (or an unhandled abort) behind.
  running?.skipTransition();
  const root = document.documentElement;
  root.dataset.transition = 'screen';
  try {
    const transition = doc.startViewTransition(() => { flushSync(update); });
    running = transition;
    const quiet = () => undefined;
    transition.ready.catch(quiet); transition.updateCallbackDone.catch(quiet);
    transition.finished.catch(quiet).finally(() => { if (running === transition) { running = null; delete root.dataset.transition; } });
  } catch { delete root.dataset.transition; update(); }
}

/** Focus the new screen's heading so keyboard and screen-reader users land in the content (audit C-21). */
function focusHeading() {
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>('[data-screen-heading]') ?? document.querySelector<HTMLElement>('.screen h1');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) { heading.tabIndex = -1; heading.style.outline = 'none'; }
    heading.focus({ preventScroll: true });
  });
}

/**
 * In-memory navigation only: the Electron bridge trusts just `/` and `/?entry=` URLs (audit C-19),
 * so tabs never touch the address bar.
 */
export function useNavigation() {
  const [tab, setTab] = useState<TabId>('today');
  const [sessionOpen, setSessionOpen] = useState(false);
  const [returnTab, setReturnTab] = useState<TabId>('today');
  const [callTarget, setCallTarget] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 });
  const [progressSection, setProgressSection] = useState<{ id: 'overview' | 'skills' | 'history' | 'rewards'; nonce: number }>({ id: 'overview', nonce: 0 });
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const sessionOpenRef = useRef(sessionOpen);
  sessionOpenRef.current = sessionOpen;

  const go = useCallback((next: TabId, options: { callId?: string | null; progress?: 'overview' | 'skills' | 'history' | 'rewards' } = {}) => {
    withViewTransition(() => {
      setSessionOpen(false); setTab(next);
      if (next === 'calls') setCallTarget(previous => ({ id: options.callId ?? null, nonce: previous.nonce + 1 }));
      if (next === 'progress' && options.progress) setProgressSection(previous => ({ id: options.progress!, nonce: previous.nonce + 1 }));
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    focusHeading();
  }, []);

  const openSession = useCallback((from?: TabId) => {
    withViewTransition(() => {
      if (!sessionOpenRef.current) setReturnTab(from ?? tabRef.current);
      setSessionOpen(true);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    focusHeading();
  }, []);

  const closeSession = useCallback(() => {
    withViewTransition(() => { setSessionOpen(false); setTab(previous => previous); });
    window.scrollTo({ top: 0, behavior: 'auto' });
    focusHeading();
  }, []);

  return { tab, tabRef, sessionOpen, sessionOpenRef, returnTab, callTarget, progressSection, go, openSession, closeSession };
}
export type Navigation = ReturnType<typeof useNavigation>;
