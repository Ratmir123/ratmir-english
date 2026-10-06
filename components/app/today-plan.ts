// Today's ONE primary card (planning/v05/DESIGN-SYSTEM.md §3 decision order) and the lists around it.
// Pure functions: no React, no fetch — unit-tested in tests/today-plan.test.ts.
import type { AppState, ProgressionState, Session } from '@/lib/types';
import type { CallSummary, PersonalDrill } from '@/lib/calls/types';
import type { PlacementView } from '@/lib/placement/types';
import { practiceResults } from '@/lib/progression';
import { localDayKey } from './labels';

type Recommendation = NonNullable<ProgressionState['recommendation']>;
/** An unfinished conversation untouched this long moves to «Незаконченные» instead of owning Today. */
export const STALE_SESSION_MS = 72 * 3600_000;

export type TodayPrimary =
  | { kind: 'placement'; view: PlacementView; retake: boolean; answered: number; planned: number }
  | { kind: 'continue'; session: Session }
  | { kind: 'call'; call: CallSummary }
  | { kind: 'drill'; drill: PersonalDrill; call: CallSummary | null }
  | { kind: 'plan'; recommendation: Recommendation }
  | { kind: 'free' };

const time = (value: string | null | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : 0; };
const IN_PROGRESS: Session['status'][] = ['active', 'analysing', 'review', 'error'];

/** Unfinished, not deliberately parked (deferred), not a removed 0.4 baseline probe. Newest first. */
export function inProgressSessions(state: AppState): Session[] {
  return state.sessions.filter(session => !session.baseline && !session.retryDeferred && IN_PROGRESS.includes(session.status))
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}
function isFresh(session: Session, now: number) {
  return session.status === 'analysing' || now - time(session.updatedAt) < STALE_SESSION_MS;
}
/** «Незаконченные»: deferred retries plus old unfinished conversations — reachable, never the daily task. */
export function laterSessions(state: AppState, now = Date.now()): Session[] {
  const parked = state.sessions.filter(session => !session.baseline && session.retryDeferred && session.status === 'completed');
  const stale = inProgressSessions(state).filter(session => !isFresh(session, now));
  return [...stale, ...parked].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}

/**
 * The one drill order (MOTION-PASS-0.5.2 §8.6) for Today's step, Practice, a call's «Тренировки» and the pattern cards:
 * due first, then the newest call, then the newest drill. Without `calls` the call date is unknown and the rest decides.
 */
export function drillOrder(calls: readonly CallSummary[] = [], now = Date.now()): (a: PersonalDrill, b: PersonalDrill) => number {
  const byId = new Map(calls.map(call => [call.id, call]));
  const callTime = (drill: PersonalDrill) => drill.source.type === 'call' ? time(byId.get(drill.source.callId)?.occurredAt ?? byId.get(drill.source.callId)?.createdAt) : 0;
  const due = (drill: PersonalDrill) => !drill.dueAt || time(drill.dueAt) <= now;
  return (a, b) => Number(due(b)) - Number(due(a)) || callTime(b) - callTime(a) || time(b.createdAt) - time(a.createdAt);
}
export function pendingDrills(state: AppState, now = Date.now()): PersonalDrill[] {
  return (state.drills ?? []).filter(drill => drill.status !== 'done').sort(drillOrder(state.calls, now));
}
/** Drills as list rows: the pending ones in the shared order, then the done ones, the most recently finished first. */
export function sortDrillRows(drills: readonly PersonalDrill[], calls: readonly CallSummary[] = [], now = Date.now()): PersonalDrill[] {
  const finished = (drill: PersonalDrill) => time(drill.completedAt ?? drill.createdAt);
  return [
    ...drills.filter(drill => drill.status !== 'done').sort(drillOrder(calls, now)),
    ...drills.filter(drill => drill.status === 'done').sort((a, b) => finished(b) - finished(a)),
  ];
}
export const processingCalls = (state: AppState) => (state.calls ?? []).filter(call => ['awaiting-upload', 'queued', 'processing', 'analysing'].includes(call.status));
export const failedCalls = (state: AppState) => (state.calls ?? []).filter(call => call.status === 'error');

export function placementProgress(view: PlacementView): { answered: number; planned: number } {
  return view.sections.reduce((sum, section) => ({
    answered: sum.answered + (section.status === 'completed' || section.status === 'skipped' ? Math.max(section.answered, section.planned) : section.answered),
    planned: sum.planned + section.planned,
  }), { answered: 0, planned: 0 });
}

export function todayPrimary(state: AppState, now = Date.now()): TodayPrimary {
  const placement = state.placement;
  // 1. Placement test until a result exists.
  if (placement && !placement.result) return { kind: 'placement', view: placement, retake: false, ...placementProgress(placement) };
  // 2. Unfinished session or a review waiting (deferred retries never hijack Today).
  const current = inProgressSessions(state).find(session => isFresh(session, now));
  if (current) return { kind: 'continue', session: current };
  if (placement?.status === 'in-progress' || placement?.status === 'scoring') return { kind: 'placement', view: placement, retake: true, ...placementProgress(placement) };
  // 3. A call that needs him (which speaker is me).
  const speaker = (state.calls ?? []).find(call => call.status === 'needs-speaker');
  if (speaker) return { kind: 'call', call: speaker };
  // 4. Pending personal drill, newest call first.
  const drill = pendingDrills(state, now)[0];
  if (drill) return { kind: 'drill', drill, call: drill.source.type === 'call' ? (state.calls ?? []).find(call => call.id === (drill.source as { callId: string }).callId) ?? null : null };
  // 5. Today's plan.
  const recommendation = state.progression?.recommendation;
  if (recommendation) return { kind: 'plan', recommendation };
  return { kind: 'free' };
}

/** Weekly rhythm by local day: practice results (the same definition as XP and «Завершено»). Informational only. */
export function weeklyRhythm(state: AppState, nowDate = new Date()): { days: { key: string; label: string; count: number; today: boolean }[]; total: number; activeDays: number } {
  const now = nowDate.getTime();
  const counts = new Map<string, number>();
  const drillSessions = new Set((state.drills ?? []).map(drill => drill.sessionId).filter((id): id is string => !!id));
  for (const result of practiceResults(state.sessions, now, drillSessions)) {
    if (now - time(result.completedAt) > 8 * 86_400_000) continue;
    const key = localDayKey(result.completedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weekday = new Intl.DateTimeFormat('ru', { weekday: 'short' });
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 6 + index);
    const key = localDayKey(day);
    return { key, label: weekday.format(day).replace('.', ''), count: counts.get(key) ?? 0, today: index === 6 };
  });
  return { days, total: days.reduce((sum, day) => sum + day.count, 0), activeDays: days.filter(day => day.count > 0).length };
}
