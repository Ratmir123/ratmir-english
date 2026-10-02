import type { BaselineStepId, Evidence, OnboardingState, Session, SkillId, Turn } from './types';

export const ONBOARDING_VERSION = 1 as const;
export const RUSSIAN_CONTROL_PROMPT = 'Знакомый говорит: «Хочу снова тренироваться, но после работы почти нет сил. В выходные обычно получается выбраться на прогулку». Ответь ему как в обычном разговоре, в 2–4 предложениях по-русски. Здесь нет обязательного вопроса или единственно правильной реплики.';
export const BASELINE_STEPS = [
  { id: 'expression', familyId: 'calibration-expression', title: 'Своя мысль голосом',
    focus: 'Объяснить опыт, причину и своё мнение на английском без готовых формулировок.', minutes: 7,
    skills: ['vocabulary', 'grammar', 'coherence'],
    instruction: 'Choose a familiar interest from the current profile. Elicit a concrete past experience, a reason or opinion, and a future/conditional choice across a short natural exchange. Start accessibly; add one meaningful follow-up suited to the response. At least two genuine learner responses should have an opportunity to demonstrate available vocabulary, sentence construction and connected meaning. Do not coach, provide answer frames, insist on a word count, or claim to assess acoustic fluency.' },
  { id: 'listening', familyId: 'calibration-project', title: 'Услышать и использовать деталь',
    focus: 'Понять смысл и детали на слух, пересказать главное и учесть новое условие в ответе.', minutes: 7,
    skills: ['listening', 'reciprocity', 'repair'],
    instruction: 'Use a plausible short everyday collaboration related to the profile. The English-speaking partner provides two or three concrete details including a meaningful constraint in their opening and asks the learner to explain the main point in their own words or suggest a suitable next action. Later introduce one changed detail. This is an audio-only understanding probe: invite a genuine response using heard content, never verbatim memorisation. A request for repetition/clarification is a valid repair action. No comprehension answer, transcript, teacher hint or obligatory question quota is supplied by the partner.' },
  { id: 'interaction', familyId: 'calibration-adaptation', title: 'Разговор и сложная мысль',
    focus: 'Обсудить рабочую задачу или сложную идею, проявить интерес и справиться с неясностью.', minutes: 8,
    skills: ['initiative', 'reciprocity', 'repair', 'coherence'],
    instruction: 'Use the learner\'s real professional context or a complex interest. Give a plausible incomplete brief or conflicting preference, then let the learner explain an approach, respond to the partner\'s specific point, and choose whether/how to clarify a consequential ambiguity. Create room for initiative without doing all useful questioning on the learner\'s behalf. Multiple effective conversational actions are valid; do not prescribe a question quota or punish a simple but relevant opinion. Obtain at least two original learner responses with genuine communicative opportunities. Never invent achievements or visa requirements.' },
] as const satisfies readonly { id: BaselineStepId; familyId: string; title: string; focus: string; minutes: number; skills: readonly SkillId[]; instruction: string }[];

export function baselineStep(id: BaselineStepId) { return BASELINE_STEPS.find(step => step.id === id)!; }
export function unassistedSpokenTurns(session: Session): Turn[] {
  return session.turns.filter(turn => turn.role === 'user' && turn.source === 'audio' && !!turn.audioFile
    && turn.support === 0 && !turn.disputed && !turn.transcriptEdited && !!turn.text.trim());
}
export function eligibleBaselineEvidence(session: Session, evidence: Evidence): boolean {
  if (!session.analysis || evidence.skill === 'clarity' || !evidence.opportunity || evidence.supported
    || !['success', 'partial', 'difficulty'].includes(evidence.result)) return false;
  const turn = unassistedSpokenTurns(session).find(item => item.id === evidence.turnId);
  if (!turn || !evidence.quote.trim() || !turn.text.includes(evidence.quote)) return false;
  if (evidence.skill === 'listening') {
    const index = session.turns.findIndex(item => item.id === turn.id);
    const partner = session.turns.slice(0, index).findLast(item => item.role === 'assistant');
    if (!partner || partner.source !== 'audio' || partner.support !== 0 || partner.disputed) return false;
  }
  return true;
}
export function baselineMissingEvidence(session: Session, stepId: BaselineStepId): string | null {
  if (session.baseline?.version !== ONBOARDING_VERSION || session.baseline.stepId !== stepId) return 'Это занятие не относится к текущей стартовой проверке.';
  if (!session.analysis || !['review', 'completed'].includes(session.status)) return 'Сначала нужен разбор исходных ответов.';
  if (session.analysis.model !== 'gpt-6.1-sol') return 'Разбор должен быть выполнен подключённой моделью Sol.';
  if (unassistedSpokenTurns(session).length < 2) return 'Нужны хотя бы два своих ответа голосом без подсказок и исправления расшифровки. Хорошая оценка не обязательна.';
  const observed = new Set(session.analysis.evidence.filter(item => eligibleBaselineEvidence(session, item)).map(item => item.skill));
  if (stepId === 'expression' && ['vocabulary', 'grammar', 'coherence'].filter(skill => observed.has(skill as SkillId)).length < 2) {
    return 'Для стартового профиля пока мало наблюдений о словах, построении фраз и связности мысли. Можно пройти новый короткий эпизод.';
  }
  if (stepId === 'listening' && !observed.has('listening')) return 'Понимание на слух пока не проверено: нужен ответ на реально прослушанную реплику без её текста и подсказок.';
  if (stepId === 'interaction' && !['initiative', 'reciprocity', 'repair', 'coherence'].some(skill => observed.has(skill as SkillId))) {
    return 'Пока мало наблюдений о самом разговоре. Нужен новый короткий эпизод с выбором, уточнением или реакцией на собеседника.';
  }
  return null;
}
export function selectedBaselineSessions(sessions: Session[]): Session[] {
  const latest = [...sessions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return BASELINE_STEPS.flatMap(step => {
    const selected = latest.find(session => baselineMissingEvidence(session, step.id) === null);
    return selected ? [selected] : [];
  });
}
export function deriveOnboardingSteps(sessions: Session[]): OnboardingState['steps'] {
  const latest = [...sessions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return BASELINE_STEPS.map(step => {
    const attempts = latest.filter(session => session.baseline?.version === ONBOARDING_VERSION && session.baseline.stepId === step.id);
    const usable = attempts.find(session => baselineMissingEvidence(session, step.id) === null);
    const current = usable ?? attempts[0];
    return { id: step.id, familyId: step.familyId, title: step.title, focus: step.focus, minutes: step.minutes,
      status: usable ? 'ready' : current?.status === 'analysing' ? 'analysing' : current ? 'in_progress' : 'pending',
      sessionId: current?.id ?? null,
      missingEvidence: current && !usable ? baselineMissingEvidence(current, step.id) : null };
  });
}

/** A good score is never required. Only an original, analysable sample advances the baseline. */
export function baselineStartDecision(onboarding: OnboardingState, sessions: Session[], requested?: BaselineStepId):
  { kind: 'practice' } | { kind: 'baseline'; stepId: BaselineStepId; resumeSessionId?: string } | { kind: 'blocked'; reason: string } {
  if (onboarding.status === 'intro') return { kind: 'blocked', reason: 'Сначала познакомься с тренингом и ответь на короткую ситуацию по-русски.' };
  if (onboarding.status === 'ready') return requested
    ? { kind: 'blocked', reason: 'Стартовые пробы уже разобраны. Можно выбрать обычную практику.' }
    : { kind: 'practice' };
  if (!requested) return { kind: 'blocked', reason: 'Сначала пройди три короткие стартовые пробы. Они нужны, чтобы тренинг опирался на твои ответы.' };
  const next = onboarding.steps.find(step => step.status !== 'ready');
  if (!next || next.id !== requested) return { kind: 'blocked', reason: 'Сначала закончи текущую стартовую пробу. Следующую можно пройти в другой день.' };
  const current = next.sessionId ? sessions.find(session => session.id === next.sessionId) : undefined;
  // A review without independent evidence can be retaken. Pending work is resumed,
  // so another click cannot buy a second model plan or discard a recorded sample.
  const resumeSessionId = current && !['review', 'completed'].includes(current.status) ? current.id : undefined;
  return { kind: 'baseline', stepId: requested, ...(resumeSessionId ? { resumeSessionId } : {}) };
}
