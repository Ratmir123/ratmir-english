// Smooth Talk mascot — floor shadow (planning/v05/DESIGN-PASS-0.5.1.md «Тень маскота — физика»).
// Light from above-front; the floor is the body's rest bottom. Two layers: a tight contact shadow that
// vanishes quickly with height and a soft ambient one that fades slowly. Pure: no DOM, no allocation per
// frame. The iPhone mirrors every number in ios/Sources/MascotShadow.swift.
import { BODY_RADIUS, SQUASH_SPRING } from './constants';

export type ShadowLayer = 'contact' | 'ambient';
export type ShadowTheme = 'light' | 'dark';
export type RGB = readonly [number, number, number];

interface ShadowLayerTuning {
  /** Base box, ·S. */
  width: number; height: number;
  /** Shift toward the lean: ·S·sin(rotation). */
  lean: number;
  /** Size 1/(1 + shrink·lift); opacity 1/(1 + fade·lift)²; lift = height above the floor, ·S. */
  shrink: number; fade: number;
  /** Widening (x) and deepening (y) per unit of positive squash q. */
  squash: number; depth: number;
  /** Widening when pushed into the floor (press 0–1). */
  press: number;
  /** Opacity at rest; squash and press darken up to 1. */
  rest: number; darken: number; pressDarken: number;
  /** Blur ·S in the layer's own (unscaled) space: (blur + blurLift·lift)·(1 − tighten·press). */
  blur: number; blurLift: number; tighten: number;
  /** Ink gradient [location, alpha multiplier], centre → edge of the box ellipse. */
  stops: readonly (readonly [number, number])[];
}

export const SHADOW = {
  /** Floor line, ·S from the canvas top: rest bottom of the body (0.5 + R0/2 = 0.89). */
  floorY: 0.5 + BODY_RADIUS / 2,
  /** Downward offset (·S) that presses the contact fully into the floor. */
  pressSpan: 0.12,
  /** A tilted body's lowest point dips below its rest bottom by ≈ tiltDip·S·sin²(rotation) (superellipse n = 2.65). */
  tiltDip: 0.27,
  contact: {
    width: 0.44, height: 0.065, lean: 0.3, shrink: 3, fade: 9, squash: 0.8, depth: 0.4, press: 0.12,
    rest: 0.75, darken: 1, pressDarken: 0.25, blur: 0.01, blurLift: 0.12, tighten: 0.5,
    stops: [[0, 1], [0.5, 0.62], [1, 0]],
  } as ShadowLayerTuning,
  ambient: {
    width: 0.68, height: 0.13, lean: 0.12, shrink: 1.2, fade: 1.4, squash: 0.25, depth: 0, press: 0,
    rest: 0.9, darken: 0.3, pressDarken: 0, blur: 0.025, blurLift: 0.2, tighten: 0,
    stops: [[0, 1], [0.55, 0.42], [1, 0]],
  } as ShadowLayerTuning,
  /** Light focused by the glass body: a small lime → lavender spot inside the contact box (radii and centre are fractions of it). */
  caustic: { radiusX: 0.22, radiusY: 0.28, centerY: 0.56, inner: [218, 241, 99] as RGB, outer: [187, 178, 245] as RGB },
  /**
   * Light pool: the glass focuses light onto the floor. A third layer riding the ambient pose (follows, spreads and
   * fades with height); box ·S centred `offsetY`·S in front of (below) the floor line, so it shows beside the body.
   * Only on dark pages, where darkening alone is invisible.
   */
  pool: {
    width: 0.62, height: 0.15, offsetY: 0.04, inner: [218, 241, 99] as RGB, outer: [187, 178, 245] as RGB,
    stops: [[0, 1], [0.5, 0.45], [1, 0]] as readonly (readonly [number, number])[],
  },
} as const;

/** Neutral ink from the background and peak alphas per theme (layer opacity multiplies them). */
export const SHADOW_PALETTE: Record<ShadowTheme, { ink: RGB; contact: number; ambient: number; caustic: number; pool: number }> = {
  light: { ink: [30, 30, 58], contact: 0.42, ambient: 0.17, caustic: 0.1, pool: 0 },
  dark: { ink: [0, 0, 4], contact: 0.82, ambient: 0.55, caustic: 0.13, pool: 0.3 },
};

export interface ShadowLayerPose {
  /** Horizontal centre offset from the canvas centre, px. */
  x: number;
  /** Relative to the base box. */
  scaleX: number; scaleY: number;
  opacity: number;
  /** px in the layer's own space (the scale applies on top, like CSS filter + transform). */
  blur: number;
}
export interface MascotShadowPose {
  /** Floor line in px from the canvas top: the rest floor, or the body's lowest point when it is pushed below it
   * (the shadow then travels down with the body and always shows just under it). */
  floorY: number;
  /** Height of the body above the floor, ·S. */
  lift: number;
  contact: ShadowLayerPose;
  ambient: ShadowLayerPose;
}
/** The frame fields the shadow reads (MascotFrame satisfies it). */
export interface ShadowSource { x: number; y: number; rotation: number; scaleX: number; squash: number }

const layerPose = (): ShadowLayerPose => ({ x: 0, scaleX: 1, scaleY: 1, opacity: 0, blur: 0 });
export const createShadowPose = (): MascotShadowPose => ({ floorY: 0, lift: 0, contact: layerPose(), ambient: layerPose() });

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => value < min ? min : value > max ? max : value;

function placeLayer(out: ShadowLayerPose, t: ShadowLayerTuning, x: number, lift: number, press: number, flat: number, width: number, lean: number, S: number) {
  const shrink = 1 / (1 + t.shrink * lift);
  const fade = 1 / ((1 + t.fade * lift) * (1 + t.fade * lift));
  out.x = x + t.lean * S * lean;
  out.scaleX = width * (1 + t.squash * flat) * (1 + t.press * press) * shrink;
  out.scaleY = (1 + t.depth * flat) * shrink;
  out.opacity = Math.min(1, t.rest * fade * (1 + t.darken * flat + t.pressDarken * press));
  out.blur = S * (t.blur + t.blurLift * lift) * (1 - t.tighten * press);
}

/**
 * Shadow for one frame. Height = upward body offset (drag up + hop, y < 0): the shadow stays on the rest floor and
 * shrinks, fades and softens. Pushed down (y > 0) the floor follows the body's lowest point (continuous at y = 0),
 * so the shadow is never hidden behind the body, and the contact tightens, widens and darkens. Writes into `out`.
 */
export function shadowPose(frame: ShadowSource, side: number, out: MascotShadowPose = createShadowPose()): MascotShadowPose {
  const S = Number.isFinite(side) && side > 0 ? side : 1;
  const x = finite(frame.x), y = finite(frame.y);
  const lift = Math.max(0, -y) / S;
  const press = clamp(y / (SHADOW.pressSpan * S), 0, 1);
  const flat = clamp(finite(frame.squash), 0, SQUASH_SPRING.clamp);
  const width = Math.max(0.5, finite(frame.scaleX, 1));
  const lean = Math.sin(finite(frame.rotation) * Math.PI / 180);
  out.floorY = SHADOW.floorY * S + Math.max(0, y + SHADOW.tiltDip * S * lean * lean);
  out.lift = lift;
  placeLayer(out.contact, SHADOW.contact, x, lift, press, flat, width, lean, S);
  placeLayer(out.ambient, SHADOW.ambient, x, lift, press, flat, width, lean, S);
  return out;
}

const rgba = (rgb: RGB, alpha: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.round(alpha * 1000) / 1000})`;
const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;

/** Glass colours on the floor: caustic inside the contact; a light pool where darkening is invisible. The app ships
 * SHIPPING_GLASS (the numbers above, mirrored on the iPhone); lab presets bring their own. */
export interface ShadowGlass {
  caustic: readonly [RGB, RGB];
  pool: readonly [RGB, RGB];
  poolAlpha: Readonly<Record<ShadowTheme, number>>;
}
export const SHIPPING_GLASS: ShadowGlass = {
  caustic: [SHADOW.caustic.inner, SHADOW.caustic.outer],
  pool: [SHADOW.pool.inner, SHADOW.pool.outer],
  poolAlpha: { light: SHADOW_PALETTE.light.pool, dark: SHADOW_PALETTE.dark.pool },
};

/** CSS background of a layer: ink ellipse filling its box; the contact adds the caustic on top, well inside the ink core. */
export function shadowFill(layer: ShadowLayer, theme: ShadowTheme, glass: ShadowGlass = SHIPPING_GLASS): string {
  const palette = SHADOW_PALETTE[theme];
  const stops = SHADOW[layer].stops.map(([at, k]) => `${rgba(palette.ink, palette[layer] * k)} ${percent(at)}`).join(',');
  const ink = `radial-gradient(closest-side,${stops})`;
  if (layer === 'ambient') return ink;
  const c = SHADOW.caustic, a = palette.caustic, [inner, outer] = glass.caustic;
  return `radial-gradient(${percent(c.radiusX)} ${percent(c.radiusY)} at 50% ${percent(c.centerY)},${rgba(inner, a)} 0%,${rgba(outer, a * 0.5)} 50%,${rgba(outer, 0)} 100%),${ink}`;
}

/** CSS background of the light pool ('none' when the theme has no pool): a soft glass-coloured ellipse, no dark centre. */
export function poolFill(theme: ShadowTheme, glass: ShadowGlass = SHIPPING_GLASS): string {
  const a = glass.poolAlpha[theme];
  if (!(a > 0)) return 'none';
  const [inner, outer] = glass.pool;
  return `radial-gradient(closest-side,${SHADOW.pool.stops.map(([at, k], i) => `${rgba(i === 0 ? inner : outer, a * k)} ${percent(at)}`).join(',')})`;
}
