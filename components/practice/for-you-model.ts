// «Для тебя» on Practice (planning/v05/MOTION-PASS-0.5.2.md §7, §8): what the block shows, as pure functions.
// No React, no fetch — unit-tested in tests/practice-for-you.test.ts. The iPhone mirrors it in ios/Sources/PracticeForYou.swift.
import type { AppState, Mode } from '@/lib/types';
import type { DrillType, PersonalDrill } from '@/lib/calls/types';
import { familyForPattern, type CatalogFamily } from '@/lib/training';
import { lessonBudget } from '@/lib/lesson-budget';
import { pendingDrills } from '../app/today-plan';

/** Tiles in the block, the plan included; the rest of the drills are one tap away in «Все тренировки». */
export const FOR_YOU_TILES = 6;

/**
 * Usual length of a drill session by type. Mirrors `DRILL_TEMPLATES[type].minutes` in lib/server/teacher.ts: a drill takes the
 * shorter of this and the daily budget.
 */
export const DRILL_MINUTES: Record<DrillType, number> = {
  replay: 6, pitch: 5, price: 6, questions: 6, closing: 6, language: 5, cards: 5, story: 6, followup: 8, rapidfire: 10,
};

export type PracticeRecommendation = NonNullable<NonNullable<AppState['progression']>['recommendation']>;
/** `other` is the second way to run it (a small text action on the tile); null for written and reading tasks. */
type Start = { minutes: number; mode: Mode; other: Mode | null };
export type DrillTile = Start & { kind: 'drill'; key: string; drill: PersonalDrill };
export type PlanTile = Start & { kind: 'plan'; key: string; recommendation: PracticeRecommendation };
export type ForYouTile = DrillTile | PlanTile;
export type PatternSuggestion = { patternId: string; patternTitle: string; family: CatalogFamily };
export type ForYouModel = {
  plan: PlanTile | null;
  /** The drill tiles of the block (pending only, the shared order), at most FOR_YOU_TILES minus the plan. */
  tiles: DrillTile[];
  /** Every pending drill in the shared order (due first, then the newest call, then the newest drill). */
  pending: DrillTile[];
  /** Done drills, newest first (folded under «Пройденные» in the full list). */
  done: DrillTile[];
  suggestions: PatternSuggestion[];
};

const other = (mode: Mode): Mode => mode === 'call' ? 'learning' : 'call';
const time = (value: string | null | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; };

/** A follow-up drill is a written message: the server always runs it with supports. */
export function drillIsText(drill: Pick<PersonalDrill, 'type'>): boolean { return drill.type === 'followup'; }

/** One start rule everywhere (§8.6): pressure tier 2–3 runs «Как на созвоне», tier 1 «С опорами». */
export function drillTile(drill: PersonalDrill, dailyMinutes: number): DrillTile {
  const text = drillIsText(drill);
  const mode: Mode = text ? 'learning' : drill.tier >= 2 ? 'call' : 'learning';
  return { kind: 'drill', key: drill.id, drill, minutes: Math.min(lessonBudget(dailyMinutes), DRILL_MINUTES[drill.type] ?? 6), mode, other: text ? null : other(mode) };
}

/** Today's plan without a drill: it starts directly in its preferred mode, exactly like Today's card. */
export function planTile(recommendation: PracticeRecommendation | null | undefined, dailyMinutes: number): PlanTile | null {
  if (!recommendation || recommendation.drillId) return null;
  const text = recommendation.activity === 'reading' || recommendation.activity === 'writing';
  const mode: Mode = text ? 'learning' : recommendation.preferredMode;
  return { kind: 'plan', key: 'plan:' + recommendation.familyId, recommendation, minutes: lessonBudget(dailyMinutes), mode, other: text ? null : other(mode) };
}

/**
 * Catalog scenarios against the costliest open weaknesses (at most two). A pattern a pending drill already trains is skipped,
 * and so is the plan's own scenario, so the block never offers the same thing twice.
 */
export function patternSuggestions(state: AppState, families: CatalogFamily[], pending: PersonalDrill[], planFamilyId: string | null): PatternSuggestion[] {
  const busy = new Set(pending.flatMap(drill => drill.patternIds));
  const result: PatternSuggestion[] = [];
  const open = (state.patterns ?? []).filter(item => !item.dismissed && item.kind === 'weakness' && ['active', 'improving'].includes(item.status))
    .sort((a, b) => a.costRank - b.costRank);
  for (const pattern of open) {
    if (busy.has(pattern.id) || result.length >= 2) continue;
    const exclude = [...(planFamilyId ? [planFamilyId] : []), ...result.map(item => item.family.id)];
    const curated = familyForPattern(pattern, exclude);
    const family = curated ? families.find(item => item.id === curated.id) : undefined;
    if (family) result.push({ patternId: pattern.id, patternTitle: pattern.title, family });
  }
  return result;
}

export function forYouModel(state: AppState, families: CatalogFamily[], now = Date.now()): ForYouModel {
  const daily = state.profile?.dailyMinutes ?? 15;
  const plan = planTile(state.progression?.recommendation, daily);
  const pendingList = pendingDrills(state, now);
  const pending = pendingList.map(drill => drillTile(drill, daily));
  const done = (state.drills ?? []).filter(drill => drill.status === 'done')
    .sort((a, b) => time(b.completedAt ?? b.createdAt) - time(a.completedAt ?? a.createdAt))
    .map(drill => drillTile(drill, daily));
  return {
    plan, pending, done,
    tiles: pending.slice(0, FOR_YOU_TILES - (plan ? 1 : 0)),
    suggestions: patternSuggestions(state, families, pendingList, plan?.recommendation.familyId ?? null),
  };
}
