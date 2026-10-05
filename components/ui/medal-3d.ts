'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type MouseEvent, type PointerEvent, type RefObject } from 'react';

/**
 * Rank medal as a physical object (DESIGN-PASS-0.5.1 «Медали рангов — объём»).
 * Same constants as `MedalSpin` in ios/Sources/RewardArt.swift — change both together.
 */
export const MEDAL = {
  /** Below this side the medal is flat art with a float: no thickness, light, holo or gestures. */
  solidMin: 48,
  depth: 0.09,
  perspective: 4,
  tiltYaw: 16,
  tiltPitch: 12,
  /** Horizontal drag across the full medal width turns it this many degrees. */
  dragDegrees: 200,
  maxSpeed: 2000,
  /** Free spin decays as v·e^(−friction·t); per throw it is bent within [min, max] to land face-front. */
  friction: 2.4,
  minFriction: 1.5,
  maxFriction: 4.5,
  /** Slower than this the face-front spring ramps in over `ramp` seconds. */
  settleSpeed: 300,
  stiffness: 50,
  damping: 8.5,
  ramp: 0.4,
  /** A tap adds one decelerating turn; rank-up starts back-facing and makes 1.5 turns. */
  tapTurn: 360,
  entranceTurn: 540,
  step: 1 / 240,
} as const;

export type MedalSpin = { angle: number; velocity: number; target: number; friction: number; settling: number | null; age: number };

/** Picks the face-front angle a throw lands on and the friction that lands it there. */
export function releaseSpin(angle: number, velocity: number): MedalSpin {
  const speed = Math.max(-MEDAL.maxSpeed, Math.min(MEDAL.maxSpeed, velocity));
  let target = Math.round((angle + speed / MEDAL.friction) / 360) * 360;
  let friction: number = MEDAL.friction;
  if (Math.abs(speed) > MEDAL.settleSpeed) {
    const best = [target - 360, target, target + 360]
      .filter(face => Math.sign(face - angle) === Math.sign(speed))
      .map(face => ({ face, friction: speed / (face - angle) }))
      .filter(option => option.friction >= MEDAL.minFriction && option.friction <= MEDAL.maxFriction)
      .sort((a, b) => Math.abs(a.friction - MEDAL.friction) - Math.abs(b.friction - MEDAL.friction))[0];
    if (best) { target = best.face; friction = best.friction; }
  }
  return { angle, velocity: speed, target, friction, settling: null, age: 0 };
}

/** Advances a throw; returns true once it rests face-front (angle snapped to the target). */
export function stepSpin(spin: MedalSpin, dt: number) {
  for (let left = Math.min(dt, 0.1); left > 1e-6; left -= MEDAL.step) {
    const h = Math.min(MEDAL.step, left);
    if (spin.settling === null && Math.abs(spin.velocity) < MEDAL.settleSpeed) spin.settling = spin.age;
    let acceleration = -spin.friction * spin.velocity;
    if (spin.settling !== null) {
      const weight = Math.min(1, (spin.age - spin.settling) / MEDAL.ramp);
      acceleration += weight * (MEDAL.stiffness * (spin.target - spin.angle) - MEDAL.damping * spin.velocity);
    }
    spin.velocity += acceleration * h;
    spin.angle += spin.velocity * h;
    spin.age += h;
  }
  const rested = spin.settling !== null && Math.abs(spin.angle - spin.target) < 0.25 && Math.abs(spin.velocity) < 4;
  if (rested || spin.age > 4) { spin.angle = spin.target; spin.velocity = 0; return true; }
  return false;
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

/**
 * Pointer tilt, drag-spin with inertia, tap-turn and the rank-up entrance. Writes CSS variables on the
 * medal root; requestAnimationFrame runs only while a throw is in flight, idle motion stays in CSS.
 * Without `solid` (reduced motion) the medal never turns: only its highlight follows a mouse pointer.
 * `nested` (inside another button or link) keeps the tilt but leaves clicks and drags to the host.
 */
export function useMedal3D(ref: RefObject<HTMLElement | null>, { size, solid, responsive, nested, entrance, onPress, onGlint }: {
  size: number; solid: boolean; responsive: boolean; nested: boolean; entrance: boolean; onPress: (pressed: boolean) => void; onGlint: (delay?: number) => void;
}) {
  const live = useRef({ angle: 0, tiltX: 0, tiltY: 0, pitch: 0, spin: null as MedalSpin | null, drag: null as Drag | null, frame: 0, last: 0, clickGuard: false });
  const options = useRef({ size, solid, onGlint });
  options.current = { size, solid, onGlint };

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
    state.spin = null; state.angle = 0; state.tiltX = state.pitch;
    if (!element) return;
    paint();
    // Commit the normalised angle while transitions are still off, or 360° → 0° would unwind visibly.
    void element.offsetWidth;
    delete element.dataset.spinning;
    if (!state.drag && !state.pitch) delete element.dataset.active;
  }, [paint, ref]);

  const tick = useCallback((now: number) => {
    const state = live.current;
    const dt = Math.min(0.05, state.last ? (now - state.last) / 1000 : 1 / 60);
    state.last = now;
    if (!state.spin) { state.frame = 0; return; }
    const rested = stepSpin(state.spin, dt);
    state.angle = state.spin.angle;
    // Transitions are off mid-throw, so the pointer pitch eases here instead.
    state.tiltX += (state.pitch - state.tiltX) * (1 - Math.exp(-dt * 8));
    paint();
    if (rested) { state.frame = 0; settle(); return; }
    state.frame = requestAnimationFrame(tick);
  }, [paint, settle]);

  const throwSpin = useCallback((velocity: number) => {
    const element = ref.current; const state = live.current;
    if (!element) return;
    element.dataset.spinning = 'true'; element.dataset.active = 'true';
    state.spin = releaseSpin(state.angle, velocity);
    state.last = 0;
    if (!state.frame) state.frame = requestAnimationFrame(tick);
  }, [ref, tick]);

  const stopFrame = useCallback(() => { const state = live.current; if (state.frame) cancelAnimationFrame(state.frame); state.frame = 0; }, []);
  useEffect(() => stopFrame, [stopFrame]);
  // Reduced motion switched on mid-throw: drop it and rest face-front.
  useEffect(() => { if (!solid && live.current.spin) { stopFrame(); settle(); } }, [solid, settle, stopFrame]);

  useLayoutEffect(() => {
    if (!entrance || !solid) return;
    // Starts back-facing and lands face-front after 1.5 decelerating turns; a flash crosses the face on the way.
    live.current.angle = -MEDAL.entranceTurn;
    paint();
    throwSpin(MEDAL.entranceTurn * MEDAL.friction);
    options.current.onGlint(620);
  }, [entrance, solid, paint, throwSpin]);

  const aim = (event: PointerEvent<HTMLElement>) => {
    const element = ref.current; if (!element) return;
    const box = element.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    const state = live.current;
    state.pitch = -y * 2 * MEDAL.tiltPitch;
    if (state.spin || state.drag?.moved) return;
    state.tiltY = x * 2 * MEDAL.tiltYaw; state.tiltX = state.pitch;
    element.dataset.active = 'true';
    paint();
  };
  const rest = () => {
    const element = ref.current; const state = live.current;
    if (state.drag) return;
    state.pitch = 0;
    if (state.spin) return;
    state.tiltX = 0; state.tiltY = 0;
    paint();
    if (element) delete element.dataset.active;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!responsive || event.button !== 0) return;
    if (event.pointerType !== 'mouse') aim(event);
    if (!nested && options.current.solid) live.current.drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, a0: 0, moved: false, samples: [] };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!responsive) return;
    const state = live.current; const drag = state.drag; const element = ref.current;
    if (!drag || drag.id !== event.pointerId) { if (event.pointerType === 'mouse') aim(event); return; }
    if (!element) return;
    const dx = event.clientX - drag.x0, dy = event.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy)) {
        drag.moved = true;
        // A caught throw keeps its angle; the hover yaw folds into the spin so nothing jumps.
        stopFrame();
        state.angle += state.tiltY; state.tiltY = 0; state.spin = null;
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
    if (event.pointerType !== 'mouse') state.pitch = 0;
    if (!drag.moved) { if (event.pointerType !== 'mouse') rest(); return; }
    if (element) delete element.dataset.dragging;
    const first = drag.samples[0], last = drag.samples[drag.samples.length - 1];
    const held = !last || event.timeStamp - last[0] > 70;
    const velocity = held || !first || last[0] === first[0] ? 0 : (last[1] - first[1]) / ((last[0] - first[0]) / 1000);
    // The click that follows a mouse drag is not a tap; touch drags fire none, so the guard expires.
    state.clickGuard = true;
    setTimeout(() => { live.current.clickGuard = false; }, 0);
    throwSpin(event.type === 'pointercancel' ? 0 : velocity);
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const state = live.current;
    if (state.clickGuard) { state.clickGuard = false; return; }
    if (!responsive || nested) return;
    // Keyboard activation and reduced motion get the highlight only, never a turn.
    if (!options.current.solid || event.detail === 0) { options.current.onGlint(); return; }
    const box = ref.current?.getBoundingClientRect();
    const direction = box && event.clientX < box.left + box.width / 2 ? -1 : 1;
    state.angle += state.tiltY; state.tiltY = 0;
    throwSpin((state.spin?.velocity ?? 0) + direction * MEDAL.tapTurn * MEDAL.friction);
  };

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onPointerLeave: rest, onClick };
}
