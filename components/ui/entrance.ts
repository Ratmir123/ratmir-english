'use client';

import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

/** 'launch' = the cold open after the greeting hands off; 'screen' = a tab switch (shorter, closer). */
export type EntranceVariant = 'launch' | 'screen';

/** How long a whole wave runs. Mirrors the [data-entering] tokens in app/globals.css (duration + step × max steps + base). */
export const ENTRANCE_MS: Readonly<Record<EntranceVariant, number>> = { launch: 900 + 85 * 9 + 60, screen: 620 + 48 * 7 };
const ROW = 32;
/**
 * Live content: a WebGL companion (its canvas), a rank medal (3D faces, float, glint) or an animated achievement medal.
 * A block holding one rises with opacity + transform only (`data-enter-live`, PASS-0.5.3 §5): a blur over content that
 * repaints every frame would be re-filtered every frame, and the filter would flatten the medal's 3D for the duration.
 */
const LIVE_CONTENT = 'canvas, [data-rank], [data-reward-motion]';
/** Lanes that never carry a blur anyway. */
const PLAIN_LANES = new Set(['side', 'chrome', 'fade', 'live']);

/**
 * Staircase entrance (MOTION-PASS-0.5.2 §2, «лесенкой»). Every `[data-enter]` block under `ref` rises in the order it
 * sits on screen — top to bottom, then left to right — so a two-column layout reads as one diagonal wave rather
 * than column by column. Sidebar items (`data-enter="side"`) run their own wave down the rail in step with the
 * content, so a long navigation list never delays the screen. Runs whenever `key` changes (`null` = do nothing yet).
 * Blocks below the fold join the end of the wave instead of queueing behind it. Content stays visible without JS:
 * the animation exists only while the root carries `data-entering`, which is removed afterwards so hover and press
 * transitions work normally. A block with live content (`LIVE_CONTENT`) is marked `data-enter-live` for this wave
 * and rises without a blur; `data-enter="live"` asks for the same explicitly.
 */
export function useEntrance(ref: RefObject<HTMLElement | null>, key: unknown, variant: EntranceVariant = 'screen') {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || key === null || key === undefined || document.hidden) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-enter]'));
    if (!items.length) return;
    const fold = window.innerHeight;
    const placed = items.map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(item => item.rect.width > 0 || item.rect.height > 0)
      .sort((a, b) => Math.round(a.rect.top / ROW) - Math.round(b.rect.top / ROW) || a.rect.left - b.rect.left);
    const steps = { main: 0, side: 0 };
    for (const item of placed) {
      const lane = item.element.dataset.enter === 'side' ? 'side' : 'main';
      const index = item.rect.top < fold ? steps[lane]++ : steps[lane];
      item.element.style.setProperty('--enter-i', String(index));
      const live = !PLAIN_LANES.has(item.element.dataset.enter ?? '') && !!item.element.querySelector(LIVE_CONTENT);
      if (live) item.element.dataset.enterLive = ''; else delete item.element.dataset.enterLive;
    }
    root.dataset.entering = variant;
    const done = window.setTimeout(() => { if (root.dataset.entering === variant) delete root.dataset.entering; }, ENTRANCE_MS[variant] + 80);
    return () => { window.clearTimeout(done); delete root.dataset.entering; };
    // The ref is stable; `key` is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, variant]);
}

/* The moment the launch layer hands the shell to the learner (MOTION-PASS-0.5.2 §4). Anything that should be seen
   rather than play unseen under the layer (the Today hero's greeting hop) waits for it. Once per page load. */
let shellRevealed = false;
const revealListeners = new Set<() => void>();
const subscribeReveal = (listener: () => void) => { revealListeners.add(listener); return () => { revealListeners.delete(listener); }; };

export function markShellRevealed() {
  if (shellRevealed) return;
  shellRevealed = true;
  revealListeners.forEach(listener => listener());
}

export function useShellRevealed(): boolean {
  return useSyncExternalStore(subscribeReveal, () => shellRevealed, () => false);
}

/* The launch is settled once its staircase has finished (or it ended without one: sign-in, the level test). Until then
   background results that would re-render the covered shell or insert a block mid-wave (limits, the catalog) wait and
   land together right after it (PASS-0.5.3 §5). Keyed: a newer result for the same key replaces the waiting one. */
let launchSettled = false;
const afterLaunchTasks = new Map<string, () => void>();

export function afterLaunch(key: string, task: () => void) {
  if (launchSettled) { task(); return; }
  afterLaunchTasks.set(key, task);
}

export function markLaunchSettled() {
  if (launchSettled) return;
  launchSettled = true;
  const tasks = [...afterLaunchTasks.values()];
  afterLaunchTasks.clear();
  for (const task of tasks) {
    try { task(); } catch (error) { console.error(error); }
  }
}

export function isLaunchSettled(): boolean { return launchSettled; }
