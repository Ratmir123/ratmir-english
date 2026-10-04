'use client';

import type { CSSProperties, Ref } from 'react';
import { Mascot, type MascotEmotion, type MascotHandle, type MascotLevelStore, type MascotState } from '../mascot/mascot';
import type { VoiceState } from '../use-voice';

export type { MascotEmotion, MascotHandle };

/** The shell's single entry to the W1 mascot: maps voice state + app context (MASCOT-SPEC §8) to its props. */
export function Companion({ state = 'idle', emotion, micLevelStore, speechLevelStore, status, size, interactive = true, greeting = false,
  celebrate, celebrateEmotion, confetti, still = false, exclusive, handleRef, className, style }: {
  state?: VoiceState; emotion?: MascotEmotion; micLevelStore?: MascotLevelStore; speechLevelStore?: MascotLevelStore;
  status?: string; size?: number; interactive?: boolean; greeting?: boolean; celebrate?: number; celebrateEmotion?: MascotEmotion;
  confetti?: boolean; still?: boolean; exclusive?: boolean; handleRef?: Ref<MascotHandle>; className?: string; style?: CSSProperties;
}) {
  return <Mascot state={state as MascotState} emotion={emotion} micLevelStore={micLevelStore} speechLevelStore={speechLevelStore}
    statusDescription={status} size={size} interactive={interactive} greeting={greeting} celebrate={celebrate}
    celebrateEmotion={celebrateEmotion} confetti={confetti} still={still} exclusive={exclusive} handleRef={handleRef}
    className={className} style={style} />;
}
