/*
 * The PC chubrik on its stage (planning/v05/PASS-0.5.4.md §2), pure geometry and motion: where it may stand, how a throw glides
 * and bounces off the screen edges, the release speed of a drag, where its card, recording pill and menu open. Pixel units of
 * the stage (the work area of one display); the point is the chubrik's centre. No DOM: tests/pet-motion.test.ts runs it.
 */

export const PET = {
  /** The chubrik's side (px). Its glass body is about 0.8 of it; the rest of the canvas is transparent. */
  size: 112,
  /** The body's half-width as a share of the side: what has to stay on screen. */
  body: 0.4,
  /** Kept between the body and the stage edge. */
  margin: 6,
  /** A press becomes a drag after this many px. */
  dragThreshold: 4,
  /** The glide slows as e^(−friction·t). */
  friction: 3.4,
  /** Share of the speed kept by a bounce off an edge. */
  restitution: 0.45,
  /** Release speed cap (px/s). */
  maxThrow: 2600,
  /** The glide ends below this speed (px/s). */
  stopSpeed: 22,
  /** The release speed comes from the pointer samples of this window (ms); a pointer held still longer gives none. */
  sampleMs: 90,
  heldMs: 70,
  /** Between the body and its card / pill (px). */
  gap: 8,
  /** The card's tail stays this far from the card's corners (px). */
  tailInset: 30,
  storageKey: 'smooth-talk:pet-position',
} as const;

export type Point = { x: number; y: number };
export type Area = { width: number; height: number };
export type Size = { width: number; height: number };
export type Glide = { x: number; y: number; vx: number; vy: number };
export type Side = 'above' | 'below';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** How far the centre stays from each edge. */
export function petReach(size = PET.size) { return size * PET.body + PET.margin; }

/** The nearest place where the whole body is on the stage (a stage smaller than the body: its middle). */
export function clampPet(point: Point, area: Area, size = PET.size): Point {
  const reach = petReach(size);
  const fit = (value: number, span: number) => span <= reach * 2 ? span / 2 : clamp(value, reach, span - reach);
  return { x: fit(finite(point.x) ? point.x : area.width, area.width), y: fit(finite(point.y) ? point.y : area.height, area.height) };
}

/** First appearance: the bottom-right corner, where the 0.5.3 overlay lived. */
export function defaultPet(area: Area, size = PET.size): Point {
  return clampPet({ x: area.width - size / 2 - 16, y: area.height - size / 2 - 10 }, area, size);
}

/** Remembered as fractions of the stage, so another resolution or display keeps the same corner. */
export function petFractions(point: Point, area: Area) {
  return { fx: area.width > 0 ? Math.round(point.x / area.width * 10_000) / 10_000 : 1, fy: area.height > 0 ? Math.round(point.y / area.height * 10_000) / 10_000 : 1 };
}

export function restorePet(saved: unknown, area: Area, size = PET.size): Point {
  const value = saved && typeof saved === 'object' ? saved as { fx?: unknown; fy?: unknown } : null;
  if (!value || !finite(value.fx) || !finite(value.fy) || value.fx < 0 || value.fx > 1 || value.fy < 0 || value.fy > 1) return defaultPet(area, size);
  return clampPet({ x: value.fx * area.width, y: value.fy * area.height }, area, size);
}

/** Speed (px/s) at release from [time ms, x, y] samples, capped; zero when the pointer rested before letting go. */
export function releaseSpeed(samples: ReadonlyArray<readonly [number, number, number]>, releasedAt: number): Point {
  const last = samples[samples.length - 1];
  if (!last || releasedAt - last[0] > PET.heldMs) return { x: 0, y: 0 };
  const first = samples.find(sample => last[0] - sample[0] <= PET.sampleMs) ?? last;
  const seconds = (last[0] - first[0]) / 1000;
  if (seconds <= 0) return { x: 0, y: 0 };
  let x = (last[1] - first[1]) / seconds, y = (last[2] - first[2]) / seconds;
  const speed = Math.hypot(x, y);
  if (speed > PET.maxThrow) { x *= PET.maxThrow / speed; y *= PET.maxThrow / speed; }
  return { x, y };
}

/**
 * One step of a throw: it glides, slows down and bounces softly off the edges (mutates `state`). Returns which edges it hit
 * this step (the caller kicks the jelly) and whether it came to rest.
 */
export function glideStep(state: Glide, dt: number, area: Area, size = PET.size): { bounced: boolean; done: boolean } {
  const step = clamp(finite(dt) ? dt : 0, 0, 0.05);
  const decay = Math.exp(-PET.friction * step);
  state.vx *= decay; state.vy *= decay;
  state.x += state.vx * step; state.y += state.vy * step;
  const reach = petReach(size);
  let bounced = false;
  if (area.width > reach * 2) {
    if (state.x < reach) { state.x = reach + (reach - state.x) * PET.restitution; state.vx = Math.abs(state.vx) * PET.restitution; bounced = true; }
    else if (state.x > area.width - reach) { state.x = area.width - reach - (state.x - area.width + reach) * PET.restitution; state.vx = -Math.abs(state.vx) * PET.restitution; bounced = true; }
  } else { state.x = area.width / 2; state.vx = 0; }
  if (area.height > reach * 2) {
    if (state.y < reach) { state.y = reach + (reach - state.y) * PET.restitution; state.vy = Math.abs(state.vy) * PET.restitution; bounced = true; }
    else if (state.y > area.height - reach) { state.y = area.height - reach - (state.y - area.height + reach) * PET.restitution; state.vy = -Math.abs(state.vy) * PET.restitution; bounced = true; }
  } else { state.y = area.height / 2; state.vy = 0; }
  const done = Math.hypot(state.vx, state.vy) < PET.stopSpeed;
  if (done) { state.vx = 0; state.vy = 0; }
  return { bounced, done };
}

/**
 * Where a card (or the recording pill) opens: centred over the chubrik and kept on the stage, above it when it fits (else
 * below; else on the roomier side, scrolling within `maxHeight`). `previous` keeps the current side while it still fits, so a
 * drag along the boundary does not flicker. `tailX` is where the tail points at the chubrik, from the card's left edge.
 */
export function placeCard(pet: Point, card: Size, area: Area, previous: Side | null = null, size = PET.size):
  { x: number; y: number; side: Side; tailX: number; maxHeight: number } {
  const half = size * PET.body;
  const width = Math.min(card.width, Math.max(0, area.width - PET.margin * 2));
  const x = clamp(pet.x - width / 2, PET.margin, Math.max(PET.margin, area.width - PET.margin - width));
  const above = pet.y - half - PET.gap - PET.margin;
  const below = area.height - (pet.y + half + PET.gap) - PET.margin;
  const fits = (side: Side) => (side === 'above' ? above : below) >= card.height;
  const side: Side = previous && fits(previous) ? previous : fits('above') ? 'above' : fits('below') ? 'below' : above >= below ? 'above' : 'below';
  const room = Math.max(0, side === 'above' ? above : below);
  const height = Math.min(card.height, room);
  const y = side === 'above' ? pet.y - half - PET.gap - height : pet.y + half + PET.gap;
  const tailX = clamp(pet.x - x, Math.min(PET.tailInset, width / 2), Math.max(width / 2, width - PET.tailInset));
  return { x, y, side, tailX, maxHeight: room };
}

/** A context menu at the pointer, flipped left / up when it would leave the stage. */
export function placeMenu(point: Point, menu: Size, area: Area): Point {
  const x = point.x + menu.width + PET.margin > area.width ? point.x - menu.width : point.x;
  const y = point.y + menu.height + PET.margin > area.height ? point.y - menu.height : point.y;
  return { x: clamp(x, PET.margin, Math.max(PET.margin, area.width - menu.width - PET.margin)), y: clamp(y, PET.margin, Math.max(PET.margin, area.height - menu.height - PET.margin)) };
}
