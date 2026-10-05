'use client';
// Dev-only (app/mascot-lab?icon=…): an app-icon candidate rendered by the real mascot renderer, face and floor
// modules at 1024 × 1024 CSS px (the capture script renders it at device scale 2 and downsamples). Not used by the app.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { BODY_RADIUS } from '@/lib/mascot/constants';
import type { MascotEmotion } from '@/lib/mascot/emotions';
import { MASCOT_PALETTE } from '@/lib/mascot/palette';
import { MascotPhysics } from '@/lib/mascot/physics';
import { SHADOW, poolFill, shadowFill, shadowPose, type ShadowLayer, type ShadowLayerPose } from '@/lib/mascot/shadow';
import { FaceView, MascotFace, createFaceRefs, faceStrings } from './face-svg';
import { createMascotRenderer } from './renderer';
import styles from './mascot.module.css';

export const ICON_VARIANTS = {
  pearl: {
    dark: false,
    background: 'radial-gradient(ellipse 70% 60% at 50% 30%, #fdfcff 0%, rgba(253, 252, 255, 0) 70%), radial-gradient(ellipse 60% 50% at 12% 88%, rgba(196, 184, 250, 0.45), transparent 70%), radial-gradient(ellipse 55% 45% at 90% 86%, rgba(226, 242, 160, 0.4), transparent 70%), linear-gradient(180deg, #f3f0fb 0%, #e9e4f7 100%)',
  },
  graphite: {
    dark: true,
    background: 'radial-gradient(ellipse 65% 55% at 22% 18%, rgba(111, 92, 242, 0.28), transparent 70%), radial-gradient(ellipse 60% 40% at 50% 92%, rgba(218, 241, 99, 0.1), transparent 70%), linear-gradient(160deg, #18171c 0%, #221e33 55%, #2a2440 100%)',
  },
  'aurora-glow': {
    dark: false,
    background: 'radial-gradient(ellipse 65% 55% at 45% 30%, rgba(255, 255, 255, 0.75), transparent 70%), linear-gradient(150deg, #ddd5fb 0%, #ebe8f8 45%, #eef4d6 75%, #e5f3b4 100%)',
  },
} as const;
export type IconVariant = keyof typeof ICON_VARIANTS;
export const isIconVariant = (value: unknown): value is IconVariant => typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_VARIANTS, value);

const ICON = 1024;
/** Body ≈ 67 % of the icon width: S·BODY_RADIUS = 0.67·1024. */
const S = Math.round(0.67 * ICON / BODY_RADIUS);
/** Body + floor shadow span 0.11·S … 0.955·S: lift the stage so that span is optically centred. */
const LIFT = Math.round(S * ((0.11 + 0.955) / 2 - 0.5));

const layerStyle = (layer: ShadowLayer | 'pool', pose: ShadowLayerPose, dark: boolean): CSSProperties => {
  const box = layer === 'pool' ? SHADOW.pool : SHADOW[layer];
  const top = SHADOW.floorY + (layer === 'pool' ? SHADOW.pool.offsetY : 0);
  const theme = dark ? 'dark' : 'light';
  const background = layer === 'pool' ? poolFill(theme, MASCOT_PALETTE.floor) : shadowFill(layer, theme, MASCOT_PALETTE.floor);
  return {
    top: `${top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, background,
    transform: `translate(${pose.x}px, 0px) translate(-50%, -50%) scale(${pose.scaleX}, ${pose.scaleY})`,
    opacity: pose.opacity, filter: `blur(${pose.blur}px)`,
  };
};

export function MascotIcon({ variant, time, emotion }: { variant: IconVariant; time: number; emotion: MascotEmotion }) {
  const spec = ICON_VARIANTS[variant];
  const [physics] = useState(() => new MascotPhysics({ size: S, emotion, seed: 1 }));
  const [frame] = useState(() => physics.settle());
  const [refs] = useState(createFaceRefs);
  const [strings] = useState(() => faceStrings(frame));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createMascotRenderer(canvas, 2, MASCOT_PALETTE);
    if (!renderer) return;
    renderer.resize(S);
    renderer.draw({ displacement: frame.displacement, time, energy: 0, gazeX: frame.gazeX, gazeY: frame.gazeY, dark: spec.dark ? 1 : 0, tint: frame.tint, tintAmount: frame.tintAmount });
    setReady(true);
    return () => renderer.dispose();
  }, [frame, time, spec.dark]);
  useEffect(() => { new FaceView(refs, MASCOT_PALETTE.face.eye).update(frame); }, [refs, frame]);

  const shade = shadowPose(frame, S);
  const bottom = BODY_RADIUS * S / 2;
  const bodyTransform = `translate3d(${frame.x}px,${frame.y}px,0) rotate(${frame.rotation}deg) translateY(${bottom}px) scale(${frame.scaleX},${frame.scaleY}) translateY(${-bottom}px)`;
  return <div data-icon={variant} data-ready={ready ? 'true' : 'false'} data-dark={spec.dark ? 'true' : 'false'}
    style={{ position: 'fixed', left: 0, top: 0, width: ICON, height: ICON, background: spec.background, overflow: 'hidden', zIndex: 2147483000 }}>
    <span className={styles.stage} style={{ '--mascot-size': `${S}px`, top: `calc(50% - ${LIFT}px)` } as CSSProperties}>
      {spec.dark && <span className={styles.shadow} style={layerStyle('pool', shade.ambient, true)} />}
      <span className={styles.shadow} style={layerStyle('ambient', shade.ambient, spec.dark)} />
      <span className={styles.shadow} style={layerStyle('contact', shade.contact, spec.dark)} />
      <span className={styles.body} style={{ transform: bodyTransform }}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <MascotFace uid={`icon-${variant}`} refs={refs} strings={strings} blush={frame.blush} colors={MASCOT_PALETTE.face} className={styles.face} />
      </span>
    </span>
  </div>;
}
