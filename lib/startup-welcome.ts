import type { AppState, Session } from './types';

export interface StartupWelcomeState {
  resumable: Session | null;
  completedToday: Session | null;
  calibrationStep: number | null;
  fullMinutes: number;
}

function validTimestamp(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : -Infinity;
}

/** Reads saved evidence only. Showing the entry screen never schedules a lesson. */
export function deriveStartupWelcome(
  state: AppState,
  now = new Date(),
  timeZone = 'Europe/Moscow',
): StartupWelcomeState {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = day.format(now);
  const newest = [...state.sessions].sort((left, right) =>
    validTimestamp(right.updatedAt) - validTimestamp(left.updatedAt)
    || validTimestamp(right.createdAt) - validTimestamp(left.createdAt));
  const resumable = newest.find(session => session.status !== 'completed') ?? null;
  const completedToday = newest.find(session => {
    const time = validTimestamp(session.updatedAt);
    return session.status === 'completed' && time !== -Infinity && time <= now.getTime()
      && session.turns.some(turn => turn.role === 'user' && turn.text.trim())
      && day.format(new Date(time)) === today;
  }) ?? null;
  const completedCalibrations = Number.isFinite(state.calibrationCompleted)
    ? Math.max(0, Math.floor(state.calibrationCompleted)) : 0;
  return {
    resumable,
    completedToday,
    calibrationStep: completedCalibrations < 3 ? completedCalibrations + 1 : null,
    fullMinutes: Number.isFinite(state.profile.dailyMinutes)
      ? Math.min(30, Math.max(5, Math.floor(state.profile.dailyMinutes))) : 15,
  };
}
