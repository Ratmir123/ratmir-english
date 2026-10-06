'use client';
// Smooth Talk mascot (MASCOT-SPEC). A jelly glass body (WebGL, 32-node outline) with an SVG face,
// driven by the deterministic reference simulation in lib/mascot/physics.ts.
// Per-frame work never re-renders React: the loop writes styles/attributes through refs.
import { memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { BODY_RADIUS, DARK, TOUCH } from '@/lib/mascot/constants';
import { STATE_LABELS, type MascotEmotion, type MascotState } from '@/lib/mascot/emotions';
import { MASCOT_PALETTE, type MascotPaletteSpec } from '@/lib/mascot/palette';
import { MascotPhysics, type MascotFrame, type Point } from '@/lib/mascot/physics';
import { SHADOW, createShadowPose, poolFill, shadowFill, shadowPose, type ShadowLayer, type ShadowLayerPose } from '@/lib/mascot/shadow';
import { fireConfetti } from './confetti';
import { FaceView, MascotFace, createFaceRefs, faceStrings } from './face-svg';
import { mascotRegistry, type MascotContender } from './registry';
import { createMascotRenderer, renderStill, type MascotRenderInput, type MascotRenderer } from './renderer';
import styles from './mascot.module.css';

export type { MascotEmotion, MascotState } from '@/lib/mascot/emotions';
/** Same shape as the voice meter store from use-voice (subscribe/getSnapshot, 0–1). Read once per frame. */
export type MascotLevelStore = { subscribe(listener: () => void): () => void; getSnapshot(): number };
export interface MascotHandle {
  /** Play a transient emotion, then return to the context emotion. */
  play(emotion: MascotEmotion, seconds?: number): void;
  /** Same as a tap (keyboard = true: no body physics). */
  tap(keyboard?: boolean): void;
  /** Joy (or the given emotion) + boing + confetti burst. */
  celebrate(emotion?: MascotEmotion): void;
  greet(): void;
  readonly emotion: MascotEmotion;
}
export interface MascotProps {
  /** Voice/app state → context emotion (idle → calm, listening → listening, speaking → speaking + lip-sync, …). */
  state?: MascotState;
  /** Overrides the context emotion from `state`. Lip-sync still runs while `state` is 'speaking'. */
  emotion?: MascotEmotion;
  /** Microphone level 0–1 (pulses the body while listening). */
  micLevelStore?: MascotLevelStore;
  /** Partner playback level 0–1 (lip-sync while speaking). use-voice: `voice.speechLevelStore`. */
  speechLevelStore?: MascotLevelStore;
  /** Square size in px. Default: fills its container (S = min(width, height)). */
  size?: number;
  /** Pointer + keyboard play (default true). Non-interactive mascots render as role="img". */
  interactive?: boolean;
  /** Decoration beside a heading: pointer play only, hidden from assistive tech and the tab order. */
  decorative?: boolean;
  /** Status text for the accessible label: "Твой собеседник. {status}". */
  statusDescription?: string;
  /** Increment to trigger joy + boing + confetti. */
  celebrate?: number;
  /** Emotion for `celebrate` (default joy, 1.5 s). */
  celebrateEmotion?: MascotEmotion;
  /** Confetti with `celebrate` (default true; skipped with Reduced Motion anyway). */
  confetti?: boolean;
  onCelebrate?: () => void;
  /** First appearance per launch: happy hop. */
  greeting?: boolean;
  /** Called when the visible emotion changes (not per frame). */
  onEmotionChange?: (emotion: MascotEmotion) => void;
  /** 'auto' follows :root[data-theme] when present, else prefers-color-scheme. */
  theme?: 'auto' | 'light' | 'dark';
  /** Only the largest/busiest visible exclusive mascot animates; others hold a static pose (default true). */
  exclusive?: boolean;
  /** Always a static pose rendered through a shared WebGL context (thumbnails, galleries). */
  still?: boolean;
  /** Body material and face colours (lib/mascot/palette). The app ships MASCOT_PALETTE; the lab compares presets.
   * Pass a stable object: a new one re-binds the renderer. */
  palette?: MascotPaletteSpec;
  handleRef?: Ref<MascotHandle>;
  seed?: number;
  className?: string;
  style?: CSSProperties;
}

const n2 = (value: number) => Math.round(value * 100) / 100;
const n3 = (value: number) => Math.round(value * 1000) / 1000;
const n4 = (value: number) => Math.round(value * 10000) / 10000;
// Floor shadow geometry and theme fills come from lib/mascot/shadow (one source with the iPhone); CSS picks the fill by
// data-dark. The palette adds its glass colours to the floor and styles the no-WebGL fallback. Built once per palette.
const shadowStyle = (layer: ShadowLayer, palette: MascotPaletteSpec) => ({
  top: `${n4(SHADOW.floorY * 100)}%`, width: `${n4(SHADOW[layer].width * 100)}%`, height: `${n4(SHADOW[layer].height * 100)}%`,
  opacity: SHADOW[layer].rest,
  '--shadow-light': shadowFill(layer, 'light', palette.floor), '--shadow-dark': shadowFill(layer, 'dark', palette.floor),
}) as CSSProperties;
const poolStyle = (palette: MascotPaletteSpec) => ({
  top: `${n4((SHADOW.floorY + SHADOW.pool.offsetY) * 100)}%`, width: `${n4(SHADOW.pool.width * 100)}%`, height: `${n4(SHADOW.pool.height * 100)}%`,
  opacity: SHADOW.ambient.rest,
  '--shadow-light': poolFill('light', palette.floor), '--shadow-dark': poolFill('dark', palette.floor),
}) as CSSProperties;
const paletteStyles = new WeakMap<MascotPaletteSpec, { contact: CSSProperties; ambient: CSSProperties; pool: CSSProperties; fallback: CSSProperties }>();
function stylesFor(palette: MascotPaletteSpec) {
  let entry = paletteStyles.get(palette);
  if (!entry) {
    const { background, boxShadow } = palette.fallback;
    entry = { contact: shadowStyle('contact', palette), ambient: shadowStyle('ambient', palette), pool: poolStyle(palette), fallback: { background, boxShadow } };
    paletteStyles.set(palette, entry);
  }
  return entry;
}
/** Writes one shadow layer (dy: floor below its rest line); the blur filter is only touched when its rounded value
 * changes. Returns that value. */
function placeShadow(element: HTMLElement, layer: ShadowLayerPose, dy: number, lastBlur: number) {
  element.style.transform = `translate(${n2(layer.x)}px,${n2(dy)}px) translate(-50%,-50%) scale(${n4(layer.scaleX)},${n4(layer.scaleY)})`;
  element.style.opacity = String(n3(layer.opacity));
  const blur = Math.round(layer.blur * 10) / 10;
  if (blur !== lastBlur) element.style.filter = `blur(${blur}px)`;
  return blur;
}
const level = (store?: MascotLevelStore) => {
  if (!store) return 0;
  const value = Number(store.getSnapshot());
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
};

interface Control { sync(): void; claim(): void; celebrate(emotion?: MascotEmotion): void; greet(): void; theme(): void; resize(): void }

export const Mascot = memo(function Mascot(props: MascotProps) {
  const { state = 'idle', emotion, size, interactive = true, decorative = false, statusDescription, celebrate, greeting = false, theme = 'auto', still = false, exclusive = true, palette = MASCOT_PALETTE, className, style } = props;
  const uid = 'm' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [physics] = useState(() => new MascotPhysics({ size: size && size > 0 ? size : 240, state, emotion: emotion ?? null, seed: props.seed ?? (Math.random() * 4294967296) >>> 0 }));
  const [faceRefs] = useState(createFaceRefs);
  const [initial] = useState(() => ({ emotion: physics.emotion, face: faceStrings(physics.frame), blush: physics.frame.blush }));
  const rootRef = useRef<HTMLButtonElement & HTMLDivElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const contactRef = useRef<HTMLSpanElement>(null);
  const ambientRef = useRef<HTMLSpanElement>(null);
  const poolRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;
  const control = useRef<Control | null>(null);

  useImperativeHandle(props.handleRef, () => ({
    play: (value, seconds) => { control.current?.claim(); physics.play(value, seconds); control.current?.sync(); },
    tap: (keyboard = false) => { control.current?.claim(); physics.tap(keyboard); control.current?.sync(); },
    celebrate: value => control.current?.celebrate(value),
    greet: () => control.current?.greet(),
    get emotion() { return physics.emotion; },
  }), [physics]);

  useLayoutEffect(() => {
    const root = rootRef.current, stage = stageRef.current, body = bodyRef.current, canvas = canvasRef.current;
    const contact = contactRef.current, ambient = ambientRef.current, pool = poolRef.current;
    if (!root || !stage || !body || !contact || !ambient || !pool || !canvas) return;
    const face = new FaceView(faceRefs, palette.face.eye);
    const shade = createShadowPose();
    let contactBlur = -1, ambientBlur = -1, poolBlur = -1;
    const point: Point = { x: 0, y: 0 }, gaze: Point = { x: 0, y: 0 };
    const input: MascotRenderInput = { displacement: physics.frame.displacement, time: 0, energy: 0, gazeX: 0, gazeY: 0, dark: 0, tint: physics.frame.tint, tintAmount: 0 };
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    let renderer: MascotRenderer | null = null;
    let side = 0, raf = 0, last = 0, lastPaint = 0, hoverUntil = 0;
    let staticTimer: ReturnType<typeof setTimeout> | null = null;
    let pageVisible = document.visibilityState === 'visible', inView = true, reduced = motionQuery.matches;
    let darkTarget = 0, dark = 0, pointerId = -1, hoverDirty = false, hoverX = 0, hoverY = 0, disposed = false;
    let shownEmotion = physics.emotion;
    // Still mascots never animate, so they never compete for (or block) the single animated slot.
    const contender: MascotContender = { area: 0, busy: false, boost: 0, visible: pageVisible, exclusive: exclusive && !still, primary: false, notify: () => schedule() };

    const visibleNow = () => pageVisible && inView && side > 0;
    const animating = () => !disposed && !still && !reduced && visibleNow() && contender.primary;

    function paint(frame: MascotFrame, staticPose: boolean) {
      if (!side) return;
      const bottom = BODY_RADIUS * side / 2; // squash is anchored at the body's floor contact
      body!.style.transform = `translate3d(${n2(frame.x)}px,${n2(frame.y)}px,0) rotate(${n2(frame.rotation)}deg) translateY(${n2(bottom)}px) scale(${n4(frame.scaleX)},${n4(frame.scaleY)}) translateY(${n2(-bottom)}px)`;
      shadowPose(frame, side, shade);
      const sink = shade.floorY - SHADOW.floorY * side; // > 0 while the body is pushed below the rest floor
      contactBlur = placeShadow(contact!, shade.contact, sink, contactBlur);
      ambientBlur = placeShadow(ambient!, shade.ambient, sink, ambientBlur);
      poolBlur = placeShadow(pool!, shade.ambient, sink, poolBlur); // the light pool rides the ambient pose (follows, spreads, fades)
      input.time = staticPose ? 0 : frame.time;
      input.energy = frame.energy; input.gazeX = frame.gazeX; input.gazeY = frame.gazeY; input.dark = dark; input.tintAmount = frame.tintAmount;
      if (renderer) renderer.draw(input);
      else if (still && root!.dataset.lens !== 'none' && !renderStill(canvas!, side, input, 2, palette)) root!.dataset.lens = 'none';
      face.update(frame);
      if (frame.emotion !== shownEmotion) {
        shownEmotion = frame.emotion;
        root!.dataset.emotion = frame.emotion;
        live.current.onEmotionChange?.(frame.emotion);
      }
    }
    function renderStatic() {
      if (disposed || !side) return;
      dark = darkTarget;
      paint(physics.settle(), true);
      if (staticTimer) { clearTimeout(staticTimer); staticTimer = null; }
      const remaining = physics.transientRemaining();
      if (remaining > 0 && Number.isFinite(remaining)) {
        staticTimer = setTimeout(() => { staticTimer = null; physics.advanceTime(remaining + 0.001); renderStatic(); }, remaining * 1000 + 5);
      }
    }
    function tick(now: number) {
      raf = 0;
      if (!animating()) { last = 0; if (visibleNow()) renderStatic(); return; }
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 1 / 60;
      last = now;
      physics.setMicLevel(level(live.current.micLevelStore));
      physics.setSpeechLevel(level(live.current.speechLevelStore));
      if (hoverDirty) { hoverDirty = false; updateHover(); }
      if (dark !== darkTarget) {
        const step = dt / DARK.seconds;
        dark = Math.abs(darkTarget - dark) <= step ? darkTarget : dark + Math.sign(darkTarget - dark) * step;
      }
      const frame = physics.step(dt);
      // Calm breathing paints at ~30 Hz; touch, voice, reactions and hover at the display rate.
      if (frame.active || now < hoverUntil || dark !== darkTarget || now - lastPaint >= 32) { paint(frame, false); lastPaint = now; }
      raf = requestAnimationFrame(tick);
    }
    function schedule() {
      if (disposed) return;
      if (animating()) { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } return; }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (visibleNow()) renderStatic();
    }
    function afterInput() { if (animating()) schedule(); else if (visibleNow()) renderStatic(); }
    function updateHover() {
      const box = stage!.getBoundingClientRect();
      if (!box.width) return;
      gaze.x = (hoverX - (box.left + box.width / 2)) / TOUCH.hoverRadius;
      gaze.y = (hoverY - (box.top + box.height / 2)) / TOUCH.hoverRadius;
      physics.hover(gaze);
    }
    function measure(width: number, height: number) {
      const fixed = live.current.size;
      const next = Math.max(0, Math.round(fixed && fixed > 0 ? fixed : height > 0 ? Math.min(width, height) : width));
      if (next === side) return;
      side = next;
      root!.style.setProperty('--mascot-size', side + 'px');
      physics.setSize(side || 240);
      renderer?.resize(side);
      contender.area = side * side;
      mascotRegistry.elect();
      afterInput();
    }
    function resolveDark() {
      const mode = live.current.theme ?? 'auto';
      if (mode !== 'auto') return mode === 'dark' ? 1 : 0;
      const attribute = document.documentElement.getAttribute('data-theme');
      if (attribute === 'dark') return 1;
      if (attribute === 'light') return 0;
      return themeQuery.matches ? 1 : 0;
    }
    function applyTheme() {
      darkTarget = resolveDark();
      root!.dataset.dark = darkTarget ? 'true' : 'false';
      if (!animating()) { dark = darkTarget; if (visibleNow()) renderStatic(); }
    }
    function toCanvas(event: PointerEvent) {
      const box = stage!.getBoundingClientRect();
      point.x = (event.clientX - box.left) * (side / (box.width || side || 1));
      point.y = (event.clientY - box.top) * (side / (box.height || side || 1));
      return point;
    }
    function claim() { contender.boost = performance.now() + 4000; mascotRegistry.elect(); }

    // ── Pointer play ──
    function onPointerDown(event: PointerEvent) {
      if (live.current.interactive === false || pointerId !== -1 || !event.isPrimary) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerId = event.pointerId;
      try { root!.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
      root!.dataset.pressed = 'true';
      claim();
      physics.pressStart(toCanvas(event));
      afterInput();
    }
    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      physics.pressMove(toCanvas(event));
    }
    function finishPointer(event: PointerEvent, cancelled: boolean) {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      root!.dataset.pressed = 'false';
      if (!cancelled) { try { root!.releasePointerCapture(event.pointerId); } catch { /* already released */ } }
      if (cancelled) physics.pressCancel(); else physics.pressEnd();
      afterInput();
    }
    const onPointerUp = (event: PointerEvent) => finishPointer(event, false);
    const onPointerCancel = (event: PointerEvent) => finishPointer(event, true);
    function onClick(event: MouseEvent) {
      // Keyboard (Enter/Space) and assistive-technology activation: instant reaction without physics noise.
      if (live.current.interactive === false || event.detail !== 0) return;
      claim();
      physics.tap(true);
      afterInput();
    }
    function onContextMenu(event: Event) { if (live.current.interactive !== false) event.preventDefault(); }
    function onWindowPointerMove(event: PointerEvent) {
      if (event.pointerType === 'touch' || !animating()) return;
      hoverX = event.clientX; hoverY = event.clientY; hoverDirty = true; hoverUntil = performance.now() + 450;
    }
    function onWindowPointerOut(event: PointerEvent) { if (!event.relatedTarget && event.pointerType !== 'touch') physics.hover(null); }
    function onWindowBlur() { physics.hover(null); }
    function onVisibility() {
      pageVisible = document.visibilityState === 'visible';
      contender.visible = pageVisible && inView;
      if (!pageVisible && pointerId !== -1) { pointerId = -1; physics.pressCancel(); root!.dataset.pressed = 'false'; }
      mascotRegistry.elect(); schedule();
    }
    function onMotion() { reduced = motionQuery.matches; schedule(); }
    function onLost(event: Event) { event.preventDefault(); renderer = null; root!.dataset.lens = 'none'; afterInput(); }
    function onRestored() {
      if (still) return;
      renderer = createMascotRenderer(canvas!, 2, palette);
      root!.dataset.lens = renderer ? 'live' : 'none';
      if (renderer && side) renderer.resize(side);
      afterInput();
    }

    if (still) root.dataset.lens = 'still';
    else {
      renderer = createMascotRenderer(canvas, 2, palette);
      root.dataset.lens = renderer ? 'live' : 'none';
    }
    darkTarget = dark = resolveDark();
    root.dataset.dark = darkTarget ? 'true' : 'false';
    contender.busy = state !== 'idle' && state !== 'paused';
    // Re-binding (StrictMode dev double-mount, prop changes) keeps a running reaction animated.
    if (physics.transientRemaining() > 0) contender.boost = performance.now() + 4000;
    mascotRegistry.add(contender);
    measure(root.clientWidth, root.clientHeight);
    // Paint synchronously before the browser's first paint: no blank glass between mount and the first frame.
    if (visibleNow()) { if (animating()) paint(physics.frame, false); else renderStatic(); }

    const resizeObserver = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      measure(box.width, box.height);
    });
    resizeObserver.observe(root);
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      inView = entries[entries.length - 1].isIntersecting;
      contender.visible = pageVisible && inView;
      if (!inView && pointerId !== -1) { pointerId = -1; physics.pressCancel(); root.dataset.pressed = 'false'; }
      mascotRegistry.elect(); schedule();
    });
    intersection?.observe(root);
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);
    root.addEventListener('lostpointercapture', onPointerCancel);
    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
    window.addEventListener('pointerout', onWindowPointerOut, { passive: true });
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibility);
    motionQuery.addEventListener('change', onMotion);
    themeQuery.addEventListener('change', applyTheme);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    control.current = {
      sync() {
        const current = live.current;
        physics.setState(current.state ?? 'idle');
        physics.setEmotion(current.emotion ?? null);
        const busy = (current.state ?? 'idle') !== 'idle' && current.state !== 'paused';
        if (busy !== contender.busy) { contender.busy = busy; mascotRegistry.elect(); }
        afterInput();
      },
      claim,
      celebrate(value) {
        const current = live.current;
        const chosen = value ?? current.celebrateEmotion ?? 'joy';
        claim();
        physics.celebrate(chosen, chosen === 'joy' ? 1.5 : 2);
        if (current.confetti !== false) fireConfetti(stage);
        current.onCelebrate?.();
        afterInput();
      },
      // A greeting must animate even when a larger mascot sits underneath an overlay (IntersectionObserver
      // cannot see occlusion), so it claims the single animated slot like a touch does.
      greet() { claim(); physics.greet(); afterInput(); },
      theme: applyTheme,
      resize() { side = -1; measure(root.clientWidth, root.clientHeight); },
    };

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (staticTimer) clearTimeout(staticTimer);
      if (pointerId !== -1) physics.pressCancel();
      mascotRegistry.remove(contender);
      resizeObserver.disconnect();
      intersection?.disconnect();
      themeObserver.disconnect();
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerCancel);
      root.removeEventListener('lostpointercapture', onPointerCancel);
      root.removeEventListener('click', onClick);
      root.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerout', onWindowPointerOut);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotion);
      themeQuery.removeEventListener('change', applyTheme);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer?.dispose();
      renderer = null;
      control.current = null;
    };
    // `state` is read through `live` after mount; the effect only re-binds for structural changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics, faceRefs, still, exclusive, interactive, palette]);

  useEffect(() => { control.current?.sync(); }, [state, emotion]);
  useEffect(() => { control.current?.theme(); }, [theme]);
  useEffect(() => { control.current?.resize(); }, [size]);
  const celebrated = useRef(celebrate);
  useEffect(() => {
    if (celebrate === celebrated.current) return;
    celebrated.current = celebrate;
    if (celebrate !== undefined) control.current?.celebrate();
  }, [celebrate]);
  const greeted = useRef(false);
  useEffect(() => {
    if (!greeting || greeted.current) return;
    greeted.current = true;
    control.current?.greet();
  }, [greeting]);

  const label = `Твой собеседник. ${statusDescription ?? STATE_LABELS[state] ?? ''}`.trim();
  const rootStyle = size && size > 0 ? { ...style, width: size, height: size, '--mascot-size': `${size}px` } as CSSProperties : style;
  const look = stylesFor(palette);
  const content = <span ref={stageRef} className={styles.stage}>
    <span ref={poolRef} className={styles.shadow} style={look.pool} />
    <span ref={ambientRef} className={styles.shadow} style={look.ambient} />
    <span ref={contactRef} className={styles.shadow} style={look.contact} />
    <span ref={bodyRef} className={styles.body}>
      <span className={styles.fallback} style={look.fallback} />
      <canvas key={still ? `still-${palette.label}` : `live-${palette.label}`} ref={canvasRef} className={styles.canvas} />
      <MascotFace uid={uid} refs={faceRefs} strings={initial.face} blush={initial.blush} colors={palette.face} className={styles.face} />
    </span>
  </span>;
  const shared = {
    ref: rootRef,
    className: className ? `${styles.root} ${className}` : styles.root,
    style: rootStyle,
    'data-state': state,
    'data-emotion': initial.emotion,
    'data-interactive': interactive ? 'true' : 'false',
    'data-lens': 'none',
  };
  // Decorative companions (screen headers, cards) still react to the pointer but stay out of the tab order and the
  // accessibility tree; the adjacent heading carries the meaning.
  if (decorative) return interactive
    ? <button key="decorative" type="button" {...shared} tabIndex={-1} aria-hidden="true">{content}</button>
    : <div key="decorative-static" {...shared} aria-hidden="true">{content}</div>;
  return interactive
    ? <button key="interactive" type="button" {...shared} aria-label={label}>{content}</button>
    : <div key="static" role="img" {...shared} aria-label={label}>{content}</div>;
});
