// Face geometry (MASCOT-SPEC §4). Pure functions → SVG path strings.
// Coordinates: origin at the feature centre, y grows down, lengths in the caller's units
// (pass scale = S; the web renderer uses a 100-unit viewBox, i.e. scale = 100).
import { FACE, MOUTH } from './constants';
import type { EyeShape } from './emotions';

/** Compact number for path strings (2 decimals, no trailing zeros, no "-0"). */
export function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? '0' : String(rounded);
}

// Pill ↔ ∩ happy arc. 13 points (M + 4 cubics) in the unit eye box: [pill x, pill y, smile x, smile y].
// Same topology as the 0.4 VoiceOrb eye and the iPhone MorphingCompanionEye.
const EYE_POINTS: readonly (readonly [number, number, number, number])[] = [
  [0.05, 0.5, 0, 0.68],
  [0.05, 0.16, 0.08, 0.43], [0.2, 0, 0.28, 0.28], [0.5, 0, 0.5, 0.28],
  [0.8, 0, 0.72, 0.28], [0.95, 0.16, 0.92, 0.43], [0.95, 0.5, 1, 0.68],
  [0.95, 0.84, 0.96, 0.87], [0.8, 1, 0.72, 0.48], [0.5, 1, 0.5, 0.48],
  [0.2, 1, 0.28, 0.48], [0.05, 0.84, 0.04, 0.87], [0.05, 0.5, 0, 0.68],
];

/** Writes the 13 eye points (x,y pairs) into `out` (length ≥ 26). Box w × h centred at the origin. */
export function eyePoints(open: number, smile: number, squint: number, w: number, h: number, out: Float64Array): Float64Array {
  const j = Math.min(1, Math.max(0, smile));
  const o = Math.max(0.08, open);
  const flatten = 1 - 0.6 * Math.min(1, Math.max(0, squint));
  for (let i = 0; i < 13; i++) {
    const point = EYE_POINTS[i];
    const x = point[0] + (point[2] - point[0]) * j;
    const y = point[1] + (point[3] - point[1]) * j;
    let cy = (y - 0.5) * h * o;
    if (cy < 0) cy *= flatten; // squint flattens the top half
    out[i * 2] = (x - 0.5) * w;
    out[i * 2 + 1] = cy;
  }
  return out;
}

/** Path string for 13 points laid out as M p0 C p1 p2 p3 C … Z. */
export function cubicPath(points: Float64Array, dx = 0, dy = 0): string {
  let d = 'M' + fmt(points[0] + dx) + ' ' + fmt(points[1] + dy);
  for (let segment = 0; segment < 4; segment++) {
    const base = 2 + segment * 6;
    d += 'C' + fmt(points[base] + dx) + ' ' + fmt(points[base + 1] + dy)
      + ' ' + fmt(points[base + 2] + dx) + ' ' + fmt(points[base + 3] + dy)
      + ' ' + fmt(points[base + 4] + dx) + ' ' + fmt(points[base + 5] + dy);
  }
  return d + 'Z';
}

const eyeScratch = new Float64Array(26);
/** Morphing pill eye: open 0–1.4, smile 0–1 (pill → ∩ arc), squint 0–1. Box w × h centred at the origin. */
export function eyePath(open: number, smile: number, squint: number, w: number, h: number): string {
  return cubicPath(eyePoints(open, smile, squint, w, h, eyeScratch));
}
/** Eye box for a given S (eye box 0.078·S × 0.115·S). */
export function eyeBox(scale: number) { return { w: FACE.eyeW * scale, h: FACE.eyeH * scale }; }

export interface SpecialEyeGeometry {
  d: string;
  /** Filled shapes (heart, star) vs stroked lines (spiral, cross, closed, caret). */
  filled: boolean;
  /** Stroke width in the same units (0 for filled shapes without outline). */
  stroke: number;
}

/**
 * Special eye shapes (cross-faded over 0.12 s, never morphed). side: 0 = left eye, 1 = right eye.
 * Sized from the eye box so they read at every mascot size.
 */
export function specialEyeShape(shape: Exclude<EyeShape, 'pill'>, side: 0 | 1, w: number, h: number): SpecialEyeGeometry {
  switch (shape) {
    case 'heart': {
      // Rounded heart ~1.35·w wide, slightly above the eye centre.
      const sx = w * 0.68, sy = h * 0.42, oy = -h * 0.04;
      const p = (x: number, y: number) => fmt(x * sx) + ' ' + fmt(y * sy + oy);
      return {
        d: `M${p(0, 1)}C${p(-0.28, 0.78)} ${p(-1, 0.28)} ${p(-1, -0.28)}C${p(-1, -0.78)} ${p(-0.52, -1.02)} ${p(-0.22, -0.9)}`
          + `C${p(-0.1, -0.85)} ${p(0, -0.72)} ${p(0, -0.6)}C${p(0, -0.72)} ${p(0.1, -0.85)} ${p(0.22, -0.9)}`
          + `C${p(0.52, -1.02)} ${p(1, -0.78)} ${p(1, -0.28)}C${p(1, 0.28)} ${p(0.28, 0.78)} ${p(0, 1)}Z`,
        filled: true, stroke: w * 0.1,
      };
    }
    case 'star': {
      // 5-point star, one point up, rounded by a same-colour stroke.
      const outer = w * 0.7, inner = outer * 0.46;
      let d = '';
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = -Math.PI / 2 + i * Math.PI / 5;
        d += (i === 0 ? 'M' : 'L') + fmt(Math.cos(angle) * radius) + ' ' + fmt(Math.sin(angle) * radius - h * 0.02);
      }
      return { d: d + 'Z', filled: true, stroke: w * 0.16 };
    }
    case 'spiral': {
      // Archimedean spiral, ~2.6 turns, drawn as a smooth polyline. Mirrored per eye so both spin outward.
      const turns = 2.6, steps = 46, max = w * 0.62, dir = side === 0 ? 1 : -1;
      let d = '';
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = t * turns * Math.PI * 2;
        const radius = max * t;
        d += (i === 0 ? 'M' : 'L') + fmt(Math.cos(angle) * radius * dir) + ' ' + fmt(Math.sin(angle) * radius);
      }
      return { d, filled: false, stroke: w * 0.17 };
    }
    case 'cross': {
      const a = w * 0.42;
      return { d: `M${fmt(-a)} ${fmt(-a)}L${fmt(a)} ${fmt(a)}M${fmt(a)} ${fmt(-a)}L${fmt(-a)} ${fmt(a)}`, filled: false, stroke: w * 0.2 };
    }
    case 'closed': {
      // Thin relaxed arc ‿ (sleep).
      const a = w * 0.56, top = h * 0.02, dip = h * 0.22;
      return { d: `M${fmt(-a)} ${fmt(top)}C${fmt(-a * 0.55)} ${fmt(dip)} ${fmt(a * 0.55)} ${fmt(dip)} ${fmt(a)} ${fmt(top)}`, filled: false, stroke: w * 0.19 };
    }
    case 'caret': {
      // >_< : the left eye points right (towards the nose), the right eye points left.
      const ax = w * 0.38, ay = h * 0.27, dir = side === 0 ? 1 : -1;
      return { d: `M${fmt(-ax * dir)} ${fmt(-ay)}L${fmt(ax * dir)} 0L${fmt(-ax * dir)} ${fmt(ay)}`, filled: false, stroke: w * 0.2 };
    }
  }
}

/**
 * Mouth control points (§4 reference formula), written into `out` (26 numbers = 13 points):
 * M L, C (upper first half), C (upper second half) → R, C (lower first half), C (lower second half) → L.
 * The lip shape is two cubics split at t = 0.5, the oval is four quarter arcs, and the result is the
 * control-point lerp by r, so the topology is identical for every parameter set.
 */
const lipScratch = new Float64Array(26);
const ovalScratch = new Float64Array(26);
function setPoint(target: Float64Array, index: number, x: number, y: number) { target[index * 2] = x; target[index * 2 + 1] = y; }

/** Lip shape only (two cubics split at t = 0.5 into four), written into `out`. */
export function lipPoints(w: number, o: number, s: number, scale: number, out: Float64Array): Float64Array {
  const W = w * scale;
  const cy = -MOUTH.cornerLift * s * W;
  const t = MOUTH.thickness * W;
  const u = MOUTH.upperSmile * s * W - MOUTH.upperOpen * o * W;
  const l = u + t + MOUTH.lowerOpen * o * W + MOUTH.lowerSmile * Math.max(0, s) * W;
  const h = W / 2, q = W / 4;
  const U = cy + u, L = cy + l;
  // Upper cubic L → R: P0(−h, cy) P1(−q, U) P2(q, U) P3(h, cy). de Casteljau at 0.5:
  setPoint(out, 0, -h, cy);
  setPoint(out, 1, (-h - q) / 2, (cy + U) / 2); // (P0 + P1)/2
  setPoint(out, 2, (-h - q) / 4, (cy + 3 * U) / 4); // (P0 + 2P1 + P2)/4
  setPoint(out, 3, 0, (2 * cy + 6 * U) / 8); // midpoint
  setPoint(out, 4, (q + h) / 4, (3 * U + cy) / 4); // (P1 + 2P2 + P3)/4
  setPoint(out, 5, (q + h) / 2, (U + cy) / 2); // (P2 + P3)/2
  setPoint(out, 6, h, cy);
  // Lower cubic R → L: Q0(h, cy) Q1(q, L) Q2(−q, L) Q3(−h, cy).
  setPoint(out, 7, (h + q) / 2, (cy + L) / 2);
  setPoint(out, 8, (h + q) / 4, (cy + 3 * L) / 4);
  setPoint(out, 9, 0, (2 * cy + 6 * L) / 8);
  setPoint(out, 10, (-q - h) / 4, (3 * L + cy) / 4);
  setPoint(out, 11, (-q - h) / 2, (L + cy) / 2);
  setPoint(out, 12, -h, cy);
  return out;
}

/** Oval only: centre (0, 0.15·o·W), rx = 0.30·W, ry = 0.30·W·(0.55 + 0.9·o), four quarter arcs left → top → right → bottom → left. */
export function ovalPoints(w: number, o: number, scale: number, out: Float64Array): Float64Array {
  const W = w * scale;
  const c = MOUTH.ovalCentre * o * W;
  const rx = MOUTH.ovalRadius * W;
  const ry = MOUTH.ovalRadius * W * (MOUTH.ovalBase + MOUTH.ovalOpen * o);
  const k = MOUTH.kappa;
  setPoint(out, 0, -rx, c);
  setPoint(out, 1, -rx, c - k * ry); setPoint(out, 2, -k * rx, c - ry); setPoint(out, 3, 0, c - ry);
  setPoint(out, 4, k * rx, c - ry); setPoint(out, 5, rx, c - k * ry); setPoint(out, 6, rx, c);
  setPoint(out, 7, rx, c + k * ry); setPoint(out, 8, k * rx, c + ry); setPoint(out, 9, 0, c + ry);
  setPoint(out, 10, -k * rx, c + ry); setPoint(out, 11, -rx, c + k * ry); setPoint(out, 12, -rx, c);
  return out;
}

export function mouthPoints(w: number, o: number, s: number, r: number, scale: number, out: Float64Array): Float64Array {
  const lip = lipPoints(w, o, s, scale, lipScratch);
  const oval = ovalPoints(w, o, scale, ovalScratch);
  const mix = Math.min(1, Math.max(0, r));
  for (let i = 0; i < 26; i++) out[i] = lip[i] + (oval[i] - lip[i]) * mix;
  return out;
}

const mouthScratch = new Float64Array(26);
/** Mouth path centred on the mouth centre (0, +0.105·S is added by the caller). */
export function mouthPath(w: number, o: number, s: number, r: number, scale: number, dx = 0, dy = 0): string {
  return cubicPath(mouthPoints(w, o, s, r, scale, mouthScratch), dx, dy);
}

/** Vertical extent of the mouth opening (top of the upper lip middle → bottom of the lower lip middle). */
export function mouthOpening(w: number, o: number, s: number, r: number, scale: number): { top: number; bottom: number; width: number } {
  const points = mouthPoints(w, o, s, r, scale, mouthScratch);
  // Points 3 (upper middle) and 9 (lower middle) are the on-curve middles of the lip/oval.
  return { top: points[7], bottom: points[19], width: points[12] - points[0] };
}

/** Blush ellipses (§4): centres (±0.205·S, +0.06·S), size 0.075·S × 0.042·S. */
export function blushGeometry(scale: number) {
  return { x: FACE.blushX * scale, y: FACE.blushY * scale, rx: FACE.blushW * scale / 2, ry: FACE.blushH * scale / 2, blur: FACE.blushBlur * scale };
}

/** Strips numbers from a path, leaving its command structure (used to prove morphs never pop). */
export function pathCommands(d: string): string {
  return d.replace(/-?\d*\.?\d+(e-?\d+)?/gi, '#').replace(/\s+/g, ' ').trim();
}
