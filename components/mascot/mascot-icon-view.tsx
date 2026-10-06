'use client';
// Dev-only (app/mascot-lab?icon=…): an app-icon candidate rendered by the real mascot renderer, face and floor
// modules at 1024 × 1024 CSS px (the capture script renders it at device scale 2 and downsamples). Not used by the app.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { BODY_RADIUS } from '@/lib/mascot/constants';
import type { MascotEmotion } from '@/lib/mascot/emotions';
import { MASCOT_PALETTE } from '@/lib/mascot/palette';
import { MascotPhysics, type MascotFrame } from '@/lib/mascot/physics';
import { SHADOW, poolFill, shadowFill, shadowPose, type ShadowLayer, type ShadowLayerPose } from '@/lib/mascot/shadow';
import { FaceView, MascotFace, createFaceRefs, faceStrings } from './face-svg';
import { ICON_VARIANTS, type IconVariant } from './icon-variants';
import { createMascotRenderer } from './renderer';
import styles from './mascot.module.css';

const ICON = 1024;
/** Stage side for a body that spans `body` of the icon width: S·BODY_RADIUS = body·1024 (0.67 → 880 px, 0.86 → 1129 px). */
const stageSize = (body: number) => Math.round(body * ICON / BODY_RADIUS);
/** Body + floor shadow span 0.11·S … 0.955·S: lift the stage so that span is optically centred. */
const floorLift = (size: number) => Math.round(size * ((0.11 + 0.955) / 2 - 0.5));
/**
 * Without a floor the body itself is centred: undo the pose offset and the squash about the bottom edge
 * (transform below: the centre lands at (x, y + bottom·(1 − scaleY))).
 */
const bodyOffset = (frame: MascotFrame, size: number) =>
  ({ x: frame.x, y: frame.y + BODY_RADIUS * size / 2 * (1 - frame.scaleY) });
/** A clear icon must not pick up the page backdrop (globals.css paints html/body) or a dark canvas. */
const CLEAR_PAGE = 'html,body{background:transparent!important;color-scheme:light!important}';

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
  const S = stageSize(spec.body);
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
  }, [frame, time, spec.dark, S]);
  useEffect(() => { new FaceView(refs, MASCOT_PALETTE.face.eye).update(frame); }, [refs, frame]);

  const shade = shadowPose(frame, S);
  const bottom = BODY_RADIUS * S / 2;
  const bodyTransform = `translate3d(${frame.x}px,${frame.y}px,0) rotate(${frame.rotation}deg) translateY(${bottom}px) scale(${frame.scaleX},${frame.scaleY}) translateY(${-bottom}px)`;
  const offset = spec.floor ? { x: 0, y: floorLift(S) } : bodyOffset(frame, S);
  return <div data-icon={variant} data-ready={ready ? 'true' : 'false'} data-dark={spec.dark ? 'true' : 'false'}
    style={{ position: 'fixed', left: 0, top: 0, width: ICON, height: ICON, background: spec.background, overflow: 'hidden', zIndex: 2147483000 }}>
    {!spec.floor && <style>{CLEAR_PAGE}</style>}
    <span className={styles.stage} style={{ '--mascot-size': `${S}px`, left: `calc(50% - ${offset.x}px)`, top: `calc(50% - ${offset.y}px)` } as CSSProperties}>
      {spec.floor && spec.dark && <span className={styles.shadow} style={layerStyle('pool', shade.ambient, true)} />}
      {spec.floor && <span className={styles.shadow} style={layerStyle('ambient', shade.ambient, spec.dark)} />}
      {spec.floor && <span className={styles.shadow} style={layerStyle('contact', shade.contact, spec.dark)} />}
      <span className={styles.body} style={{ transform: bodyTransform }}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <MascotFace uid={`icon-${variant}`} refs={refs} strings={strings} blush={frame.blush} colors={MASCOT_PALETTE.face} className={styles.face} />
      </span>
    </span>
  </div>;
}
