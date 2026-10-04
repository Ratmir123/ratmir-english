'use client';

/** One place where the W3 features use W1's mascot (components/mascot/mascot.tsx). */
import { Mascot, type MascotEmotion, type MascotLevelStore, type MascotState } from '@/components/mascot/mascot';

export function FeatureMascot({ emotion, state = 'idle', size = 120, mic, speech, celebrate, celebrateEmotion, label, interactive = true, still = false }: {
  emotion?: MascotEmotion; state?: MascotState; size?: number; mic?: MascotLevelStore; speech?: MascotLevelStore;
  celebrate?: number; celebrateEmotion?: MascotEmotion; label?: string; interactive?: boolean;
  /** Decorative/small: static pose through the shared WebGL context (no animation loop). */
  still?: boolean;
}) {
  return (
    <Mascot size={size} state={state} emotion={emotion} micLevelStore={mic} speechLevelStore={speech} celebrate={celebrate}
      celebrateEmotion={celebrateEmotion} statusDescription={label} interactive={still ? false : interactive} still={still} />
  );
}
