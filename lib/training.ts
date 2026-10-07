import { SKILLS, type AppState, type Context, type SkillId, type LearningTrackId, type LearningActivity, type Mode, type LessonPlan } from './types';
import type { CommunicationPattern, CostCategory, DrillType, PersonalDrill, ProfileFact, CallSummary } from './calls/types';
import type { CEFRLevel, PlacementResult } from './placement/types';
import type { StrategyMoveId } from './strategy-moves';
import { BASELINE_STEPS } from './onboarding';

/** How a lesson runs. Template formats (pitch, rapidfire, replay, cards and every drill) start instantly without a planning call. */
export type LessonFormat = 'conversation' | 'pitch' | 'rapidfire' | 'replay' | 'cards' | 'writing' | 'reading' | 'listening';

export interface ScenarioFamily {
  id: string;
  title: string;
  context: Context;
  /** Russian: the communicative purpose, never a prewritten dialogue. */
  description: string;
  skills: SkillId[];
  track: LearningTrackId; activity: LearningActivity; preferredMode: Mode;
  /** v0.5 catalog metadata (absent only on the legacy calibration entries). */
  category?: CatalogCategory;
  minutes?: number;
  icon?: { sf: string; phosphor: string };
  isNew?: boolean;
  format?: LessonFormat;
  /** English observable standards of this scenario; the planner turns them into criteria and the evaluator checks them. */
  situationalNorms?: string[];
  /** Communication pattern slugs (see lib/calls) this scenario gives a fresh opportunity to beat. */
  patternIds?: string[];
  /** Pattern categories this scenario trains, for patterns without a listed slug. */
  patternCategories?: CostCategory[];
  /** Strategy moves the evaluator scores here (empty: none). */
  moves?: StrategyMoveId[];
  /** English: who the counterpart is and how they behave. A behaviour brief, never a script. */
  persona?: string;
  /** Hidden families are planned only from personal drills and never listed in the catalog. */
  hidden?: boolean;
}

/** A curated v0.5 family: every catalog field is present. */
export type CuratedFamily = ScenarioFamily & Required<Pick<ScenarioFamily, 'category' | 'minutes' | 'icon' | 'isNew' | 'format'
  | 'situationalNorms' | 'patternIds' | 'patternCategories' | 'moves' | 'persona'>>;

/** v0.5 catalog groups shown identically on iPhone and PC (Practice tab). */
export type CatalogCategory = 'strategy' | 'work' | 'life' | 'relocation' | 'ielts';
export interface CatalogFamily {
  id: string; title: string; description: string; category: CatalogCategory;
  context: Context; activity: LearningActivity; preferredMode: Mode; skills: SkillId[];
  minutes: number;                 // typical budget
  icon: { sf: string; phosphor: string }; // SF Symbol name (iOS) and Phosphor icon name without the "Icon" suffix (web)
  isNew: boolean;
  /** Additive v0.5.1 fields: how the session runs and which communication patterns it trains. */
  format: LessonFormat; patternIds: string[];
}
export interface CatalogSection { id: CatalogCategory; title: string; description: string; families: CatalogFamily[] }

/** v0.5 lesson fields kept with the plan. Root mirrors them as optional fields of `LessonPlan` in lib/types.ts. */
export interface LessonPlanExtras {
  format?: LessonFormat;
  /** Exact counterpart line from a real call that opens a replay. */
  seed?: string | null;
  /** English counterpart persona. */
  persona?: string | null;
  /** Partner speech level (placement `partnerLevel`, +1 for pressure tier 3). */
  speechLevel?: CEFRLevel | null;
  pressureTier?: 1 | 2 | 3 | null;
  /** English escalation lines (partner-only, like hidden facts; also feeds the pushback round). */
  pushback?: string[];
  situationalNorms?: string[];
  patternIds?: string[];
  /** Strategy moves scored for this lesson. */
  moves?: StrategyMoveId[];
  drillId?: string | null;
  drillType?: DrillType | null;
  /** Spaced-repetition slot of a drill (its dueAt): a new slot is a new practice opportunity, the same slot is not. */
  drillSlot?: string | null;
  mustInclude?: string[];
  mustAvoid?: string[];
  /** 0.5.3: saved phrases this lesson practises (a phrase round) or weaves in (an ordinary session), PASS-0.5.3 §1.5. */
  phraseIds?: string[];
  /** 0.5.5: the call prep this session rehearses (PASS-0.5.5 §2); its family is the hidden 'call-prep'. */
  prepId?: string | null;
  /** Snapshot of the learner context for the evaluator and hints (never sent to the partner). */
  coaching?: LessonCoaching | null;
}
export type LessonPlanV05 = LessonPlan & LessonPlanExtras;
export interface LessonCoaching {
  playbook: { kind: string; text: string }[];
  patterns: { id: string; title: string; description: string; lastQuote: string | null }[];
  levels: { overall: string; speaking: string | null; partnerLevel: CEFRLevel | null; confidence: string } | null;
}

export const LEARNING_ACTIVITIES: { id: LearningActivity; title: string }[] = [
  { id: 'speaking', title: 'Говорить' }, { id: 'listening', title: 'Слушать' },
  { id: 'reading', title: 'Читать' }, { id: 'writing', title: 'Писать' },
];
export const LEARNING_TRACKS: { id: LearningTrackId; title: string; description: string; targetSessions: number }[] = [
  { id: 'life', title: 'Обычная жизнь', description: 'Знакомства, друзья, интересы и понятные разговоры с людьми.', targetSessions: 12 },
  { id: 'work', title: 'Работа и созвоны', description: 'Питч, цена, условия, брифы, интервью и обратная связь.', targetSessions: 12 },
  { id: 'relocation', title: 'Переезд', description: 'Граница, жильё, бытовые дела и правдивые ответы в новой стране.', targetSessions: 4 },
  { id: 'ielts-foundation', title: 'Основа для IELTS', description: 'Короткие задания на речь, понимание, чтение и письмо. Это практика основ, без оценки band и имитации полного экзамена.', targetSessions: 8 },
];

type FamilyInput = Omit<CuratedFamily, 'track' | 'activity' | 'preferredMode' | 'patternCategories' | 'moves' | 'patternIds' | 'isNew'>
  & Partial<Pick<CuratedFamily, 'track' | 'activity' | 'preferredMode' | 'patternCategories' | 'moves' | 'patternIds' | 'isNew'>>;
const family = (input: FamilyInput): CuratedFamily => ({
  track: input.category === 'ielts' ? 'ielts-foundation' : input.context, activity: 'speaking', preferredMode: 'learning',
  patternCategories: [], moves: [], patternIds: [], isNew: input.category === 'strategy', ...input,
});

// Families describe communicative purposes and counterpart behaviour, never prewritten conversations.
// Order matters: it is the catalog order and the tie-break for recommendations.
export const FAMILIES: CuratedFamily[] = [
  // Strategy: the costly moments of real client calls.
  family({ id: 'strategy-pitch-30', title: 'Питч за 30 секунд', category: 'strategy', context: 'work', format: 'pitch', minutes: 5, preferredMode: 'call',
    description: 'Ответить на «расскажи о себе» за 30–45 секунд: роль, жанр, доказательство с цифрой и текущий проект. Без биографии и оговорок.',
    skills: ['positioning', 'coherence', 'vocabulary'], icon: { sf: 'mic', phosphor: 'Microphone' },
    situationalNorms: ['The introduction lasts about 25–45 seconds of speech.',
      'It names the role or specialism, one concrete proof (a number, a known name or a result) and a current or recent project.',
      'The strongest recent case comes first; no chronological biography.',
      'No disclaimers that lower perceived seniority (age, no education, "just started") and no labels instead of facts.'],
    patternIds: ['bio-not-pitch', 'beginner-framing', 'no-leverage', 'labels-not-facts', 'weak-case-first', 'permission-asking'],
    patternCategories: ['positioning', 'structure', 'fluency'], moves: ['positioning', 'proof', 'answer-first'],
    persona: 'A busy first-time contact (agency producer, startup founder, brand manager or fellow creator) who asks for a quick intro, listens, then asks one natural follow-up about something specific the learner said.' }),
  family({ id: 'strategy-agency-screening', title: 'Скрининг агентства', category: 'strategy', context: 'work', format: 'rapidfire', minutes: 10, preferredMode: 'call',
    description: 'Пройти семь стандартных вопросов: кто ты и где, бренды, модель бюджета, недавний клиент, его бюджет, сроки и интерес к агентству. Отвечать сразу по сути, своим диапазоном, и задать свой вопрос.',
    skills: ['coherence', 'positioning', 'negotiation', 'initiative'], icon: { sf: 'checklist', phosphor: 'ListChecks' },
    situationalNorms: ['Each answer gives the direct answer in its first sentence.',
      'The strongest recent case is named first when asked about brands or a recent client.',
      'Budget questions get the learner\'s own range or day rate; another client\'s fee, timing or terms are never disclosed.',
      'The learner asks at least one question about their projects, process or payment and ends with a concrete next step.'],
    patternIds: ['weak-case-first', 'fee-disclosure', 'no-discovery', 'bio-not-pitch', 'beginner-framing', 'permission-asking'],
    patternCategories: ['structure'], moves: ['answer-first', 'positioning', 'proof', 'confidential', 'discovery', 'close'],
    persona: 'A production assistant or producer at a creative agency running a standard screening checklist, writing notes and repeating numbers back. Friendly, brisk, never coaching.' }),
  family({ id: 'strategy-price', title: 'Цена и встречное предложение', category: 'strategy', context: 'work', format: 'conversation', minutes: 8,
    description: 'Клиент первым называет низкую цифру. Взять паузу, назвать свою цену или встречное предложение и обменивать объём и условия, а не делать скидку.',
    skills: ['negotiation', 'initiative', 'coherence'], icon: { sf: 'dollarsign.circle', phosphor: 'CurrencyDollar' },
    situationalNorms: ['No instant acceptance of the first number: a pause, then an own number, range or counter-offer.',
      'Concessions are traded for scope, rights, timing or volume, not given as a discount.',
      'Agreed terms are stated explicitly: fee, add-ons, deliverables and payment.', 'No apology for the price.'],
    patternIds: ['first-number', 'terms-vague', 'recap-drops-addon'], patternCategories: ['negotiation'], moves: ['anchor-hold', 'discovery', 'recap'],
    persona: 'A client or startup founder who anchors low first with a confident number. An instant yes triggers extra asks (cut-downs, raw files, more revisions); a counter triggers a question about what justifies it, and the client meets partway only for a clear trade. The real budget ceiling is revealed only when the learner asks about budget.' }),
  family({ id: 'strategy-recap-close', title: 'Резюме и следующий шаг', category: 'strategy', context: 'work', format: 'conversation', minutes: 6,
    description: 'Собеседник спрашивает «на чём остановились?» и собирается уходить. Перечислить все условия со своими доплатами и назначить следующий шаг: кто, что и когда.',
    skills: ['initiative', 'negotiation', 'coherence'], icon: { sf: 'arrow.right.circle', phosphor: 'ArrowRight' },
    situationalNorms: ['The recap names every agreed term, including the learner\'s own add-ons (licence fee, extra versions).',
      'It names what is still open.', 'It ends with a next step: who does what and by when.'],
    patternIds: ['recap-drops-addon', 'no-discovery', 'terms-vague'], patternCategories: ['closing'], moves: ['recap', 'close'],
    persona: 'A friendly client wrapping up the call and about to leave, who agrees with whatever is said but never volunteers a missing term.' }),
  family({ id: 'strategy-follow-up', title: 'Письмо после звонка', category: 'strategy', context: 'work', format: 'writing', activity: 'writing', minutes: 8,
    description: 'По сводке звонка написать клиенту короткое сообщение до 120 слов: все условия, открытые вопросы и следующий шаг.',
    skills: ['negotiation', 'coherence', 'grammar'], icon: { sf: 'envelope', phosphor: 'EnvelopeSimple' },
    situationalNorms: ['At most about 120 words.', 'Every agreed term and open item of the call summary appears, including the learner\'s own add-ons.',
      'Friendly professional register with a clear next step and date.'],
    patternIds: ['terms-vague', 'recap-drops-addon'], moves: ['recap', 'close'],
    persona: 'The client reading the message, who replies briefly and may ask about one unclear term.' }),
  family({ id: 'strategy-confidential', title: 'Чужие цены и NDA', category: 'strategy', context: 'work', format: 'conversation', minutes: 6,
    description: 'Спрашивают, сколько платил другой клиент и с кем ты работаешь. Вежливо отказать, назвать свой диапазон и делиться только публичным.',
    skills: ['negotiation', 'positioning', 'coherence'], icon: { sf: 'lock.shield', phosphor: 'ShieldCheck' },
    situationalNorms: ['Never names another client\'s fee, timing or contract terms.', 'Declines in one friendly sentence and gives the own range instead.',
      'Shares only public facts: the published work and the fact of the collaboration.'],
    patternIds: ['fee-disclosure'], patternCategories: ['confidentiality'], moves: ['confidential', 'anchor-hold'],
    persona: 'A curious producer or client who asks directly what a previous client paid and how long it took, and pushes once more if the learner hesitates.' }),
  family({ id: 'strategy-say-no', title: 'Отказ без потери лида', category: 'strategy', context: 'work', format: 'conversation', minutes: 6,
    description: 'Просят бесплатный тест, работу без бюджета или фуллтайм. Спокойно отказать, предложить альтернативу и оставить дверь открытой.',
    skills: ['positioning', 'negotiation', 'initiative'], icon: { sf: 'hand.raised', phosphor: 'HandPalm' },
    situationalNorms: ['Declines clearly without over-apologising or inventing excuses.', 'Offers an alternative: a paid test, a smaller scope or a later slot.',
      'Keeps the relationship and a concrete way to continue.'],
    moves: ['anchor-hold', 'close'],
    persona: 'A brand contact asking for a free test piece, a sponsor without budget, or a studio offering full-time work; polite and persistent once.' }),
  family({ id: 'strategy-scope-creep', title: 'Правки и рост объёма', category: 'strategy', context: 'work', format: 'conversation', minutes: 8,
    description: '«Маленькие правки» оказываются новой работой. Отделить то, что входит в договорённость, от дополнительного и оценить дополнительное, не испортив отношения.',
    skills: ['negotiation', 'reciprocity', 'coherence'], icon: { sf: 'scissors', phosphor: 'Scissors' },
    situationalNorms: ['Separates in-scope revisions from new deliverables with a concrete reason.', 'Prices or trades the extra work instead of absorbing it.',
      'Confirms the updated scope and timing.'],
    patternIds: ['terms-vague'], moves: ['anchor-hold', 'recap'],
    persona: 'A client who frames new deliverables as small tweaks, stays friendly and sounds slightly surprised when extra cost comes up.' }),
  family({ id: 'strategy-rights', title: 'Права, лицензия, лицо в рекламе', category: 'strategy', context: 'work', format: 'conversation', minutes: 8,
    description: 'Клиент хочет бессрочно крутить ролик в рекламе, в том числе с твоим лицом. Уточнить каналы и срок, ограничить их или назначить цену.',
    skills: ['negotiation', 'initiative', 'coherence'], icon: { sf: 'checkmark.seal', phosphor: 'SealCheck' },
    situationalNorms: ['Asks about or states the usage: channels, paid or organic, term and territory.',
      'Limits the term or prices extended usage; the licence ends if agreed payments stop.', 'Keeps a cooperative tone.'],
    patternIds: ['terms-vague'], moves: ['discovery', 'anchor-hold', 'recap'],
    persona: 'A marketing lead who assumes perpetual paid-ads usage, including the creator\'s face, is standard and included in the fee.' }),

  // Work.
  family({ id: 'work-call-opening', title: 'Первая минута созвона', category: 'work', context: 'work', format: 'conversation', minutes: 5, preferredMode: 'call', isNew: true,
    description: 'Разговор в начале звонка: где живёшь, переезд, возраст, учёба, как начинал. Ответить тепло и коротко, без оговорок, и перейти к делу или их проекту.',
    skills: ['positioning', 'reciprocity', 'vocabulary'], icon: { sf: 'phone', phosphor: 'Phone' },
    situationalNorms: ['Personal questions get brief, truthful answers without disclaimers that lower perceived seniority.',
      'Within one or two sentences the learner pivots to proof or to the other person\'s project.', 'Warm small talk that picks up one detail from the other person.'],
    patternIds: ['beginner-framing', 'no-research'], patternCategories: ['positioning'], moves: ['positioning', 'discovery'],
    persona: 'A friendly co-founder or producer opening a video call with small talk about location, relocation, age, studies or how the learner started.' }),
  family({ id: 'work-brief-call', title: 'Бриф-звонок', category: 'work', context: 'work', format: 'conversation', minutes: 10, isNew: true,
    description: 'Бриф расплывчатый, важные ограничения скрыты. Уточнить результат, сроки, правки, права и бюджет, пересказать задачу своими словами и договориться о шаге.',
    skills: ['reciprocity', 'initiative', 'repair'], icon: { sf: 'doc.text.magnifyingglass', phosphor: 'ClipboardText' },
    situationalNorms: ['Own questions uncover at least two hidden constraints (deadline, revisions, usage rights, budget or decision maker).',
      'The brief is restated in own words before proposing anything.', 'A next step is agreed.'],
    patternIds: ['no-discovery', 'no-research', 'terms-vague'], patternCategories: ['questions', 'listening'], moves: ['discovery', 'recap', 'close'],
    persona: 'A client with a vague brief who knows three important constraints and reveals each one only when asked about it.' }),
  family({ id: 'work-project', title: 'Обсудить проект', category: 'work', context: 'work', format: 'conversation', minutes: 10,
    description: 'Понять результат, аудиторию и ограничения клиента, предложить подход и объяснить выбор через услышанное.',
    skills: ['reciprocity', 'initiative', 'coherence', 'vocabulary'], icon: { sf: 'briefcase', phosphor: 'Briefcase' },
    situationalNorms: ['Uses at least one specific detail the client said when proposing an approach.', 'Explains why the approach fits their goal or constraint.'],
    patternIds: ['labels-not-facts'], moves: ['discovery', 'proof'],
    persona: 'A client describing an upcoming video project with one constraint that changes which approach fits.' }),
  family({ id: 'work-interview', title: 'Рабочее интервью', category: 'work', context: 'work', format: 'conversation', minutes: 12, preferredMode: 'call',
    description: 'Рассказать о реальном опыте, объяснить решения и спокойно ответить на неожиданный вопрос.',
    skills: ['coherence', 'grammar', 'repair', 'positioning'], icon: { sf: 'person.2', phosphor: 'Users' },
    situationalNorms: ['Answers lead with the point, then one concrete example.', 'Facts and results instead of labels.'],
    patternIds: ['bio-not-pitch', 'labels-not-facts', 'beginner-framing'], moves: ['answer-first', 'proof', 'positioning'],
    persona: 'An interviewer at a studio or brand who asks about real experience and adds one unexpected question.' }),
  family({ id: 'work-revisions', title: 'Разобрать обратную связь', category: 'work', context: 'work', format: 'conversation', minutes: 10,
    description: 'Понять, что именно не устроило, отделить вкус от задачи и договориться, что меняется, сохранив свою позицию.',
    skills: ['reciprocity', 'repair', 'coherence', 'grammar'], icon: { sf: 'text.bubble', phosphor: 'ChatTeardropText' },
    situationalNorms: ['Clarifies the actual problem behind the feedback before agreeing to changes.', 'Keeps or changes one creative choice with a reason.'],
    moves: ['discovery'],
    persona: 'A client giving vague feedback on a delivered video ("it doesn\'t feel premium") with one concrete issue behind it.' }),

  // Life.
  family({ id: 'life-new-city', title: 'Новые знакомые в новом городе', category: 'life', context: 'life', format: 'conversation', minutes: 8, isNew: true,
    description: 'Коворкинг, митап или зал: рассказать о себе, подхватить деталь собеседника и договориться о встрече.',
    skills: ['reciprocity', 'initiative', 'vocabulary'], icon: { sf: 'building.2', phosphor: 'Buildings' },
    situationalNorms: ['Builds on a specific detail the other person mentions.', 'Makes or accepts a concrete plan.'],
    persona: 'A friendly local or fellow newcomer at a coworking space, meetup or gym who has one detail worth picking up.' }),
  family({ id: 'life-friends', title: 'Разговор с друзьями', category: 'life', context: 'life', format: 'conversation', minutes: 10,
    description: 'Поделиться историей, подхватить деталь рассказа и договориться о совместном плане.',
    skills: ['coherence', 'reciprocity', 'grammar'], icon: { sf: 'cup.and.saucer', phosphor: 'Coffee' },
    situationalNorms: ['Tells a short story in order with one vivid detail.', 'Picks up one detail of the friend\'s story.'],
    persona: 'A friend catching up over coffee with a story of their own and a plan to suggest.' }),
  family({ id: 'life-debate', title: 'Спор: AI, искусство, философия', category: 'life', context: 'life', format: 'conversation', minutes: 10, isNew: true,
    description: 'Честно пересказать довод собеседника, признать сильную сторону и возразить на примере.',
    skills: ['coherence', 'reciprocity', 'vocabulary', 'grammar'], icon: { sf: 'lightbulb', phosphor: 'Lightbulb' },
    situationalNorms: ['Restates the other person\'s argument fairly before disagreeing.', 'Supports the own position with a concrete example.'],
    persona: 'A thoughtful opponent with a real argument about AI, art, business or philosophy who concedes only to a concrete example.' }),
  family({ id: 'life-games', title: 'Игра и команда', category: 'life', context: 'life', format: 'conversation', minutes: 8,
    description: 'Выбрать совместный формат, обсудить предпочтения, действия или игровой опыт.',
    skills: ['reciprocity', 'initiative', 'repair', 'vocabulary'], icon: { sf: 'gamecontroller', phosphor: 'GameController' },
    situationalNorms: ['Takes the other player\'s preference or constraint into account.', 'Agrees a concrete plan.'],
    persona: 'A teammate or gaming friend with a preference and a time limit.' }),
  family({ id: 'life-sport', title: 'Спорт и интересы', category: 'life', context: 'life', format: 'conversation', minutes: 8,
    description: 'Объяснить предпочтение или тренировочный опыт и выбрать совместную активность.',
    skills: ['vocabulary', 'coherence', 'reciprocity'], icon: { sf: 'figure.run', phosphor: 'Barbell' },
    situationalNorms: ['Explains a preference with a reason or an example.', 'Chooses an activity that fits both people.'],
    persona: 'A gym or sport acquaintance with their own routine and one constraint.' }),
  family({ id: 'life-group', title: 'Разговор в компании', category: 'life', context: 'life', format: 'conversation', minutes: 10,
    description: 'Вступить в общую тему, выразить свою мысль и вернуть разговор после смены направления.',
    skills: ['initiative', 'repair', 'reciprocity'], icon: { sf: 'person.3', phosphor: 'UsersThree' },
    situationalNorms: ['Joins the topic with a relevant contribution.', 'Brings the conversation back after a change of direction when it matters.'],
    persona: 'Two or three people in a casual group conversation that drifts between topics.' }),
  family({ id: 'life-travel', title: 'Поездка и обычные дела', category: 'life', context: 'life', format: 'conversation', minutes: 8,
    description: 'Уточнить условия, выбрать вариант и решить обычное недоразумение в поездке.',
    skills: ['repair', 'initiative', 'grammar', 'reciprocity'], icon: { sf: 'map', phosphor: 'MapTrifold' },
    situationalNorms: ['Clarifies the condition that matters before choosing.', 'Repairs a misunderstanding politely.'],
    persona: 'A hotel, rental or ticket desk employee with one condition the traveller does not know yet.' }),

  // Relocation: truthful language practice, never legal advice.
  family({ id: 'relocation-arrival', title: 'Паспортный контроль и первые вопросы', category: 'relocation', context: 'relocation', format: 'conversation', minutes: 6, preferredMode: 'call', isNew: true,
    description: 'Коротко и правдиво ответить о цели поездки, сроке, адресе, обратном билете и удалённой работе. Только факты из профиля, без юридических утверждений.',
    skills: ['coherence', 'repair', 'grammar'], icon: { sf: 'airplane', phosphor: 'Airplane' },
    situationalNorms: ['Short, consistent, truthful answers using only supplied facts.', 'Remote work is described accurately without legal claims.',
      'Asks for clarification instead of guessing.'],
    patternCategories: [], moves: ['answer-first'],
    persona: 'A border officer asking about purpose, length of stay, address, onward ticket and work, neutral and quick.' }),
  family({ id: 'relocation-housing', title: 'Квартира: осмотр и условия', category: 'relocation', context: 'relocation', format: 'conversation', minutes: 8, isNew: true,
    description: 'Осмотреть квартиру с арендодателем: уточнить депозит, коммунальные платежи и договор и вежливо договориться об одном пункте.',
    skills: ['repair', 'negotiation', 'reciprocity'], icon: { sf: 'house', phosphor: 'House' },
    situationalNorms: ['Clarifies deposit, utilities and contract terms.', 'Negotiates one item politely with a reason.'],
    patternIds: ['first-number'], moves: ['discovery', 'anchor-hold'],
    persona: 'A landlord showing a flat, with a deposit, extra utility costs and one contract condition mentioned only if asked.' }),
  family({ id: 'relocation-errands', title: 'Банк, SIM, коворкинг', category: 'relocation', context: 'relocation', format: 'conversation', minutes: 8, preferredMode: 'call', isNew: true,
    description: 'Открыть счёт, купить SIM или оформить коворкинг: понять требование, уточнить документы и исправить недоразумение.',
    skills: ['repair', 'reciprocity', 'vocabulary'], icon: { sf: 'building.columns', phosphor: 'Bank' },
    situationalNorms: ['Understands the requirement and confirms it in own words.', 'Repairs a misunderstanding by asking or rephrasing.'],
    persona: 'A clerk at a bank, phone shop or coworking desk with a document requirement the learner does not know yet.' }),
  family({ id: 'relocation-interview', title: 'Визовое интервью', category: 'relocation', context: 'relocation', format: 'conversation', minutes: 10, preferredMode: 'call',
    description: 'Последовательно и коротко объяснить настоящие обстоятельства поездки и понять уточнения. Языковая практика без выдуманных требований и юридических советов.',
    skills: ['coherence', 'grammar', 'repair', 'reciprocity'], icon: { sf: 'person.text.rectangle', phosphor: 'IdentificationCard' },
    situationalNorms: ['Consistent, concise, truthful answers based only on supplied facts.', 'No invented requirements, eligibility claims or guarantees.'],
    moves: ['answer-first'],
    persona: 'A consular officer asking short follow-up questions about the trip, work and ties, neutral and attentive to consistency.' }),

  // IELTS foundation: opt-in only, never part of the default rotation.
  family({ id: 'ielts-speaking', title: 'IELTS: развить ответ', category: 'ielts', context: 'life', format: 'conversation', minutes: 8,
    description: 'От короткого ответа о знакомой теме к примеру, объяснению и более сложному мнению. Без оценки произношения по расшифровке.',
    skills: ['coherence', 'vocabulary', 'grammar'], icon: { sf: 'quote.bubble', phosphor: 'ChatsCircle' },
    situationalNorms: ['Extends a familiar answer with a reason and an example.'], persona: 'A calm examiner-style partner asking about a familiar topic, then a broader question.' }),
  family({ id: 'ielts-listening', title: 'IELTS: услышать детали', category: 'ielts', context: 'life', format: 'listening', activity: 'listening', preferredMode: 'call', minutes: 8,
    description: 'Послушать короткую оригинальную историю, различить основную мысль и детали и проверить услышанное уточнением.',
    skills: ['listening', 'reciprocity', 'repair'], icon: { sf: 'ear', phosphor: 'Ear' },
    situationalNorms: ['Separates the main point from the details and checks an unclear detail.'], persona: 'A speaker telling a short original story with concrete details.' }),
  family({ id: 'ielts-reading', title: 'IELTS: прочитать и проверить', category: 'ielts', context: 'life', format: 'reading', activity: 'reading', minutes: 10,
    description: 'Прочитать небольшой оригинальный текст, найти основание для ответа и отделить вывод от того, чего в тексте нет.',
    skills: ['coherence', 'vocabulary', 'repair'], icon: { sf: 'book', phosphor: 'BookOpen' },
    situationalNorms: ['Grounds each answer in the text and separates inference from what the text says.'], persona: 'A study partner discussing the source text.' }),
  family({ id: 'ielts-writing', title: 'IELTS: небольшой аргумент', category: 'ielts', context: 'life', format: 'writing', activity: 'writing', minutes: 12,
    description: 'Написать короткий связный абзац с позицией, причиной и примером, затем самостоятельно улучшить его.',
    skills: ['coherence', 'grammar', 'vocabulary'], icon: { sf: 'pencil', phosphor: 'PencilSimple' },
    situationalNorms: ['A clear position with a reason and an example.'], persona: 'A task partner who reads the paragraph and reacts to its meaning.' }),
];

/** Drill sessions that are not a catalog scenario: a replayed real moment, cards, or a drill whose type has no catalog match. */
export const CALL_REPLAY_FAMILY: CuratedFamily = family({ id: 'call-replay', title: 'Тренировка из созвона', category: 'strategy', context: 'work',
  format: 'replay', minutes: 6, preferredMode: 'call', isNew: true, hidden: true,
  description: 'Переиграть реальный момент из своего созвона и ответить так, как стоило ответить.',
  skills: ['coherence', 'initiative', 'negotiation'], icon: { sf: 'arrow.counterclockwise', phosphor: 'ArrowCounterClockwise' },
  situationalNorms: ['The reply resolves what went wrong in the real moment.', 'The first sentence carries the main point.'],
  persona: 'The same counterpart as in the real call, reacting the way a real client or producer would.' });

/** «Мои фразы» rounds (PASS-0.5.3 §1.5): the learner's saved expressions in a short conversation. Hidden: never in the catalog. */
export const PHRASES_FAMILY: CuratedFamily = family({ id: 'my-phrases', title: 'Мои фразы', category: 'life', context: 'life',
  format: 'conversation', minutes: 5, preferredMode: 'learning', isNew: false, hidden: true,
  description: 'Сказать свои сохранённые фразы к месту в коротком разговоре, своими словами вокруг них.',
  skills: ['vocabulary', 'grammar'], icon: { sf: 'text.badge.plus', phosphor: 'BookmarkSimple' },
  situationalNorms: ['Each saved expression is used where it fits the conversation.',
    'The learner builds an own sentence around the expression instead of repeating a memorised template.'],
  persona: 'A friendly acquaintance in a quick, relaxed chat who opens natural moments for the learner\'s saved expressions and never says them.' });

/** «Подготовка к созвону» rehearsals (PASS-0.5.5): one real upcoming call, played by its counterpart. Hidden: never in the catalog. */
export const PREP_FAMILY: CuratedFamily = family({ id: 'call-prep', title: 'Репетиция созвона', category: 'strategy', context: 'work',
  format: 'conversation', minutes: 12, preferredMode: 'call', isNew: true, hidden: true,
  description: 'Прогнать предстоящий созвон с этим собеседником: его вопросы, его давление и твои цели и минимумы.',
  skills: ['positioning', 'negotiation', 'reciprocity'], icon: { sf: 'phone.badge.checkmark', phosphor: 'PhoneCall' },
  situationalNorms: ['Answers lead with the point; the strongest recent case or a concrete number comes before labels and biography.',
    'Own questions uncover what changes the offer (scope, usage, timeline, budget or decision maker) before quoting.',
    'The price floor is held: no instant yes to the first number; an own number, a counter or a trade instead of a discount.',
    "Other clients' fees, timing and terms stay confidential.", 'The recap keeps every agreed term including own add-ons, and a next step is agreed.'],
  patternCategories: ['positioning', 'negotiation', 'confidentiality', 'questions', 'closing', 'structure'],
  moves: ['answer-first', 'positioning', 'proof', 'discovery', 'anchor-hold', 'confidential', 'recap', 'close'],
  persona: "The real counterpart of an upcoming call, built from the learner's chat with him: his company, his goal and his constraints." });

/** v0.4 ids merged into v0.5 families. Old sessions and old clients keep working through these. */
export const FAMILY_ALIASES: Record<string, string> = {
  'work-agency': 'strategy-agency-screening', 'work-agreement': 'strategy-price', 'work-options': 'work-project',
  'life-people': 'life-new-city', 'life-ideas': 'life-debate',
};

/** A public family by id or merged legacy id. The hidden call-replay family is never returned here. */
export function findFamily(id: string | undefined | null): CuratedFamily | undefined {
  if (!id) return undefined;
  const canonical = FAMILY_ALIASES[id] ?? id;
  return FAMILIES.find(item => item.id === canonical);
}

/** Any family a stored lesson can refer to, including the hidden drill, «Мои фразы» and call-prep families. */
export function lessonFamily(id: string | undefined | null): CuratedFamily | undefined {
  return id === CALL_REPLAY_FAMILY.id ? CALL_REPLAY_FAMILY : id === PHRASES_FAMILY.id ? PHRASES_FAMILY : id === PREP_FAMILY.id ? PREP_FAMILY : findFamily(id);
}

/** Drill types with a catalog scenario. A seeded drill replays its real moment instead (call-replay). */
const DRILL_FAMILIES: Partial<Record<DrillType, string>> = {
  pitch: 'strategy-pitch-30', price: 'strategy-price', closing: 'strategy-recap-close', questions: 'work-brief-call',
  followup: 'strategy-follow-up', rapidfire: 'strategy-agency-screening',
};

/** The family a drill session is planned in. The returned copy carries the drill's context. */
export function familyForDrill(drill: Pick<PersonalDrill, 'type' | 'seedLine' | 'context'>): CuratedFamily {
  const seeded = !!drill.seedLine?.trim() && drill.type !== 'followup' && drill.type !== 'rapidfire';
  const mapped = seeded ? undefined : findFamily(DRILL_FAMILIES[drill.type]);
  if (mapped && mapped.context === drill.context) return mapped;
  return { ...CALL_REPLAY_FAMILY, context: drill.context, track: drill.context,
    ...(drill.type === 'followup' ? { activity: 'writing' as const, format: 'writing' as const, preferredMode: 'learning' as const } : {}) };
}

/**
 * The catalog scenario that gives this pattern the most direct fresh opportunity: a scenario listing the slug whose main purpose
 * is the pattern's category, then any scenario listing the slug, then one built for the category (catalog order breaks ties).
 */
export function familyForPattern(pattern: Pick<CommunicationPattern, 'id' | 'category' | 'contexts'>, exclude: string[] = []): CuratedFamily | undefined {
  const contexts = pattern.contexts?.length ? pattern.contexts : null;
  const eligible = FAMILIES.filter(item => item.category !== 'ielts' && item.activity === 'speaking' && !exclude.includes(item.id)
    && (!contexts || contexts.includes(item.context)));
  const listed = eligible.filter(item => item.patternIds.includes(pattern.id));
  return listed.find(item => item.patternCategories.includes(pattern.category)) ?? listed[0]
    ?? eligible.find(item => item.patternCategories.includes(pattern.category));
}

const CATALOG_SECTIONS: Record<CatalogCategory, [string, string]> = {
  strategy: ['Стратегия разговора', 'Питч, цена, условия и следующий шаг.'],
  work: ['Работа', 'Начало звонка, бриф, проект, интервью и обратная связь.'],
  life: ['Жизнь', 'Знакомства, друзья, интересы и споры.'],
  relocation: ['Переезд', 'Граница, жильё, бытовые дела и визовые вопросы.'],
  ielts: ['Основа для IELTS', 'Короткие задания на четыре навыка. Без оценки band.'],
};
export const CATALOG_ORDER: CatalogCategory[] = ['strategy', 'work', 'life', 'relocation', 'ielts'];

/** Practice tab content, identical on iPhone and PC. Hidden drill families are never listed. */
export function familyCatalog(): CatalogSection[] {
  return CATALOG_ORDER.map(id => ({ id, title: CATALOG_SECTIONS[id][0], description: CATALOG_SECTIONS[id][1],
    families: FAMILIES.filter(item => item.category === id && !item.hidden).map((item): CatalogFamily => ({
      id: item.id, title: item.title, description: item.description, category: item.category, context: item.context,
      activity: item.activity, preferredMode: item.preferredMode, skills: [...item.skills], minutes: item.minutes,
      icon: { ...item.icon }, isNew: item.isNew, format: item.format, patternIds: [...item.patternIds] })) }))
    .filter(section => section.families.length);
}

/** @deprecated v0.4 baseline probes, replaced by the placement test. Kept for old clients of GET /api/families. */
export const CALIBRATION_OPTIONS: ScenarioFamily[] = BASELINE_STEPS.map(step => ({
  id: step.familyId, title: step.title, context: step.id === 'interaction' ? 'work' : 'life',
  description: step.focus, skills: [...step.skills],
  track: step.id === 'interaction' ? 'work' : 'life', activity: step.id === 'listening' ? 'listening' : 'speaking', preferredMode: 'call',
}));

/** Text source and writing tasks cannot silently turn into audio-only calls. */
export function lessonMode(activity: LearningActivity | undefined, requested: Mode): Mode {
  return activity === 'reading' || activity === 'writing' ? 'learning' : requested;
}

/** @deprecated v0.4 baseline progress; the planner no longer schedules calibration lessons. */
export function nextCalibrationIndex(state: AppState): number {
  if (state.onboarding) {
    if (state.onboarding.status === 'ready') return -1;
    return state.onboarding.steps.findIndex(step => step.status !== 'ready');
  }
  const count = Math.max(0, Math.floor(state.calibrationCompleted));
  return count >= CALIBRATION_OPTIONS.length ? -1 : count;
}

export const shorten = (text: string | null | undefined, limit: number): string => {
  const value = (text ?? '').trim();
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};
const time = (value: string | null | undefined) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };

/** Compact placement estimate: the current level model for planning and coaching (null before the first result). */
export function placementContext(result: PlacementResult | null | undefined) {
  if (!result) return null;
  const value = result as Partial<PlacementResult> & PlacementResult;
  const labels = value.speaking?.labels;
  return {
    completedAt: value.completedAt,
    headline: shorten(value.headline, 240) || null,
    overall: { level: value.overall.level, label: value.overall.label, confidence: value.overall.confidence, summary: shorten(value.overall.summary, 500) },
    partnerLevel: value.partnerLevel ?? null,
    skills: (value.skills ?? []).map(skill => ({ id: skill.id, label: skill.label, confidence: skill.confidence,
      range: skill.range ? `${skill.range.from}–${skill.range.to}` : null })),
    speaking: { range: labels?.range ?? value.speaking?.range ?? null, accuracy: labels?.accuracy ?? value.speaking?.accuracy ?? null,
      fluency: labels?.fluency ?? value.speaking?.fluency ?? null, coherence: labels?.coherence ?? value.speaking?.coherence ?? null },
    languageTargets: (value.languageTargets ?? []).slice(0, 5).map(target => ({ tag: shorten(target.tag, 60), title: shorten(target.title, 160),
      quote: target.quote ? shorten(target.quote, 160) : null, correction: target.correction ? shorten(target.correction, 160) : null })),
    strengths: (value.communication?.strengths ?? []).slice(0, 3).map(item => shorten(item, 220)),
    risks: (value.communication?.risks ?? []).slice(0, 4).map(item => shorten(item, 220)),
    moves: (value.communication?.moves ?? []).map(move => ({ id: move.id, score: move.score })),
    priorities: (value.priorities ?? []).slice(0, 3).map(item => ({ title: shorten(item.title, 160), action: shorten(item.action, 300) })),
    limitations: (value.limitations ?? []).slice(0, 2).map(item => shorten(item, 240)),
  };
}

const FACT_ORDER = ['rate', 'floor', 'case', 'metric', 'confidential', 'positioning', 'relocation', 'counterpart', 'preference', 'other'];
const PLAYBOOK_BUDGET = 1600;
/** Learner-confirmed facts (the PLAYBOOK): accepted facts only, grouped by kind, about 1.5 KB at most. */
export function playbookContext(facts: ProfileFact[] | undefined): { kind: string; text: string }[] {
  const accepted = (facts ?? []).filter(fact => fact.status === 'accepted' && fact.text?.trim())
    .sort((a, b) => FACT_ORDER.indexOf(a.kind ?? 'other') - FACT_ORDER.indexOf(b.kind ?? 'other') || time(b.createdAt) - time(a.createdAt));
  const result: { kind: string; text: string }[] = [];
  let used = 0;
  for (const fact of accepted) {
    const text = shorten(fact.text, 240);
    if (result.length >= 24 || used + text.length > PLAYBOOK_BUDGET) break;
    used += text.length; result.push({ kind: fact.kind ?? 'other', text });
  }
  return result;
}

const PATTERN_STATUS_ORDER = { active: 0, improving: 1, watch: 2, resolved: 3 } as const;
/** Active/improving weaknesses first (most expensive first), then a few active strengths. Patterns are not skills. */
export function patternContext(patterns: CommunicationPattern[] | undefined) {
  const usable = (patterns ?? []).filter(pattern => !pattern.dismissed && (pattern.status === 'active' || pattern.status === 'improving'));
  const order = (a: CommunicationPattern, b: CommunicationPattern) => PATTERN_STATUS_ORDER[a.status] - PATTERN_STATUS_ORDER[b.status]
    || (a.costRank ?? 5) - (b.costRank ?? 5) || b.occurrences - a.occurrences || time(b.lastSeenAt) - time(a.lastSeenAt) || a.id.localeCompare(b.id);
  const describe = (pattern: CommunicationPattern) => ({
    id: pattern.id, title: shorten(pattern.title, 140), kind: pattern.kind, category: pattern.category, status: pattern.status,
    costRank: pattern.costRank ?? null, contexts: pattern.contexts ?? [], occurrences: pattern.occurrences,
    description: shorten(pattern.description, 280), drillHint: shorten(pattern.drillHint, 200),
    lastStatus: pattern.history?.at(-1)?.status ?? null, lastQuote: pattern.evidence?.[0]?.quote ? shorten(pattern.evidence[0].quote, 200) : null,
    real: pattern.real ?? null, practice: pattern.practice ? { attempts: pattern.practice.attempts, independentSuccesses: pattern.practice.independentSuccesses } : null,
  });
  return [...usable.filter(pattern => pattern.kind === 'weakness').sort(order).slice(0, 6).map(describe),
    ...usable.filter(pattern => pattern.kind === 'strength' && pattern.status === 'active').sort(order).slice(0, 3).map(describe)];
}

/** Personal drills still to do, due ones first. */
export function pendingDrillContext(drills: PersonalDrill[] | undefined) {
  return (drills ?? []).filter(drill => drill.status !== 'done')
    .sort((a, b) => (a.dueAt ? time(a.dueAt) : Infinity) - (b.dueAt ? time(b.dueAt) : Infinity) || time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 6).map(drill => ({ title: shorten(drill.title, 160), type: drill.type, goal: shorten(drill.goal, 240), context: drill.context, tier: drill.tier ?? null }));
}

/** The last reviewed real calls: their outcome and most expensive moment. */
export function recentCallContext(calls: CallSummary[] | undefined) {
  return (calls ?? []).filter(call => call.status === 'ready')
    .sort((a, b) => time(b.occurredAt ?? b.createdAt) - time(a.occurredAt ?? a.createdAt) || a.id.localeCompare(b.id)).slice(0, 3)
    .map(call => ({ title: shorten(call.title, 120), date: call.occurredAt ?? call.createdAt, context: call.context,
      outcome: call.outcome ? shorten(call.outcome, 240) : null, topCost: call.topCost ? shorten(call.topCost, 160) : null }));
}

/** Snapshot stored with a planned lesson so the evaluator and hints use the same standards the plan was built with. */
export function lessonCoaching(state: AppState, focusPatternIds: string[] = []): LessonCoaching {
  const placement = placementContext(state.placement?.result);
  const active = (state.patterns ?? []).filter(pattern => !pattern.dismissed && pattern.kind === 'weakness'
    && (pattern.status === 'active' || pattern.status === 'improving'));
  const ordered = [...active].sort((a, b) => Number(focusPatternIds.includes(b.id)) - Number(focusPatternIds.includes(a.id))
    || (a.costRank ?? 5) - (b.costRank ?? 5) || b.occurrences - a.occurrences || a.id.localeCompare(b.id)).slice(0, 6);
  return {
    playbook: playbookContext(state.profileFacts),
    patterns: ordered.map(pattern => ({ id: pattern.id, title: shorten(pattern.title, 140), description: shorten(pattern.description, 240),
      lastQuote: pattern.evidence?.[0]?.quote ? shorten(pattern.evidence[0].quote, 200) : null })),
    levels: placement ? { overall: placement.overall.label, speaking: placement.skills.find(skill => skill.id === 'speaking')?.label ?? null,
      partnerLevel: placement.partnerLevel, confidence: placement.overall.confidence } : null,
  };
}

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
    /** The current level estimate from the placement test; null means the level is unknown. */
    placement: placementContext(state.placement?.result),
    /** Learner-confirmed facts and rules (accepted call facts and seeds). */
    playbook: playbookContext(state.profileFacts),
    /** Recurring communication patterns from real calls and practice. They are not skills. */
    patterns: patternContext(state.patterns),
    pendingDrills: pendingDrillContext(state.drills),
    recentCalls: recentCallContext(state.calls),
    skills: SKILLS.map(skill => {
      const observed = state.skills.find(item => item.id === skill.id);
      return {
        skill: skill.id, label: skill.label, group: skill.group,
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
      || a.id.localeCompare(b.id)).slice(0, 8).map(session => {
      const extra = session.analysis as (typeof session.analysis & { outcome?: { achieved: string }; patternHits?: { patternId: string; outcome: string }[] }) | null;
      return {
        id: session.id, status: session.status, date: session.createdAt,
        familyId: session.lesson.familyId, title: session.lesson.title,
        context: session.lesson.context, kind: session.lesson.kind,
        goal: shorten(session.lesson.goal, 600), support: session.support,
        summary: session.analysis ? shorten(session.analysis.summary, 1000) : null,
        nextFocus: session.analysis ? shorten(session.analysis.nextFocus, 700) : null,
        outcome: extra?.outcome?.achieved ?? null,
        patternHits: (extra?.patternHits ?? []).slice(0, 4).map(hit => ({ patternId: hit.patternId, outcome: hit.outcome })),
        evidence: session.analysis?.evidence.filter(item => item.result !== 'unobserved')
          .map(item => ({ ...item, quote: shorten(item.quote, 400), reason: shorten(item.reason, 500) })) ?? [],
        comfort: session.comfort ?? null,
      };
    }),
  };
}
