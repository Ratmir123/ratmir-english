/**
 * JS mirror of the 0.5.2 motion tokens in app/globals.css (MOTION-PASS-0.5.2 §1, «glass jelly settles»): long soft
 * deceleration, exits shorter than entrances, overshoot only for the mascot, medals and rewards. Animations driven
 * from script (Web Animations, timers that wait for a CSS exit) read these numbers so both sides stay in step.
 */
export const EASE_OUT = 'cubic-bezier(.16, 1, .3, 1)';
export const EASE_EXIT = 'cubic-bezier(.4, 0, 1, 1)';

export const MOTION_MS = {
  press: 200,
  pressed: 120,
  hover: 240,
  /** Lenses, lifts: the critically damped spring (no overshoot). */
  spring: 520,
  /** Rewards only. */
  bouncy: 680,
  reveal: 460,
  sheetIn: 560,
  sheetOut: 300,
  backdrop: 420,
  toastIn: 480,
  toastOut: 260,
  fill: 900,
  viewOut: 220,
  viewIn: 520,
  /** The launch layer hands off to the shell. */
  launchFade: 600,
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Expo-out position 0–1 for a progress t 0–1 (same feel as EASE_OUT for script-driven counters). */
export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * Math.max(0, t));
}
