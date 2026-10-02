'use client';

import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import type { VoiceState } from './use-voice';
import styles from './voice-orb.module.css';

export type OrbEmotion = 'calm' | 'attentive' | 'curious' | 'friendly' | 'pleased' | 'supportive';
type VoiceOrbProps = { state: VoiceState; volume?: number; emotion?: OrbEmotion };
const expressions: Record<VoiceState, OrbEmotion> = {
  idle: 'calm', listening: 'attentive', speaking: 'friendly', transcribing: 'curious', thinking: 'curious', paused: 'calm',
};
const descriptions: Record<VoiceState, string> = {
  idle: 'Ждёт твоего ответа', listening: 'Слушает тебя', speaking: 'Говорит', transcribing: 'Распознаёт запись', thinking: 'Готовит ответ', paused: 'Пауза',
};

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function isPageVisible() {
  return document.visibilityState === 'visible';
}

function serverVisibility() {
  return true;
}

export const VoiceOrb = memo(function VoiceOrb({ state, volume = 0, emotion }: VoiceOrbProps) {
  const visible = useSyncExternalStore(subscribeToVisibility, isPageVisible, serverVisibility);
  const element = useRef<HTMLButtonElement>(null);
  const [inView, setInView] = useState(true);
  const [winking, setWinking] = useState(false);
  const [pointerGreeting, setPointerGreeting] = useState(false);
  const lastGreeting = useRef(-Infinity);
  const greetingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (greetingTimer.current) clearTimeout(greetingTimer.current); }, []);
  function greet(event: MouseEvent<HTMLButtonElement>) {
    const now = performance.now();
    if (now - lastGreeting.current < 1600) return;
    lastGreeting.current = now;
    setPointerGreeting(event.detail > 0);
    setWinking(true);
    if (greetingTimer.current) clearTimeout(greetingTimer.current);
    greetingTimer.current = setTimeout(() => setWinking(false), 780);
  }
  const live = state === 'listening' || state === 'speaking';
  const active = live || state === 'transcribing' || state === 'thinking';
  // Playback has no RMS feed yet; its activity pose must not imply measured loudness.
  const level = visible && inView && state === 'listening' && Number.isFinite(volume)
    ? Math.min(1, Math.max(0, volume)) : 0;
  const motion = {
    '--voice-scale': 1 + level * 0.08,
    '--orb-shift': `${level * 4}px`,
  } as CSSProperties;

  return (
    <button
      type="button"
      ref={element}
      className={`voice-orb ${styles.orb}`}
      data-state={state}
      data-emotion={emotion ?? expressions[state]}
      data-wink={winking}
      data-bounce={winking && pointerGreeting}
      data-keyboard-greeting={winking && !pointerGreeting}
      data-awake={visible && inView && (active || winking)}
      data-page-hidden={!visible || !inView}
      aria-label={`Твой собеседник. ${descriptions[state]}. Поздороваться: подмигнёт.`}
      title="Коснись, и я подмигну"
      onClick={greet}
      style={motion}
    >
      <div className={styles.shadow} aria-hidden="true" />
      <div className={`orb-body ${styles.body}`} aria-hidden="true">
        <div className={styles.pose}>
          <div className={styles.cyanPose}>
            <div className={styles.cyan} />
          </div>
          <div className={styles.indigoPose}>
            <div className={styles.indigo} />
          </div>
          <div className={styles.tealPose}>
            <div className={styles.teal} />
          </div>
        </div>
        <div className={styles.sheen} />
        <div className={styles.eyes}>
          {[0, 1].map(index => <span className={styles.eye} key={index}>
            <svg className={styles.blink} viewBox="0 0 20 32" fill="none" focusable="false">
              <rect className={styles.pillEye} x="2" y="0" width="16" height="32" rx="8" fill="white" />
              <path className={styles.arcEye} d="M 1 20 Q 10 8 19 20" stroke="white" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </span>)}
        </div>
      </div>
    </button>
  );
});
