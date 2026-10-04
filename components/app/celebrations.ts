// Gamification moments (DESIGN-SYSTEM "Celebrations", audit-product §5): created only by a confirmed action
// (completing a lesson, an improved retry) — never by opening history. Pure diff, tested in tests/celebrations.test.ts.
import type { ProgressionState } from '@/lib/types';
import { experienceBand } from '@/lib/achievement-targets';

export type ProgressSnapshot = { xp: number; level: number; unlocked: string[] };
export type Celebration =
  | { id: string; kind: 'xp'; amount: number; level: number; levelUp: boolean }
  | { id: string; kind: 'rank'; level: number; title: string; art: string }
  | { id: string; kind: 'achievement'; achievementId: string; title: string; description: string }
  | { id: string; kind: 'improved' };

export function progressSnapshot(progression: ProgressionState | null | undefined): ProgressSnapshot {
  return {
    xp: progression?.xp ?? 0, level: progression?.level ?? 1,
    unlocked: progression?.achievements.filter(item => item.unlocked).map(item => item.id) ?? [],
  };
}

let sequence = 0;
const nextId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;

/** Order on screen: XP flies first, then new achievements, then a rank-up sheet. */
export function diffProgress(before: ProgressSnapshot, after: ProgressionState | null | undefined): Celebration[] {
  if (!after) return [];
  const result: Celebration[] = [];
  const gained = after.xp - before.xp;
  if (gained > 0) result.push({ id: nextId('xp'), kind: 'xp', amount: gained, level: after.level, levelUp: after.level > before.level });
  for (const item of after.achievements) {
    if (item.unlocked && !before.unlocked.includes(item.id)) {
      result.push({ id: nextId('achievement'), kind: 'achievement', achievementId: item.id, title: item.title, description: item.description });
    }
  }
  const from = experienceBand(before.level);
  const to = experienceBand(after.level);
  if (to.from > from.from) result.push({ id: nextId('rank'), kind: 'rank', level: after.level, title: to.title, art: to.art });
  return result;
}

export function improvedCelebration(): Celebration { return { id: nextId('improved'), kind: 'improved' }; }
