import type { AppState, LearningActivity, LearningTrackId } from './types';
import { qualifyingRetryImprovement } from './progression';

export interface AchievementTarget {
  label: string; reason: string; track: LearningTrackId; activity?: LearningActivity;
  sessionId?: string; available: boolean;
}

/** Navigation intent only. Choosing a goal never starts a model request. */
export function achievementTarget(id: string, state: AppState, now = Date.now()): AchievementTarget {
  const value = state.progression;
  const normal: AchievementTarget = { label: 'К короткой практике', reason: 'Выбери занятие и заверши свою попытку с разбором.', track: 'life', available: true };
  if (id === 'own-improvement') {
    const saved = [...state.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).find(session =>
      !session.baseline && session.lesson.kind !== 'calibration' && session.analysis && session.analysis.priorities.length > 0 &&
      (session.status === 'review' || (session.status === 'completed' && session.retryDeferred && !qualifyingRetryImprovement(session, now))));
    return saved ? { ...normal, label: qualifyingRetryImprovement(saved, now) ? 'Завершить свою практику' : 'Вернуться к своей попытке',
      reason: qualifyingRetryImprovement(saved, now) ? 'Ответ уже исправлен. Осталось завершить занятие, чтобы сохранить результат.' : 'Есть сохранённый разбор. Попробуй исправить ответ своими словами.', sessionId: saved.id }
      : { ...normal, reason: 'Сначала нужна собственная попытка и разбор, затем её улучшение.' };
  }
  if (id === 'three-days') {
    const today = new Date(now).toISOString().slice(0, 10);
    const practiced = value?.recentResults.some(result => result.completedAt.slice(0, 10) === today);
    return { ...normal, label: practiced ? 'К практике' : 'Практика на сегодня',
      reason: practiced ? 'Сегодня уже засчитан день. Следующий день по UTC приблизит эту награду.' : 'Засчитываются разные дни по UTC, а не несколько уроков за день.' };
  }
  if (id === 'balanced-practice') {
    const life = value?.tracks.find(track => track.id === 'life')?.completedSessions ?? 0;
    const work = value?.tracks.find(track => track.id === 'work')?.completedSessions ?? 0;
    const track = life <= work ? 'life' : 'work';
    return { ...normal, track, label: track === 'life' ? 'К разговорам о жизни' : 'К рабочим разговорам', reason: 'Пойдём в направление, где пока меньше завершённых попыток.' };
  }
  if (id === 'independent-listening') return { ...normal, label: 'К практике на слух', track: 'ielts-foundation', activity: 'listening', reason: 'Слушай без текста, используй детали в своём ответе. Подсказки доступны, но награда учитывает самостоятельное понимание.' };
  if (id === 'ielts-four-sides') {
    const activities = value?.tracks.find(track => track.id === 'ielts-foundation')?.activities;
    const activity = [...(activities ?? [])].sort((a, b) => a.completedSessions - b.completedSessions)[0]?.id ?? 'speaking';
    return { ...normal, label: 'К следующему навыку', track: 'ielts-foundation', activity, reason: 'Откроем навык с меньшим числом попыток. Запуск задания остаётся за тобой.' };
  }
  return normal;
}

const ACHIEVEMENT_ART: Record<string, string> = {
  'first-practice': 'first-practice', 'three-days': 'three-days', 'ten-practices': 'ten-practices',
  'own-improvement': 'own-improvement', 'balanced-practice': 'balanced-worlds',
  'independent-listening': 'independent-listening', 'ielts-four-sides': 'four-sides',
};
export const achievementArt = (id: string) => `/rewards-v041/${ACHIEVEMENT_ART[id] ?? 'first-practice'}.png`;
export const EXPERIENCE_BANDS = [
  { from: 1, art: 'rank-pearl', title: 'Старт' }, { from: 3, art: 'rank-mint', title: 'Разгон' },
  { from: 6, art: 'rank-sky', title: 'Ритм' }, { from: 10, art: 'rank-violet', title: 'Напор' },
  { from: 16, art: 'rank-rose', title: 'Искра' }, { from: 25, art: 'rank-gold', title: 'Огонь' },
] as const;
export const experienceBand = (level: number) => [...EXPERIENCE_BANDS].reverse().find(band => level >= band.from) ?? EXPERIENCE_BANDS[0];
