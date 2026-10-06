// Removal with undo (MOTION-PASS-0.5.2 §8.4): the item leaves the screen at once, a toast offers «Вернуть» for ≈ 6 s, and
// only when that window ends does `commit` (the server request) run. Module-level, so a pending removal survives the screen
// that started it. No DOM; unit-tested in tests/undo-queue.test.ts.
import { useSyncExternalStore } from 'react';

/** How long «Вернуть» stays (the toast's `life` uses the same value). */
export const UNDO_MS = 6000;

export type UndoQueue = {
  /** Hides `id` now and commits after the undo window. False when it is already pending. */
  schedule: (id: string, commit: () => Promise<unknown> | unknown) => boolean;
  /** «Вернуть»: drops a pending removal. False once its commit has started (or it is unknown). */
  cancel: (id: string) => boolean;
  /** Ids to render as gone: waiting for their window, or committing until the commit settles. */
  pending: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
};

const NONE: ReadonlySet<string> = new Set();

export function createUndoQueue(delayMs = UNDO_MS): UndoQueue {
  const entries = new Map<string, { timer: ReturnType<typeof setTimeout> | null; committing: boolean }>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlySet<string> = NONE;
  const publish = () => { snapshot = entries.size ? new Set(entries.keys()) : NONE; listeners.forEach(listener => listener()); };
  return {
    schedule(id, commit) {
      if (entries.has(id)) return false;
      const entry: { timer: ReturnType<typeof setTimeout> | null; committing: boolean } = { timer: null, committing: false };
      entry.timer = setTimeout(() => {
        entry.committing = true;
        // A failed commit brings the item back; the caller reports the error itself.
        void Promise.resolve().then(commit).catch(() => undefined).finally(() => { entries.delete(id); publish(); });
      }, delayMs);
      entries.set(id, entry);
      publish();
      return true;
    },
    cancel(id) {
      const entry = entries.get(id);
      if (!entry || entry.committing) return false;
      if (entry.timer) clearTimeout(entry.timer);
      entries.delete(id);
      publish();
      return true;
    },
    pending: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** The ids of `queue` that are pending removal (re-renders when the set changes). */
export function usePendingRemovals(queue: UndoQueue): ReadonlySet<string> {
  return useSyncExternalStore(queue.subscribe, queue.pending, () => NONE);
}
