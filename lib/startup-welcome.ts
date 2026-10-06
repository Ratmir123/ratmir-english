import type { AppState, Session } from './types';
import { duePhraseCount } from './phrases/schedule';
import { practiceResults } from './progression';

export interface StartupWelcomeState {
  resumable: Session | null;
  completedToday: Session | null;
  calibrationStep: number | null;
  fullMinutes: number;
}

/** Mirrors STALE_SESSION_MS in components/app/today-plan.ts (lib cannot import from components). */
const STALE_RESUME_MS = 72 * 3600_000;
const DAY_MS = 86_400_000;

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

/* ── Launch motivation (PASS-0.5.3 §6): one line under the companion while the app loads, then a personal one ──
   Same list, same order and same rules on the iPhone (ios/Sources: OpeningGreeting). The rules are a pure function of
   a few facts (`launchMotivation`) so both platforms compute the facts their own way and pick the identical line. */

/** The day-of-year pool, in this order. Index = (day of the year, 1-based, local calendar) − 1, modulo 7: 1 January → the first line. */
export const MOTIVATION_POOL = [
  'Пять минут вслух — лучше часа в голове.',
  'Сильный ответ начинается с главного.',
  'Каждый разговор делает следующий созвон проще.',
  'Говори своими словами — точность придёт с практикой.',
  'Короткий шаг каждый день сильнее редкого рывка.',
  'Свою цену называют спокойно.',
  'Сегодня — ещё один спокойный разговор на английском.',
] as const;

export const MOTIVATION_RESUME = 'Разговор ждёт — продолжим с того же места.';
export const MOTIVATION_DONE_TODAY = 'Сегодня уже была практика. Дальше — в своём темпе.';
export const MOTIVATION_CALL_DRILL = 'Есть тренировка из твоего созвона — переиграем момент.';
/** «Держим ритм» needs at least this many practice days in the last seven (today included). */
export const MOTIVATION_RHYTHM_DAYS = 3;

/** Russian plural: 1 / 2–4 / 5+ (11–14 take the last form). */
function plural(value: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(Math.trunc(value)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** «1 фраза ждёт повторения — скажем её вслух.» / «3 фразы ждут … их …» / «5 фраз ждут …» / «21 фраза ждёт … их …». */
export function duePhrasesLine(count: number): string {
  const n = Math.max(1, Math.floor(count));
  const noun = plural(n, ['фраза', 'фразы', 'фраз']);
  return `${n} ${noun} ${noun === 'фраза' ? 'ждёт' : 'ждут'} повторения — скажем ${n === 1 ? 'её' : 'их'} вслух.`;
}

/** «3 дня практики на этой неделе. Держим ритм.» / «5 дней …». */
export function rhythmLine(days: number): string {
  const n = Math.max(0, Math.floor(days));
  return `${n} ${plural(n, ['день', 'дня', 'дней'])} практики на этой неделе. Держим ритм.`;
}

/** Calendar parts of `now` in `timeZone` (undefined = the device's zone). */
function calendarDay(now: Date, timeZone?: string): { year: number; month: number; day: number } | null {
  if (!Number.isFinite(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
    const value = { year: pick('year'), month: pick('month'), day: pick('day') };
    return Number.isFinite(value.year) && Number.isFinite(value.month) && Number.isFinite(value.day) ? value : null;
  } catch { return null; }
}

/** 1 for 1 January … 365/366 for 31 December, in `timeZone`'s calendar. */
export function dayOfYear(now: Date, timeZone?: string): number {
  const date = calendarDay(now, timeZone);
  if (!date) return 1;
  return Math.round((Date.UTC(date.year, date.month - 1, date.day) - Date.UTC(date.year, 0, 1)) / DAY_MS) + 1;
}

/** The pool line for a day of the year (1-based). */
export function poolMotivation(day: number): string {
  const index = Number.isFinite(day) ? ((Math.floor(day) - 1) % MOTIVATION_POOL.length + MOTIVATION_POOL.length) % MOTIVATION_POOL.length : 0;
  return MOTIVATION_POOL[index];
}

/** The line shown from the first frame, before any data: the day-of-year pool only. */
export function bootMotivation(now = new Date(), timeZone?: string): string {
  return poolMotivation(dayOfYear(now, timeZone));
}

/**
 * Practice days among the last seven calendar days in `timeZone` (today and the six before it — the same window as
 * Today's «На этой неделе — N из 7»), from practice-result completion times. Future and invalid times never count.
 */
export function practiceDaysThisWeek(completedAt: readonly string[], now = new Date(), timeZone?: string): number {
  const today = calendarDay(now, timeZone);
  if (!today) return 0;
  const key = (date: { year: number; month: number; day: number }) => `${date.year}-${date.month}-${date.day}`;
  const week = new Set(Array.from({ length: 7 }, (_, back) => {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    return key({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() });
  }));
  const practised = new Set<string>();
  for (const value of completedAt) {
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time > now.getTime() + 1000 || now.getTime() - time > 8 * DAY_MS) continue;
    const date = calendarDay(new Date(time), timeZone);
    if (date && week.has(key(date))) practised.add(key(date));
  }
  return practised.size;
}

/** What the motivation rules look at (each platform derives these from its own state). */
export interface LaunchMotivationFacts {
  /** A conversation is waiting (Today's «Продолжить», not older than 72 h). */
  resumable: boolean;
  /** A completed practice with his own words today. */
  completedToday: boolean;
  /** «Мои фразы» due now (new phrases are due at once): lib/phrases/schedule `duePhraseCount`. */
  duePhrases: number;
  /** A personal drill from a real call that is not done yet. */
  pendingCallDrill: boolean;
  /** Practice days in the last seven calendar days (`practiceDaysThisWeek`). */
  practiceDays: number;
  /** 1-based day of the year (`dayOfYear`) for the pool. */
  dayOfYear: number;
}

/** The first rule that matches, in this order; otherwise the day-of-year pool. */
export function launchMotivation(facts: LaunchMotivationFacts): string {
  if (facts.resumable) return MOTIVATION_RESUME;
  if (facts.completedToday) return MOTIVATION_DONE_TODAY;
  if (facts.duePhrases > 0) return duePhrasesLine(facts.duePhrases);
  if (facts.pendingCallDrill) return MOTIVATION_CALL_DRILL;
  if (facts.practiceDays >= MOTIVATION_RHYTHM_DAYS) return rhythmLine(facts.practiceDays);
  return poolMotivation(facts.dayOfYear);
}

/** The facts for `launchMotivation` from the saved state (web). */
export function launchMotivationFacts(state: AppState, now = new Date(), timeZone = 'Europe/Moscow'): LaunchMotivationFacts {
  const saved = deriveStartupWelcome(state, now, timeZone);
  const drills = state.drills ?? [];
  // The same practice results as XP and Today's weekly rhythm (drill sessions are short practices too).
  const drillSessions = new Set(drills.map(drill => drill.sessionId).filter((id): id is string => !!id));
  return {
    resumable: !!saved.resumable,
    completedToday: !!saved.completedToday,
    duePhrases: duePhraseCount(state.phrases, now.getTime()),
    pendingCallDrill: drills.some(drill => drill.status !== 'done' && drill.source.type === 'call'),
    practiceDays: practiceDaysThisWeek(practiceResults(state.sessions, now.getTime(), drillSessions).map(result => result.completedAt), now, timeZone),
    dayOfYear: dayOfYear(now, timeZone),
  };
}

/** A short greeting from saved facts; launch does not wait for a model call. */
export function deriveOpeningGreeting(state: AppState, now = new Date(), timeZone = 'Europe/Moscow') {
  const name = state.profile.name.trim();
  return {
    greeting: name && !['Ты', 'You', 'Learner'].includes(name) ? `Привет, ${name}.` : 'Привет.',
    motivation: launchMotivation(launchMotivationFacts(state, now, timeZone)),
  };
}
