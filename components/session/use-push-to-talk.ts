'use client';

import { useEffect, useRef } from 'react';
import { isEditableTarget } from '../ui/use-glass-pointer';
import type { VoiceState } from '../use-voice';

/**
 * Hold Space to talk on PC (audit U-24). Ignored while typing in a field, and on a focused button
 * when the user navigates with the keyboard (Space must still press that button).
 */
export function usePushToTalk({ enabled, state, toggle }: { enabled: boolean; state: VoiceState; toggle: () => void }) {
  const holding = useRef(false);
  const stopWhenReady = useRef(false);
  const latest = useRef({ enabled, state, toggle });
  latest.current = { enabled, state, toggle };

  useEffect(() => {
    const blocked = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(target)) return true;
      if (target?.closest('dialog[open]')) return true;
      const keyboardUser = document.documentElement.dataset.input === 'keyboard';
      return keyboardUser && !!target && /^(BUTTON|A|SUMMARY)$/u.test(target.tagName);
    };
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || !latest.current.enabled || blocked(event)) return;
      event.preventDefault();
      if (event.repeat || holding.current) return;
      if (latest.current.state === 'listening') return;
      if (latest.current.state !== 'idle' && latest.current.state !== 'paused' && latest.current.state !== 'speaking') return;
      holding.current = true; stopWhenReady.current = false;
      latest.current.toggle();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !holding.current) return;
      event.preventDefault();
      holding.current = false;
      if (latest.current.state === 'listening') latest.current.toggle(); else stopWhenReady.current = true;
    };
    const release = () => { if (holding.current) { holding.current = false; if (latest.current.state === 'listening') latest.current.toggle(); else stopWhenReady.current = true; } };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', release); };
  }, []);

  // Released before the microphone opened: finish as soon as it is listening.
  useEffect(() => {
    if (state === 'listening' && stopWhenReady.current && !holding.current) { stopWhenReady.current = false; latest.current.toggle(); }
    if (state === 'idle' || state === 'paused') stopWhenReady.current = false;
  }, [state]);
}
