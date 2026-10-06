// "One mascot visible at a time animates" (MASCOT-SPEC §9). Pure TS so it can be unit-tested.
// The winner is the visible exclusive mascot with the highest score: area, ×4 while busy (listening,
// speaking, thinking…), and an overriding boost for a few seconds after it is touched or reacts.
// Non-exclusive mascots always animate and never block others.
// PASS-0.5.3 §5: while the launch or placement layer covers the app shell, mascots inside the shell sleep (no loop, no
// WebGL work); when it is uncovered they wake one per animation frame, the biggest first. When a boost expires the
// registry re-elects by itself.

export interface MascotContender {
  area: number;
  busy: boolean;
  /** performance.now() deadline of a touch/reaction claim. */
  boost: number;
  visible: boolean;
  exclusive: boolean;
  primary: boolean;
  /** Inside the app shell ([data-shell]): sleeps while the shell is covered. */
  inShell?: boolean;
  /** Set by the registry: true while the shell covers this mascot or it waits for its wake-up frame. */
  asleep?: boolean;
  notify(): void;
}

/** Frame and timer hooks (injectable for tests). */
export interface RegistryScheduler {
  /** Runs `callback` on the next animation frame. */
  frame(callback: () => void): void;
  /** One-shot timer; returns its cancel function. */
  timer(callback: () => void, ms: number): () => void;
}

const browserScheduler: RegistryScheduler = {
  frame(callback) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback());
    else setTimeout(callback, 16);
  },
  timer(callback, ms) {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
};

export class MascotRegistry {
  private readonly contenders = new Set<MascotContender>();
  private covered = false;
  private readonly waking: MascotContender[] = [];
  private pumping = false;
  private expiry = Infinity;
  private cancelExpiry: (() => void) | null = null;
  constructor(private readonly clock: () => number = () => performance.now(), private readonly scheduler: RegistryScheduler = browserScheduler) {}

  /** True while the app shell is covered (mascots inside it sleep). */
  get isCovered(): boolean { return this.covered; }

  add(contender: MascotContender) {
    contender.asleep = this.covered && !!contender.inShell;
    this.contenders.add(contender);
    this.elect();
  }
  remove(contender: MascotContender) {
    this.contenders.delete(contender);
    const index = this.waking.indexOf(contender);
    if (index >= 0) this.waking.splice(index, 1);
    this.elect();
  }

  /**
   * The shell is covered (launch/placement layer) or uncovered. Covering puts every in-shell mascot to sleep at once;
   * uncovering wakes them one per animation frame, the biggest (busiest) first, so their WebGL work never lands in one frame.
   */
  setCovered(value: boolean) {
    if (value === this.covered) return;
    this.covered = value;
    if (value) {
      this.waking.length = 0;
      const fell: MascotContender[] = [];
      for (const contender of this.contenders) {
        if (contender.inShell && !contender.asleep) { contender.asleep = true; fell.push(contender); }
      }
      this.elect(fell);
      return;
    }
    const now = this.clock();
    const sleeping: MascotContender[] = [];
    for (const contender of this.contenders) if (contender.asleep) sleeping.push(contender);
    sleeping.sort((a, b) => score(b, now) - score(a, now));
    this.waking.push(...sleeping);
    this.pump();
  }

  /** Recomputes the animated mascot; notifies every contender whose role changed (and every one in `changed`). */
  elect(changed?: readonly MascotContender[]) {
    let best: MascotContender | null = null, bestScore = -1, nextExpiry = Infinity;
    const now = this.clock();
    for (const contender of this.contenders) {
      if (contender.boost > now && contender.boost < nextExpiry) nextExpiry = contender.boost;
      if (!contender.exclusive || !contender.visible || contender.asleep) continue;
      const value = score(contender, now);
      if (value > bestScore) { bestScore = value; best = contender; }
    }
    for (const contender of this.contenders) {
      const primary = !contender.exclusive || contender === best;
      if (primary !== contender.primary) { contender.primary = primary; contender.notify(); }
      else if (changed?.includes(contender)) contender.notify();
    }
    this.armExpiry(nextExpiry, now);
  }

  private pump() {
    if (this.pumping || !this.waking.length) return;
    this.pumping = true;
    this.scheduler.frame(() => {
      this.pumping = false;
      if (this.covered) { this.waking.length = 0; return; }
      const next = this.waking.shift();
      if (next && next.asleep && this.contenders.has(next)) { next.asleep = false; this.elect([next]); }
      this.pump();
    });
  }

  /** A claim (boost) that runs out re-runs the election by itself, so the slot returns to the biggest/busiest mascot. */
  private armExpiry(at: number, now: number) {
    if (at === this.expiry) return;
    this.cancelExpiry?.();
    this.cancelExpiry = null;
    this.expiry = at;
    if (!Number.isFinite(at)) return;
    this.cancelExpiry = this.scheduler.timer(() => {
      this.cancelExpiry = null;
      this.expiry = Infinity;
      this.elect();
    }, Math.max(0, at - now) + 1);
  }
}

function score(contender: MascotContender, now: number) {
  return contender.area * (contender.busy ? 4 : 1) + (contender.boost > now ? 1e12 : 0);
}

export const mascotRegistry = new MascotRegistry();
