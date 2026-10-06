// Smooth Talk mascot — shared constants (planning/v05/MASCOT-SPEC.md).
// The iPhone (SwiftUI + Metal) build uses exactly the same numbers, so both feel identical.
// Units: S = canvas side in CSS px/pt. Ring displacement d_i is a fraction of R0.

/** §2 deformable outline */
export const NODE_COUNT = 32;
export const BODY_RADIUS = 0.78; // R0, shader units (p ∈ [-1,1]² over the canvas)
export const KERNEL_K = 38; // w_i = exp(K·(cos(θ − θ_i) − 1))
export const SUPERELLIPSE_N = 2.65;

/** §2 simulation */
export const STEP_DT = 1 / 240;
export const MAX_SUBSTEPS = 8;
export const K_SPRING = 140;
export const C_DAMP = 7.5;
export const K_NEIGH = 900;
export const VOLUME_KEEP = 0.85;
export const D_MIN = -0.32;
export const D_MAX = 0.26;

/** §2 global body springs: v += (k·(target − x) − c·v)·dt; x += v·dt */
export const POS_SPRING = { k: 170, c: 15 } as const;
export const SQUASH_SPRING = { k: 260, c: 9, clamp: 0.35 } as const;
export const TILT_SPRING = { k: 120, c: 11, clamp: 14 } as const;
export const HOP_SPRING = { k: 210, c: 13 } as const;
/** Uniform puff/shrink and sag (proud ×1.06, shy ×0.95, sad scaleY 0.95). Not tuned by the spec; mildly bouncy. */
export const SCALE_SPRING = { k: 170, c: 16 } as const;

/** §3 touch → physics */
export const TOUCH = {
  dentImpulse: 2.4,
  dentSigma: 0.45,
  centreRadius: 0.55, // ρ below which a press also squashes
  centreSquash: 0.9,
  squintSeconds: 0.15,
  holdForce: 22,
  holdRampSeconds: 0.35,
  longPressSeconds: 0.6,
  squeezeQ: 0.22,
  dragThreshold: 6, // pt
  dragFollow: 0.35,
  dragRadius: 0.22, // ·S
  stretchForce: 14,
  stretchSpan: 0.5, // ·S
  dragTiltPerPt: 0.09,
  dragTiltMax: 12,
  tapSeconds: 0.22,
  tapSquash: 1.4,
  tapHop: -0.9, // ·S per second
  bigBoing: 2.0,
  rapidTaps: 4,
  rapidWindow: 2,
  tickleTaps: 9,
  tickleWindow: 4,
  shakeReversals: 3,
  shakeWindow: 1,
  shakeAmplitude: 0.15, // ·S
  hoverRadius: 420, // px
} as const;

/** §4 face (fractions of S, measured from the canvas centre; y grows down) */
export const FACE = {
  eyeX: 0.135,
  eyeY: -0.035,
  eyeW: 0.078,
  eyeH: 0.115,
  eyeColor: '#FDFEFF',
  glowRadius: 0.014,
  glowOpacity: 0.6,
  gazeX: 0.038,
  gazeY: 0.024,
  mouthY: 0.105,
  mouthInterior: '#2A1F5E',
  mouthInteriorOpacity: 0.85,
  mouthRim: 0.006,
  tongue: '#FF8FB1',
  blushX: 0.205,
  blushY: 0.06,
  blushW: 0.075,
  blushH: 0.042,
  blushColor: '#FF8FB1',
  blushBlur: 0.012,
  shapeFadeSeconds: 0.12,
  blinkMin: 3.2,
  blinkMax: 6.5,
  blinkSeconds: 0.14,
  doubleBlinkChance: 0.2,
  /** Critically damped face springs. */
  spring: { k: 320, c: 2 * Math.sqrt(320) },
} as const;

/** Mouth reference formula (§4). */
export const MOUTH = {
  cornerLift: 0.26,
  thickness: 0.09,
  upperSmile: 0.16,
  upperOpen: 0.22,
  lowerOpen: 1.05,
  lowerSmile: 0.22,
  ovalCentre: 0.15,
  ovalRadius: 0.3,
  ovalBase: 0.55,
  ovalOpen: 0.9,
  kappa: 0.5523,
} as const;

/** §7 audio */
export const AUDIO = {
  attackSeconds: 0.035,
  releaseSeconds: 0.11,
  mouthRest: 0.08,
  mouthRange: 0.85,
  syllableBob: 0.18,
  micPulse: 0.05,
  micEyes: 0.1,
} as const;

/** §6 idle life (PASS-0.5.3 §4: a roll episode replaces the held ±6° tilt; the pointer gaze relaxes when the pointer rests). */
export const IDLE = {
  minGap: 4,
  maxGap: 7,
  sleepAfter: 60,
  glance: 0.5,
  glanceSeconds: 0.8,
  hop: -0.6, // ·S per second
  /** Roll episode (same 15 % share of the idle picks as the old tilt): one smooth cycle 0 → +5° → −5° → 0, random sign. */
  rollDegrees: 5,
  rollSeconds: 2.6,
  flickerSmile: 0.4,
  flickerSeconds: 0.6,
  /** Web pointer gaze: after gazeRelaxAfter s without pointer movement it eases back to the centre over gazeRelaxSeconds. */
  gazeRelaxAfter: 2.5,
  gazeRelaxSeconds: 0.6,
} as const;

/**
 * PASS-0.5.3 §4 — rolling, not swinging (an egg rocking on its base). The body rotates about a pivot near its base and
 * shifts sideways with the tilt; the floor shadow follows the shift. pivotY: fraction of the canvas side from the top
 * (the body's rest bottom is at 0.89; iPhone: rotation anchor UnitPoint(0.5, 0.86)). Δx = shift·R0·S·φ(rad) in the tilt
 * direction, i.e. 0.35 × 0.78 × S × φ = 0.273·S·φ. Static, settled and reduced-motion poses are upright (φ = 0, Δx = 0).
 */
export const ROLL = { pivotY: 0.86, shift: 0.35 } as const;

/**
 * PASS-0.5.3 §6 — compositor idle (idleMode 'compositor', the launch preloader): one settled upright WebGL frame plus a CSS
 * keyframe roll (±degrees about the roll pivot, with the rolling shift) and breath (scale 1 ↔ 1 + breath) on a wrapper,
 * period `seconds`, transform only. Switching to the live physics eases the wrapper back to identity in handoffMs.
 * mascot.module.css holds the keyframes; tests/mascot-roll.test.ts checks them against these numbers.
 */
export const COMPOSITOR_IDLE = { degrees: 4, breath: 0.015, seconds: 4.2, handoffMs: 320 } as const;

/** Mood tint colours, linear 0–1 sRGB triplets (§1). */
export const TINT_RGB = {
  lime: [0xda / 255, 0xf1 / 255, 0x63 / 255],
  pink: [0xff / 255, 0x8f / 255, 0xb1 / 255],
  blue: [0x3b / 255, 0x5b / 255, 0xdb / 255],
  violet: [0x7b / 255, 0x6c / 255, 0xf6 / 255],
  cyan: [0x3f / 255, 0xd5 / 255, 0xea / 255],
} as const;
export type TintName = keyof typeof TINT_RGB;

/** Dark theme shader adjustments (§1). */
export const DARK = { rim: 0.15, specular: 0.2, tint: 0.08, seconds: 0.3 } as const;
