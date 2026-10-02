'use client';

import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import type { VoiceState, VoiceMeterStore } from './use-voice';
import styles from './voice-orb.module.css';

export type OrbEmotion = 'calm' | 'attentive' | 'curious' | 'friendly' | 'pleased' | 'supportive';
type VoiceOrbProps = { state: VoiceState; volume?: number; meterStore?: VoiceMeterStore; emotion?: OrbEmotion; statusDescription?: string };
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
function noMeterSubscription() { return () => {}; }
function silentMeter() { return 0; }

export const VoiceOrb = memo(function VoiceOrb({ state, volume = 0, meterStore, emotion, statusDescription }: VoiceOrbProps) {
  const visible = useSyncExternalStore(subscribeToVisibility, isPageVisible, serverVisibility);
  const measuredLevel = useSyncExternalStore(meterStore?.subscribe ?? noMeterSubscription, meterStore?.getSnapshot ?? silentMeter, silentMeter);
  const element = useRef<HTMLButtonElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const [inView, setInView] = useState(true);
  const [winking, setWinking] = useState(false);
  const [pressed, setPressed] = useState(false);
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
  useEffect(() => {
    if (visible && inView) return;
    setPressed(false);
    face.current?.style.removeProperty('transform');
    bounds.current = null;
  }, [visible, inView]);
  function look(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== 'mouse' || !visible || !inView
      || document.documentElement.dataset.input === 'keyboard'
      || !window.matchMedia('(hover: hover) and (pointer: fine)').matches
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = bounds.current;
    if (!box || !face.current) return;
    const x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
    // Only this tiny face layer moves. No render or layout measurement per frame.
    face.current.style.transform = `translate(${x * 5}px, ${y * 3}px)`;
  }
  function release() {
    setPressed(false);
    face.current?.style.removeProperty('transform');
    bounds.current = null;
  }
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
  const volumeLevel = meterStore ? measuredLevel : volume;
  const level = visible && inView && live && Number.isFinite(volumeLevel)
    ? Math.min(1, Math.max(0, volumeLevel)) : 0;
  const motion = {
    '--voice-scale': 1 + level * 0.045,
    '--voice-stretch': 1 + level * (state === 'speaking' ? 0.018 : 0.01),
    '--voice-lift': `${-level * 3}px`,
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
      data-greeting={winking && pointerGreeting}
      data-pressed={pressed}
      data-keyboard-greeting={winking && !pointerGreeting}
      data-awake={visible && inView && (active || winking)}
      data-page-hidden={!visible || !inView}
      aria-label={`Твой собеседник. ${statusDescription ?? descriptions[state]}. Поздороваться: подмигнёт.`}
      title="Коснись, и я подмигну"
      onClick={greet}
      onPointerEnter={event => { bounds.current = event.currentTarget.getBoundingClientRect(); look(event); }}
      onPointerMove={look}
      onPointerDown={event => { if (event.isPrimary && event.button === 0) setPressed(true); }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={release}
      onPointerLeave={release}
      onBlur={release}
      style={motion}
    >
      <div className={styles.shadow} aria-hidden="true" />
      <div className={styles.gel}>
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
        <div className={styles.rim} />
        <div className={styles.face} ref={face}>
        <div className={styles.eyes}>
          {[0, 1].map(index => <span className={styles.eye} key={index}>
            <svg className={styles.blink} viewBox="0 0 20 32" fill="none" focusable="false">
              <rect className={styles.pillEye} x="2" y="0" width="16" height="32" rx="8" fill="white" />
              <path className={styles.arcEye} d="M 1 20 Q 10 8 19 20" stroke="white" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </span>)}
        </div>
        </div>
      </div>
      </div>
    </button>
  );
});
