'use client';

import { useEffect } from 'react';

/** One delegated, rAF-throttled pointer listener drives the specular highlight of interactive glass (--mx/--my). */
export function useGlassPointer() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    let target: HTMLElement | null = null;
    let x = 0, y = 0;
    const paint = () => {
      frame = 0;
      if (!target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${x - box.left}px`);
      target.style.setProperty('--my', `${y - box.top}px`);
    };
    const move = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest?.<HTMLElement>('.glass.interactive') ?? null;
      target = element; x = event.clientX; y = event.clientY;
      if (element && !frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (frame) cancelAnimationFrame(frame); };
  }, []);
}

/** Keyboard modality only for real keyboard navigation — never while typing in a field (audit C-01). */
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Escape']);
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(element.tagName));
}
export function isKeyboardNavigation(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (isEditableTarget(target)) return event.key === 'Tab';
  return NAVIGATION_KEYS.has(event.key) || ((event.key === 'Enter' || event.key === ' ') && !!target && /^(BUTTON|SUMMARY|A)$/u.test(target.tagName));
}
export function useInputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = () => { root.dataset.input = 'pointer'; };
    const keyboard = (event: KeyboardEvent) => { if (isKeyboardNavigation(event)) root.dataset.input = 'keyboard'; };
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', keyboard, true);
    return () => { window.removeEventListener('pointerdown', pointer, true); window.removeEventListener('keydown', keyboard, true); delete root.dataset.input; };
  }, []);
}
