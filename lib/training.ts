import { SKILLS, type AppState, type Context, type SkillId, type LearningTrackId, type LearningActivity, type Mode } from './types';
import { BASELINE_STEPS } from './onboarding';

export interface ScenarioFamily {
  id: string;
  title: string;
  context: Context;
  description: string;
  skills: SkillId[];
  track: LearningTrackId; activity: LearningActivity; preferredMode: Mode;
}

export const LEARNING_ACTIVITIES: { id: LearningActivity; title: string }[] = [
  { id: 'speaking', title: 'Говорить' }, { id: 'listening', title: 'Слушать' },
  { id: 'reading', title: 'Читать' }, { id: 'writing', title: 'Писать' },
];
export const LEARNING_TRACKS: { id: LearningTrackId; title: string; description: string; targetSessions: number }[] = [
  { id: 'life', title: 'Обычная жизнь', description: 'Знакомства, игры, интересы и понятные разговоры с людьми.', targetSessions: 12 },
  { id: 'work', title: 'Работа и интервью', description: 'Проекты, решения, обратная связь и разговоры о своём опыте.', targetSessions: 12 },
  { id: 'relocation', title: 'Переезд', description: 'Правдивые ответы, бытовые ситуации и уточнения в новой стране.', targetSessions: 4 },
  { id: 'ielts-foundation', title: 'Основа для IELTS', description: 'Короткие задания на речь, понимание, чтение и письмо. Это практика основ, без оценки band и имитации полного экзамена.', targetSessions: 8 },
];

// Families describe communicative purposes, never prewritten conversations.
const conversationFamilies: Omit<ScenarioFamily, 'track' | 'activity' | 'preferredMode'>[] = [
  { id: 'work-project', title: 'Обсудить проект', context: 'work', description: 'Понять результат, аудиторию и ограничения клиента и предложить подход.', skills: ['reciprocity', 'initiative', 'vocabulary', 'coherence'] },
  { id: 'work-agency', title: 'Знакомство с агентством', context: 'work', description: 'Показать релевантный опыт и выяснить взаимное соответствие, условия и следующий шаг.', skills: ['coherence', 'initiative', 'vocabulary'] },
  { id: 'work-interview', title: 'Рабочее интервью', context: 'work', description: 'Рассказать о реальном опыте, объяснить решения и отреагировать на неожиданный вопрос.', skills: ['coherence', 'grammar', 'repair'] },
  { id: 'work-revisions', title: 'Обсудить правки', context: 'work', description: 'Уточнить смысл обратной связи и обсудить изменение результата, сохранив собственную позицию.', skills: ['reciprocity', 'repair', 'grammar', 'coherence'] },
  { id: 'work-options', title: 'Предложить решение', context: 'work', description: 'Сравнить подходы к CG или AI-видео и объяснить выбор с учётом полученной информации.', skills: ['vocabulary', 'coherence', 'reciprocity', 'grammar'] },
  { id: 'work-agreement', title: 'Договориться о работе', context: 'work', description: 'Обсудить объём, сроки, ответственность и свои границы без выдуманных условий или обещаний.', skills: ['initiative', 'grammar', 'repair', 'reciprocity'] },
  { id: 'life-people', title: 'Познакомиться', context: 'life', description: 'Найти общую тему с новым человеком, рассказать о себе и развить его конкретную мысль.', skills: ['vocabulary', 'reciprocity', 'initiative'] },
  { id: 'life-games', title: 'Игра и команда', context: 'life', description: 'Выбрать совместный формат, обсудить предпочтения, действия или игровой опыт.', skills: ['reciprocity', 'initiative', 'repair', 'vocabulary'] },
  { id: 'life-friends', title: 'Разговор с друзьями', context: 'life', description: 'Поделиться историей, подхватить деталь рассказа и договориться о совместном плане.', skills: ['coherence', 'reciprocity', 'grammar'] },
  { id: 'life-travel', title: 'Поездка и обычные дела', context: 'life', description: 'Уточнить условия, выбрать вариант и решить обычное недоразумение в поездке.', skills: ['repair', 'initiative', 'grammar', 'reciprocity'] },
  { id: 'life-ideas', title: 'Идеи и несогласие', context: 'life', description: 'Обсудить AI, бизнес или философию, разобраться в доводе и обосновать собственную позицию.', skills: ['coherence', 'reciprocity', 'vocabulary', 'grammar'] },
  { id: 'life-sport', title: 'Спорт и интересы', context: 'life', description: 'Объяснить предпочтение или тренировочный опыт и выбрать совместную активность.', skills: ['vocabulary', 'coherence', 'reciprocity'] },
  { id: 'life-group', title: 'Разговор в компании', context: 'life', description: 'Вступить в общую тему, выразить свою мысль и вернуть разговор после смены направления.', skills: ['initiative', 'repair', 'reciprocity'] },
  { id: 'relocation-arrival', title: 'Новая страна', context: 'relocation', description: 'Объяснить реальные планы, уточнить обычные условия и справиться с вопросами после переезда.', skills: ['grammar', 'repair', 'initiative', 'vocabulary'] },
  { id: 'relocation-interview', title: 'Интервью о поездке', context: 'relocation', description: 'Последовательно объяснить настоящие обстоятельства и понять уточнения; языковая практика без выдуманных визовых требований.', skills: ['coherence', 'grammar', 'repair', 'reciprocity'] },
];

export const FAMILIES: ScenarioFamily[] = [
  ...conversationFamilies.map(family => ({ ...family, track: family.context, activity: 'speaking' as const, preferredMode: 'learning' as const })),
  { id: 'ielts-speaking', title: 'IELTS: развить ответ', context: 'life', track: 'ielts-foundation', activity: 'speaking', preferredMode: 'learning',
    description: 'От короткого ответа о знакомой теме к примеру, объяснению и более сложному мнению. Без оценки произношения по расшифровке.', skills: ['coherence', 'vocabulary', 'grammar'] },
  { id: 'ielts-listening', title: 'IELTS: услышать детали', context: 'life', track: 'ielts-foundation', activity: 'listening', preferredMode: 'call',
    description: 'Послушать короткую оригинальную историю, различить основную мысль и детали и проверить услышанное уточнением.', skills: ['listening', 'reciprocity', 'repair'] },
  { id: 'ielts-reading', title: 'IELTS: прочитать и проверить', context: 'life', track: 'ielts-foundation', activity: 'reading', preferredMode: 'learning',
    description: 'Прочитать небольшой оригинальный текст, найти основание для ответа и отделить вывод от того, чего в тексте нет.', skills: ['coherence', 'vocabulary', 'repair'] },
  { id: 'ielts-writing', title: 'IELTS: небольшой аргумент', context: 'life', track: 'ielts-foundation', activity: 'writing', preferredMode: 'learning',
    description: 'Написать короткий связный абзац с позицией, причиной и примером, затем самостоятельно улучшить его.', skills: ['coherence', 'grammar', 'vocabulary'] },
];

export const CALIBRATION_OPTIONS: ScenarioFamily[] = BASELINE_STEPS.map(step => ({
  id: step.familyId, title: step.title, context: step.id === 'interaction' ? 'work' : 'life',
  description: step.focus, skills: [...step.skills],
  track: step.id === 'interaction' ? 'work' : 'life', activity: step.id === 'listening' ? 'listening' : 'speaking', preferredMode: 'call',
}));

/** Text source and writing tasks cannot silently turn into audio-only calls. */
export function lessonMode(activity: LearningActivity | undefined, requested: Mode): Mode {
  return activity === 'reading' || activity === 'writing' ? 'learning' : requested;
}

export function nextCalibrationIndex(state: AppState): number {
  if (state.onboarding) {
    if (state.onboarding.status === 'ready') return -1;
    return state.onboarding.steps.findIndex(step => step.status !== 'ready');
  }
  const count = Math.max(0, Math.floor(state.calibrationCompleted));
  return count >= CALIBRATION_OPTIONS.length ? -1 : count;
}

const shorten = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit)}…`;

/** Bounded planning context. Audio files and full archived conversations are not needed. */
export function summaryContext(state: AppState) {
  const completedSessions = state.sessions.filter(session => session.status === 'completed'
    && !session.baseline && session.lesson.kind !== 'calibration' && session.lesson.track !== 'ielts-foundation');
  return {
    profile: {
      name: shorten(state.profile.name, 120),
      goals: shorten(state.profile.goals, 1800),
      interests: state.profile.interests.slice(0, 15).map(topic => shorten(topic, 140)),
      professionalContext: shorten(state.profile.professionalContext, 2200),
      relocation: shorten(state.profile.relocation, 1600),
      dailyMinutes: state.profile.dailyMinutes,
      feedback: shorten(state.profile.feedback, 1200),
    },
    calibration: { completed: state.onboarding?.completedStages ?? state.calibrationCompleted,
      nextIndex: nextCalibrationIndex(state), status: state.onboarding?.status ?? 'legacy',
      // This is an uncertain initial observation, not a mastery certificate.
      baseline: state.onboarding?.report ?? null },
    skills: SKILLS.map(skill => {
      const observed = state.skills.find(item => item.id === skill.id);
      return {
        skill: skill.id, label: skill.label,
        state: observed?.state ?? 'unknown',
        independentSuccesses: observed?.independentSuccesses ?? 0,
        transfer: observed?.transfer ?? false,
        retention: observed?.retention ?? false,
        lastChecked: observed?.lastChecked ?? null,
        examples: observed?.examples.slice(-3).map(example => ({ ...example, quote: shorten(example.quote, 450), reason: shorten(example.reason, 450) })) ?? [],
      };
    }),
    completedContexts: {
      work: completedSessions.filter(session => session.lesson.context === 'work').length,
      life: completedSessions.filter(session => session.lesson.context === 'life').length,
      relocation: completedSessions.filter(session => session.lesson.context === 'relocation').length,
    },
    reviews: [...state.reviews].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 12),
    // Store order is not part of this contract: recent attempts must remain recent
    // when state comes from a database, an import, or an in-memory caller.
    recentSessions: [...state.sessions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
      || a.id.localeCompare(b.id)).slice(0, 8).map(session => ({
      id: session.id, status: session.status, date: session.createdAt,
      familyId: session.lesson.familyId, title: session.lesson.title,
      context: session.lesson.context, kind: session.lesson.kind,
      goal: shorten(session.lesson.goal, 600), support: session.support,
      summary: session.analysis ? shorten(session.analysis.summary, 1000) : null,
      nextFocus: session.analysis ? shorten(session.analysis.nextFocus, 700) : null,
      evidence: session.analysis?.evidence.map(item => ({ ...item, quote: shorten(item.quote, 400), reason: shorten(item.reason, 500) })) ?? [],
      comfort: session.comfort ?? null,
    })),
  };
}
