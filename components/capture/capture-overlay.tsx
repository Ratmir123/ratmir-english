'use client';

/*
 * The `?entry=quick` page (planning/v05/PASS-0.5.3.md §7). The 0.5.3 shell reports `quickStyle: 'overlay'`: a frameless
 * transparent window at the bottom-right of the screen, where the chubrik rises from below the edge and the bubble grows
 * out of it; exit is the reverse (≤ 300 ms), then `hideQuick()`. Clicks pass through everything but the bubble and the
 * companion (`setClickThrough`). It hides on Esc, on losing focus and 2.5 s after a save (not while the pointer is over
 * it). Older shells (framed 420×720 window) and a plain browser get the same card on an opaque page. Never waits for
 * /api/state.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortcutHint } from '@/lib/phrases/labels';
import type { DesktopStatus } from '../desktop-bridge';
import { EASE_EXIT, EASE_OUT, MOTION_MS, prefersReducedMotion } from '../ui/motion';
import { CaptureCard } from './capture-card';
import { loadDesktopStatus, useCapture, type Capture } from './use-capture';
import styles from './capture-overlay.module.css';

type QuickStyle = 'overlay' | 'panel';
/** An older shell that never answers still gets its card. */
const STATUS_WAIT_MS = 1500;
/** After a confirmed save, unless the pointer rests on it (PASS-0.5.3 §7). */
export const AUTO_HIDE_MS = 2500;

type Parts = { mascot: HTMLElement | null; bubble: HTMLElement | null };
const partsOf = (root: HTMLElement): Parts => ({
  mascot: root.querySelector<HTMLElement>('[data-part="mascot"]'),
  bubble: root.querySelector<HTMLElement>('[data-part="bubble"]'),
});

/** Web Animations with the CSS spring tokens; an engine without `linear()` easing falls back to the ease-out curve. */
function play(element: HTMLElement | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (!element) return null;
  try { return element.animate(keyframes, options); }
  catch { return element.animate(keyframes, { ...options, easing: EASE_OUT }); }
}
const bouncy = () => {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--spring-bouncy').trim();
  return value || EASE_OUT;
};

export function CaptureOverlay({ onDismiss }: { onDismiss: (target?: 'phrases') => void }) {
  const [desktop] = useState(() => typeof window !== 'undefined' && !!window.ratmirDesktop);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [style, setStyle] = useState<QuickStyle | null>(desktop ? null : 'panel');
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const timer = setTimeout(() => { if (alive) setStyle(current => current ?? 'panel'); }, STATUS_WAIT_MS);
    void loadDesktopStatus().then(value => {
      if (!alive) return;
      setStatus(value);
      // Decided once: a late answer never swaps the page under his cursor.
      setStyle(current => current ?? (value?.quickStyle === 'overlay' ? 'overlay' : 'panel'));
    });
    return () => { alive = false; clearTimeout(timer); };
  }, [desktop]);
  // <html data-entry="quick"> comes from the head script (app/layout.tsx); the style decides whether the page stays
  // transparent (overlay) or becomes the opaque app background again (panel).
  useLayoutEffect(() => { if (style) document.documentElement.dataset.quickStyle = style; }, [style]);
  // Leaving for the app (a plain browser only) gives the page its own background back. Not an unmount cleanup: React's
  // development double mount would run it while the capture page stays.
  const dismiss = useCallback((target?: 'phrases') => {
    const root = document.documentElement;
    delete root.dataset.quickStyle; delete root.dataset.entry;
    onDismiss(target);
  }, [onDismiss]);
  const capture = useCapture({ origin: desktop ? 'desktop' : 'web' });
  if (!style) return null;
  return style === 'overlay'
    ? <OverlayStage capture={capture} status={status} />
    : <PanelStage capture={capture} status={status} desktop={desktop} onDismiss={dismiss} />;
}

function OverlayStage({ capture, status }: { capture: Capture; status: DesktopStatus | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const phase = useRef<'hidden' | 'shown' | 'leaving'>('hidden');
  const running = useRef<Animation[]>([]);
  const [inside, setInside] = useState(false);
  const captureRef = useRef(capture);
  captureRef.current = capture;

  const clickThrough = useCallback((ignore: boolean) => {
    void window.ratmirDesktop?.setClickThrough?.(ignore)?.catch(() => undefined);
  }, []);
  const stopRunning = () => { running.current.forEach(animation => animation.cancel()); running.current = []; };
  const markHidden = useCallback(() => {
    phase.current = 'hidden';
    if (stage.current) stage.current.dataset.phase = 'hidden';
    setInside(false);
    clickThrough(true);
  }, [clickThrough]);

  const enter = useCallback(() => {
    const root = stage.current;
    if (!root || phase.current === 'shown') return;
    stopRunning();
    phase.current = 'shown';
    root.dataset.phase = 'shown';
    setInside(false);
    clickThrough(true);
    // Summoned again after a save: a fresh field for the next thing to remember (an unsaved text stays).
    if (captureRef.current.saved) captureRef.current.reset();
    const { mascot, bubble } = partsOf(root);
    running.current = (prefersReducedMotion()
      ? [play(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out', fill: 'backwards' })]
      : [
        // The companion rises from below the screen edge on its spring; the bubble grows out of it.
        play(mascot, [{ transform: 'translate3d(0, 165%, 0)' }, { transform: 'translate3d(0, 0, 0)' }], { duration: MOTION_MS.bouncy, easing: bouncy(), fill: 'backwards' }),
        play(bubble, [{ opacity: 0, transform: 'scale(.38)' }, { opacity: 1, transform: 'none' }], { duration: MOTION_MS.reveal, delay: 160, easing: EASE_OUT, fill: 'backwards' }),
      ]).filter((animation): animation is Animation => !!animation);
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  }, [clickThrough]);

  const leave = useCallback(async () => {
    const root = stage.current;
    if (!root || phase.current !== 'shown') return;
    phase.current = 'leaving';
    stopRunning();
    const { mascot, bubble } = partsOf(root);
    // The reverse, shorter (≤ 300 ms): the bubble folds into the companion, which sinks below the edge.
    const animations = (prefersReducedMotion()
      ? [play(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' })]
      : [
        play(bubble, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.38)' }], { duration: 170, easing: EASE_EXIT, fill: 'forwards' }),
        play(mascot, [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, 165%, 0)' }], { duration: 230, delay: 60, easing: EASE_EXIT, fill: 'forwards' }),
      ]).filter((animation): animation is Animation => !!animation);
    running.current = animations;
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    if (phase.current !== 'leaving') return; // summoned again meanwhile
    markHidden();
    await window.ratmirDesktop?.hideQuick().catch(() => undefined);
  }, [markHidden]);

  // Hidden until the first entrance (a development double mount must not hide it again after that).
  useLayoutEffect(() => {
    if (stage.current && phase.current === 'hidden') stage.current.dataset.phase = 'hidden';
  }, []);

  // Shown: replay the entrance (visibility, or focus when the shell keeps the page "visible"); hidden by the shell: reset.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { if (phase.current === 'hidden') enter(); }
      else { stopRunning(); markHidden(); }
    };
    const onFocus = () => { if (phase.current === 'hidden') enter(); };
    const onBlur = () => { if (phase.current === 'shown') void leave(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      void leave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    // A window created hidden can still report "visible" on its first load (Electron paints it in advance): the entrance
    // waits until the shell really shows it, which also gives it focus.
    if (document.visibilityState === 'visible' && document.hasFocus()) enter();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
    };
  }, [enter, leave, markHidden]);

  // 2.5 s after a confirmed save it goes away by itself; the pointer resting on it (reading the enrichment) pauses that.
  const confirmed = !!capture.saved?.phrase;
  const ticket = capture.saved?.ticket;
  useEffect(() => {
    if (!confirmed || inside) return;
    const timer = setTimeout(() => { if (phase.current === 'shown') void leave(); }, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [confirmed, ticket, inside, leave]);

  return <div ref={stage} className={`${styles.root} ${styles.overlay}`} data-testid="capture-overlay">
    <div className={styles.content}
      onPointerEnter={() => { setInside(true); clickThrough(false); }}
      onPointerLeave={() => { setInside(false); clickThrough(true); }}>
      <CaptureCard variant="overlay" capture={capture} fieldRef={field} hint={shortcutHint(status)}
        onClose={() => void leave()}
        // The shell opens the main window on «Мои фразы» (Practice → the phrases sheet); nothing else to do here.
        onOpenPhrases={() => void window.ratmirDesktop?.openTraining('phrases').catch(() => undefined)} />
    </div>
  </div>;
}

/** Older shells' framed quick window and a plain browser: the same card, centred on an opaque page. */
function PanelStage({ capture, status, desktop, onDismiss }: {
  capture: Capture; status: DesktopStatus | null; desktop: boolean; onDismiss: (target?: 'phrases') => void;
}) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const close = useCallback(() => {
    if (desktop) void window.ratmirDesktop?.hideQuick().catch(() => undefined);
    else onDismiss();
  }, [desktop, onDismiss]);
  useEffect(() => {
    const focus = () => requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (captureRef.current.saved) captureRef.current.reset();
      focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey);
    focus();
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('keydown', onKey); };
  }, [close]);
  return <main className={`${styles.root} ${styles.panel}`} data-testid="capture-panel">
    <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
    <CaptureCard variant="panel" capture={capture} fieldRef={field} hint={shortcutHint(status)} onClose={close}
      onOpenPhrases={() => { if (desktop) void window.ratmirDesktop?.openTraining('phrases').catch(() => undefined); else onDismiss('phrases'); }} />
  </main>;
}
