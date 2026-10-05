// "One mascot visible at a time animates" (MASCOT-SPEC §9). Pure TS so it can be unit-tested.
// The winner is the visible exclusive mascot with the highest score: area, ×4 while busy (listening,
// speaking, thinking…), and an overriding boost for a few seconds after it is touched or reacts.
// Non-exclusive mascots always animate and never block others.

export interface MascotContender {
  area: number;
  busy: boolean;
  /** performance.now() deadline of a touch/reaction claim. */
  boost: number;
  visible: boolean;
  exclusive: boolean;
  primary: boolean;
  notify(): void;
}

export class MascotRegistry {
  private readonly contenders = new Set<MascotContender>();
  constructor(private readonly clock: () => number = () => performance.now()) {}

  add(contender: MascotContender) { this.contenders.add(contender); this.elect(); }
  remove(contender: MascotContender) { this.contenders.delete(contender); this.elect(); }

  /** Recomputes the animated mascot; notifies every contender whose role changed. */
  elect() {
    let best: MascotContender | null = null, bestScore = -1;
    const now = this.clock();
    for (const contender of this.contenders) {
      if (!contender.exclusive || !contender.visible) continue;
      const score = contender.area * (contender.busy ? 4 : 1) + (contender.boost > now ? 1e12 : 0);
      if (score > bestScore) { bestScore = score; best = contender; }
    }
    for (const contender of this.contenders) {
      const primary = !contender.exclusive || contender === best;
      if (primary !== contender.primary) { contender.primary = primary; contender.notify(); }
    }
  }
}

export const mascotRegistry = new MascotRegistry();
