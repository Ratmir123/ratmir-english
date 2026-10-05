// Smooth Talk mascot — deterministic jelly simulation (MASCOT-SPEC §2, §3, §5, §6, §7).
// Pure TypeScript reference: no DOM, no React. Fixed step 1/240 s, ≤ 8 substeps per rendered frame,
// semi-implicit Euler, preallocated buffers (no allocation per frame), injectable seeded RNG.
import {
  AUDIO, BODY_RADIUS, C_DAMP, D_MAX, D_MIN, FACE, HOP_SPRING, IDLE, K_NEIGH, K_SPRING, MAX_SUBSTEPS, NODE_COUNT,
  POS_SPRING, SCALE_SPRING, SQUASH_SPRING, STEP_DT, TILT_SPRING, TINT_RGB, TOUCH, VOLUME_KEEP,
} from './constants';
import { EMOTIONS, REACTIONS, TAP_CYCLE, emotionForState, type EyeShape, type MascotEmotion, type MascotState } from './emotions';

const N = NODE_COUNT;
const TAU = Math.PI * 2;
const DT = STEP_DT;
const QUEUE_MAX = 4;
const IMPULSE_MAX = 8;
const TAP_HISTORY = 16;
const REVERSAL_HISTORY = 8;
const ATTACK = 1 - Math.exp(-DT / AUDIO.attackSeconds);
const RELEASE = 1 - Math.exp(-DT / AUDIO.releaseSeconds);
const SHAPE_RATE = DT / FACE.shapeFadeSeconds;
const DENT_DENOMINATOR = 2 * TOUCH.dentSigma * TOUCH.dentSigma;

// Face spring slots.
const OPEN = 0, SMILE = 1, SQUINT = 2, TILT = 3, WIDTH = 4, EYE_STRIDE = 5;
const M_W = 10, M_O = 11, M_S = 12, M_R = 13, M_X = 14, BLUSH = 15, GAZE_X = 16, GAZE_Y = 17;
const TINT_R = 18, TINT_G = 19, TINT_B = 20, TINT_A = 21, FACE_COUNT = 22;
const GAZE_K = 200, TINT_K = 40;

export type RandomSource = () => number;
/** mulberry32 — tiny, fast and identical on every JS engine. */
export function createSeededRandom(seed = 0x5eed): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Point { x: number; y: number }
export interface EyeFrame {
  open: number; smile: number; squint: number; tilt: number; width: number;
  /** Special shape on screen ('pill' when none). */
  shape: EyeShape;
  specialOpacity: number;
  pillOpacity: number;
  /** Degrees (spiral spins 360°/s, star twinkles). */
  spin: number;
  /** Scale pulse (heart 1.6 Hz). */
  pulse: number;
}
export interface MouthFrame { w: number; o: number; s: number; r: number; x: number; interior: number; tongue: number }
export interface MascotFrame {
  time: number;
  emotion: MascotEmotion;
  sleeping: boolean;
  /** Shader displacement per node (fraction of R0), including the mic pulse; clamped. */
  displacement: Float32Array;
  /** Body offset in px (position spring + hop). */
  x: number; y: number;
  rotation: number; scaleX: number; scaleY: number;
  hop: number; squash: number;
  gazeX: number; gazeY: number;
  eyes: [EyeFrame, EyeFrame];
  mouth: MouthFrame;
  blush: number;
  tint: Float32Array; tintAmount: number;
  /** Smoothed microphone level (0–1). */
  energy: number;
  /** Speech envelope (0–1). */
  speech: number;
  /** Sleepy "z" phase 0–1, or −1 when awake. */
  zzz: number;
  /** True while something moves fast enough to need full-rate rendering. */
  active: boolean;
}
export interface MascotPhysicsOptions {
  /** Canvas side S in px/pt (default 240). */
  size?: number;
  seed?: number;
  random?: RandomSource;
  state?: MascotState;
  emotion?: MascotEmotion | null;
}
export interface MascotDebug {
  time: number; q: number; vq: number; h: number; vh: number; phi: number; vphi: number; px: number; py: number;
  meanDisplacement: number; maxDisplacement: number; maxVelocity: number; pressing: boolean; dragging: boolean;
  queue: MascotEmotion[]; context: MascotEmotion; sleeping: boolean; lastActivity: number;
}

const eyeFrame = (): EyeFrame => ({ open: 1, smile: 0, squint: 0, tilt: 0, width: 1, shape: 'pill', specialOpacity: 0, pillOpacity: 1, spin: 0, pulse: 1 });
const clamp = (value: number, min: number, max: number) => value < min ? min : value > max ? max : value;
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smoothstep = (edge0: number, edge1: number, x: number) => { const t = clamp((x - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };
/** Wraps an angle to (−π, π]. */
function wrap(angle: number) { let a = angle % TAU; if (a <= -Math.PI) a += TAU; else if (a > Math.PI) a -= TAU; return a; }

export class MascotPhysics {
  readonly frame: MascotFrame;
  private readonly random: RandomSource;
  private size: number;
  private time = 0;
  private accumulator = 0;

  // Ring.
  private readonly d = new Float64Array(N);
  private readonly v = new Float64Array(N);
  private readonly a = new Float64Array(N);
  private readonly force = new Float64Array(N);
  private readonly touch = new Float64Array(N);
  private readonly nodeCos = new Float64Array(N);
  private readonly nodeSin = new Float64Array(N);
  private pulse = 0;

  // Global body springs and their targets.
  private px = 0; private vpx = 0; private py = 0; private vpy = 0;
  private q = 0; private vq = 0; private phi = 0; private vphi = 0; private h = 0; private vh = 0;
  private puff = 0; private vpuff = 0; private sag = 0; private vsag = 0;
  private tpx = 0; private tpy = 0; private tq = 0; private tphi = 0; private th = 0; private tpuff = 0; private tsag = 0;

  // Face springs.
  private readonly fv = new Float64Array(FACE_COUNT);
  private readonly fvel = new Float64Array(FACE_COUNT);
  private readonly ft = new Float64Array(FACE_COUNT);
  private readonly fk = new Float64Array(FACE_COUNT);
  private readonly fc = new Float64Array(FACE_COUNT);
  private readonly shapeTarget: [EyeShape, EyeShape] = ['pill', 'pill'];
  private readonly shapeShown: [EyeShape, EyeShape] = ['pill', 'pill'];
  private readonly special = new Float64Array(2);
  private readonly pill = new Float64Array([1, 1]);
  private tongueGate = 0;
  private blink = 1;

  // Emotion state.
  private state: MascotState = 'idle';
  private override: MascotEmotion | null = null;
  private context: MascotEmotion = 'calm';
  private current: MascotEmotion = 'calm';
  private currentSince = 0;
  private readonly queueEmotion: MascotEmotion[] = ['calm', 'calm', 'calm', 'calm'];
  private readonly queueDuration = new Float64Array(QUEUE_MAX);
  private queueLength = 0;
  private queueUntil = 0;
  private sleeping = false;
  private lastActivity = 0;
  private wokeAt = -Infinity;

  // Scheduled impulses (hops) and laugh bounce.
  private readonly impulseAt = new Float64Array(IMPULSE_MAX);
  private readonly impulseH = new Float64Array(IMPULSE_MAX);
  private impulseCount = 0;
  private nextBounce = Infinity;
  private bounceSign = 1;

  // Blink and idle life.
  private nextBlink: number;
  private blinkStart = -1;
  private secondBlinkAt = -1;
  private nextIdle: number;
  private glanceUntil = 0; private glanceX = 0;
  private tiltUntil = 0; private tiltSign = 1;
  private flickerUntil = 0;
  private squintUntil = 0;

  // Audio.
  private micLevel = 0; private micEnv = 0;
  private speechLevel = 0; private speechEnv = 0;

  // Pointer.
  private hoverX = 0; private hoverY = 0;
  private pressing = false; private pressStartTime = 0;
  private startX = 0; private startY = 0; private curX = 0; private curY = 0;
  private dragging = false; private maxMove = 0; private squeezed = false;
  private readonly axisDir = new Float64Array(2);
  private readonly axisAnchor = new Float64Array(2);
  private readonly axisPeak = new Float64Array(2);
  private readonly reversals = new Float64Array(REVERSAL_HISTORY).fill(-Infinity);
  private reversalIndex = 0;
  private readonly taps = new Float64Array(TAP_HISTORY).fill(-Infinity);
  private tapIndex = 0;
  private cycleIndex = 0;

  constructor(options: MascotPhysicsOptions = {}) {
    this.random = options.random ?? createSeededRandom(options.seed ?? 0x5eed);
    this.size = options.size && options.size > 0 ? options.size : 240;
    for (let i = 0; i < N; i++) { const angle = TAU * i / N; this.nodeCos[i] = Math.cos(angle); this.nodeSin[i] = Math.sin(angle); }
    for (let i = 0; i < FACE_COUNT; i++) { this.fk[i] = FACE.spring.k; this.fc[i] = FACE.spring.c; }
    this.fk[GAZE_X] = this.fk[GAZE_Y] = GAZE_K; this.fc[GAZE_X] = this.fc[GAZE_Y] = 2 * Math.sqrt(GAZE_K);
    for (const slot of [TINT_R, TINT_G, TINT_B, TINT_A]) { this.fk[slot] = TINT_K; this.fc[slot] = 2 * Math.sqrt(TINT_K); }
    this.frame = {
      time: 0, emotion: 'calm', sleeping: false, displacement: new Float32Array(N), x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      hop: 0, squash: 0, gazeX: 0, gazeY: 0, eyes: [eyeFrame(), eyeFrame()],
      mouth: { w: 0.07, o: 0, s: 0.35, r: 0, x: 0, interior: 0, tongue: 0 }, blush: 0, tint: new Float32Array(TINT_RGB.cyan),
      tintAmount: 0, energy: 0, speech: 0, zzz: -1, active: false,
    };
    this.fv.set(this.frame.tint, TINT_R); this.ft.set(this.frame.tint, TINT_R);
    this.nextBlink = FACE.blinkMin + this.random() * (FACE.blinkMax - FACE.blinkMin);
    this.nextIdle = IDLE.minGap + this.random() * (IDLE.maxGap - IDLE.minGap);
    if (options.state) this.state = options.state;
    if (options.emotion) this.override = options.emotion;
    this.context = this.override ?? emotionForState(this.state);
    this.current = this.context;
    this.settle();
  }

  // ───────────────────────── Public API ─────────────────────────

  get emotion(): MascotEmotion { return this.current; }
  get now(): number { return this.time; }
  get isSleeping(): boolean { return this.sleeping; }
  get isPressing(): boolean { return this.pressing; }
  get canvasSize(): number { return this.size; }

  setSize(size: number) { if (Number.isFinite(size) && size > 0) this.size = size; }

  /** App/voice state (§8). A change counts as activity and wakes a sleeping mascot. */
  setState(state: MascotState) {
    if (state === this.state) return;
    this.state = state;
    this.refreshContext();
  }
  /** Explicit emotion that overrides the state mapping (null → follow the state). */
  setEmotion(emotion: MascotEmotion | null) {
    if (emotion === this.override) return;
    this.override = emotion;
    this.refreshContext();
  }
  /** Microphone level 0–1 (used while listening). */
  setMicLevel(level: number) {
    this.micLevel = clamp(finite(level), 0, 1);
    if (this.micLevel > 0.08) this.lastActivity = this.time;
  }
  /** Partner playback level 0–1 (lip-sync while speaking). */
  setSpeechLevel(level: number) {
    this.speechLevel = clamp(finite(level), 0, 1);
    if (this.speechLevel > 0.08) this.lastActivity = this.time;
  }
  /** Pointer gaze in −1…1 per axis, already normalised by the caller ((cursor − centre) / 420 px); null resets. */
  hover(gaze: Point | null) {
    if (!gaze || !Number.isFinite(gaze.x) || !Number.isFinite(gaze.y)) { this.hoverX = 0; this.hoverY = 0; return; }
    const x = clamp(gaze.x, -1, 1), y = clamp(gaze.y, -1, 1);
    if (Math.abs(x - this.hoverX) + Math.abs(y - this.hoverY) > 0.04) this.activity();
    this.hoverX = x; this.hoverY = y;
  }
  /** Convenience: pointer offset from the body centre in px → hover gaze. */
  hoverOffset(dx: number, dy: number) { this.hover({ x: dx / TOUCH.hoverRadius, y: dy / TOUCH.hoverRadius }); }

  /** Press at a canvas point (px, origin top-left of the S×S canvas). */
  pressStart(point: Point) {
    if (this.pressing || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.activity();
    const S = this.size, c = S / 2;
    const dx = point.x - c, dy = point.y - c;
    const theta = Math.atan2(dy, dx);
    const rho = Math.hypot(dx, dy) / (BODY_RADIUS * S / 2);
    for (let i = 0; i < N; i++) {
      const delta = wrap(TAU * i / N - theta);
      const weight = Math.exp(-delta * delta / DENT_DENOMINATOR);
      this.touch[i] = weight;
      this.v[i] -= TOUCH.dentImpulse * weight;
    }
    if (rho < TOUCH.centreRadius) this.vq += TOUCH.centreSquash;
    this.squintUntil = this.time + TOUCH.squintSeconds;
    this.pressing = true; this.pressStartTime = this.time;
    this.startX = this.curX = point.x; this.startY = this.curY = point.y;
    this.dragging = false; this.maxMove = 0; this.squeezed = false;
    this.axisDir[0] = this.axisDir[1] = 0;
    this.axisAnchor[0] = this.axisPeak[0] = point.x; this.axisAnchor[1] = this.axisPeak[1] = point.y;
  }
  pressMove(point: Point) {
    if (!this.pressing || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.curX = point.x; this.curY = point.y;
    const distance = Math.hypot(point.x - this.startX, point.y - this.startY);
    if (distance > this.maxMove) this.maxMove = distance;
    if (!this.dragging && distance > TOUCH.dragThreshold) {
      this.dragging = true;
      if (this.squeezed) { this.squeezed = false; this.clearQueue(); }
    }
    if (this.dragging) { this.lastActivity = this.time; this.trackShake(point.x, point.y); }
  }
  pressEnd() {
    if (!this.pressing) return;
    const held = this.time - this.pressStartTime;
    const tap = !this.dragging && this.maxMove < TOUCH.dragThreshold && held < TOUCH.tapSeconds;
    const squeezed = this.squeezed;
    this.releasePress();
    if (tap) this.tap();
    else if (squeezed) { this.vq += TOUCH.bigBoing; this.playChain(REACTIONS.release); }
  }
  /** Pointer cancelled (scroll took over, capture lost): release without a tap. */
  pressCancel() {
    if (!this.pressing) return;
    const squeezed = this.squeezed;
    this.releasePress();
    if (squeezed) this.clearQueue();
  }
  /**
   * Tap reaction (§3). Pointer taps add the boing and the hop; keyboard/VoiceOver activation
   * (keyboard = true) reacts instantly without physics noise.
   */
  tap(keyboard = false) {
    const wasSleeping = this.sleeping;
    this.activity();
    if (!keyboard) { this.vq += TOUCH.tapSquash; this.vh += TOUCH.tapHop * this.size; }
    if (wasSleeping || this.time - this.wokeAt < 0.35) return; // waking up is the reaction
    this.taps[this.tapIndex] = this.time; this.tapIndex = (this.tapIndex + 1) % TAP_HISTORY;
    if (this.countSince(this.taps, TOUCH.tickleWindow) >= TOUCH.tickleTaps) {
      this.taps.fill(-Infinity);
      this.playChain(REACTIONS.tickle);
      return;
    }
    if (this.countSince(this.taps, TOUCH.rapidWindow) >= TOUCH.rapidTaps) { this.playChain(REACTIONS.rapidLaugh); return; }
    const reaction = TAP_CYCLE[this.cycleIndex % TAP_CYCLE.length];
    this.cycleIndex++;
    this.play(reaction.emotion, reaction.duration);
  }
  /** Plays one transient emotion, then returns to the context emotion. */
  play(emotion: MascotEmotion, duration = EMOTIONS[emotion].duration) { this.playChain([{ emotion, duration }]); }
  /** Plays a chain of transient emotions (each for its duration), then the context emotion. */
  playChain(chain: readonly { emotion: MascotEmotion; duration: number }[]) {
    const length = Math.min(chain.length, QUEUE_MAX);
    for (let i = 0; i < length; i++) { this.queueEmotion[i] = chain[i].emotion; this.queueDuration[i] = Math.max(0, chain[i].duration); }
    this.queueLength = length;
    this.queueUntil = this.time + (length ? this.queueDuration[0] : 0);
    this.resolveEmotion();
  }
  /** Celebration: joy (default) + boing. Confetti is the renderer's job. */
  celebrate(emotion: MascotEmotion = 'joy', duration = 1.5) {
    this.activity();
    this.vq += TOUCH.tapSquash;
    this.play(emotion, duration);
  }
  /** First appearance per launch: happy hop (§8). */
  greet() {
    this.activity();
    this.vh += TOUCH.tapHop * 1.15 * this.size;
    this.playChain(REACTIONS.greeting);
  }
  /** Seconds left of the current transient chain (0 when showing the context emotion). */
  transientRemaining(): number {
    if (!this.queueLength) return 0;
    let total = Math.max(0, this.queueUntil - this.time);
    for (let i = 1; i < this.queueLength; i++) total += this.queueDuration[i];
    return total;
  }

  /**
   * Advances the simulation by a rendered frame time. Runs whole 1/240 s substeps (≤ 8);
   * time beyond 8 substeps is dropped so a slow frame can never spiral.
   */
  step(frameSeconds: number): MascotFrame {
    if (Number.isFinite(frameSeconds) && frameSeconds > 0) {
      this.accumulator += frameSeconds;
      let steps = Math.floor(this.accumulator / DT + 1e-6);
      if (steps > MAX_SUBSTEPS) { steps = MAX_SUBSTEPS; this.accumulator = 0; }
      else this.accumulator = Math.max(0, this.accumulator - steps * DT);
      for (let k = 0; k < steps; k++) this.substep();
    }
    this.writeFrame(false);
    return this.frame;
  }
  /** Advances only the clocks (transients, sleep) without motion — for Reduced Motion static poses. */
  advanceTime(seconds: number): MascotFrame {
    if (Number.isFinite(seconds) && seconds > 0) { this.time += seconds; this.resolveEmotion(); }
    return this.settle();
  }
  /** Static pose: every spring at its target, ring at rest, no blink or oscillation. */
  settle(): MascotFrame {
    this.resolveEmotion();
    this.computeTargets(true);
    this.d.fill(0); this.v.fill(0); this.force.fill(0); this.pulse = 0;
    this.px = this.tpx; this.py = this.tpy; this.q = this.tq; this.phi = this.tphi; this.h = this.th; this.puff = this.tpuff; this.sag = this.tsag;
    this.vpx = this.vpy = this.vq = this.vphi = this.vh = this.vpuff = this.vsag = 0;
    this.fv.set(this.ft); this.fvel.fill(0);
    this.impulseCount = 0; this.nextBounce = Infinity; this.blinkStart = -1; this.secondBlinkAt = -1; this.blink = 1;
    this.micEnv = 0; this.speechEnv = 0;
    for (let e = 0; e < 2; e++) {
      const target = this.shapeTarget[e];
      this.shapeShown[e] = target; this.special[e] = target === 'pill' ? 0 : 1; this.pill[e] = target === 'pill' ? 1 : 0;
    }
    this.tongueGate = this.current === 'laugh' || this.current === 'joy' ? 1 : 0;
    this.writeFrame(true);
    return this.frame;
  }
  debug(): MascotDebug {
    let sum = 0, max = 0, maxV = 0;
    for (let i = 0; i < N; i++) { sum += this.d[i]; max = Math.max(max, Math.abs(this.d[i])); maxV = Math.max(maxV, Math.abs(this.v[i])); }
    return {
      time: this.time, q: this.q, vq: this.vq, h: this.h, vh: this.vh, phi: this.phi, vphi: this.vphi, px: this.px, py: this.py,
      meanDisplacement: sum / N, maxDisplacement: max, maxVelocity: maxV, pressing: this.pressing, dragging: this.dragging,
      queue: this.queueEmotion.slice(0, this.queueLength), context: this.context, sleeping: this.sleeping, lastActivity: this.lastActivity,
    };
  }

  // ───────────────────────── Internals ─────────────────────────

  private refreshContext() {
    this.context = this.override ?? emotionForState(this.state);
    this.activity();
    this.resolveEmotion();
  }
  private activity() {
    this.lastActivity = this.time;
    if (this.sleeping) { this.sleeping = false; this.wokeAt = this.time; this.playChain(REACTIONS.wake); }
  }
  private clearQueue() { this.queueLength = 0; this.resolveEmotion(); }
  private releasePress() {
    this.pressing = false; this.dragging = false; this.squeezed = false;
    this.force.fill(0);
  }
  private countSince(history: Float64Array, window: number) {
    let count = 0;
    for (let i = 0; i < history.length; i++) if (this.time - history[i] <= window + 1e-9) count++;
    return count;
  }
  private trackShake(x: number, y: number) {
    const hysteresis = 0.03 * this.size;
    const threshold = TOUCH.shakeAmplitude * this.size;
    for (let axis = 0; axis < 2; axis++) {
      const value = axis === 0 ? x : y;
      const dir = this.axisDir[axis];
      if (dir === 0) {
        const delta = value - this.axisAnchor[axis];
        if (Math.abs(delta) > hysteresis) { this.axisDir[axis] = Math.sign(delta); this.axisPeak[axis] = value; }
      } else if ((value - this.axisPeak[axis]) * dir > 0) {
        this.axisPeak[axis] = value;
      } else if (Math.abs(value - this.axisPeak[axis]) > hysteresis) {
        if (Math.abs(this.axisPeak[axis] - this.axisAnchor[axis]) > threshold) this.recordReversal();
        this.axisAnchor[axis] = this.axisPeak[axis];
        this.axisPeak[axis] = value;
        this.axisDir[axis] = -dir;
      }
    }
  }
  private recordReversal() {
    this.reversals[this.reversalIndex] = this.time;
    this.reversalIndex = (this.reversalIndex + 1) % REVERSAL_HISTORY;
    if (this.countSince(this.reversals, TOUCH.shakeWindow) >= TOUCH.shakeReversals) {
      this.reversals.fill(-Infinity);
      this.playChain(REACTIONS.shake);
    }
  }
  private resolveEmotion() {
    while (this.queueLength > 0 && this.time >= this.queueUntil) {
      for (let i = 1; i < this.queueLength; i++) { this.queueEmotion[i - 1] = this.queueEmotion[i]; this.queueDuration[i - 1] = this.queueDuration[i]; }
      this.queueLength--;
      if (this.queueLength > 0) this.queueUntil = this.time + this.queueDuration[0];
    }
    const next: MascotEmotion = this.queueLength > 0 ? this.queueEmotion[0] : this.sleeping ? 'sleepy' : this.context;
    if (next !== this.current) this.enter(next);
  }
  private enter(emotion: MascotEmotion) {
    const previous = this.current;
    this.current = emotion;
    this.currentSince = this.time;
    this.impulseCount = 0;
    const body = EMOTIONS[emotion].body;
    if (body.kick) this.vq += body.kick;
    if (body.nod) this.vh += body.nod * this.size;
    if (body.hops) {
      for (let k = 0; k < body.hops.count && this.impulseCount < IMPULSE_MAX; k++) {
        this.impulseAt[this.impulseCount] = this.time + k * body.hops.interval;
        this.impulseH[this.impulseCount] = body.hops.velocity * this.size;
        this.impulseCount++;
      }
    }
    this.nextBounce = body.bounce ? this.time : Infinity;
    this.bounceSign = 1;
    if (emotion === 'calm' && previous !== 'calm') this.nextIdle = this.time + IDLE.minGap + this.random() * (IDLE.maxGap - IDLE.minGap);
  }

  private substep() {
    this.time += DT;
    const t = this.time;
    this.resolveEmotion();
    // Sleep after 60 s without interaction or state change (only from the calm context).
    if (!this.sleeping && this.context === 'calm' && this.queueLength === 0 && !this.pressing && t - this.lastActivity >= IDLE.sleepAfter) {
      this.sleeping = true;
      this.resolveEmotion();
    }
    this.updateIdleLife(t);
    this.updateBlink(t);
    this.updateAudio();
    this.updatePress(t);
    this.computeTargets(false);
    this.applyImpulses(t);
    this.integrateRing();
    this.integrateBody();
    this.integrateFace();
    this.updateShapes();
  }

  private updateIdleLife(t: number) {
    if (this.current !== 'calm' || this.pressing || t < this.nextIdle) return;
    this.nextIdle = t + IDLE.minGap + this.random() * (IDLE.maxGap - IDLE.minGap);
    const pick = this.random();
    if (pick < 0.4) this.startBlink(t, this.random() < 0.5);
    else if (pick < 0.6) { this.glanceX = this.random() < 0.5 ? -IDLE.glance : IDLE.glance; this.glanceUntil = t + IDLE.glanceSeconds; }
    else if (pick < 0.7) this.vh += IDLE.hop * this.size;
    else if (pick < 0.85) { this.tiltSign = this.random() < 0.5 ? -1 : 1; this.tiltUntil = t + IDLE.tiltSeconds; }
    else this.flickerUntil = t + IDLE.flickerSeconds;
  }
  private canBlink() {
    return this.shapeTarget[0] === 'pill' && this.shapeTarget[1] === 'pill' && this.current !== 'sleepy'
      && this.ft[SMILE] < 0.7 && this.ft[EYE_STRIDE + SMILE] < 0.7;
  }
  private startBlink(t: number, double: boolean) {
    if (!this.canBlink() || this.blinkStart >= 0) return;
    this.blinkStart = t;
    this.secondBlinkAt = double ? t + 0.22 : -1;
  }
  private updateBlink(t: number) {
    if (t >= this.nextBlink) {
      this.nextBlink = t + FACE.blinkMin + this.random() * (FACE.blinkMax - FACE.blinkMin);
      this.startBlink(t, this.random() < FACE.doubleBlinkChance);
    }
    if (this.blinkStart < 0 && this.secondBlinkAt >= 0 && t >= this.secondBlinkAt) {
      this.secondBlinkAt = -1;
      if (this.canBlink()) this.blinkStart = t;
    }
    if (this.blinkStart < 0) { this.blink = 1; return; }
    const u = (t - this.blinkStart) / FACE.blinkSeconds;
    if (u >= 1 || !this.canBlink()) { this.blinkStart = -1; this.blink = 1; return; }
    const closed = u < 0.45 ? smoothstep(0, 0.45, u) : 1 - smoothstep(0.45, 1, u);
    this.blink = 1 - 0.92 * closed;
  }
  private updateAudio() {
    const speaking = this.state === 'speaking' || this.current === 'speaking';
    const speechTarget = speaking ? this.speechLevel : 0;
    const previous = this.speechEnv;
    this.speechEnv += (speechTarget - previous) * (speechTarget > previous ? ATTACK : RELEASE);
    const rise = this.speechEnv - previous;
    // Syllable bob: q += 0.18·Δenvelope⁺ (applied to the squash itself, then the wobbly spring rings out).
    if (speaking && rise > 0) this.q += AUDIO.syllableBob * rise;
    const listening = this.state === 'listening' || this.current === 'listening';
    const micTarget = listening ? this.micLevel : 0;
    this.micEnv += (micTarget - this.micEnv) * (micTarget > this.micEnv ? ATTACK : RELEASE);
    this.pulse = AUDIO.micPulse * this.micEnv;
  }
  private updatePress(t: number) {
    if (!this.pressing) return;
    const held = t - this.pressStartTime;
    if (!this.squeezed && !this.dragging && held >= TOUCH.longPressSeconds) {
      this.squeezed = true;
      this.playChain([{ emotion: 'squeeze', duration: Infinity }]);
    }
    const S = this.size;
    const depth = Math.min(1, held / TOUCH.holdRampSeconds);
    const dx = this.curX - this.startX, dy = this.curY - this.startY;
    const drag = Math.hypot(dx, dy);
    // The dent stays where the finger landed and fades as the drag takes over (pull, not push).
    const dent = TOUCH.holdForce * depth * (this.dragging ? Math.max(0, 1 - drag / (0.2 * S)) : 1);
    const stretch = this.dragging ? TOUCH.stretchForce * Math.min(1, drag / (TOUCH.stretchSpan * S)) : 0;
    const cosDrag = drag > 0 ? dx / drag : 0, sinDrag = drag > 0 ? dy / drag : 0;
    for (let i = 0; i < N; i++) {
      this.force[i] = -dent * this.touch[i] + stretch * (this.nodeCos[i] * cosDrag + this.nodeSin[i] * sinDrag);
    }
  }
  private computeTargets(still: boolean) {
    const t = this.time, S = this.size;
    const spec = EMOTIONS[this.current];
    const body = spec.body;
    const local = t - this.currentSince;
    let q = body.q, phi = body.tilt, px = 0, py = 0;
    if (!still) {
      q += body.breath.amp * Math.sin(body.breath.freq * t);
      if (body.sway) phi += body.sway.amp * Math.sin(body.sway.freq * t);
      if (body.shake && local < body.shake.seconds) phi += body.shake.amp * Math.sin(TAU * body.shake.hz * local);
      if (this.tiltUntil > t) phi += IDLE.tiltDegrees * this.tiltSign;
      if (body.orbit) { const angle = TAU * body.orbit.hz * local; px += body.orbit.radius * S * Math.cos(angle); py += body.orbit.radius * S * Math.sin(angle); }
    }
    let gazeX = this.hoverX, gazeY = this.hoverY;
    if (this.pressing && this.dragging) {
      const dx = this.curX - this.startX, dy = this.curY - this.startY;
      const distance = Math.hypot(dx, dy);
      const follow = Math.min(TOUCH.dragFollow * distance, TOUCH.dragRadius * S);
      if (distance > 0) { px += dx / distance * follow; py += dy / distance * follow; }
      phi += clamp(dx * TOUCH.dragTiltPerPt, -TOUCH.dragTiltMax, TOUCH.dragTiltMax);
      const reach = Math.min(1, distance / (0.25 * S));
      if (distance > 0) { gazeX = dx / distance * reach; gazeY = dy / distance * reach; }
    } else if (spec.gaze) { gazeX = spec.gaze[0]; gazeY = spec.gaze[1]; }
    else if (!still && this.glanceUntil > t) { gazeX = this.glanceX; gazeY = 0; }
    if (still) { gazeX = spec.gaze ? spec.gaze[0] : 0; gazeY = spec.gaze ? spec.gaze[1] : 0; }
    this.tq = clamp(q, -SQUASH_SPRING.clamp, SQUASH_SPRING.clamp);
    this.tphi = clamp(phi, -TILT_SPRING.clamp, TILT_SPRING.clamp);
    this.tpx = px; this.tpy = py;
    this.th = body.lift * S;
    this.tpuff = body.scale - 1 + (!still && body.pulse ? body.pulse.amp * Math.sin(TAU * body.pulse.hz * t) : 0);
    this.tsag = body.scaleY - 1;

    const listeningEyes = AUDIO.micEyes * this.micEnv;
    for (let e = 0; e < 2; e++) {
      const eye = spec.eyes[e], base = e * EYE_STRIDE;
      let open = eye.open + listeningEyes, smile = eye.smile, squint = eye.squint, tilt = eye.tilt;
      if (!still) {
        if (this.flickerUntil > t) smile = Math.max(smile, IDLE.flickerSmile);
        if (this.tiltUntil > t) { open += e === 0 ? 0.1 : -0.18; tilt += (e === 0 ? -7 : 8) * this.tiltSign; }
        if (this.squintUntil > t) squint = Math.max(squint, 0.7);
      }
      this.ft[base + OPEN] = open; this.ft[base + SMILE] = smile; this.ft[base + SQUINT] = squint;
      this.ft[base + TILT] = tilt; this.ft[base + WIDTH] = eye.width;
      this.shapeTarget[e] = eye.shape;
    }
    const mouth = spec.mouth;
    this.ft[M_W] = mouth.w; this.ft[M_O] = mouth.o; this.ft[M_R] = mouth.r; this.ft[M_X] = mouth.x;
    this.ft[M_S] = mouth.s + (!still && spec.mouthWobble ? spec.mouthWobble.amp * Math.sin(TAU * spec.mouthWobble.hz * local) : 0);
    this.ft[BLUSH] = spec.blush;
    this.ft[GAZE_X] = gazeX; this.ft[GAZE_Y] = gazeY;
    if (spec.tint) { const rgb = TINT_RGB[spec.tint]; this.ft[TINT_R] = rgb[0]; this.ft[TINT_G] = rgb[1]; this.ft[TINT_B] = rgb[2]; }
    this.ft[TINT_A] = spec.tint ? spec.tintAmount : 0;
  }
  private applyImpulses(t: number) {
    let kept = 0;
    for (let k = 0; k < this.impulseCount; k++) {
      if (t >= this.impulseAt[k]) this.vh += this.impulseH[k];
      else { this.impulseAt[kept] = this.impulseAt[k]; this.impulseH[kept] = this.impulseH[k]; kept++; }
    }
    this.impulseCount = kept;
    const bounce = EMOTIONS[this.current].body.bounce;
    if (bounce && t >= this.nextBounce) {
      this.vq += this.bounceSign * bounce.impulse;
      this.bounceSign = -this.bounceSign;
      this.nextBounce += bounce.interval;
    }
  }
  private integrateRing() {
    const d = this.d, v = this.v, a = this.a, f = this.force;
    for (let i = 0; i < N; i++) {
      const left = d[i === 0 ? N - 1 : i - 1], right = d[i === N - 1 ? 0 : i + 1];
      a[i] = -K_SPRING * d[i] - C_DAMP * v[i] + K_NEIGH * (left + right - 2 * d[i]) + f[i];
    }
    let mean = 0;
    for (let i = 0; i < N; i++) { v[i] += a[i] * DT; d[i] += v[i] * DT; mean += d[i]; }
    mean /= N;
    for (let i = 0; i < N; i++) {
      let value = d[i] - VOLUME_KEEP * mean;
      if (value < D_MIN) { value = D_MIN; if (v[i] < 0) v[i] = 0; }
      else if (value > D_MAX) { value = D_MAX; if (v[i] > 0) v[i] = 0; }
      d[i] = value;
    }
  }
  private integrateBody() {
    this.vpx += (POS_SPRING.k * (this.tpx - this.px) - POS_SPRING.c * this.vpx) * DT; this.px += this.vpx * DT;
    this.vpy += (POS_SPRING.k * (this.tpy - this.py) - POS_SPRING.c * this.vpy) * DT; this.py += this.vpy * DT;
    this.vq += (SQUASH_SPRING.k * (this.tq - this.q) - SQUASH_SPRING.c * this.vq) * DT; this.q += this.vq * DT;
    if (this.q > SQUASH_SPRING.clamp) { this.q = SQUASH_SPRING.clamp; if (this.vq > 0) this.vq = 0; }
    else if (this.q < -SQUASH_SPRING.clamp) { this.q = -SQUASH_SPRING.clamp; if (this.vq < 0) this.vq = 0; }
    this.vphi += (TILT_SPRING.k * (this.tphi - this.phi) - TILT_SPRING.c * this.vphi) * DT; this.phi += this.vphi * DT;
    if (this.phi > TILT_SPRING.clamp) { this.phi = TILT_SPRING.clamp; if (this.vphi > 0) this.vphi = 0; }
    else if (this.phi < -TILT_SPRING.clamp) { this.phi = -TILT_SPRING.clamp; if (this.vphi < 0) this.vphi = 0; }
    this.vh += (HOP_SPRING.k * (this.th - this.h) - HOP_SPRING.c * this.vh) * DT; this.h += this.vh * DT;
    this.vpuff += (SCALE_SPRING.k * (this.tpuff - this.puff) - SCALE_SPRING.c * this.vpuff) * DT; this.puff += this.vpuff * DT;
    this.vsag += (SCALE_SPRING.k * (this.tsag - this.sag) - SCALE_SPRING.c * this.vsag) * DT; this.sag += this.vsag * DT;
  }
  private integrateFace() {
    const fv = this.fv, fvel = this.fvel, ft = this.ft, fk = this.fk, fc = this.fc;
    for (let i = 0; i < FACE_COUNT; i++) {
      fvel[i] += (fk[i] * (ft[i] - fv[i]) - fc[i] * fvel[i]) * DT;
      fv[i] += fvel[i] * DT;
    }
    if (this.state === 'speaking' || this.current === 'speaking') {
      // Lip-sync drives the opening directly; the spring resumes from here when speech ends.
      fv[M_O] = AUDIO.mouthRest + AUDIO.mouthRange * this.speechEnv;
      fvel[M_O] = 0;
    }
    const laughing = this.current === 'laugh' || this.current === 'joy';
    this.tongueGate = clamp(this.tongueGate + (laughing ? SHAPE_RATE : -SHAPE_RATE), 0, 1);
  }
  private updateShapes() {
    for (let e = 0; e < 2; e++) {
      const target = this.shapeTarget[e];
      this.pill[e] = clamp(this.pill[e] + (target === 'pill' ? SHAPE_RATE : -SHAPE_RATE), 0, 1);
      if (target === 'pill') {
        this.special[e] = Math.max(0, this.special[e] - SHAPE_RATE);
        if (this.special[e] === 0) this.shapeShown[e] = 'pill';
      } else if (this.shapeShown[e] === target) {
        this.special[e] = Math.min(1, this.special[e] + SHAPE_RATE);
      } else if (this.special[e] <= 0 || this.shapeShown[e] === 'pill') {
        this.shapeShown[e] = target; this.special[e] = Math.min(1, Math.max(0, this.special[e]) + SHAPE_RATE);
      } else {
        this.special[e] = Math.max(0, this.special[e] - SHAPE_RATE);
      }
    }
  }
  private writeFrame(still: boolean) {
    const frame = this.frame, S = this.size, t = this.time;
    frame.time = t;
    frame.emotion = this.current;
    frame.sleeping = this.sleeping;
    let motion = 0;
    for (let i = 0; i < N; i++) {
      frame.displacement[i] = clamp(this.d[i] + this.pulse, D_MIN, D_MAX);
      motion = Math.max(motion, Math.abs(this.v[i]));
    }
    frame.x = this.px; frame.y = this.py + this.h;
    frame.rotation = this.phi; frame.hop = this.h; frame.squash = this.q;
    frame.scaleX = (1 + 0.5 * this.q) * (1 + this.puff);
    frame.scaleY = (1 - this.q) * (1 + this.puff) * (1 + this.sag);
    frame.gazeX = this.fv[GAZE_X]; frame.gazeY = this.fv[GAZE_Y];
    for (let e = 0; e < 2; e++) {
      const eye = frame.eyes[e], base = e * EYE_STRIDE, shape = this.shapeShown[e];
      eye.open = Math.max(0, this.fv[base + OPEN]) * this.blink;
      eye.smile = clamp(this.fv[base + SMILE], 0, 1);
      eye.squint = clamp(this.fv[base + SQUINT], 0, 1);
      eye.tilt = this.fv[base + TILT];
      eye.width = this.fv[base + WIDTH];
      eye.shape = shape;
      eye.specialOpacity = shape === 'pill' ? 0 : this.special[e];
      eye.pillOpacity = this.pill[e];
      eye.spin = still ? 0 : shape === 'spiral' ? (t * 360) % 360 * (e === 0 ? 1 : -1) : shape === 'star' ? 8 * Math.sin(TAU * 0.8 * t + e) : 0;
      eye.pulse = still ? 1 : shape === 'heart' ? 1 + 0.08 * Math.sin(TAU * 1.6 * t) : shape === 'star' ? 1 + 0.05 * Math.sin(TAU * 2 * t + e) : 1;
    }
    const mouth = frame.mouth;
    mouth.w = clamp(this.fv[M_W], 0.03, 0.2);
    mouth.o = clamp(this.fv[M_O], 0, 1);
    mouth.s = clamp(this.fv[M_S], -1, 1);
    mouth.r = clamp(this.fv[M_R], 0, 1);
    mouth.x = this.fv[M_X];
    mouth.interior = smoothstep(0.07, 0.12, mouth.o);
    mouth.tongue = this.tongueGate * smoothstep(0.45, 0.6, mouth.o);
    frame.blush = clamp(this.fv[BLUSH], 0, 0.7);
    frame.tint[0] = this.fv[TINT_R]; frame.tint[1] = this.fv[TINT_G]; frame.tint[2] = this.fv[TINT_B];
    frame.tintAmount = clamp(this.fv[TINT_A], 0, 0.35);
    frame.energy = this.micEnv;
    frame.speech = this.speechEnv;
    frame.zzz = this.current !== 'sleepy' ? -1 : still ? 0.35 : (t * 0.42) % 1;
    let faceMotion = 0;
    for (let i = 0; i < FACE_COUNT; i++) if (i < TINT_R) faceMotion = Math.max(faceMotion, Math.abs(this.fvel[i]));
    frame.active = !still && (this.pressing || this.queueLength > 0 || this.blinkStart >= 0 || motion > 0.02
      || Math.abs(this.vq) > 0.05 || Math.abs(this.vh) > 0.05 * S || Math.abs(this.vphi) > 8 || Math.hypot(this.vpx, this.vpy) > 0.05 * S
      || faceMotion > 0.3 || this.speechEnv > 0.01 || this.micEnv > 0.01 || this.impulseCount > 0
      || this.current === 'dizzy' || this.current === 'laugh' || this.current === 'excited' || this.current === 'love');
  }
}

export function createMascotPhysics(options?: MascotPhysicsOptions) { return new MascotPhysics(options); }
