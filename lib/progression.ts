import { SKILLS, type Analysis, type AppState, type LearningActivity, type LearningTrackId, type PracticeResult, type ProgressionState, type Session, type SkillId } from './types';
import { FAMILIES, LEARNING_ACTIVITIES, LEARNING_TRACKS, PHRASES_FAMILY, familyForDrill, familyForPattern, findFamily, shorten, type CuratedFamily, type LessonPlanV05 } from './training';
import type { CommunicationPattern, PatternOutcome, PersonalDrill } from './calls/types';
import type { StrategyMoveId, StrategyMoveScore } from './strategy-moves';
import { validSpeechTiming } from './speech-timing';

const DAY = 86_400_000;
const outcomes = new Set(['success', 'partial', 'difficulty']);
const normalized = (text: string) => text.trim().replace(/\s+/g, ' ');
const validTime = (value: string | undefined | null) => value ? Date.parse(value) : NaN;

const WRITTEN_SKILLS = new Set<SkillId>(['grammar', 'vocabulary', 'coherence', 'positioning', 'negotiation']);
/** Which skills an activity can actually expose. Clarity needs acoustic evidence the app does not have. */
export function skillObservableIn(activity: LearningActivity, skill: SkillId): boolean {
  if (skill === 'clarity') return false;
  if (activity === 'writing') return WRITTEN_SKILLS.has(skill);
  if (activity === 'reading') return skill !== 'listening';
  return true;
}
const observableCount = SKILLS.filter(skill => skill.id !== 'clarity').length;

/** Whitespace, presentation fields and regenerated IDs never create another practice opportunity. */
export function lessonMaterialSignature(session: Session): string {
  const lesson = session.lesson;
  return JSON.stringify([lesson.familyId, normalized(lesson.opening), normalized(lesson.role), normalized(lesson.npcBrief),
    lesson.hiddenFacts.map(normalized), lesson.successCriteria.map(normalized), normalized(lesson.difficulty), normalized(lesson.languageFocus),
    lesson.material ? [lesson.material.type, normalized(lesson.material.text), normalized(lesson.material.instruction)] : null]);
}

/** Registered catalog families own track and activity; drill sessions keep what their plan recorded. */
export function lessonActivity(session: Session): { track: LearningTrackId; activity: LearningActivity } {
  const family = findFamily(session.lesson.familyId);
  return { track: family?.track ?? session.lesson.track ?? session.lesson.context,
    activity: family?.activity ?? session.lesson.activity ?? 'speaking' };
}

/** This counts grounded observations, never guessed pronunciation or numbered criteria passed. */
export function practiceEvidence(session: Session): PracticeResult['evidence'] {
  if (!session.analysis) return [];
  const activity = lessonActivity(session).activity;
  const evidence: PracticeResult['evidence'] = [];
  for (const item of session.analysis.evidence) {
    if (!SKILLS.some(skill => skill.id === item.skill) || !skillObservableIn(activity, item.skill) || !item.opportunity || !outcomes.has(item.result)) continue;
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

/** Shared eligibility for reward navigation and XP; a changed label never loosens source/date/retry checks. */
export function qualifyingRetryImprovement(session: Session, now = Date.now()): Session['retries'][number] | undefined {
  if (!session.analysis || !Number.isSafeInteger(session.analysis.version) || session.analysis.version < 1
    || !session.analysis.priorities.length) return undefined;
  const created = validTime(session.createdAt); const analysed = validTime(session.analysis.createdAt); const saved = validTime(session.updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(saved)) return undefined;
  return session.retries.filter(retry => retry.improved === true
    && (retry.analysisVersion === undefined || retry.analysisVersion === session.analysis!.version)
    && !!retry.text.trim() && !retry.transcriptEdited
    && Number.isFinite(validTime(retry.createdAt)) && validTime(retry.createdAt) >= created
    && (!Number.isFinite(analysed) || validTime(retry.createdAt) >= analysed)
    && validTime(retry.createdAt) <= saved && validTime(retry.createdAt) <= now + 1000)
    .sort((a, b) => validTime(a.createdAt) - validTime(b.createdAt))[0];
}

/** A session started from a personal drill (its plan records the drill, or the caller lists it). */
export function isDrillSession(session: Session, drillSessionIds?: ReadonlySet<string>): boolean {
  return !!(session.lesson as LessonPlanV05).drillId || !!drillSessionIds?.has(session.id);
}

/** A «Мои фразы» round (PASS-0.5.3 §1.5.1): short like a drill. Phrases woven into an ordinary lesson change nothing here. */
export function isPhraseRoundSession(session: Session): boolean {
  return session.lesson.familyId === PHRASES_FAMILY.id;
}

/** XP: a lesson is 15, a short drill or phrase round 8 (+4 with an independent success); a confirmed improved retry adds 5. */
export function practiceResult(session: Session, now = Date.now(), drillSessionIds?: ReadonlySet<string>): PracticeResult | null {
  if (session.status !== 'completed' || session.baseline || session.lesson.kind === 'calibration' || !session.analysis
    || !Number.isSafeInteger(session.analysis.version) || session.analysis.version < 1) return null;
  const evidence = practiceEvidence(session);
  const completed = validTime(session.completedAt ?? session.updatedAt);
  const created = validTime(session.createdAt);
  // Store CAS timestamps may lead the wall clock by a few milliseconds.
  if (!evidence.length || !Number.isFinite(completed) || completed > now + 1000 || !Number.isFinite(created) || completed < created) return null;
  const improvement = qualifyingRetryImprovement(session, now);
  // A deferred retry can be improved later without changing the original practice day.
  const improvedRetry = !!improvement;
  const targets = new Set<SkillId>(session.lesson.targetSkills.filter(skill => skill !== 'clarity'));
  const seenTargets = new Set(evidence.filter(item => targets.has(item.skill)).map(item => item.skill));
  const independentSuccesses = evidence.filter(item => item.result === 'success' && !item.supported).length;
  const base = isDrillSession(session, drillSessionIds) || isPhraseRoundSession(session) ? 8 + (independentSuccesses ? 4 : 0) : 15;
  return { sessionId: session.id, xp: base + (improvedRetry ? 5 : 0), completedAt: new Date(completed).toISOString(),
    ...lessonActivity(session), improvedRetry, ...(improvement ? { improvedAt: new Date(validTime(improvement.createdAt)).toISOString() } : {}), evidence,
    quality: { observedTargets: seenTargets.size, targetCount: targets.size, independentSuccesses,
      supportedObservations: evidence.filter(item => item.supported).length,
      partial: evidence.filter(item => item.result === 'partial').length,
      difficulty: evidence.filter(item => item.result === 'difficulty').length } };
}

/** Latest persisted state wins; an old cached completion cannot overwrite a source edit. */
export function practiceResults(sessions: Session[], now = Date.now(), drillSessionIds?: ReadonlySet<string>): PracticeResult[] {
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
    const result = practiceResult(session, now, drillSessionIds); if (!result) continue;
    // A scheduled drill repetition (a new due slot) is a new opportunity; restarting the same slot is not.
    const slot = (session.lesson as LessonPlanV05).drillSlot;
    const key = lessonMaterialSignature(session) + (slot ? `#${slot}` : ''); const previous = variants.get(key);
    if (!previous || result.xp > previous.xp) variants.set(key, result);
  }
  return [...variants.values()].sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.sessionId.localeCompare(b.sessionId));
}

/** Evidence-based inputs from placement and real calls, supplied by the store (pure: nothing is fetched here). */
export interface ProgressionExtras {
  /** One entry per completed, not skipped, placement section of any attempt: +15 XP each. */
  placementSections?: { attemptId: string; section: string; completedAt: string }[];
  /** One entry per completed placement result: «Знаю свой уровень». */
  placementResults?: { attemptId: string; completedAt: string }[];
  /** Real calls with a ready review: +40 XP each; their strategy moves and pattern outcomes drive real-world achievements,
   * and every pattern avoided on a call adds +25 once per pattern per call. */
  calls?: { callId: string; reviewedAt: string; moves?: StrategyMoveScore[]; patterns?: { patternId: string; status: PatternOutcome }[] }[];
  /** Practice sessions started from personal drills, when their plan does not record the drill itself. */
  drillSessionIds?: string[];
  /** Patterns that moved to improving or resolved, with the time it happened: «Паттерн сдаётся». */
  patternImprovements?: { patternId: string; at: string }[];
}

const MILESTONES = [
  { id: 'first-practice', title: 'Первое дело', description: 'Завершить первое занятие с разобранной собственной попыткой.', target: 1 },
  { id: 'three-days', title: 'Возвращаюсь к делу', description: 'Практиковаться в три разных дня.', target: 3 },
  { id: 'ten-practices', title: 'Десять настоящих попыток', description: 'Завершить десять разных разобранных занятий.', target: 10 },
  { id: 'own-improvement', title: 'Сам исправил', description: 'Завершить занятие с подтверждённой улучшенной попыткой.', target: 1 },
  { id: 'balanced-practice', title: 'И в жизни, и в работе', description: 'Разобрать по три разных занятия о жизни и работе.', target: 3 },
  { id: 'independent-listening', title: 'Услышал и использовал', description: 'В пяти разных занятиях подтвердить понимание аудио без текста и подсказок.', target: 5 },
  { id: 'ielts-four-sides', title: 'Четыре стороны языка', description: 'Попробовать все четыре направления основы для IELTS. Это опыт практики, не экзаменационный результат.', target: 4 },
  { id: 'placement-complete', title: 'Знаю свой уровень', description: 'Пройти тест уровня до конца и получить результат по навыкам.', target: 1 },
  { id: 'first-call-review', title: 'Первый разбор звонка', description: 'Загрузить реальный созвон и получить его разбор.', target: 1 },
  { id: 'call-replay', title: 'Переиграл момент', description: 'Завершить тренировку из созвона: переиграть реальный момент и получить разбор.', target: 1 },
  { id: 'pattern-improving', title: 'Паттерн сдаётся', description: 'Паттерн из созвонов перешёл в «улучшается» или «решён».', target: 1 },
  { id: 'counter-offer', title: 'Встречная цифра', description: 'На реальном созвоне ответить на цифру клиента своей цифрой или обменом, а не мгновенным согласием.', target: 1 },
  { id: 'no-disclaimers', title: 'Без дисклеймеров ×3', description: 'Три реальных созвона без оговорок про возраст, образование или «только начал».', target: 3 },
  { id: 'case-first', title: 'Кейс первым', description: 'На реальном созвоне начать с сильного свежего кейса или конкретного доказательства.', target: 1 },
  { id: 'dated-next-step', title: 'Закрыл шагом с датой', description: 'Закончить реальный созвон следующим шагом: кто, что и когда.', target: 1 },
  { id: 'clean-pitch', title: 'Чистый питч', description: 'Питч до 45 секунд с конкретной цифрой или результатом и без оговорок.', target: 1 },
] as const;

type AnalysisExtras = Analysis & { strategyMoves?: StrategyMoveScore[]; patternHits?: { patternId: string; outcome: string }[] };
/** «Чистый питч»: a measured 15–45 s spoken pitch with proof and no seniority disclaimer, from the evaluator's grounded moves. */
export function cleanPitch(session: Session | undefined): boolean {
  if (!session?.analysis) return false;
  const lesson = session.lesson as LessonPlanV05;
  if (lesson.familyId !== 'strategy-pitch-30' && lesson.drillType !== 'pitch') return false;
  const analysis = session.analysis as AnalysisExtras;
  const score = (id: StrategyMoveId) => analysis.strategyMoves?.find(move => move.id === id)?.score ?? null;
  if (score('proof') !== 2 || score('positioning') === 0) return false;
  if (analysis.patternHits?.some(hit => hit.patternId === 'beginner-framing' && hit.outcome === 'repeated')) return false;
  const pitch = session.turns.find(turn => turn.role === 'user');
  if (!pitch || pitch.source !== 'audio' || pitch.disputed || pitch.transcriptEdited || !validSpeechTiming(pitch.speechTiming, pitch.audioFile)) return false;
  const timing = pitch.speechTiming;
  return timing.quality !== 'no-speech' && timing.speechSpanSeconds >= 15 && timing.speechSpanSeconds <= 45;
}

export function deriveProgression(sessions: Session[], now = Date.now(), extras: ProgressionExtras = {}): ProgressionState {
  const drillIds = new Set(extras.drillSessionIds ?? []);
  const results = practiceResults(sessions, now, drillIds);
  const byId = new Map(sessions.map(session => [session.id, session]));
  const valid = (value: string | undefined) => {
    const time = validTime(value);
    return Number.isFinite(time) && time <= now + 1000 ? new Date(time).toISOString() : null;
  };
  const unique = <T>(items: T[] | undefined, key: (item: T) => string, at: (item: T) => string) => {
    const seen = new Map<string, string>();
    for (const item of items ?? []) {
      const id = key(item); const when = valid(at(item));
      if (!id || !when) continue;
      if (!seen.has(id) || when < seen.get(id)!) seen.set(id, when);
    }
    return [...seen.values()].sort();
  };
  const sectionTimes = unique(extras.placementSections, item => item.attemptId && item.section ? `${item.attemptId}:${item.section}` : '', item => item.completedAt);
  const placementTimes = unique(extras.placementResults, item => item.attemptId, item => item.completedAt);
  const improvementTimes = unique(extras.patternImprovements, item => item.patternId, item => item.at);
  // One entry per call: a repeated id is ignored (the first entry wins), so XP cannot be counted twice.
  const firstByCall = new Map<string, NonNullable<ProgressionExtras['calls']>[number] & { reviewedAt: string }>();
  for (const call of extras.calls ?? []) {
    const reviewedAt = valid(call.reviewedAt);
    if (call.callId && reviewedAt && !firstByCall.has(call.callId)) firstByCall.set(call.callId, { ...call, reviewedAt });
  }
  const calls = [...firstByCall.values()].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.callId.localeCompare(b.callId));
  const avoided = new Set(calls.flatMap(call => (call.patterns ?? []).filter(item => item.status === 'avoided' && item.patternId)
    .map(item => `${item.patternId}:${call.callId}`)));
  const practiceXP = results.reduce((total, result) => total + result.xp, 0);
  const xp = practiceXP + 15 * sectionTimes.length + 40 * calls.length + 25 * avoided.size;
  const level = Math.floor(xp / 100) + 1;
  const levelFloorXP = (level - 1) * 100; const nextLevelXP = level * 100;

  const observedSkills = new Set<string>();
  let independentSuccesses = 0; let supportedObservations = 0; let partial = 0; let difficulty = 0;
  for (const result of results) {
    for (const item of result.evidence) observedSkills.add(item.skill);
    independentSuccesses += result.quality.independentSuccesses;
    supportedObservations += result.quality.supportedObservations;
    partial += result.quality.partial; difficulty += result.quality.difficulty;
  }
  const tracks = LEARNING_TRACKS.map(track => ({ ...track,
    completedSessions: results.filter(result => result.track === track.id).length,
    activities: LEARNING_ACTIVITIES.map(activity => ({ ...activity,
      completedSessions: results.filter(result => result.track === track.id && result.activity === activity.id).length,
      targetSessions: track.id === 'ielts-foundation' ? 2 : activity.id === 'speaking' ? track.targetSessions : 0 })) }));

  // Each achievement is a chronological list of qualifying events: progress is their count, the unlock is the target-th event.
  const days = new Set<string>(); const dayEvents: string[] = [];
  let life = 0; let work = 0; const balancedEvents: string[] = [];
  const ielts = new Set<string>(); const ieltsEvents: string[] = [];
  for (const result of results) {
    const day = result.completedAt.slice(0, 10);
    if (!days.has(day)) { days.add(day); dayEvents.push(result.completedAt); }
    if (result.track === 'life') life++; if (result.track === 'work') work++;
    while (balancedEvents.length < Math.min(life, work)) balancedEvents.push(result.completedAt);
    if (result.track === 'ielts-foundation' && !ielts.has(result.activity)) { ielts.add(result.activity); ieltsEvents.push(result.completedAt); }
  }
  const move = (call: typeof calls[number], id: StrategyMoveId) => call.moves?.find(item => item.id === id)?.score ?? null;
  const outcome = (call: typeof calls[number], id: string) => call.patterns?.find(item => item.patternId === id)?.status ?? null;
  const callEvents = (test: (call: typeof calls[number]) => boolean) => calls.filter(test).map(call => call.reviewedAt);
  const events: Record<typeof MILESTONES[number]['id'], string[]> = {
    'first-practice': results.map(result => result.completedAt),
    'three-days': dayEvents,
    'ten-practices': results.map(result => result.completedAt),
    'own-improvement': results.flatMap(result => result.improvedAt ? [result.improvedAt] : []).sort(),
    'balanced-practice': balancedEvents,
    'independent-listening': results.filter(result => result.evidence.some(item => item.skill === 'listening' && item.result === 'success' && !item.supported))
      .map(result => result.completedAt),
    'ielts-four-sides': ieltsEvents,
    'placement-complete': placementTimes,
    'first-call-review': calls.map(call => call.reviewedAt),
    'call-replay': results.filter(result => { const session = byId.get(result.sessionId); return !!session && isDrillSession(session, drillIds); })
      .map(result => result.completedAt),
    'pattern-improving': improvementTimes,
    'counter-offer': callEvents(call => move(call, 'anchor-hold') === 2 || outcome(call, 'first-number') === 'avoided'),
    'no-disclaimers': callEvents(call => move(call, 'positioning') === 2 || outcome(call, 'beginner-framing') === 'avoided'),
    'case-first': callEvents(call => move(call, 'proof') === 2 || outcome(call, 'weak-case-first') === 'avoided'),
    'dated-next-step': callEvents(call => move(call, 'close') === 2),
    'clean-pitch': results.filter(result => cleanPitch(byId.get(result.sessionId))).map(result => result.completedAt),
  };
  return { version: 1, xp, level, levelTitle: `Уровень опыта ${level}`, levelFloorXP, nextLevelXP,
    xpInLevel: xp - levelFloorXP, xpToNextLevel: nextLevelXP - xp,
    completedPractice: results.length, practiceDays: days.size, practiceDayTimezone: 'UTC',
    evidenceCoverage: { observedSkills: observedSkills.size, observableSkills: observableCount,
      independentSuccesses, supportedObservations, partial, difficulty },
    tracks,
    // The counter never exceeds the target: «6/1» is a display bug, the unlock itself is unchanged.
    achievements: MILESTONES.map(milestone => {
      const list = events[milestone.id]; const unlocked = list.length >= milestone.target;
      return { id: milestone.id, title: milestone.title, description: milestone.description, target: milestone.target,
        current: Math.min(list.length, milestone.target), unlocked, unlockedAt: unlocked ? list[milestone.target - 1] : null };
    }),
    recentResults: [...results].reverse().slice(0, 12),
    notice: 'XP и уровень опыта показывают усилия: занятия, тест уровня и разборы созвонов. Они не означают CEFR, IELTS band или владение навыком. Наблюдения с опорами и самостоятельные ответы отмечаются отдельно.' };
}

export type Recommendation = NonNullable<ProgressionState['recommendation']>;
const time = (value: string | null | undefined) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : NaN; };

/** Hot drills (fresh from a review in the last 7 days) first, then drills whose spaced repetition is due. */
export function nextDrill(drills: PersonalDrill[] | undefined, now = Date.now()): { drill: PersonalDrill; due: boolean } | null {
  const usable = (drills ?? []).map((drill, index) => ({ drill, index })).filter(({ drill }) => drill?.id && drill.title?.trim());
  const hot = usable.filter(({ drill }) => drill.status === 'new' && time(drill.createdAt) > now - 7 * DAY && time(drill.createdAt) <= now + 1000)
    .sort((a, b) => time(b.drill.createdAt) - time(a.drill.createdAt) || a.index - b.index);
  if (hot.length) return { drill: hot[0].drill, due: false };
  const due = usable.filter(({ drill }) => drill.status !== 'started' && drill.dueAt && time(drill.dueAt) <= now
    && !(drill.completedAt && time(drill.completedAt) >= time(drill.dueAt)))
    .sort((a, b) => time(a.drill.dueAt) - time(b.drill.dueAt) || a.index - b.index);
  return due.length ? { drill: due[0].drill, due: true } : null;
}

function familyRecommendation(family: CuratedFamily, why: string, source: Recommendation['source']): Recommendation {
  return { familyId: family.id, title: family.title, track: family.track, activity: family.activity, preferredMode: family.preferredMode, why, drillId: null, source };
}

/**
 * The ONE next step for Today (after placement, unfinished sessions and calls, which the client checks first):
 * 1–2. personal drills (hot from the last 7 days, then due), 3. due retention reviews, 4. the most expensive active pattern,
 * 5. work/life balance over 7 days plus the relocation pack; IELTS only when the learner chose it recently.
 * Null until the placement test has a result: Today shows the test then.
 */
export function nextRecommendation(state: AppState, now = Date.now(), options: { includeDrills?: boolean } = {}): Recommendation | null {
  if (!state.placement?.result) return null;
  if (options.includeDrills !== false) {
    const next = nextDrill(state.drills, now);
    if (next) {
      const { drill, due } = next; const family = familyForDrill(drill);
      return { familyId: family.id, title: shorten(drill.title, 140), track: drill.context, activity: family.activity, preferredMode: family.preferredMode,
        why: due ? `Пора повторить. ${shorten(drill.why || drill.goal, 280)}` : shorten(drill.why || drill.goal || 'Из свежего разбора созвона.', 320),
        drillId: drill.id, source: 'drill' };
    }
  }
  const results = practiceResults(state.sessions, now);
  const byId = new Map(state.sessions.map(session => [session.id, session]));
  const familyOf = (sessionId: string) => findFamily(byId.get(sessionId)?.lesson.familyId)?.id ?? byId.get(sessionId)?.lesson.familyId;
  const familyCount = (id: string) => results.filter(result => familyOf(result.sessionId) === id).length;
  const last = results.at(-1);
  const lastFamily = last ? familyOf(last.sessionId) : undefined;
  const recent = results.filter(result => Date.parse(result.completedAt) > now - 7 * DAY);
  const recentCount = (track: LearningTrackId) => recent.filter(result => result.track === track).length;
  const relocationActive = !!state.profile.relocation?.trim()
    || (state.profileFacts ?? []).some(fact => fact.status === 'accepted' && fact.kind === 'relocation');
  const ieltsChosen = state.sessions.some(session => session.lesson.track === 'ielts-foundation' && Date.parse(session.createdAt) > now - 14 * DAY);
  const lanes = [{ track: 'work' as const, weight: 2 }, { track: 'life' as const, weight: 2 },
    ...(relocationActive ? [{ track: 'relocation' as const, weight: 1 }] : []),
    ...(ieltsChosen ? [{ track: 'ielts-foundation' as const, weight: 1 }] : [])];
  const lane = [...lanes].sort((a, b) => recentCount(a.track) / a.weight - recentCount(b.track) / b.weight)[0].track;
  const pool = (track: LearningTrackId) => FAMILIES.filter(item => item.track === track && !item.hidden);
  const leastPractised = (items: CuratedFamily[]) => [...items].sort((a, b) => Number(a.id === lastFamily) - Number(b.id === lastFamily)
    || familyCount(a.id) - familyCount(b.id))[0];

  const counted = new Set(results.map(result => result.sessionId));
  const due = state.reviews.filter(item => Date.parse(item.dueAt) <= now && counted.has(item.sourceSessionId));
  const lastKind = last ? byId.get(last.sessionId)?.lesson.kind : undefined;
  if (due.length && lastKind !== 'retention') {
    const ordinary = [...pool('work'), ...pool('life')].filter(item => item.activity === 'speaking');
    const covers = (item: CuratedFamily) => Number(item.skills.some(skill => due.some(review => review.skill === skill)));
    const chosen = [...ordinary].sort((a, b) => covers(b) - covers(a) || Number(b.track === lane) - Number(a.track === lane)
      || Number(a.id === lastFamily) - Number(b.id === lastFamily) || familyCount(a.id) - familyCount(b.id))[0];
    const focus = [...due].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0].focus;
    if (chosen) return familyRecommendation(chosen, `Пора проверить, что осталось с прошлой практики: «${shorten(focus, 140)}». Новая ситуация, без готового ответа.`, 'review');
  }

  // Pattern quests lead while the week is not already tilted towards work.
  if (recentCount('work') <= recentCount('life') + 1) {
    const patterns = (state.patterns ?? []).filter(pattern => pattern.kind === 'weakness' && pattern.status === 'active' && !pattern.dismissed)
      .sort((a, b) => (a.costRank ?? 5) - (b.costRank ?? 5) || b.occurrences - a.occurrences || (time(b.lastSeenAt) || 0) - (time(a.lastSeenAt) || 0) || a.id.localeCompare(b.id));
    for (const pattern of patterns) {
      const chosen = familyForPattern(pattern, lastFamily ? [lastFamily] : []);
      if (chosen) return familyRecommendation(chosen, patternWhy(pattern), 'pattern');
    }
  }

  const chosen = leastPractised(pool(lane));
  const why = lane === 'work' ? 'За эту неделю рабочих разговоров меньше. Берём ситуацию из созвонов, которую ты пробовал реже.'
    : lane === 'life' ? 'Держим баланс: за неделю разговоров об обычной жизни меньше.'
    : lane === 'relocation' ? 'Переезд скоро. Короткая практика на месте: граница, жильё, бытовые дела.'
    : 'Ты недавно выбирал IELTS. Добавим направление, где попыток меньше.';
  return chosen ? familyRecommendation(chosen, why, 'balance') : null;
}

function patternWhy(pattern: CommunicationPattern): string {
  const quote = pattern.evidence?.[0]?.quote;
  return `Паттерн «${shorten(pattern.title, 80)}» ещё активен${quote ? `. Последний раз: “${shorten(quote, 120)}”` : ''}. Сегодня новая ситуация, где его можно обойти.`;
}

/** @deprecated v0.4 name kept for callers; see nextRecommendation. */
export const nextRecommendedFamily = nextRecommendation;
