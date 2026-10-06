'use client';

/*
 * «The shell is covered» (PASS-0.5.3 §5): while the launch layer or the placement layer sits over the app shell, nothing inside
 * the shell animates — its mascots stop their loops and its medals pause their CSS — so the visible layer gets the whole main
 * thread and GPU. The shell root carries `data-shell`; this module mirrors the flag on <html data-shell-covered> for CSS.
 *
 * Owners: the launch/placement orchestration sets it (components/training-app.tsx); mascots (components/mascot/*) and medals
 * (components/ui/rewards.*) read it. A mascot or medal outside `[data-shell]` (the launch layer's own chubrik) is never covered.
 */

let covered = false;
const listeners = new Set<() => void>();

export function setShellCovered(value: boolean): void {
  if (covered === value) return;
  covered = value;
  if (typeof document !== 'undefined') {
    if (value) document.documentElement.dataset.shellCovered = 'true';
    else delete document.documentElement.dataset.shellCovered;
  }
  listeners.forEach(listener => listener());
}

export function isShellCovered(): boolean { return covered; }

export function subscribeShellCover(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** True when `element` sits inside the app shell (as opposed to a layer above it). */
export function insideShell(element: Element | null | undefined): boolean {
  return !!element?.closest('[data-shell]');
}
