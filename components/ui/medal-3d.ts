'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent, type PointerEvent, type RefObject } from 'react';

/**
 * Rank medal as a physical object (DESIGN-PASS-0.5.1 «Медали рангов — объём»), turning slowly and smoothly
 * (PASS-0.5.3 §8). Every turn is an eased curve with a known end, so nothing whips round or creeps for long.
 * Mirrored in ios/Sources/RankMedalSolid.swift MedalTuning — change both together.
 */
export const MEDAL = {
  /** Below this side the medal is flat art with a float and a glint: no thickness, light, holo or gestures. */
  solidMin: 48,
  depth: 0.09,
  perspective: 4,
  tiltYaw: 16,
  tiltPitch: 12,
  /** Horizontal drag across the full medal width turns it this many degrees. */
  dragDegrees: 200,
  /** Tap: one turn over `tapSeconds` (ease-in-out cubic) that runs `tapSettle`° past face-front and springs back. */
  tapTurn: 360,
  tapSeconds: 2.4,
  tapSettle: 1.5,
  /** The glint crosses the face at this share of a tap turn (it faces front again). */
  tapGlint: 0.82,
  /** Rank-up: from −720° to face-front over `entranceSeconds` (ease-out quint), glint at `entranceGlint` of it. */
  entranceTurn: 720,
  entranceSeconds: 3.6,
  entranceGlint: 0.6,
  /**
   * Drag release, capped at `maxSpeed` °/s. From `throwMinSpeed` up it decays as an ease-out cubic that starts at the
   * release speed (no jump) and stops exactly on a face ahead: of the faces whose landing time 3·distance/speed lies in
   * [throwMinSeconds, throwMaxSeconds], the one nearest `throwSeconds`. Slower releases, or no face in range, spring.
   */
  maxSpeed: 720,
  throwMinSpeed: 120,
  throwMinSeconds: 0.9,
  throwSeconds: 2.4,
  throwMaxSeconds: 4.5,
  /** The face spring (slow releases and the tap settle): target = the face nearest angle + speed·coast. */
  coast: 0.4,
  stiffness: 20,
  damping: 8,
  springMaxSeconds: 3,
  /**
   * Showcase: a visible idle hero medal (≥ `showcaseMin` px, untouched for `showcaseIdle` s) turns once by
   * `showcaseTurn`° over `showcaseSeconds` (ease-in-out sine), starts `showcaseEveryMin`–`showcaseEveryMax` s apart,
   * alternating direction; the glint crosses at `showcaseGlint` of the turn.
   */
  showcaseMin: 64,
  showcaseIdle: 8,
  showcaseEveryMin: 11,
  showcaseEveryMax: 16,
  showcaseTurn: 360,
  showcaseSeconds: 3.4,
  showcaseGlint: 0.86,
  /** Spring integration step. */
  step: 1 / 240,
} as const;

export type MedalEase = 'inOutCubic' | 'outQuint' | 'inOutSine' | 'outCubic';
/** Progress (0→1) and its slope d/ds for each curve. */
export const MEDAL_EASE: Record<MedalEase, { at: (s: number) => number; slope: (s: number) => number }> = {
  inOutCubic: { at: s => s < 0.5 ? 4 * s ** 3 : 1 - (2 - 2 * s) ** 3 / 2, slope: s => s < 0.5 ? 12 * s ** 2 : 3 * (2 - 2 * s) ** 2 },
  outQuint: { at: s => 1 - (1 - s) ** 5, slope: s => 5 * (1 - s) ** 4 },
  inOutSine: { at: s => (1 - Math.cos(Math.PI * s)) / 2, slope: s => Math.PI * Math.sin(Math.PI * s) / 2 },
  outCubic: { at: s => 1 - (1 - s) ** 3, slope: s => 3 * (1 - s) ** 2 },
};

/**
 * One eased turn from `from` by `delta` over `seconds`. A turn that takes over a moving medal starts at `v0` °/s:
 * an ease-out cubic carries v0·T/3 of the distance, the eased curve the rest — position and speed stay continuous.
 * It rests on `face`; when `delta` ends past it (the tap settle) a spring brings it back.
 */
export type MedalTurn = { kind: 'turn'; from: number; delta: number; seconds: number; ease: MedalEase; v0: number; elapsed: number; face: number; glintAt: number | null };
export type MedalSpring = { kind: 'spring'; target: number; velocity: number; age: number };
export type MedalMotion = MedalTurn | MedalSpring;

const nearestFace = (angle: number) => Math.round(angle / 360) * 360 || 0;
/** The face a motion rests on (the nearest one when there is no motion). */
export const motionFace = (motion: MedalMotion | null, angle: number) => !motion ? nearestFace(angle) : motion.kind === 'turn' ? motion.face : motion.target;

/** Angle and speed (°/s) of a turn `t` seconds in. */
export function turnAt(turn: MedalTurn, t: number) {
  const T = turn.seconds, s = Math.min(1, Math.max(0, t / T));
  const carry = turn.v0 * T / 3;
  const ease = MEDAL_EASE[turn.ease];
  return {
    angle: turn.from + carry * MEDAL_EASE.outCubic.at(s) + (turn.delta - carry) * ease.at(s),
    velocity: s >= 1 ? 0 : turn.v0 * (1 - s) ** 2 + (turn.delta - carry) * ease.slope(s) / T,
  };
}

/**
 * A tap at rest turns once towards the tapped side (`side`). On a moving medal it adds one turn in the direction it
 * already moves, keeping its speed; at most one turn is queued (a further tap while more than a turn remains is ignored).
 */
export function tapTurn(angle: number, velocity: number, side: 1 | -1, current: MedalMotion | null): MedalTurn | null {
  const moving = !!current && Math.abs(velocity) > 20;
  const direction = moving ? Math.sign(velocity) : side;
  const base = motionFace(current, angle);
  if (moving && Math.abs(base - angle) > MEDAL.tapTurn) return null;
  const face = base + direction * MEDAL.tapTurn;
  const delta = face + direction * MEDAL.tapSettle - angle;
  const v0 = moving ? velocity : 0;
  // A fast medal would overshoot inside the eased curve: then the whole rest is its own ease-out (still lands at rest).
  const seconds = v0 && Math.abs(v0) * MEDAL.tapSeconds / 3 > Math.abs(delta) ? 3 * delta / v0 : MEDAL.tapSeconds;
  return { kind: 'turn', from: angle, delta, seconds, ease: 'inOutCubic', v0, elapsed: 0, face, glintAt: MEDAL.tapGlint };
}

/** Rank-up: two turns from behind, decelerating onto the face. */
export function entranceTurn(): MedalTurn {
  return { kind: 'turn', from: -MEDAL.entranceTurn, delta: MEDAL.entranceTurn, seconds: MEDAL.entranceSeconds, ease: 'outQuint', v0: 0, elapsed: 0, face: 0, glintAt: MEDAL.entranceGlint };
}

/** The idle showcase: one slow turn from rest. */
export function showcaseTurn(angle: number, direction: 1 | -1): MedalTurn {
  const face = nearestFace(angle) + direction * MEDAL.showcaseTurn;
  return { kind: 'turn', from: angle, delta: face - angle, seconds: MEDAL.showcaseSeconds, ease: 'inOutSine', v0: 0, elapsed: 0, face, glintAt: MEDAL.showcaseGlint };
}

/** What a drag release does: a decelerating turn onto a face ahead, or the face spring for a slow release. */
export function releaseThrow(angle: number, velocity: number): MedalMotion {
  const speed = Math.max(-MEDAL.maxSpeed, Math.min(MEDAL.maxSpeed, velocity));
  if (Math.abs(speed) >= MEDAL.throwMinSpeed) {
    const direction = Math.sign(speed);
    let first = direction > 0 ? Math.ceil(angle / 360) * 360 : Math.floor(angle / 360) * 360;
    if (Math.abs(first - angle) < 1e-6) first += direction * 360;
    let best: { face: number; seconds: number } | null = null;
    for (let turn = 0; turn < 3; turn++) {
      const face = first + direction * 360 * turn;
      const seconds = 3 * Math.abs(face - angle) / Math.abs(speed);
      if (seconds < MEDAL.throwMinSeconds || seconds > MEDAL.throwMaxSeconds) continue;
      if (!best || Math.abs(seconds - MEDAL.throwSeconds) < Math.abs(best.seconds - MEDAL.throwSeconds)) best = { face, seconds };
    }
    if (best) return { kind: 'turn', from: angle, delta: best.face - angle, seconds: best.seconds, ease: 'outCubic', v0: 0, elapsed: 0, face: best.face, glintAt: null };
  }
  return { kind: 'spring', target: nearestFace(angle + speed * MEDAL.coast), velocity: speed, age: 0 };
}

/**
 * Advances a motion by `dt` seconds (mutating it). Returns the angle and speed, the motion that continues (`null` once
 * it rests, with the angle exactly on its face) and whether the glint is due in this step.
 */
export function stepMotion(motion: MedalMotion, angle: number, dt: number): { angle: number; velocity: number; next: MedalMotion | null; glint: boolean } {
  if (motion.kind === 'turn') {
    const before = motion.elapsed;
    motion.elapsed += dt;
    const glint = motion.glintAt !== null && before < motion.glintAt * motion.seconds && motion.elapsed >= motion.glintAt * motion.seconds;
    if (motion.elapsed < motion.seconds) return { ...turnAt(motion, motion.elapsed), next: motion, glint };
    const end = motion.from + motion.delta;
    if (Math.abs(end - motion.face) < 1e-6) return { angle: motion.face, velocity: 0, next: null, glint };
    return { angle: end, velocity: 0, next: { kind: 'spring', target: motion.face, velocity: 0, age: 0 }, glint };
  }
  let velocity = motion.velocity;
  for (let left = dt; left > 1e-9; left -= MEDAL.step) {
    const h = Math.min(MEDAL.step, left);
    velocity += (MEDAL.stiffness * (motion.target - angle) - MEDAL.damping * velocity) * h;
    angle += velocity * h;
  }
  motion.velocity = velocity;
  motion.age += dt;
  if ((Math.abs(angle - motion.target) < 0.05 && Math.abs(velocity) < 1) || motion.age > MEDAL.springMaxSeconds) return { angle: motion.target, velocity: 0, next: null, glint: false };
  return { angle, velocity, next: motion, glint: false };
}

/** Light, foil, floor shadow and edge glint for a yaw/pitch: reflections move against the turn. */
export function medalLight(yaw: number, pitch: number, size: number) {
  const s = Math.sin(yaw * Math.PI / 180), c = Math.cos(yaw * Math.PI / 180), p = Math.sin(pitch * Math.PI / 180);
  return {
    glareX: -s * size * 0.45, glareY: p * size * 0.45,
    holoX: -s * size * 0.6, holoY: p * size * 0.5,
    shadowX: -s * size * 0.07, shadowW: 0.62 + 0.38 * Math.abs(c),
    edge: Math.min(1, Math.abs(s) * 1.15) ** 2,
    /** Thickness planes fade within ~10° of edge-on, where the side band carries the rim. */
    faceOn: Math.min(1, Math.abs(c) * 5),
  };
}

/**
 * Thickness layers between the face (+depth/2) and the back (−depth/2), about 0.6 px apart so no step shows
 * (8 at 64 px, 16 at 104 px, 20 from 112 px). `mix` blends rim-dark → rim-light: dark at both faces, lighter mid-way.
 */
export function medalEdges(size: number) {
  const depth = size * MEDAL.depth;
  const count = Math.max(8, Math.min(20, Math.round(depth / 0.6)));
  return {
    depth, layers: Array.from({ length: count }, (_, index) => {
      const t = (index + 1) / (count + 1);
      return { z: depth / 2 - depth * t, mix: 0.08 + 0.42 * Math.sin(Math.PI * t) ** 1.5 };
    }),
  };
}

const reducedQuery = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (onChange: () => void) => {
  const query = window.matchMedia(reducedQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(reducedQuery).matches, () => false);
}

type Drag = { id: number; x0: number; y0: number; a0: number; moved: boolean; samples: Array<[number, number]> };
const between = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Pointer tilt, drag-spin, tap-turn, the rank-up entrance and the idle showcase. Writes CSS variables on the medal
 * root; requestAnimationFrame runs only while a motion is in flight, idle motion stays in CSS.
 * Without `solid` (reduced motion) the medal never turns: only its highlight follows a mouse pointer.
 * `nested` (inside another button or link) keeps the tilt but leaves clicks and drags to the host.
 * `showcase` (a visible, uncovered hero medal) lets it turn by itself now and then. `sleeping()` is true while the
 * medal is offscreen, the page hidden or the shell covered: a motion in flight then comes to rest at once.
 */
export function useMedal3D(ref: RefObject<HTMLElement | null>, { size, solid, responsive, nested, entrance, showcase, sleeping, onPress, onGlint }: {
  size: number; solid: boolean; responsive: boolean; nested: boolean; entrance: boolean; showcase: boolean; sleeping: () => boolean;
  onPress: (pressed: boolean) => void; onGlint: (delay?: number) => void;
}) {
  const live = useRef({ angle: 0, velocity: 0, tiltX: 0, tiltY: 0, pitch: 0, motion: null as MedalMotion | null, drag: null as Drag | null,
    frame: 0, last: 0, clickGuard: false, touched: -Infinity, showcaseDirection: -1 as 1 | -1 });
  const options = useRef({ size, solid, sleeping, onGlint });
  options.current = { size, solid, sleeping, onGlint };

  const paint = useCallback(() => {
    const element = ref.current; if (!element) return;
    const state = live.current;
    const light = medalLight(state.tiltY + state.angle, state.tiltX, options.current.size);
    const style = element.style;
    style.setProperty('--tilt-x', `${state.tiltX.toFixed(2)}deg`);
    style.setProperty('--tilt-y', `${state.tiltY.toFixed(2)}deg`);
    style.setProperty('--spin', `${state.angle.toFixed(2)}deg`);
    style.setProperty('--glare-x', `${light.glareX.toFixed(1)}px`);
    style.setProperty('--glare-y', `${light.glareY.toFixed(1)}px`);
    style.setProperty('--holo-x', `${light.holoX.toFixed(1)}px`);
    style.setProperty('--holo-y', `${light.holoY.toFixed(1)}px`);
    style.setProperty('--shadow-x', `${light.shadowX.toFixed(1)}px`);
    style.setProperty('--shadow-w', light.shadowW.toFixed(3));
    style.setProperty('--edge-glint', light.edge.toFixed(3));
    style.setProperty('--face-on', light.faceOn.toFixed(3));
  }, [ref]);

  const settle = useCallback(() => {
    const element = ref.current; const state = live.current;
    state.motion = null; state.angle = 0; state.velocity = 0; state.tiltX = state.pitch;
    if (!element) return;
    paint();
    // Commit the normalised angle while transitions are still off, or 360° → 0° would unwind visibly.
    void element.offsetWidth;
    delete element.dataset.spinning;
    if (!state.drag && !state.pitch) delete element.dataset.active;
  }, [paint, ref]);

  const stopFrame = useCallback(() => { const state = live.current; if (state.frame) cancelAnimationFrame(state.frame); state.frame = 0; }, []);

  /** Ends a motion in flight on its face at once (covered, offscreen, reduced motion, unmount). */
  const finish = useCallback(() => {
    const state = live.current;
    stopFrame();
    if (!state.motion) return;
    state.angle = motionFace(state.motion, state.angle);
    settle();
  }, [settle, stopFrame]);

  const tick = useCallback((now: number) => {
    const state = live.current;
    const dt = Math.min(0.05, state.last ? (now - state.last) / 1000 : 1 / 60);
    state.last = now;
    if (!state.motion) { state.frame = 0; return; }
    if (options.current.sleeping()) { state.frame = 0; finish(); return; }
    const step = stepMotion(state.motion, state.angle, dt);
    state.angle = step.angle; state.velocity = step.velocity; state.motion = step.next;
    if (step.glint) options.current.onGlint(0);
    // Transitions are off mid-turn, so the pointer pitch eases here instead.
    state.tiltX += (state.pitch - state.tiltX) * (1 - Math.exp(-dt * 8));
    paint();
    if (!state.motion) { state.frame = 0; settle(); return; }
    state.frame = requestAnimationFrame(tick);
  }, [finish, paint, settle]);

  const run = useCallback((motion: MedalMotion) => {
    const element = ref.current; const state = live.current;
    if (!element) return;
    element.dataset.spinning = 'true'; element.dataset.active = 'true';
    state.motion = motion;
    state.last = 0;
    if (!state.frame) state.frame = requestAnimationFrame(tick);
  }, [ref, tick]);

  useEffect(() => stopFrame, [stopFrame]);
  // Reduced motion switched on mid-turn: drop it and rest face-front.
  useEffect(() => { if (!solid && live.current.motion) finish(); }, [solid, finish]);

  useLayoutEffect(() => {
    if (!entrance || !solid) return;
    // Rank-up: two decelerating turns from behind onto the face; the glint crosses as it lands.
    const turn = entranceTurn();
    live.current.angle = turn.from;
    paint();
    run(turn);
  }, [entrance, solid, paint, run]);

  // Showcase: now and then an idle hero medal turns once by itself. Any touch postpones it by `showcaseIdle`.
  useEffect(() => {
    if (!showcase || !solid) return;
    let timer = 0;
    const schedule = (seconds: number) => { timer = window.setTimeout(attempt, seconds * 1000); };
    function attempt() {
      const state = live.current; const element = ref.current;
      const idle = (performance.now() - state.touched) / 1000;
      if (state.motion || state.drag || element?.dataset.active === 'true' || idle < MEDAL.showcaseIdle) {
        schedule(Math.max(1, MEDAL.showcaseIdle - idle) + between(0, 2));
        return;
      }
      if (!options.current.sleeping()) {
        state.showcaseDirection = state.showcaseDirection === 1 ? -1 : 1;
        run(showcaseTurn(state.angle, state.showcaseDirection));
      }
      schedule(between(MEDAL.showcaseEveryMin, MEDAL.showcaseEveryMax));
    }
    schedule(between(MEDAL.showcaseEveryMin, MEDAL.showcaseEveryMax));
    return () => window.clearTimeout(timer);
  }, [showcase, solid, ref, run]);

  const touch = () => { live.current.touched = performance.now(); };
  const aim = (event: PointerEvent<HTMLElement>) => {
    const element = ref.current; if (!element) return;
    const box = element.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    const state = live.current;
    state.pitch = -y * 2 * MEDAL.tiltPitch;
    if (state.motion || state.drag?.moved) return;
    state.tiltY = x * 2 * MEDAL.tiltYaw; state.tiltX = state.pitch;
    element.dataset.active = 'true';
    paint();
  };
  const rest = () => {
    const element = ref.current; const state = live.current;
    if (state.drag) return;
    state.pitch = 0;
    if (state.motion) return;
    state.tiltX = 0; state.tiltY = 0;
    paint();
    if (element) delete element.dataset.active;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!responsive || event.button !== 0) return;
    touch();
    if (event.pointerType !== 'mouse') aim(event);
    if (!nested && options.current.solid) live.current.drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, a0: 0, moved: false, samples: [] };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!responsive) return;
    touch();
    const state = live.current; const drag = state.drag; const element = ref.current;
    if (!drag || drag.id !== event.pointerId) { if (event.pointerType === 'mouse') aim(event); return; }
    if (!element) return;
    const dx = event.clientX - drag.x0, dy = event.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy)) {
        drag.moved = true;
        // A caught turn keeps its angle; the hover yaw folds into the spin so nothing jumps.
        stopFrame();
        state.angle += state.tiltY; state.tiltY = 0; state.motion = null; state.velocity = 0;
        drag.a0 = state.angle; drag.x0 = event.clientX;
        element.dataset.spinning = 'true'; element.dataset.active = 'true'; element.dataset.dragging = 'true';
        try { element.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
        onPress(false);
      } else if (Math.abs(dy) > 10) { state.drag = null; if (event.pointerType !== 'mouse') rest(); }
      return;
    }
    state.angle = drag.a0 + (event.clientX - drag.x0) * MEDAL.dragDegrees / options.current.size;
    drag.samples.push([event.timeStamp, state.angle]);
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0][0] > 90) drag.samples.shift();
    paint();
  };
  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const state = live.current; const drag = state.drag; const element = ref.current;
    if (!drag || drag.id !== event.pointerId) return;
    state.drag = null;
    touch();
    if (event.pointerType !== 'mouse') state.pitch = 0;
    if (!drag.moved) { if (event.pointerType !== 'mouse') rest(); return; }
    if (element) delete element.dataset.dragging;
    const first = drag.samples[0], last = drag.samples[drag.samples.length - 1];
    const held = !last || event.timeStamp - last[0] > 70;
    const velocity = held || !first || last[0] === first[0] ? 0 : (last[1] - first[1]) / ((last[0] - first[0]) / 1000);
    // The click that follows a mouse drag is not a tap; touch drags fire none, so the guard expires.
    state.clickGuard = true;
    setTimeout(() => { live.current.clickGuard = false; }, 0);
    run(releaseThrow(state.angle, event.type === 'pointercancel' ? 0 : velocity));
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const state = live.current;
    if (state.clickGuard) { state.clickGuard = false; return; }
    if (!responsive || nested) return;
    touch();
    // Keyboard activation and reduced motion get the highlight only, never a turn.
    if (!options.current.solid || event.detail === 0) { options.current.onGlint(); return; }
    const box = ref.current?.getBoundingClientRect();
    const side = box && event.clientX < box.left + box.width / 2 ? -1 : 1;
    state.angle += state.tiltY; state.tiltY = 0;
    const turn = tapTurn(state.angle, state.velocity, side, state.motion);
    if (turn) run(turn); else paint();
  };

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onPointerLeave: rest, onClick };
}
