// Compatibility re-exports for the 0.4 lens renderer. The jelly renderer lives in
// components/mascot/renderer.ts and the geometry in lib/mascot/face.ts.
import { eyePath as mascotEyePath } from '@/lib/mascot/face';
export { createMascotRenderer, renderStill, type MascotRenderer, type MascotRenderInput } from './mascot/renderer';

export type Spring = { value: number; velocity: number };
export function advanceSpring(spring: Spring, target: number, dt: number, stiffness = 190, damping = 22) {
  spring.velocity += ((target - spring.value) * stiffness - spring.velocity * damping) * dt;
  spring.value += spring.velocity * dt;
}

/** 0.4 signature: eye in a 20 × 32 box (origin top-left), pill → happy arc by `joy`. */
export function eyePath(open: number, joy: number) {
  return mascotEyePath(open, joy, 0, 20, 32).replace(/(-?\d*\.?\d+)\s(-?\d*\.?\d+)/g, (_, x: string, y: string) => `${Math.round((Number(x) + 10) * 1000) / 1000},${Math.round((Number(y) + 16) * 1000) / 1000}`);
}
