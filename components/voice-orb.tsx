'use client';

import { memo, useSyncExternalStore, type CSSProperties } from 'react';
import type { VoiceState } from './use-voice';
import styles from './voice-orb.module.css';

type VoiceOrbProps = { state: VoiceState; volume?: number };

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

export const VoiceOrb = memo(function VoiceOrb({ state, volume = 0 }: VoiceOrbProps) {
  const visible = useSyncExternalStore(subscribeToVisibility, isPageVisible, serverVisibility);
  const live = state === 'listening' || state === 'speaking';
  const active = live || state === 'transcribing' || state === 'thinking';
  // Playback has no RMS feed yet; its activity pose must not imply measured loudness.
  const level = visible && state === 'listening' && Number.isFinite(volume)
    ? Math.min(1, Math.max(0, volume)) : 0;
  const motion = {
    '--voice-scale': 1 + level * 0.045,
    '--orb-shift': `${level * 4}px`,
  } as CSSProperties;

  return (
    <div
      className={`voice-orb ${styles.orb}`}
      data-state={state}
      data-awake={visible && active}
      data-page-hidden={!visible}
      aria-hidden="true"
      style={motion}
    >
      <div className={styles.shadow} />
      <div className={`orb-body ${styles.body}`}>
        <div className={styles.pose}>
          <div className={styles.lavenderPose}>
            <div className={styles.lavender} />
          </div>
          <div className={styles.inkPose}>
            <div className={styles.ink} />
          </div>
          <div className={styles.limePose}>
            <div className={styles.lime} />
          </div>
        </div>
        <div className={styles.sheen} />
      </div>
    </div>
  );
});
