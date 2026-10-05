// The mascot face: one SVG in a 100-unit viewBox (S = 100), rendered once by React and then updated
// per frame through refs. Attributes are only written when their string actually changes.
import { memo } from 'react';
import { FACE } from '@/lib/mascot/constants';
import type { EyeShape } from '@/lib/mascot/emotions';
import { blushGeometry, cubicPath, eyePath, fmt, mouthPoints, specialEyeShape, type SpecialEyeGeometry } from '@/lib/mascot/face';
import type { MascotFaceColors } from '@/lib/mascot/palette';
import type { MascotFrame } from '@/lib/mascot/physics';

const UNIT = 100;
const EYE_X = FACE.eyeX * UNIT, EYE_Y = FACE.eyeY * UNIT;
const EYE_W = FACE.eyeW * UNIT, EYE_H = FACE.eyeH * UNIT;
const MOUTH_Y = FACE.mouthY * UNIT;
const BLUSH = blushGeometry(UNIT);
const GLOW = FACE.glowRadius * UNIT;
const RIM = FACE.mouthRim * UNIT;
const Z_PATH = 'M-1.6 -1.7H1.6L-1.6 1.7H1.6';

export interface FaceRefs {
  face: SVGGElement | null;
  blush: SVGGElement | null;
  eyes: [SVGGElement | null, SVGGElement | null];
  pills: [SVGPathElement | null, SVGPathElement | null];
  specialGroups: [SVGGElement | null, SVGGElement | null];
  specials: [SVGPathElement | null, SVGPathElement | null];
  mouth: SVGGElement | null;
  lip: SVGPathElement | null;
  open: SVGPathElement | null;
  clip: SVGPathElement | null;
  tongue: SVGEllipseElement | null;
  zzz: SVGGElement | null;
  zs: [SVGPathElement | null, SVGPathElement | null, SVGPathElement | null];
}
export function createFaceRefs(): FaceRefs {
  return {
    face: null, blush: null, eyes: [null, null], pills: [null, null], specialGroups: [null, null], specials: [null, null],
    mouth: null, lip: null, open: null, clip: null, tongue: null, zzz: null, zs: [null, null, null],
  };
}

const specialCache = new Map<string, SpecialEyeGeometry>();
function special(shape: Exclude<EyeShape, 'pill'>, side: 0 | 1): SpecialEyeGeometry {
  const key = shape + side;
  let geometry = specialCache.get(key);
  if (!geometry) { geometry = specialEyeShape(shape, side, EYE_W, EYE_H); specialCache.set(key, geometry); }
  return geometry;
}

const mouthScratch = new Float64Array(26);
/** Initial (SSR-safe) strings for a frame, so the first paint is never blank. */
export function faceStrings(frame: MascotFrame): { pills: [string, string]; mouth: string } {
  const points = mouthPoints(frame.mouth.w, frame.mouth.o, frame.mouth.s, frame.mouth.r, UNIT, mouthScratch);
  return {
    pills: [0, 1].map(index => {
      const eye = frame.eyes[index];
      return eyePath(eye.open, eye.smile, eye.squint, EYE_W * eye.width, EYE_H);
    }) as [string, string],
    mouth: cubicPath(points),
  };
}

export interface FaceStrings { pills: [string, string]; mouth: string }
/** Rendered once; never re-rendered (props are stable), so per-frame imperative updates are never fought by React. */
/** Colours come from the mascot palette; a palette change re-renders only the colour attributes. */
export const MascotFace = memo(function MascotFace({ uid, refs, strings, blush, colors, className }: { uid: string; refs: FaceRefs; strings: FaceStrings; blush: number; colors: MascotFaceColors; className?: string }) {
  const glowId = `${uid}-glow`, blushId = `${uid}-blush`, clipId = `${uid}-mouth`;
  return <svg className={className} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false" overflow="visible">
    <defs>
      <radialGradient id={blushId}>
        <stop offset="0" stopColor={FACE.blushColor} stopOpacity="1" />
        <stop offset="0.45" stopColor={FACE.blushColor} stopOpacity="0.85" />
        <stop offset="1" stopColor={FACE.blushColor} stopOpacity="0" />
      </radialGradient>
      <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation={GLOW} result="blur" />
        <feFlood floodColor={colors.glow} floodOpacity={colors.glowOpacity} />
        <feComposite in2="blur" operator="in" result="glow" />
        <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <clipPath id={clipId}><path ref={node => { refs.clip = node; }} d={strings.mouth} /></clipPath>
    </defs>
    <g ref={node => { refs.blush = node; }} opacity={fmt(blush)}>
      {[-1, 1].map(side => <ellipse key={side} cx={fmt(side * BLUSH.x)} cy={fmt(BLUSH.y)} rx={fmt(BLUSH.rx + BLUSH.blur * 1.5)} ry={fmt(BLUSH.ry + BLUSH.blur * 1.5)} fill={`url(#${blushId})`} />)}
    </g>
    <g ref={node => { refs.face = node; }}>
      <g filter={`url(#${glowId})`}>
        {([0, 1] as const).map(index => <g key={index} ref={node => { refs.eyes[index] = node; }} transform={`translate(${fmt((index === 0 ? -1 : 1) * EYE_X)} ${fmt(EYE_Y)})`}>
          <path ref={node => { refs.pills[index] = node; }} d={strings.pills[index]} fill={colors.eye} />
          <g ref={node => { refs.specialGroups[index] = node; }} opacity="0">
            <path ref={node => { refs.specials[index] = node; }} d="" fill="none" stroke={colors.eye} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>)}
        <g ref={node => { refs.mouth = node; }} transform={`translate(0 ${fmt(MOUTH_Y)})`}>
          <path ref={node => { refs.lip = node; }} d={strings.mouth} fill={colors.eye} stroke={colors.lipStroke > 0 ? colors.eye : undefined} strokeWidth={colors.lipStroke > 0 ? colors.lipStroke : undefined} strokeLinejoin="round" />
          <path ref={node => { refs.open = node; }} d={strings.mouth} fill={colors.mouthInterior} fillOpacity={colors.mouthInteriorOpacity} stroke={colors.eye} strokeWidth={fmt(RIM)} strokeLinejoin="round" opacity="0" />
          <g clipPath={`url(#${clipId})`}><ellipse ref={node => { refs.tongue = node; }} cx="0" cy="0" rx="1" ry="1" fill={FACE.tongue} opacity="0" /></g>
        </g>
      </g>
    </g>
    <g ref={node => { refs.zzz = node; }} data-part="zzz" opacity="0" fill="none" stroke={FACE.eyeColor} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round">
      {([0, 1, 2] as const).map(index => <path key={index} ref={node => { refs.zs[index] = node; }} d={Z_PATH} />)}
    </g>
  </svg>;
});

// Numeric cache slots (values are quantised before comparison, so a settled face does no string work).
const GAZE_X = 0, GAZE_Y = 1, BLUSH_SLOT = 2, EYE_BASE = 3, EYE_STRIDE = 9;
const MOUTH_BASE = EYE_BASE + 2 * EYE_STRIDE, ZZZ = MOUTH_BASE + 7, SLOTS = ZZZ + 1;

/** Imperative per-frame updater. Strings are only built (and the DOM only touched) when a quantised input changes. */
export class FaceView {
  private readonly last = new Float64Array(SLOTS).fill(NaN);
  private readonly points = new Float64Array(26);
  private readonly shapes: [EyeShape, EyeShape] = ['pill', 'pill'];
  constructor(private readonly refs: FaceRefs, private readonly eyeColor: string = FACE.eyeColor) {}

  /** True when the value moved by at least one quantum since the last frame (and remembers it). */
  private moved(slot: number, value: number, quantum: number) {
    const q = Math.round(value / quantum);
    if (this.last[slot] === q) return false;
    this.last[slot] = q;
    return true;
  }

  update(frame: MascotFrame) {
    const refs = this.refs;
    const gx = this.moved(GAZE_X, frame.gazeX, 0.002), gy = this.moved(GAZE_Y, frame.gazeY, 0.002);
    if ((gx || gy) && refs.face) refs.face.setAttribute('transform', `translate(${fmt(frame.gazeX * FACE.gazeX * UNIT)} ${fmt(frame.gazeY * FACE.gazeY * UNIT)})`);
    if (this.moved(BLUSH_SLOT, frame.blush, 0.01)) refs.blush?.setAttribute('opacity', fmt(frame.blush));
    for (let index = 0; index < 2; index++) {
      const eye = frame.eyes[index], side = index === 0 ? -1 : 1, base = EYE_BASE + index * EYE_STRIDE;
      if (this.moved(base, eye.tilt, 0.05)) refs.eyes[index]?.setAttribute('transform', `translate(${fmt(side * EYE_X)} ${fmt(EYE_Y)}) rotate(${fmt(eye.tilt)})`);
      const open = this.moved(base + 1, eye.open, 0.002), smile = this.moved(base + 2, eye.smile, 0.002);
      const squint = this.moved(base + 3, eye.squint, 0.002), width = this.moved(base + 4, eye.width, 0.002);
      if (open || smile || squint || width) refs.pills[index]?.setAttribute('d', eyePath(eye.open, eye.smile, eye.squint, EYE_W * eye.width, EYE_H));
      if (this.moved(base + 5, eye.pillOpacity, 0.01)) refs.pills[index]?.setAttribute('opacity', fmt(eye.pillOpacity));
      const shape = eye.shape;
      if (shape !== this.shapes[index]) {
        this.shapes[index] = shape;
        const path = refs.specials[index];
        if (shape !== 'pill' && path) {
          const geometry = special(shape, index as 0 | 1);
          path.setAttribute('d', geometry.d);
          path.setAttribute('fill', geometry.filled ? this.eyeColor : 'none');
          path.setAttribute('stroke', this.eyeColor);
          path.setAttribute('stroke-width', fmt(geometry.stroke));
        }
      }
      if (this.moved(base + 6, eye.specialOpacity, 0.01)) refs.specialGroups[index]?.setAttribute('opacity', fmt(eye.specialOpacity));
      if (eye.specialOpacity > 0) {
        const spin = this.moved(base + 7, eye.spin, 0.5), pulse = this.moved(base + 8, eye.pulse, 0.002);
        if (spin || pulse) refs.specialGroups[index]?.setAttribute('transform', `rotate(${fmt(eye.spin)}) scale(${fmt(eye.pulse)})`);
      }
    }
    const mouth = frame.mouth;
    const w = this.moved(MOUTH_BASE, mouth.w, 0.0005), o = this.moved(MOUTH_BASE + 1, mouth.o, 0.002);
    const s = this.moved(MOUTH_BASE + 2, mouth.s, 0.002), r = this.moved(MOUTH_BASE + 3, mouth.r, 0.002);
    if (this.moved(MOUTH_BASE + 4, mouth.x, 0.0005)) refs.mouth?.setAttribute('transform', `translate(${fmt(mouth.x * UNIT)} ${fmt(MOUTH_Y)})`);
    if (w || o || s || r) {
      const points = mouthPoints(mouth.w, mouth.o, mouth.s, mouth.r, UNIT, this.points);
      const d = cubicPath(points);
      refs.lip?.setAttribute('d', d);
      refs.open?.setAttribute('d', d);
      refs.clip?.setAttribute('d', d);
      const top = points[7], bottom = points[19], height = Math.max(0.01, bottom - top), span = points[12] - points[0];
      refs.tongue?.setAttribute('cy', fmt(bottom - height * 0.18));
      refs.tongue?.setAttribute('rx', fmt(Math.max(0.5, span * 0.3)));
      refs.tongue?.setAttribute('ry', fmt(height * 0.35));
    }
    if (this.moved(MOUTH_BASE + 5, mouth.interior, 0.01)) {
      refs.lip?.setAttribute('opacity', fmt(1 - mouth.interior));
      refs.open?.setAttribute('opacity', fmt(mouth.interior));
    }
    if (this.moved(MOUTH_BASE + 6, mouth.tongue, 0.01)) refs.tongue?.setAttribute('opacity', fmt(mouth.tongue));
    // Sleepy "z"s float up from the top-right of the head.
    if (this.moved(ZZZ, frame.zzz, 0.004)) {
      refs.zzz?.setAttribute('opacity', frame.zzz >= 0 ? '1' : '0');
      if (frame.zzz >= 0) {
        for (let index = 0; index < 3; index++) {
          const phase = (frame.zzz + index / 3) % 1;
          refs.zs[index]?.setAttribute('transform', `translate(${fmt(21 + phase * 9)} ${fmt(-27 - phase * 17)}) scale(${fmt(0.7 + phase * 0.9)})`);
          refs.zs[index]?.setAttribute('opacity', fmt(Math.sin(phase * Math.PI) * 0.9));
        }
      }
    }
  }
}
