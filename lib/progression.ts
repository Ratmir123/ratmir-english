import { SKILLS, type AppState, type LearningActivity, type LearningTrackId, type PracticeResult, type ProgressionState, type Session, type SkillId } from './types';
import { FAMILIES, LEARNING_ACTIVITIES, LEARNING_TRACKS } from './training';

const observable = new Set<SkillId>(SKILLS.filter(skill => skill.id !== 'clarity').map(skill => skill.id));
const outcomes = new Set(['success', 'partial', 'difficulty']);
const normalized = (text: string) => text.trim().replace(/\s+/g, ' ');
const validTime = (value: string | undefined) => value ? Date.parse(value) : NaN;

/** Whitespace, presentation fields and regenerated IDs never create another practice opportunity. */
export function lessonMaterialSignature(session: Session): string {
  const lesson = session.lesson;
  return JSON.stringify([lesson.familyId, normalized(lesson.opening), normalized(lesson.role), normalized(lesson.npcBrief),
    lesson.hiddenFacts.map(normalized), lesson.successCriteria.map(normalized), normalized(lesson.difficulty), normalized(lesson.languageFocus),
    lesson.material ? [lesson.material.type, normalized(lesson.material.text), normalized(lesson.material.instruction)] : null]);
}

export function lessonActivity(session: Session): { track: LearningTrackId; activity: LearningActivity } {
  const family = FAMILIES.find(item => item.id === session.lesson.familyId);
  return { track: family?.track ?? session.lesson.track ?? session.lesson.context,
    activity: family?.activity ?? session.lesson.activity ?? 'speaking' };
}

/** This counts grounded observations, never guessed pronunciation or numbered criteria passed. */
export function practiceEvidence(session: Session): PracticeResult['evidence'] {
  if (!session.analysis) return [];
  const activity = lessonActivity(session).activity;
  const evidence: PracticeResult['evidence'] = [];
  for (const item of session.analysis.evidence) {
    if (!observable.has(item.skill) || !item.opportunity || !outcomes.has(item.result)) continue;
    if (activity === 'writing' && !['grammar', 'vocabulary', 'coherence'].includes(item.skill)) continue;
    if (activity === 'reading' && item.skill === 'listening') continue;
    const index = session.turns.findIndex(turn => turn.id === item.turnId);
    const turn = session.turns[index];
    if (!turn || turn.role !== 'user' || turn.disputed || !normalized(item.quote)
      || !normalized(turn.text).includes(normalized(item.quote))) continue;
    if (item.skill === 'listening') {
      const heard = session.turns.slice(0, index).findLast(value => value.role === 'assistant');
      if (!heard || heard.source !== 'audio' || heard.support > 0 || heard.disputed || turn.support > 0 || turn.transcriptEdited || item.supported) continue;
    }
    evidence.push({ skill: item.skill, result: item.result as 'success' | 'partial' | 'difficulty',
      supported: item.supported || turn.support > 0 || !!turn.transcriptEdited, turnId: turn.id, quote: item.quote });
  }
  const conflicts = new Set<string>();
  for (const item of evidence) {
    if (evidence.some(other => other.skill === item.skill && other.turnId === item.turnId
      && ((other.result === 'success') !== (item.result === 'success')))) conflicts.add(`${item.skill}:${item.turnId}`);
  }
  const seen = new Set<string>();
  return evidence.filter(item => {
    const key = `${item.skill}:${item.turnId}`;
    if (conflicts.has(key) || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function practiceResult(session: Session, now = Date.now()): PracticeResult | null {
  if (session.status !== 'completed' || session.baseline || session.lesson.kind === 'calibration' || !session.analysis
    || !Number.isSafeInteger(session.analysis.version) || session.analysis.version < 1) return null;
  const evidence = practiceEvidence(session);
  const completed = validTime(session.completedAt ?? session.updatedAt);
  const created = validTime(session.createdAt);
  // Store CAS timestamps may lead the wall clock by a few milliseconds.
  if (!evidence.length || !Number.isFinite(completed) || completed > now + 1000 || !Number.isFinite(created) || completed < created) return null;
  const analysed = validTime(session.analysis.createdAt);
  const saved = validTime(session.updatedAt);
  const improvement = session.analysis.priorities.length > 0 ? session.retries.filter(retry => retry.improved === true
    && (retry.analysisVersion === undefined || retry.analysisVersion === session.analysis!.version)
    && !!retry.text.trim() && !retry.transcriptEdited
    && Number.isFinite(validTime(retry.createdAt)) && validTime(retry.createdAt) >= created
    && (!Number.isFinite(analysed) || validTime(retry.createdAt) >= analysed)
    && Number.isFinite(saved) && validTime(retry.createdAt) <= saved && validTime(retry.createdAt) <= now + 1000)
    .sort((a, b) => validTime(a.createdAt) - validTime(b.createdAt))[0] : undefined;
  // A deferred retry can be improved later without changing the original practice day.
  const improvedRetry = !!improvement;
  const targets = new Set(session.lesson.targetSkills.filter(skill => observable.has(skill)));
  const seenTargets = new Set(evidence.filter(item => targets.has(item.skill)).map(item => item.skill));
  return { sessionId: session.id, xp: 15 + (improvedRetry ? 5 : 0), completedAt: new Date(completed).toISOString(),
    ...lessonActivity(session), improvedRetry, ...(improvement ? { improvedAt: new Date(validTime(improvement.createdAt)).toISOString() } : {}), evidence,
    quality: { observedTargets: seenTargets.size, targetCount: targets.size,
      independentSuccesses: evidence.filter(item => item.result === 'success' && !item.supported).length,
      supportedObservations: evidence.filter(item => item.supported).length,
      partial: evidence.filter(item => item.result === 'partial').length,
      difficulty: evidence.filter(item => item.result === 'difficulty').length } };
}

/** Latest persisted state wins; an old cached completion cannot overwrite a source edit. */
export function practiceResults(sessions: Session[], now = Date.now()): PracticeResult[] {
  const current = new Map<string, Session>();
  for (const session of sessions) {
    const key = session.clientRequestId ?? session.id;
    const previous = current.get(key);
    const time = validTime(session.updatedAt); const before = validTime(previous?.updatedAt);
    if (!previous || (Number.isFinite(time) && (!Number.isFinite(before) || time > before))
      || (time === before && session.id.localeCompare(previous.id) < 0)) current.set(key, session);
  }
  const variants = new Map<string, PracticeResult>();
  for (const session of [...current.values()].sort((a, b) => validTime(a.createdAt) - validTime(b.createdAt) || a.id.localeCompare(b.id))) {
    const result = practiceResult(session, now); if (!result) continue;
    const key = lessonMaterialSignature(session); const previous = variants.get(key);
    if (!previous || result.xp > previous.xp) variants.set(key, result);
  }
  return [...variants.values()].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.sessionId.localeCompare(b.sessionId));
}

export function deriveProgression(sessions: Session[], now = Date.now()): ProgressionState {
  const results = practiceResults(sessions, now);
  const xp = results.reduce((total, result) => total + result.xp, 0);
  const level = Math.floor(xp / 100) + 1;
  const levelFloorXP = (level - 1) * 100; const nextLevelXP = level * 100;
  const days = new Set<string>();
  const observedSkills = new Set<string>();
  let independentSuccesses = 0; let supportedObservations = 0; let partial = 0; let difficulty = 0;
  const tracks = LEARNING_TRACKS.map(track => ({ ...track,
    completedSessions: results.filter(result => result.track === track.id).length,
    activities: LEARNING_ACTIVITIES.map(activity => ({ ...activity,
      completedSessions: results.filter(result => result.track === track.id && result.activity === activity.id).length,
      targetSessions: track.id === 'ielts-foundation' ? 2 : activity.id === 'speaking' ? track.targetSessions : 0 })) }));
  const milestones = [
    { id: 'first-practice', title: 'Первое дело', description: 'Завершить первое занятие с разобранной собственной попыткой.', target: 1 },
    { id: 'three-days', title: 'Возвращаюсь к делу', description: 'Практиковаться в три разных дня по UTC.', target: 3 },
    { id: 'ten-practices', title: 'Десять настоящих попыток', description: 'Завершить десять разных разобранных занятий.', target: 10 },
    { id: 'own-improvement', title: 'Сам исправил', description: 'Завершить занятие с подтверждённой улучшенной попыткой.', target: 1 },
    { id: 'balanced-practice', title: 'И в жизни, и в работе', description: 'Разобрать по три разных занятия о жизни и работе.', target: 3 },
    { id: 'independent-listening', title: 'Услышал и использовал', description: 'В пяти разных занятиях подтвердить понимание аудио без текста и подсказок.', target: 5 },
    { id: 'ielts-four-sides', title: 'Четыре стороны языка', description: 'Попробовать все четыре направления основы для IELTS. Это опыт практики, не экзаменационный результат.', target: 4 },
  ];
  const unlocks = new Map<string, string>();
  let completed = 0; let improved = 0; let life = 0; let work = 0; let heard = 0;
  const ieltsActivities = new Set<string>();
  let counts: Record<string, number> = {};
  for (const result of results) {
    completed++; days.add(result.completedAt.slice(0, 10));
    if (result.improvedRetry) improved++;
    if (result.track === 'life') life++; if (result.track === 'work') work++;
    if (result.evidence.some(item => item.skill === 'listening' && item.result === 'success' && !item.supported)) heard++;
    if (result.track === 'ielts-foundation') ieltsActivities.add(result.activity);
    for (const item of result.evidence) observedSkills.add(item.skill);
    independentSuccesses += result.quality.independentSuccesses;
    supportedObservations += result.quality.supportedObservations;
    partial += result.quality.partial; difficulty += result.quality.difficulty;
    counts = { 'first-practice': completed, 'three-days': days.size, 'ten-practices': completed,
      'own-improvement': improved, 'balanced-practice': Math.min(life, work),
      'independent-listening': heard, 'ielts-four-sides': ieltsActivities.size };
    for (const milestone of milestones) if (!unlocks.has(milestone.id) && counts[milestone.id] >= milestone.target) unlocks.set(milestone.id, result.completedAt);
  }
  const firstImprovement = results.flatMap(result => result.improvedAt ? [result.improvedAt] : []).sort()[0];
  if (firstImprovement) unlocks.set('own-improvement', firstImprovement);
  return { version: 1, xp, level, levelTitle: `Уровень опыта ${level}`, levelFloorXP, nextLevelXP,
    xpInLevel: xp - levelFloorXP, xpToNextLevel: nextLevelXP - xp,
    completedPractice: results.length, practiceDays: days.size, practiceDayTimezone: 'UTC',
    evidenceCoverage: { observedSkills: observedSkills.size, observableSkills: observable.size,
      independentSuccesses, supportedObservations, partial, difficulty },
    tracks, achievements: milestones.map(milestone => ({ ...milestone, current: counts[milestone.id] ?? 0,
      unlocked: unlocks.has(milestone.id), unlockedAt: unlocks.get(milestone.id) ?? null })),
    recentResults: [...results].reverse().slice(0, 12),
    notice: 'XP и уровень опыта показывают завершённую практику. Они не означают CEFR, IELTS band или владение навыком. Наблюдения с опорами и самостоятельные ответы отмечаются отдельно.' };
}

/** Allocates a small mixed curriculum; Sol still authors and adapts the actual task. */
export function nextRecommendedFamily(state: AppState, now = Date.now()): NonNullable<ProgressionState['recommendation']> | null {
  if (state.onboarding ? state.onboarding.status !== 'ready' : nextCalibrationPending(state)) return null;
  const results = practiceResults(state.sessions, now);
  const byId = new Map(state.sessions.map(session => [session.id, session]));
  const counted = new Set(results.map(result => result.sessionId));
  const ordinary = FAMILIES.filter(family => family.track === 'life' || family.track === 'work');
  const life = results.filter(result => result.track === 'life').length;
  const work = results.filter(result => result.track === 'work').length;
  const balanced = life > work ? 'work' : 'life';
  const familyCount = (id: string) => results.filter(result => byId.get(result.sessionId)?.lesson.familyId === id).length;
  const due = state.reviews.filter(item => Date.parse(item.dueAt) <= now && counted.has(item.sourceSessionId));
  const last = results.at(-1);
  const lastKind = last ? byId.get(last.sessionId)?.lesson.kind : undefined;
  let chosen; let why: string;
  if (due.length && lastKind !== 'retention') {
    chosen = [...ordinary].sort((a, b) => Number(b.skills.some(skill => due.some(item => item.skill === skill)))
      - Number(a.skills.some(skill => due.some(item => item.skill === skill)))
      || Number(b.track === balanced) - Number(a.track === balanced) || familyCount(a.id) - familyCount(b.id))[0];
    why = 'Сначала проверим, что осталось от прошлой практики, в новой ситуации без готового ответа.';
  } else if (results.length >= 5 && Math.floor((results.length + 1) / 6) > results.filter(result => result.track === 'ielts-foundation').length) {
    chosen = [...FAMILIES.filter(family => family.track === 'ielts-foundation')]
      .sort((a, b) => familyCount(a.id) - familyCount(b.id))[0];
    why = 'Добавим короткое задание для IELTS в наименее опробованном направлении. Основная практика остаётся про жизнь и работу.';
  } else {
    chosen = ordinary.filter(family => family.track === balanced).sort((a, b) => familyCount(a.id) - familyCount(b.id))[0];
    why = balanced === 'work' ? 'Рабочих ситуаций пока меньше. Возьмём короткую практику для созвонов и интервью.'
      : 'Держим баланс с обычной жизнью и пробуем менее знакомую ситуацию.';
  }
  return chosen ? { familyId: chosen.id, title: chosen.title, track: chosen.track, activity: chosen.activity, preferredMode: chosen.preferredMode, why } : null;
}

function nextCalibrationPending(state: AppState) { return state.calibrationCompleted < 3; }
