'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { APP_NAME } from '@/lib/app-info';
import { deriveOpeningGreeting } from '@/lib/startup-welcome';
import type { AppState } from '@/lib/types';
import { Companion } from './shell/companion';
import styles from './startup-welcome.module.css';

export interface StartupWelcomeProps {
  state: AppState;
  onReveal: () => void;
  onFinished: () => void;
}

/** A disposable cold-open layer (once per launch). Home is mounted beneath it throughout. */
export function StartupWelcome({ state, onReveal, onFinished }: StartupWelcomeProps) {
  const [copy] = useState(() => deriveOpeningGreeting(state, new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [leaving, setLeaving] = useState(false);
  const callbacks = useRef({ onReveal, onFinished });
  callbacks.current = { onReveal, onFinished };
  const finished = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  const finish = useCallback((immediate = false) => {
    if (finished.current) { if (immediate) { clear(); callbacks.current.onFinished(); } return; }
    finished.current = true; clear();
    if (immediate) { callbacks.current.onFinished(); return; }
    callbacks.current.onReveal();
    setLeaving(true);
    timers.current.push(setTimeout(() => callbacks.current.onFinished(), 560));
  }, [clear]);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (document.hidden || reduced.matches) { finish(true); return; }
    timers.current.push(setTimeout(() => finish(), 2800));
    const key = (event: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      // A keystroke skips this temporary layer; it must not activate the hidden page beneath.
      event.preventDefault(); event.stopPropagation(); finish(true);
    };
    const hidden = () => { if (document.hidden) finish(true); };
    const preference = () => { if (reduced.matches) finish(true); };
    window.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', hidden);
    reduced.addEventListener('change', preference);
    return () => { clear(); window.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', hidden); reduced.removeEventListener('change', preference); };
  }, [clear, finish]);

  return <div className={styles.entry} data-phase={leaving ? 'leaving' : 'hello'} data-testid="opening-greeting" onPointerDown={() => finish(true)}>
    <div className={styles.content}>
      <div className={styles.companion} aria-hidden="true" inert><Companion state="idle" emotion="happy" greeting interactive={false} exclusive={false} /></div>
      <div className={styles.copy} role="status" aria-live="polite">
        <h1>{copy.greeting}</h1>
        <p aria-label={copy.motivation}>{copy.motivation.split(' ').map((word, index) => <span aria-hidden="true" key={index} style={{ '--word-delay': (420 + index * 45) + 'ms' } as CSSProperties}>{word}{' '}</span>)}</p>
      </div>
      <span className={styles.wordmark} aria-hidden="true">{APP_NAME.toLowerCase()}</span>
    </div>
    <button type="button" className={styles.skip} onClick={() => finish(true)}>Перейти к главной</button>
  </div>;
}
