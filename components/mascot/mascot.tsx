'use client';
// Smooth Talk mascot (MASCOT-SPEC). A jelly glass body (WebGL, 32-node outline) with an SVG face,
// driven by the deterministic reference simulation in lib/mascot/physics.ts.
// Per-frame work never re-renders React: the loop writes styles/attributes through refs.
// PASS-0.5.3: the body rolls about a pivot near its base (lib/mascot/roll) and never holds a lean; the WebGL context is
// created when the mascot is first visible and not covered, and compiles off the main thread; mascots inside the app shell
// sleep while the launch or placement layer covers it (components/ui/shell-cover) and wake one per frame; idleMode
// 'compositor' idles on the compositor (CSS) while the main thread is busy.
import { memo, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { COMPOSITOR_IDLE, DARK, TOUCH } from '@/lib/mascot/constants';
import { STATE_LABELS, type MascotEmotion, type MascotState } from '@/lib/mascot/emotions';
import { MASCOT_PALETTE, type MascotPaletteSpec } from '@/lib/mascot/palette';
import { MascotPhysics, type MascotFrame, type Point } from '@/lib/mascot/physics';
import { bodyTransform } from '@/lib/mascot/roll';
import { SHADOW, createShadowPose, poolFill, shadowFill, shadowPose, type ShadowLayer, type ShadowLayerPose } from '@/lib/mascot/shadow';
import { EASE_OUT } from '../ui/motion';
import { insideShell, isShellCovered, subscribeShellCover } from '../ui/shell-cover';
import { fireConfetti } from './confetti';
import { FACE_GLOW_MIN_SIDE, FaceView, MascotFace, createFaceRefs, faceGlowFilter, faceStrings } from './face-svg';
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
  /** PASS-0.5.4 §2: the mascot's stage moves across the screen (velocity px/s, acceleration px/s²); zeros when it rests. */
  carry(vx: number, vy: number, ax: number, ay: number): void;
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
  /**
   * 0.5.3 (PASS-0.5.3 §6): 'compositor' = one upright frame drawn once, no rAF loop; the wrapper idles with a CSS roll/breath
   * that runs on the compositor, so a busy main thread (the launch preloader) never freezes it. Switching to 'live' hands
   * over smoothly to the physics. Default 'live'.
   */
  idleMode?: 'live' | 'compositor';
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
const DEG = Math.PI / 180;
/** The cached stage rect (pointer gaze) is re-measured at most this often, outside the frame tick. */
const RECT_TTL_MS = 1000;
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

let coverBound = false;
/** Mirrors the shell-cover flag (components/ui/shell-cover) into the registry; bound once, on the first client mount. */
function bindShellCover() {
  if (coverBound) return;
  coverBound = true;
  mascotRegistry.setCovered(isShellCovered());
  subscribeShellCover(() => mascotRegistry.setCovered(isShellCovered()));
}

interface Control { sync(): void; claim(): void; celebrate(emotion?: MascotEmotion): void; greet(): void; theme(): void; resize(): void; mode(): void; exclusive(): void }
type Lens = 'pending' | 'live' | 'still' | 'none';

export const Mascot = memo(function Mascot(props: MascotProps) {
  const { state = 'idle', emotion, size, interactive = true, decorative = false, statusDescription, celebrate, greeting = false, theme = 'auto', still = false, exclusive = true, idleMode = 'live', palette = MASCOT_PALETTE, className, style } = props;
  const uid = 'm' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [physics] = useState(() => new MascotPhysics({ size: size && size > 0 ? size : 240, state, emotion: emotion ?? null, seed: props.seed ?? (Math.random() * 4294967296) >>> 0 }));
  const [faceRefs] = useState(createFaceRefs);
  const [initial] = useState(() => ({
    emotion: physics.emotion, face: faceStrings(physics.frame), blush: physics.frame.blush,
    glow: !(size && size > 0 && size < FACE_GLOW_MIN_SIDE), compositor: idleMode === 'compositor',
  }));
  const rootRef = useRef<HTMLButtonElement & HTMLDivElement>(null);
  const stageRef = useRef<HTMLSpanElement>(null);
  const floorRef = useRef<HTMLSpanElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const idleRef = useRef<HTMLSpanElement>(null);
  const breathRef = useRef<HTMLSpanElement>(null);
  const fallbackRef = useRef<HTMLSpanElement>(null);
  const contactRef = useRef<HTMLSpanElement>(null);
  const ambientRef = useRef<HTMLSpanElement>(null);
  const poolRef = useRef<HTMLSpanElement>(null);
  const live = useRef(props);
  live.current = props;
  const control = useRef<Control | null>(null);

  useImperativeHandle(props.handleRef, () => ({
    play: (value, seconds) => { control.current?.claim(); physics.play(value, seconds); control.current?.sync(); },
    tap: (keyboard = false) => { control.current?.claim(); physics.tap(keyboard); control.current?.sync(); },
    celebrate: value => control.current?.celebrate(value),
    greet: () => control.current?.greet(),
    carry: (vx, vy, ax, ay) => {
      // The first frame of a move claims the animated slot; the loop then follows the physics by itself.
      if (!physics.frame.active && (vx || vy || ax || ay)) control.current?.claim();
      physics.carry(vx, vy, ax, ay);
    },
    get emotion() { return physics.emotion; },
  }), [physics]);

  useLayoutEffect(() => {
    const root = rootRef.current, stage = stageRef.current, floor = floorRef.current, body = bodyRef.current;
    const idle = idleRef.current, breath = breathRef.current, fallback = fallbackRef.current;
    const contact = contactRef.current, ambient = ambientRef.current, pool = poolRef.current;
    if (!root || !stage || !floor || !body || !idle || !breath || !fallback || !contact || !ambient || !pool) return;
    bindShellCover();
    const face = new FaceView(faceRefs, palette.face.eye);
    const shade = createShadowPose();
    let contactBlur = -1, ambientBlur = -1, poolBlur = -1;
    const point: Point = { x: 0, y: 0 }, gaze: Point = { x: 0, y: 0 };
    const input: MascotRenderInput = { displacement: physics.frame.displacement, time: 0, energy: 0, gazeX: 0, gazeY: 0, dark: 0, tint: physics.frame.tint, tintAmount: 0, tilt: 0 };
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    // The canvas belongs to this binding (created on first paint, removed on cleanup), so a disposed context never
    // blocks the next binding and the context is created only when the mascot is first visible and not covered.
    let canvas: HTMLCanvasElement | null = null;
    let renderer: MascotRenderer | null = null;
    let gl: 'unborn' | 'compiling' | 'ready' | 'failed' = 'unborn';
    let lens = (root.dataset.lens as Lens | undefined) ?? 'pending';
    let side = 0, raf = 0, pollRaf = 0, last = 0, lastPaint = 0, hoverUntil = 0;
    let staticTimer: ReturnType<typeof setTimeout> | null = null;
    let pageVisible = document.visibilityState === 'visible', reduced = motionQuery.matches;
    // Out of view until the IntersectionObserver reports (no forced layout at mount, nothing created for unseen mascots).
    let inView = typeof IntersectionObserver === 'undefined';
    let darkTarget = 0, dark = 0, pointerId = -1, hoverDirty = false, hoverX = 0, hoverY = 0, disposed = false;
    let mode: 'live' | 'compositor' = live.current.idleMode === 'compositor' ? 'compositor' : 'live';
    let pendingGreet = false;
    let glowOn = faceRefs.glow ? faceRefs.glow.hasAttribute('filter') : true;
    // Stage rect for the pointer gaze: measured in input handlers, invalidated by scroll/resize/observers, never read in the tick.
    let rect: DOMRect | null = null, rectAt = 0;
    let shownEmotion = physics.emotion;
    // Still mascots never animate, so they never compete for (or block) the single animated slot.
    const contender: MascotContender = {
      area: 0, busy: false, boost: 0, visible: false, exclusive: (live.current.exclusive ?? true) && !still, primary: false,
      inShell: insideShell(root), notify: () => schedule(),
    };
    const idleParts: readonly (readonly [HTMLElement, string])[] = [[idle, styles.idleRoll], [breath, styles.idleBreath], [floor, styles.idleFloor]];

    const setLens = (value: Lens) => { if (lens !== value) { lens = value; root.dataset.lens = value; } };
    const awake = () => !contender.asleep;
    // In view, whether or not a layer covers the shell. A covered shell mascot still prepares while the launch preloader runs:
    // its WebGL context (the costly part, 40–200 ms on Windows) and one settled frame are made under the cover, so the
    // hand-off only starts loops (PASS-0.5.3 §5). It never animates while covered.
    const preparable = () => pageVisible && inView && side > 0;
    const visibleNow = () => preparable() && awake();
    const animating = () => !disposed && !still && !reduced && mode === 'live' && visibleNow() && contender.primary;

    function ensureCanvas() {
      if (canvas) return canvas;
      canvas = document.createElement('canvas');
      canvas.className = styles.canvas;
      canvas.setAttribute('aria-hidden', 'true');
      fallback!.after(canvas);
      if (!still) {
        canvas.addEventListener('webglcontextlost', onLost);
        canvas.addEventListener('webglcontextrestored', onRestored);
      }
      return canvas;
    }
    /** True when the WebGL body can draw now. The context is created the first time the mascot is visible and awake;
     * the shader compiles in parallel and is polled once per frame until it is ready. */
    function glReady(): boolean {
      if (still || gl === 'failed') return false;
      if (gl === 'unborn') {
        if (!preparable()) return false;
        renderer = createMascotRenderer(ensureCanvas(), 2, palette, { parallel: true });
        if (!renderer) { gl = 'failed'; return false; }
        renderer.resize(side);
        gl = 'compiling';
      }
      if (gl === 'compiling') {
        const status = renderer!.status();
        if (status === 'failed') { renderer!.dispose(); renderer = null; gl = 'failed'; return false; }
        if (status === 'pending') {
          if (!pollRaf) pollRaf = requestAnimationFrame(() => { pollRaf = 0; schedule(); });
          return false;
        }
        gl = 'ready';
      }
      return true;
    }
    function paint(frame: MascotFrame, staticPose: boolean) {
      if (!side || (!staticPose && !awake())) return;
      const ready = glReady();
      // Nothing shows until the first WebGL frame can land (or the still copy / the CSS fallback when WebGL failed).
      if (!ready && !still && gl !== 'failed') return;
      body!.style.transform = bodyTransform(frame, side);
      shadowPose(frame, side, shade);
      const sink = shade.floorY - SHADOW.floorY * side; // > 0 while the body is pushed below the rest floor
      contactBlur = placeShadow(contact!, shade.contact, sink, contactBlur);
      ambientBlur = placeShadow(ambient!, shade.ambient, sink, ambientBlur);
      poolBlur = placeShadow(pool!, shade.ambient, sink, poolBlur); // the light pool rides the ambient pose (follows, spreads, fades)
      input.time = staticPose ? 0 : frame.time;
      input.energy = frame.energy; input.gazeX = frame.gazeX; input.gazeY = frame.gazeY; input.dark = dark; input.tintAmount = frame.tintAmount;
      input.tilt = frame.rotation * DEG; // keeps the key light and highlights fixed on screen while the body rolls
      if (ready) { if (renderer!.draw(input)) setLens('live'); }
      else if (still) { if (lens !== 'none') setLens(renderStill(ensureCanvas(), side, input, 2, palette) ? 'still' : 'none'); }
      else setLens('none');
      face.update(frame);
      if (frame.emotion !== shownEmotion) {
        shownEmotion = frame.emotion;
        root!.dataset.emotion = frame.emotion;
        live.current.onEmotionChange?.(frame.emotion);
      }
    }
    /** Static (settled, upright) pose: non-primary and reduced-motion mascots, and the compositor-idle poster. */
    function renderStatic() {
      if (disposed || !side || !preparable()) return;
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
      if (!animating()) { last = 0; renderStatic(); return; }
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
      // Calm breathing paints at ~30 Hz, sleep at ~15 Hz (the PC chubrik can doze on the screen all day); touch, voice,
      // reactions and hover at the display rate (and every frame until the first WebGL frame has landed).
      if (frame.active || now < hoverUntil || dark !== darkTarget || now - lastPaint >= (frame.sleeping ? 66 : 32) || lens === 'pending') { paint(frame, false); lastPaint = now; }
      raf = requestAnimationFrame(tick);
    }
    /** Runs the loop when this mascot animates, otherwise stops it and shows the static pose (when visible). */
    function schedule() {
      if (disposed) return;
      if (animating()) {
        // The loop plays transients itself; a static-pose timer must not settle (and freeze) the running physics later.
        if (staticTimer) { clearTimeout(staticTimer); staticTimer = null; }
        if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
        return;
      }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      renderStatic();
    }
    function measureRect(now: number, fresh = false) {
      if (fresh || !rect || now - rectAt > RECT_TTL_MS) { rect = stage!.getBoundingClientRect(); rectAt = now; }
      return rect;
    }
    const invalidateRect = () => { rect = null; };
    function updateHover() {
      if (!rect || !rect.width) return;
      gaze.x = (hoverX - (rect.left + rect.width / 2)) / TOUCH.hoverRadius;
      gaze.y = (hoverY - (rect.top + rect.height / 2)) / TOUCH.hoverRadius;
      physics.hover(gaze);
    }
    function measure(width: number, height: number) {
      const fixed = live.current.size;
      const next = Math.max(0, Math.round(fixed && fixed > 0 ? fixed : height > 0 ? Math.min(width, height) : width));
      rect = null;
      if (next === side) return;
      side = next;
      root!.style.setProperty('--mascot-size', side + 'px');
      physics.setSize(side || 240);
      renderer?.resize(side);
      // No SVG glow filter on small mascots (invisible at that size, and a filter pass on every face update).
      const glow = side >= FACE_GLOW_MIN_SIDE;
      if (glow !== glowOn && faceRefs.glow) {
        glowOn = glow;
        if (glow) faceRefs.glow.setAttribute('filter', faceGlowFilter(uid));
        else faceRefs.glow.removeAttribute('filter');
      }
      contender.area = side * side;
      mascotRegistry.elect();
      schedule();
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
      if (!animating()) { dark = darkTarget; renderStatic(); }
    }
    function toCanvas(event: PointerEvent, fresh: boolean) {
      const box = measureRect(performance.now(), fresh);
      point.x = (event.clientX - box.left) * (side / (box.width || side || 1));
      point.y = (event.clientY - box.top) * (side / (box.height || side || 1));
      return point;
    }
    function claim() { contender.boost = performance.now() + 4000; mascotRegistry.elect(); }

    // ── Compositor idle (PASS-0.5.3 §6) ──
    function startCompositorIdle() {
      if (!root!.dataset.roll || !idle!.classList.contains(styles.idleRoll)) root!.dataset.roll = Math.random() < 0.5 ? 'reverse' : 'normal';
      for (const [element, name] of idleParts) element.classList.add(name);
    }
    /** Hands the compositor idle to the physics: each wrapper keeps its current transform, drops the keyframes and eases
     * back to rest (WAAPI from the computed value, so it runs on the compositor too). */
    function stopCompositorIdle(ease: boolean) {
      const current = idleParts.map(([element, name]) => ease && element.classList.contains(name) ? getComputedStyle(element).transform : 'none');
      idleParts.forEach(([element, name], index) => {
        if (!element.classList.contains(name)) return;
        element.classList.remove(name);
        const from = current[index];
        if (from && from !== 'none' && typeof element.animate === 'function') {
          element.animate([{ transform: from }, { transform: 'none' }], { duration: COMPOSITOR_IDLE.handoffMs, easing: EASE_OUT });
        }
      });
    }
    function setMode(next: 'live' | 'compositor') {
      if (next === mode) return;
      mode = next;
      if (next === 'compositor') {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        startCompositorIdle();
        schedule(); // the settled, upright poster
        return;
      }
      stopCompositorIdle(!reduced);
      // The physics starts from the settled upright poster pose; a greeting asked for during the idle plays now.
      if (pendingGreet) { pendingGreet = false; claim(); physics.greet(); }
      schedule();
    }

    // ── Pointer play ──
    function onPointerDown(event: PointerEvent) {
      if (live.current.interactive === false || pointerId !== -1 || !event.isPrimary) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerId = event.pointerId;
      try { root!.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
      root!.dataset.pressed = 'true';
      claim();
      physics.pressStart(toCanvas(event, true));
      schedule();
    }
    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      physics.pressMove(toCanvas(event, false));
    }
    function finishPointer(event: PointerEvent, cancelled: boolean) {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      root!.dataset.pressed = 'false';
      if (!cancelled) { try { root!.releasePointerCapture(event.pointerId); } catch { /* already released */ } }
      if (cancelled) physics.pressCancel(); else physics.pressEnd();
      schedule();
    }
    const onPointerUp = (event: PointerEvent) => finishPointer(event, false);
    const onPointerCancel = (event: PointerEvent) => finishPointer(event, true);
    function onClick(event: MouseEvent) {
      // Keyboard (Enter/Space) and assistive-technology activation: instant reaction without physics noise.
      if (live.current.interactive === false || event.detail !== 0) return;
      claim();
      physics.tap(true);
      schedule();
    }
    function onContextMenu(event: Event) { if (live.current.interactive !== false) event.preventDefault(); }
    function onWindowPointerMove(event: PointerEvent) {
      if (event.pointerType === 'touch' || !animating()) return;
      const now = performance.now();
      hoverX = event.clientX; hoverY = event.clientY; hoverDirty = true; hoverUntil = now + 450;
      measureRect(now);
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
    function onLost(event: Event) { event.preventDefault(); renderer = null; gl = 'failed'; setLens('none'); schedule(); }
    function onRestored() {
      if (disposed || !canvas) return;
      renderer = createMascotRenderer(canvas, 2, palette, { parallel: true });
      if (!renderer) return;
      if (side) renderer.resize(side);
      gl = 'compiling';
      schedule();
    }

    // A new binding starts hidden until its first frame; one that was on the CSS fallback keeps showing it while WebGL is retried.
    if (still || lens !== 'none') setLens('pending');
    if (mode === 'compositor') startCompositorIdle(); else stopCompositorIdle(false);
    darkTarget = dark = resolveDark();
    root.dataset.dark = darkTarget ? 'true' : 'false';
    contender.busy = state !== 'idle' && state !== 'paused';
    // Re-binding (StrictMode dev double-mount, prop changes) keeps a running reaction animated.
    if (physics.transientRemaining() > 0) contender.boost = performance.now() + 4000;
    mascotRegistry.add(contender);
    // A fixed size needs no layout read; fluid mascots get their size from the ResizeObserver's first report.
    const fixed = live.current.size;
    if (fixed && fixed > 0) measure(fixed, fixed);

    const resizeObserver = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      measure(box.width, box.height);
    });
    resizeObserver.observe(root);
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      inView = entries[entries.length - 1].isIntersecting;
      rect = null;
      contender.visible = pageVisible && inView;
      if (!inView && pointerId !== -1) { pointerId = -1; physics.pressCancel(); root.dataset.pressed = 'false'; }
      mascotRegistry.elect(); schedule();
    });
    intersection?.observe(root);
    if (!intersection) { contender.visible = pageVisible; mascotRegistry.elect(); }
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
    window.addEventListener('scroll', invalidateRect, { capture: true, passive: true });
    window.addEventListener('resize', invalidateRect, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    motionQuery.addEventListener('change', onMotion);
    themeQuery.addEventListener('change', applyTheme);

    control.current = {
      sync() {
        const current = live.current;
        physics.setState(current.state ?? 'idle');
        physics.setEmotion(current.emotion ?? null);
        const busy = (current.state ?? 'idle') !== 'idle' && current.state !== 'paused';
        if (busy !== contender.busy) { contender.busy = busy; mascotRegistry.elect(); }
        schedule();
      },
      claim,
      celebrate(value) {
        const current = live.current;
        const chosen = value ?? current.celebrateEmotion ?? 'joy';
        claim();
        physics.celebrate(chosen, chosen === 'joy' ? 1.5 : 2);
        if (current.confetti !== false) fireConfetti(stage);
        current.onCelebrate?.();
        schedule();
      },
      // A greeting must animate even when a larger mascot sits underneath an overlay (IntersectionObserver
      // cannot see occlusion), so it claims the single animated slot like a touch does. In the compositor idle it waits
      // for the hand-off to the live physics.
      greet() {
        if (mode === 'compositor') { pendingGreet = true; return; }
        claim(); physics.greet(); schedule();
      },
      theme: applyTheme,
      resize() {
        side = -1;
        const value = live.current.size;
        if (value && value > 0) measure(value, value);
        else measure(root.clientWidth, root.clientHeight);
      },
      mode() { setMode(live.current.idleMode === 'compositor' ? 'compositor' : 'live'); },
      exclusive() {
        const value = (live.current.exclusive ?? true) && !still;
        if (value !== contender.exclusive) { contender.exclusive = value; mascotRegistry.elect(); schedule(); }
      },
    };

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (pollRaf) cancelAnimationFrame(pollRaf);
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
      window.removeEventListener('scroll', invalidateRect, { capture: true });
      window.removeEventListener('resize', invalidateRect);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotion);
      themeQuery.removeEventListener('change', applyTheme);
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
      }
      renderer?.dispose(); // frees the GL objects and loses the context (WEBGL_lose_context)
      renderer = null;
      canvas?.remove();
      canvas = null;
      control.current = null;
    };
    // `state`, `size`, `exclusive` and `idleMode` are read through `live` after mount; the effect only re-binds for
    // structural changes (a new root element, palette or still mode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physics, faceRefs, still, interactive, decorative, palette]);

  // The mode hand-off runs before the other prop effects, so a commit that switches to 'live' and greets plays the greeting live.
  useEffect(() => { control.current?.mode(); }, [idleMode]);
  useEffect(() => { control.current?.sync(); }, [state, emotion]);
  useEffect(() => { control.current?.exclusive(); }, [exclusive]);
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
  // The compositor-idle classes are rendered once from the initial mode; later switches are imperative (the hand-off must
  // read the running transform before the keyframes go), so React never rewrites these class names.
  const content = <span ref={stageRef} className={styles.stage}>
    <span ref={floorRef} className={initial.compositor ? `${styles.floor} ${styles.idleFloor}` : styles.floor}>
      <span ref={poolRef} className={styles.shadow} style={look.pool} />
      <span ref={ambientRef} className={styles.shadow} style={look.ambient} />
      <span ref={contactRef} className={styles.shadow} style={look.contact} />
    </span>
    <span ref={bodyRef} className={styles.body}>
      <span ref={idleRef} className={initial.compositor ? `${styles.idle} ${styles.idleRoll}` : styles.idle}>
        <span ref={breathRef} className={initial.compositor ? `${styles.breath} ${styles.idleBreath}` : styles.breath}>
          <span ref={fallbackRef} className={styles.fallback} style={look.fallback} />
          {/* The WebGL (or still 2D) canvas is inserted here by the layout effect when the mascot is first painted. */}
          <MascotFace uid={uid} refs={faceRefs} strings={initial.face} blush={initial.blush} glow={initial.glow} colors={palette.face} className={styles.face} />
        </span>
      </span>
    </span>
  </span>;
  const shared = {
    ref: rootRef,
    className: className ? `${styles.root} ${className}` : styles.root,
    style: rootStyle,
    'data-state': state,
    'data-emotion': initial.emotion,
    'data-interactive': interactive ? 'true' : 'false',
    'data-lens': 'pending',
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
