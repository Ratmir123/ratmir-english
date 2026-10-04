'use client';
// Compatibility wrapper (0.4 API → 0.5 jelly mascot). Existing call sites keep working unchanged:
// <VoiceOrb state meterStore emotion statusDescription openingGreeting />. New code should use
// <Mascot> from components/mascot/mascot.tsx directly.
import { memo, useMemo, useRef } from 'react';
import { toMascotEmotion, type LegacyOrbEmotion, type MascotEmotion } from '@/lib/mascot/emotions';
import { Mascot, type MascotLevelStore } from './mascot/mascot';
import type { VoiceMeterStore, VoiceState } from './use-voice';
import styles from './voice-orb.module.css';

export type { MascotEmotion, MascotState } from '@/lib/mascot/emotions';
export { Mascot, type MascotHandle, type MascotLevelStore, type MascotProps } from './mascot/mascot';
export { useConfetti, fireConfetti, CONFETTI_COLORS } from './mascot/confetti';
export const CONFETTI = { colors: ['#DAF163', '#BBB2F5', '#3FD5EA', '#FF8FB1'] as const, particles: 120, seconds: 1.6 } as const;

/** 0.4 moods. Mapped: calm → calm, attentive → listening, curious → curious, friendly → happy, pleased → proud, supportive → sad. */
export type OrbEmotion = LegacyOrbEmotion;

type VoiceOrbProps = {
  state: VoiceState;
  /** Static level when no store is given (0–1). */
  volume?: number;
  /** use-voice `meterStore`: microphone while listening; while speaking it also carries the playback level. */
  meterStore?: VoiceMeterStore;
  /** Old moods or any new mascot emotion. */
  emotion?: OrbEmotion | MascotEmotion;
  statusDescription?: string;
  openingGreeting?: boolean;
  /** Preferred lip-sync source: use-voice `speechLevelStore` (rms·4). Falls back to `meterStore` while speaking. */
  speechLevelStore?: VoiceMeterStore;
  /** Increment to celebrate (joy + confetti). */
  celebrate?: number;
  className?: string;
};

/**
 * The 0.4 meterStore maps playback RMS as (20·log10(rms) + 55) / 55. Invert it to the spec's lip-sync
 * level clamp(rms·4, 0, 1) so the mouth articulates instead of hanging open between syllables.
 */
function playbackFromMeter(store: MascotLevelStore): MascotLevelStore {
  return {
    subscribe: listener => store.subscribe(listener),
    getSnapshot() {
      const value = Number(store.getSnapshot());
      if (!(value > 0)) return 0;
      const rms = Math.pow(10, (value * 55 - 55) / 20);
      return Math.min(1, Math.max(0, rms * 4));
    },
  };
}

export const VoiceOrb = memo(function VoiceOrb({ state, volume = 0, meterStore, emotion, statusDescription, openingGreeting = false, speechLevelStore, celebrate, className }: VoiceOrbProps) {
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const volumeStore = useMemo<MascotLevelStore>(() => ({ subscribe: () => () => {}, getSnapshot: () => volumeRef.current }), []);
  const micStore: MascotLevelStore = meterStore ?? volumeStore;
  const fallbackSpeech = useMemo(() => playbackFromMeter(micStore), [micStore]);
  return <Mascot
    className={`voice-orb ${styles.orb}${className ? ' ' + className : ''}`}
    state={state}
    emotion={emotion ? toMascotEmotion(emotion) : undefined}
    micLevelStore={micStore}
    speechLevelStore={speechLevelStore ?? fallbackSpeech}
    statusDescription={statusDescription}
    greeting={openingGreeting}
    celebrate={celebrate}
  />;
});
