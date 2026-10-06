'use client';

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import { Companion, type MascotEmotion } from './shell/companion';
import { MOTION_MS, prefersReducedMotion } from './ui/motion';
import styles from './startup-welcome.module.css';

/** boot: waiting for the state (companion breathing) · greeting: «Привет…» next to it · leaving: fading over the shell. */
export type LaunchPhase = 'boot' | 'greeting' | 'leaving';
export type LaunchCopy = { greeting: string; motivation: string };

/** How long the greeting stays (from its first word) before the layer hands off to the shell. */
const GREETING_MS = 2700;

/** The server-rendered first paint of the launch layer: the background only — the companion needs the client. */
export function LaunchBackdrop() {
  return <div className={styles.layer} data-phase="boot" aria-busy="true" />;
}

/**
 * One launch layer from the first paint to the hand-off (MOTION-PASS-0.5.2 §4). The SAME companion instance breathes
 * while the state loads, greets next to its words when a greeting is due, turns sad with a retry when loading fails,
 * then the layer fades (600 ms) while the shell rises in its staircase underneath. A key press or a click skips the
 * greeting at once; reduced motion never gets the greeting choreography (training-app decides).
 */
export function LaunchLayer({ phase, copy, error, retrying, onRetry, onSkip, onGreeted, onLeft }: {
  phase: LaunchPhase; copy: LaunchCopy | null; error: string | null; retrying: boolean;
  onRetry: () => void; onSkip: () => void; onGreeted: () => void; onLeft: () => void;
}) {
  const callbacks = useRef({ onSkip, onGreeted, onLeft });
  callbacks.current = { onSkip, onGreeted, onLeft };

  useEffect(() => {
    if (phase !== 'greeting') return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const timer = setTimeout(() => callbacks.current.onGreeted(), GREETING_MS);
    const key = (event: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      // A keystroke skips this temporary layer; it must not activate the page beneath.
      event.preventDefault(); event.stopPropagation(); callbacks.current.onSkip();
    };
    const hidden = () => { if (document.hidden) callbacks.current.onSkip(); };
    const preference = () => { if (reduced.matches) callbacks.current.onSkip(); };
    window.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', hidden);
    reduced.addEventListener('change', preference);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', hidden);
      reduced.removeEventListener('change', preference);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => callbacks.current.onLeft(), prefersReducedMotion() || document.hidden ? 240 : MOTION_MS.launchFade);
    return () => clearTimeout(timer);
  }, [phase]);

  // While the layer covers the page, the shell mounting beneath must not bring a scrollbar (it would shift the
  // companion sideways the moment the greeting starts).
  useLayoutEffect(() => {
    if (phase === 'leaving') return;
    const root = document.documentElement;
    root.dataset.launch = 'covering';
    return () => { delete root.dataset.launch; };
  }, [phase]);

  const emotion: MascotEmotion = error ? (retrying ? 'thinking' : 'sad') : copy ? 'joy' : 'calm';
  return <div className={styles.layer} data-phase={phase} data-testid="opening-greeting" aria-busy={phase === 'boot' && !error}
    onPointerDown={phase === 'greeting' ? () => callbacks.current.onSkip() : undefined}>
    <div className={styles.stage}>
      <div className={styles.mascot} aria-hidden="true">
        <Companion state="idle" emotion={emotion} greeting={phase === 'greeting'} interactive={false} exclusive={false} />
      </div>
      <div className={styles.copy}>
        {error ? <div className={styles.problem} role="alert">
          <h1>Не удалось открыть тренинг</h1>
          <p>{error}</p>
          <button type="button" className="button primary" onClick={onRetry} disabled={retrying}>
            <ArrowsClockwiseIcon size={17} aria-hidden="true" />{retrying ? 'Подключаюсь…' : 'Повторить'}
          </button>
        </div>
          : copy ? <div className={styles.hello} role="status" aria-live="polite">
            <h1>{copy.greeting}</h1>
            <p aria-label={copy.motivation}>{copy.motivation.split(' ').map((word, index) =>
              <span aria-hidden="true" key={index} style={{ '--word-delay': (380 + index * 55) + 'ms' } as CSSProperties}>{word}{' '}</span>)}</p>
            <span className={styles.wordmark} aria-hidden="true">{APP_NAME.toLowerCase()}</span>
          </div>
            : <span className="visually-hidden" role="status">Открываю тренинг…</span>}
      </div>
    </div>
    {phase === 'greeting' && <button type="button" className={styles.skip} onClick={() => callbacks.current.onSkip()}>Перейти к главной</button>}
  </div>;
}
