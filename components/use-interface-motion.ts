'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => { root.dataset.input = 'pointer'; };
    const keyboard = () => { root.dataset.input = 'keyboard'; };
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', keyboard, true);
    return () => {
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', keyboard, true);
      delete root.dataset.input;
    };
  }, []);
}

/** A single entrance for changed content; polling never restarts it. */
export function useContentEntrance<T extends HTMLElement>(key: string, distance = 6, duration = 200, animateOnMount = false) {
  const ref = useRef<T>(null);
  const animation = useRef<Animation | null>(null);
  const previous = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (previous.current === key) return;
    const initial = previous.current === null;
    previous.current = key;
    if (initial && !animateOnMount) return;
    const element = ref.current;
    if (!element) return;
    const interrupted = animation.current?.playState === 'running';
    const current = interrupted ? getComputedStyle(element) : null;
    const from = { transform: current?.transform || `translateY(${distance}px)` };
    animation.current?.cancel();
    if (document.hidden || document.documentElement.dataset.input === 'keyboard'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) return;
    const next = element.animate([from, { transform: 'translateY(0)' }], {
      duration, easing: EASE_OUT,
    });
    animation.current = next;
    void next.finished.then(() => { if (animation.current === next) animation.current = null; }).catch(() => undefined);
  }, [key, distance, duration, animateOnMount]);

  useEffect(() => {
    const stop = () => { animation.current?.cancel(); animation.current = null; };
    const onVisibility = () => { if (document.hidden) stop(); };
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => { if (preference.matches) stop(); };
    window.addEventListener('keydown', stop, true);
    document.addEventListener('visibilitychange', onVisibility);
    preference.addEventListener('change', onPreference);
    return () => {
      stop(); window.removeEventListener('keydown', stop, true);
      document.removeEventListener('visibilitychange', onVisibility);
      preference.removeEventListener('change', onPreference);
    };
  }, []);
  return ref;
}

/** The opening reveals mounted Home blocks once; interaction restores their natural position. */
export function useHomeStagger<T extends HTMLElement>(root: RefObject<T | null>, sequence: number) {
  useLayoutEffect(() => {
    const element = root.current;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!sequence || !element || document.hidden || preference.matches
      || document.documentElement.dataset.input === 'keyboard' || !element.animate) return;
    const blocks = element.querySelectorAll<HTMLElement>('.page-heading, .home-main > *, .profile-column > *');
    const animations = [...blocks].map((block, index) => block.animate([
      { opacity: 0, transform: 'translateY(10px) scale(.99)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 300, delay: Math.min(index * 45, 225), easing: EASE_OUT, fill: 'backwards' }));
    const stop = () => animations.forEach(animation => animation.cancel());
    const onVisibility = () => { if (document.hidden) stop(); };
    const onPreference = () => { if (preference.matches) stop(); };
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('keydown', stop, true);
    document.addEventListener('visibilitychange', onVisibility);
    preference.addEventListener('change', onPreference);
    return () => {
      stop(); window.removeEventListener('pointerdown', stop, true); window.removeEventListener('keydown', stop, true);
      document.removeEventListener('visibilitychange', onVisibility); preference.removeEventListener('change', onPreference);
    };
  }, [root, sequence]);
}

/** Measure stable button hitboxes only on selection or resize, never on animation frames. */
export function useNavigationHighlight(active: string) {
  const nav = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const frame = useRef<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  const position = useCallback((instant: boolean) => {
    const parent = nav.current;
    const pill = highlight.current;
    if (!parent || !pill) return;
    const selected = parent.querySelector<HTMLButtonElement>('button[aria-current="page"]');
    pill.dataset.visible = String(!!selected);
    if (!selected) return;
    if (instant) pill.style.transition = 'none';
    pill.style.width = `${selected.offsetWidth}px`;
    pill.style.height = `${selected.offsetHeight}px`;
    pill.style.transform = `translate3d(${selected.offsetLeft}px, ${selected.offsetTop}px, 0)`;
    if (instant) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => { pill.style.removeProperty('transition'); frame.current = null; });
    }
  }, []);

  const bind = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    nav.current = element;
    if (!element) return;
    position(true);
    observer.current = new ResizeObserver(() => position(true));
    observer.current.observe(element);
  }, [position]);
  useLayoutEffect(() => { position(false); }, [active, position]);
  useEffect(() => {
    return () => { observer.current?.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  return { nav: bind, highlight };
}
