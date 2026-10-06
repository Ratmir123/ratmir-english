'use client';

import type { CSSProperties } from 'react';
import { Companion, type MascotEmotion } from './companion';

/**
 * The live companion for screen headers, empty states and cards (MOTION-PASS-0.5.2 §3). Always animated (idle life,
 * blinking, pointer play) and never competing with the lesson's main mascot (`exclusive={false}`). The mood says what
 * the screen or card is about; it is decorative, so the adjacent heading carries the meaning for screen readers.
 * `fluid` takes the size from CSS (`className`) instead of `size`, for companions that shrink on narrow screens
 * (`.screen-mascot` in app/globals.css: 96 px, 72 px at ≤ 640 px).
 */
export function ScreenMascot({ emotion, size = 96, fluid = false, className, style, interactive = true }: {
  emotion: MascotEmotion; size?: number; fluid?: boolean; className?: string; style?: CSSProperties; interactive?: boolean;
}) {
  return <div className={className} style={fluid ? { flexShrink: 0, ...style } : { width: size, height: size, flexShrink: 0, ...style }}>
    <Companion emotion={emotion} size={fluid ? undefined : size} interactive={interactive} decorative exclusive={false} />
  </div>;
}
