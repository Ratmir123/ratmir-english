// Smooth Talk mascot — rolling kinematics (PASS-0.5.3 §4) and the compositor idle pose (§6). Pure: no DOM, no React.
// Rolling, not swinging: like an egg rocking on its base, the body rotates about a pivot near its bottom and shifts
// sideways with the tilt, so the top and the centre travel the same way; the floor shadow follows the shift
// (lib/mascot/shadow). The iPhone mirrors it in MascotFace.swift (rotation anchor UnitPoint(0.5, ROLL.pivotY) + the same
// x offset) and MascotShadow.swift.
import { BODY_RADIUS, COMPOSITOR_IDLE, ROLL } from './constants';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const finite = (value: number) => Number.isFinite(value) ? value : 0;
const n2 = (value: number) => Math.round(value * 100) / 100;
const n4 = (value: number) => Math.round(value * 10000) / 10000;

/** Sideways rolling shift (px) for a tilt in degrees (positive = clockwise, top to the right) on a canvas of side S:
 * Δx = ROLL.shift·R0·S·φ(rad) = 0.273·S·φ, in the tilt direction. */
export function rollShift(rotation: number, side: number): number {
  return ROLL.shift * BODY_RADIUS * finite(side) * finite(rotation) * DEG;
}

/** The roll pivot below the canvas centre (px): (ROLL.pivotY − 0.5)·S = 0.36·S, just above the body's rest bottom (0.39·S). */
export function rollPivot(side: number): number {
  return (ROLL.pivotY - 0.5) * finite(side);
}

/** The pose fields the body transform reads (MascotFrame satisfies it). */
export interface BodyPose { x: number; y: number; rotation: number; scaleX: number; scaleY: number }

/**
 * CSS transform of the body element (transform-origin = the canvas centre): squash/scale anchored at the floor contact
 * (R0·S/2 below the centre), roll about the pivot, then the rolling shift and the pose offset. At rotation 0 it is the
 * 0.5.2 transform (translate + squash about the bottom).
 */
export function bodyTransform(pose: BodyPose, side: number): string {
  const S = finite(side), bottom = BODY_RADIUS * S / 2, pivot = rollPivot(S);
  return `translate3d(${n2(finite(pose.x) + rollShift(pose.rotation, S))}px,${n2(finite(pose.y))}px,0) translateY(${n2(pivot)}px) `
    + `rotate(${n2(finite(pose.rotation))}deg) translateY(${n2(bottom - pivot)}px) scale(${n4(finite(pose.scaleX))},${n4(finite(pose.scaleY))}) `
    + `translateY(${n2(-bottom)}px)`;
}

/** Where a body-local point (px from the canvas centre, y down) lands for a pose: the same mapping as bodyTransform. */
export function bodyPoint(pose: BodyPose, side: number, x: number, y: number): { x: number; y: number } {
  const S = finite(side), bottom = BODY_RADIUS * S / 2, pivot = rollPivot(S);
  const sx = x * pose.scaleX, sy = bottom + (y - bottom) * pose.scaleY; // squash about the floor contact
  const angle = finite(pose.rotation) * DEG, c = Math.cos(angle), s = Math.sin(angle);
  const dx = sx, dy = sy - pivot; // roll about the pivot (CSS rotate: clockwise on screen, y down)
  return { x: dx * c - dy * s + finite(pose.x) + rollShift(pose.rotation, S), y: pivot + dx * s + dy * c + finite(pose.y) };
}

/** Compositor idle (§6) at phase u (0–1) of its period: roll in degrees (starts upright, rolls to + first), breath scale and
 * the rolling shift as a fraction of S. mascot.module.css samples it every 2.5 % (tests/mascot-roll.test.ts). */
export function compositorIdlePose(u: number): { angle: number; scale: number; shift: number } {
  const phase = TAU * finite(u);
  const angle = COMPOSITOR_IDLE.degrees * Math.sin(phase);
  return { angle, scale: 1 + COMPOSITOR_IDLE.breath * (1 - Math.cos(phase)) / 2, shift: rollShift(angle, 1) };
}
