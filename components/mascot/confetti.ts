'use client';
// Celebration confetti (DESIGN-SYSTEM "Celebrations"): lime / lavender / cyan / pink, 120 particles, 1.6 s.
// One fixed full-viewport <canvas> is created on demand and removed when the burst ends.
// Skipped with Reduced Motion or a hidden page. Particle buffers are preallocated.
import { useCallback } from 'react';

export const CONFETTI_COLORS = ['#DAF163', '#BBB2F5', '#3FD5EA', '#FF8FB1'] as const;
export interface ConfettiOptions {
  /** Particles in this burst (default 120). */
  count?: number;
  /** Lifetime in seconds (default 1.6). */
  duration?: number;
  /** Launch speed in px/s (default 760). */
  power?: number;
  colors?: readonly string[];
}
export type ConfettiOrigin = { x: number; y: number } | Element | null | undefined;

const MAX = 480;
const px = new Float32Array(MAX), py = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX);
const angle = new Float32Array(MAX), spin = new Float32Array(MAX), size = new Float32Array(MAX), born = new Float32Array(MAX);
const life = new Float32Array(MAX), wobble = new Float32Array(MAX), shape = new Uint8Array(MAX), color = new Uint8Array(MAX);
let palette: readonly string[] = CONFETTI_COLORS;
let count = 0;
let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
let frame = 0;
let clock = 0;
let lastNow = 0;
let ratio = 1;

function reducedMotion() {
  return typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible';
}
function ensureCanvas() {
  if (canvas && context) return true;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.mascotConfetti = 'true';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2147483000' });
  context = canvas.getContext('2d');
  if (!context) { canvas = null; return false; }
  document.body.appendChild(canvas);
  resize();
  window.addEventListener('resize', resize);
  return true;
}
function resize() {
  if (!canvas || !context) return;
  ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
}
function teardown() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0; count = 0; lastNow = 0;
  window.removeEventListener('resize', resize);
  canvas?.remove();
  canvas = null; context = null;
}
function tick(now: number) {
  frame = 0;
  if (!context || !canvas) return;
  const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 1 / 60;
  lastNow = now; clock += dt;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  let alive = 0;
  for (let i = 0; i < count; i++) {
    const age = clock - born[i];
    if (age >= life[i]) continue;
    // Gravity, air drag and a little flutter.
    vy[i] += 980 * dt;
    vx[i] *= 1 - 1.6 * dt; vy[i] *= 1 - 1.1 * dt;
    px[i] += (vx[i] + Math.sin(clock * 9 + wobble[i]) * 28) * dt;
    py[i] += vy[i] * dt;
    angle[i] += spin[i] * dt;
    const fade = Math.min(1, (life[i] - age) / 0.45);
    context.globalAlpha = fade;
    context.fillStyle = palette[color[i] % palette.length];
    const s = size[i];
    if (shape[i] === 0) {
      context.save(); context.translate(px[i], py[i]); context.rotate(angle[i]);
      context.scale(1, Math.abs(Math.cos(clock * 7 + wobble[i])) * 0.8 + 0.2);
      context.fillRect(-s, -s * 0.45, s * 2, s * 0.9);
      context.restore();
    } else {
      context.beginPath(); context.arc(px[i], py[i], s * 0.62, 0, Math.PI * 2); context.fill();
    }
    alive++;
  }
  context.globalAlpha = 1;
  if (alive) frame = requestAnimationFrame(tick);
  else teardown();
}

/** Fires one burst from a point (client px) or from the centre of an element. Returns false when skipped. */
export function fireConfetti(origin?: ConfettiOrigin, options: ConfettiOptions = {}): boolean {
  if (typeof window === 'undefined' || reducedMotion() || !ensureCanvas()) return false;
  let x = window.innerWidth / 2, y = window.innerHeight * 0.4;
  if (origin && 'getBoundingClientRect' in origin) {
    const box = origin.getBoundingClientRect();
    x = box.left + box.width / 2; y = box.top + box.height * 0.2; // from the top of the head
  } else if (origin && Number.isFinite((origin as { x: number }).x)) {
    x = (origin as { x: number }).x; y = (origin as { y: number }).y;
  }
  palette = options.colors?.length ? options.colors : CONFETTI_COLORS;
  const total = Math.min(options.count ?? 120, MAX);
  const duration = options.duration ?? 1.6;
  const power = options.power ?? 760;
  // Compact the pool: keep live particles, then append the new burst.
  let kept = 0;
  for (let i = 0; i < count; i++) {
    if (clock - born[i] >= life[i]) continue;
    px[kept] = px[i]; py[kept] = py[i]; vx[kept] = vx[i]; vy[kept] = vy[i]; angle[kept] = angle[i]; spin[kept] = spin[i];
    size[kept] = size[i]; born[kept] = born[i]; life[kept] = life[i]; wobble[kept] = wobble[i]; shape[kept] = shape[i]; color[kept] = color[i];
    kept++;
  }
  count = kept;
  for (let n = 0; n < total && count < MAX; n++, count++) {
    const i = count;
    // A fountain: mostly upward, fanned ±70°.
    const direction = -Math.PI / 2 + (Math.random() - 0.5) * 2.45;
    const speed = power * (0.45 + Math.random() * 0.65);
    px[i] = x + (Math.random() - 0.5) * 24; py[i] = y + (Math.random() - 0.5) * 12;
    vx[i] = Math.cos(direction) * speed; vy[i] = Math.sin(direction) * speed;
    angle[i] = Math.random() * Math.PI * 2; spin[i] = (Math.random() - 0.5) * 16;
    size[i] = 3.2 + Math.random() * 3.8; born[i] = clock;
    life[i] = duration * (0.7 + Math.random() * 0.3); wobble[i] = Math.random() * 10;
    shape[i] = Math.random() < 0.72 ? 0 : 1; color[i] = n % palette.length;
  }
  if (!frame) frame = requestAnimationFrame(tick);
  return true;
}

/**
 * Hook form: returns a stable `fire(origin?, options?)`. A burst lives on a fixed overlay and removes
 * itself after ~1.6 s, so it may outlive the caller (e.g. a sheet that closes as the confetti falls).
 */
export function useConfetti() {
  return useCallback((origin?: ConfettiOrigin, options?: ConfettiOptions) => fireConfetti(origin, options), []);
}
