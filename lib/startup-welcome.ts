import type { AppState, Session } from './types';

export interface StartupWelcomeState {
  resumable: Session | null;
  completedToday: Session | null;
  calibrationStep: number | null;
  fullMinutes: number;
}

/** Mirrors STALE_SESSION_MS in components/app/today-plan.ts (lib cannot import from components). */
const STALE_RESUME_MS = 72 * 3600_000;

function validTimestamp(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : -Infinity;
}

/** Reads saved evidence only. Opening the app never schedules a lesson. */
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
  // Same rule as Today's main card (components/app/today-plan.ts): a conversation untouched for 72 h is no longer
  // «waiting» — it lives in «Незаконченные», so the greeting must not promise it.
  const resumable = newest.find(session => session.status !== 'completed'
    && !(session.baseline && state.onboarding?.status === 'ready')
    && (session.status === 'analysing' || now.getTime() - validTimestamp(session.updatedAt) < STALE_RESUME_MS)) ?? null;
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
    calibrationStep: state.onboarding
      ? state.onboarding.status === 'baseline' ? state.onboarding.completedStages + 1 : null
      : completedCalibrations < 3 ? completedCalibrations + 1 : null,
    fullMinutes: Number.isFinite(state.profile.dailyMinutes)
      ? Math.min(30, Math.max(5, Math.floor(state.profile.dailyMinutes))) : 15,
  };
}

/** A short greeting from saved facts; launch does not wait for a model call. */
export function deriveOpeningGreeting(state: AppState, now = new Date(), timeZone = 'Europe/Moscow') {
  const saved = deriveStartupWelcome(state, now, timeZone);
  const name = state.profile.name.trim();
  return {
    greeting: name && !['Ты', 'You', 'Learner'].includes(name) ? `Привет, ${name}.` : 'Привет.',
    motivation: saved.resumable ? 'Разговор ждёт — продолжим с того же места.'
      : saved.completedToday ? 'Сегодня уже была практика. Дальше — в своём темпе.'
        : 'Начнём с одного короткого шага.',
  };
}
