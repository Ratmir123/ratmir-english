'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import { Companion, type MascotEmotion } from './shell/companion';
import { MOTION_MS, prefersReducedMotion } from './ui/motion';
import styles from './startup-welcome.module.css';

/** boot: the preloader (companion + motivation line) · greeting: «Привет…» above the line · leaving: fading over the shell. */
export type LaunchPhase = 'boot' | 'greeting' | 'leaving';
export type LaunchCopy = { greeting: string; motivation: string };

/** How long the greeting stays (from its first word) before the layer hands off to the shell (PASS-0.5.3 §6). */
const GREETING_MS = 2200;

/** The server-rendered first paint of the launch layer: the background only — the companion needs the client. */
export function LaunchBackdrop() {
  return <div className={styles.layer} data-phase="boot" aria-busy="true" />;
}

/**
 * One launch layer from the first paint to the hand-off (MOTION-PASS-0.5.2 §4, PASS-0.5.3 §6). Boot is the preloader:
 * the SAME companion instance rises in and idles on the compositor (a still frame with a CSS roll/breath that a busy
 * main thread cannot stall) above one motivation line that needs no data; a hairline progress joins the line only when
 * loading takes longer than 0.9 s. When the app is ready the companion goes live and greets, «Привет, …» rises into
 * the room above the line and the line cross-fades to the personal one if it differs. Loading fails → sad, with a retry.
 * Then the layer fades (600 ms) while the shell rises in its staircase underneath. A key press or a click skips the
 * greeting at once; reduced motion never gets the greeting choreography (training-app decides).
 */
export function LaunchLayer({ phase, line, copy, error, retrying, onRetry, onSkip, onGreeted, onLeft }: {
  phase: LaunchPhase; line: string; copy: LaunchCopy | null; error: string | null; retrying: boolean;
  onRetry: () => void; onSkip: () => void; onGreeted: () => void; onLeft: () => void;
}) {
  const callbacks = useRef({ onSkip, onGreeted, onLeft });
  callbacks.current = { onSkip, onGreeted, onLeft };
  // Live physics from the greeting on (or to look sad about an error), and never back: the hand-off without a greeting
  // keeps the compositor idle, so nothing starts on the main thread while the shell's staircase runs.
  const live = useRef(false);
  if (phase === 'greeting' || error) live.current = true;

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
  // companion sideways the moment the greeting starts). The attribute also pauses the ambient aurora behind it.
  useLayoutEffect(() => {
    if (phase === 'leaving') return;
    const root = document.documentElement;
    root.dataset.launch = 'covering';
    return () => { delete root.dataset.launch; };
  }, [phase]);

  const emotion: MascotEmotion = error ? (retrying ? 'thinking' : 'sad') : copy ? 'joy' : 'calm';
  const personal = copy && copy.motivation !== line ? copy.motivation : null;
  return <div className={styles.layer} data-phase={phase} data-testid="opening-greeting" aria-busy={phase === 'boot' && !error}
    onPointerDown={phase === 'greeting' ? () => callbacks.current.onSkip() : undefined}>
    <div className={styles.stage}>
      <div className={styles.mascot} aria-hidden="true">
        <Companion state="idle" emotion={emotion} greeting={phase === 'greeting'} idleMode={live.current ? 'live' : 'compositor'}
          interactive={false} exclusive={false} />
      </div>
      <div className={styles.copy}>
        {error ? <div className={styles.problem} role="alert">
          <h1>Не удалось открыть тренинг</h1>
          <p>{error}</p>
          <button type="button" className="button primary" onClick={onRetry} disabled={retrying}>
            <ArrowsClockwiseIcon size={17} aria-hidden="true" />{retrying ? 'Подключаюсь…' : 'Повторить'}
          </button>
        </div>
          : <div className={styles.hello} data-greeted={copy ? 'true' : undefined}>
            {/* Visible copy is decoration; the status below speaks it once. The greeting's room is kept from the first
                frame, so the line only glides down into place — it never jumps. */}
            <div className={styles.greeting} aria-hidden="true">{copy && <h1>{copy.greeting}</h1>}</div>
            <p className={styles.line} aria-hidden="true">
              <span data-leaving={personal ? 'true' : undefined}>{line}</span>
              {personal && <span data-arriving="true">{personal}</span>}
            </p>
            <div className={styles.foot} aria-hidden="true">
              <span className={styles.progress}><i /></span>
              <span className={styles.wordmark}>{APP_NAME.toLowerCase()}</span>
            </div>
            <span className="visually-hidden" role="status">{copy ? `${copy.greeting} ${copy.motivation}` : `Открываю тренинг… ${line}`}</span>
          </div>}
      </div>
    </div>
    {phase === 'greeting' && <button type="button" className={styles.skip} onClick={() => callbacks.current.onSkip()}>Перейти к главной</button>}
  </div>;
}
