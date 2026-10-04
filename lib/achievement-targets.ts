import type { AppState, LearningActivity, LearningTrackId } from './types';
import { nextDrill, qualifyingRetryImprovement } from './progression';
import { familyForPattern, findFamily, shorten } from './training';

export interface AchievementTarget {
  label: string; reason: string; track: LearningTrackId; activity?: LearningActivity;
  sessionId?: string; available: boolean;
  /** v0.5: where the button leads. Absent means the practice catalog (v0.4 behaviour). */
  destination?: 'practice' | 'placement' | 'calls' | 'patterns' | 'drill';
  /** v0.5: a specific catalog scenario to open (its detail sheet; starting stays a separate tap). */
  familyId?: string;
  /** v0.5: a personal drill to open. */
  drillId?: string;
}

/** Navigation intent only. Choosing a goal never starts a model request. */
export function achievementTarget(id: string, state: AppState, now = Date.now()): AchievementTarget {
  const value = state.progression;
  const normal: AchievementTarget = { label: 'К короткой практике', reason: 'Выбери занятие и заверши свою попытку с разбором.', track: 'life', available: true };
  const scenario = (familyId: string, label: string, reason: string): AchievementTarget => {
    const family = findFamily(familyId);
    return { ...normal, destination: 'practice', familyId, track: family?.track ?? 'work', ...(family ? { activity: family.activity } : {}), label, reason };
  };
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
  if (id === 'placement-complete') {
    const started = state.placement?.status === 'in-progress' || state.placement?.status === 'scoring' || state.placement?.status === 'error';
    return { ...normal, track: 'work', destination: 'placement', label: started ? 'Продолжить тест' : 'Пройти тест уровня',
      reason: started ? 'Тест сохраняется после каждого ответа. Продолжи с того места, где остановился.'
        : 'Около 25 минут в два захода: понимание, чтение, язык, речь и рабочий разговор. Можно прерваться и продолжить позже.' };
  }
  if (id === 'first-call-review') {
    return { ...normal, track: 'work', destination: 'calls', label: 'Загрузить созвон',
      reason: 'Запись, расшифровка или готовый разбор реального звонка. Разбор покажет, что стоило денег и что тренировать.' };
  }
  if (id === 'call-replay') {
    const next = nextDrill(state.drills, now)?.drill ?? (state.drills ?? []).find(drill => drill.status !== 'done');
    return next ? { ...normal, track: next.context, destination: 'drill', drillId: next.id, label: 'Переиграть момент', reason: shorten(next.why || next.title, 240) }
      : { ...normal, track: 'work', destination: 'calls', label: 'К созвонам', reason: 'Тренировки появятся после разбора реального звонка. Загрузи запись или расшифровку.' };
  }
  if (id === 'pattern-improving') {
    const pattern = (state.patterns ?? []).filter(item => item.kind === 'weakness' && item.status === 'active' && !item.dismissed)
      .sort((a, b) => (a.costRank ?? 5) - (b.costRank ?? 5) || b.occurrences - a.occurrences || a.id.localeCompare(b.id))[0];
    if (!pattern) return { ...normal, track: 'work', destination: 'calls', label: 'К созвонам', reason: 'Паттерны появляются из разборов реальных звонков.' };
    const drill = (state.drills ?? []).find(item => item.status !== 'done' && item.patternIds.includes(pattern.id));
    const reason = `«${shorten(pattern.title, 80)}» сдаётся, когда ты несколько раз обходишь его в тренировках и на реальном звонке.`;
    if (drill) return { ...normal, track: drill.context, destination: 'drill', drillId: drill.id, label: 'Тренировать паттерн', reason };
    const family = familyForPattern(pattern);
    return family ? scenario(family.id, 'Тренировать паттерн', reason) : { ...normal, track: 'work', destination: 'patterns', label: 'К паттернам', reason };
  }
  if (id === 'counter-offer') return scenario('strategy-price', 'Отрепетировать встречную цифру', 'Награда за реальный созвон. Сначала отрепетируй ответ на низкую цифру, затем загрузи следующий звонок.');
  if (id === 'no-disclaimers') return scenario('work-call-opening', 'Отрепетировать начало звонка', 'Засчитываются реальные созвоны без оговорок про возраст, образование и «только начал». Начало звонка решает больше всего.');
  if (id === 'case-first') return scenario('strategy-agency-screening', 'Отрепетировать вопросы агентства', 'Награда за реальный созвон: на вопрос о брендах или недавнем клиенте первым звучит сильный свежий кейс.');
  if (id === 'dated-next-step') return scenario('strategy-recap-close', 'Отрепетировать финал звонка', 'Награда за реальный созвон: в конце названо, кто что делает и когда.');
  if (id === 'clean-pitch') return scenario('strategy-pitch-30', 'К питчу за 30 секунд', 'Скажи питч голосом: до 45 секунд, с цифрой или результатом и без оговорок. Длительность измеряется по записи.');
  return normal;
}

/** Reward art reuses the shared custom set; iOS mirrors this mapping in RewardArt.achievement. */
export const ACHIEVEMENT_ART: Record<string, string> = {
  'first-practice': 'first-practice', 'three-days': 'three-days', 'ten-practices': 'ten-practices',
  'own-improvement': 'own-improvement', 'balanced-practice': 'balanced-worlds',
  'independent-listening': 'independent-listening', 'ielts-four-sides': 'four-sides',
  'placement-complete': 'four-sides', 'first-call-review': 'independent-listening', 'call-replay': 'own-improvement',
  'pattern-improving': 'rank-mint', 'counter-offer': 'rank-gold', 'no-disclaimers': 'three-days',
  'case-first': 'ten-practices', 'dated-next-step': 'balanced-worlds', 'clean-pitch': 'first-practice',
};
export const achievementArt = (id: string) => `/rewards-v041/${ACHIEVEMENT_ART[id] ?? 'first-practice'}.png`;
export const EXPERIENCE_BANDS = [
  { from: 1, art: 'rank-pearl', title: 'Старт' }, { from: 3, art: 'rank-mint', title: 'Разгон' },
  { from: 6, art: 'rank-sky', title: 'Ритм' }, { from: 10, art: 'rank-violet', title: 'Напор' },
  { from: 16, art: 'rank-rose', title: 'Искра' }, { from: 25, art: 'rank-gold', title: 'Огонь' },
] as const;
export const experienceBand = (level: number) => [...EXPERIENCE_BANDS].reverse().find(band => level >= band.from) ?? EXPERIENCE_BANDS[0];
