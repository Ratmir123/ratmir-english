import type { CommunicationPattern, CostCategory } from '../../calls/types';

/**
 * Generic seed definitions for communication patterns (no learner or client data). A pattern row is created only when a
 * real call references it; the lifecycle (watch → active → improving → resolved) is computed in lifecycle.ts.
 * costRank follows the contract: 1 = most expensive, 5 = cheapest.
 */
export type PatternDefinition = Pick<CommunicationPattern, 'id' | 'title' | 'kind' | 'category' | 'description' | 'drillHint' | 'costRank' | 'contexts'>;

const WORK: PatternDefinition['contexts'] = ['work'];
const ALL: PatternDefinition['contexts'] = ['work', 'life', 'relocation'];

function weakness(id: string, title: string, category: CostCategory, costRank: PatternDefinition['costRank'], description: string, drillHint: string,
  contexts = WORK): PatternDefinition {
  return { id, title, kind: 'weakness', category, costRank, contexts, description, drillHint };
}
function strength(id: string, title: string, category: CostCategory, description: string, drillHint: string): PatternDefinition {
  return { id, title, kind: 'strength', category, costRank: 5, contexts: WORK, description, drillHint };
}

export const SEED_PATTERNS: PatternDefinition[] = [
  weakness('fee-disclosure', 'Называешь чужой гонорар и сроки', 'confidentiality', 1,
    'На вопрос о бюджете прошлого проекта называешь, сколько и за какой срок заплатил другой клиент. Цифра становится якорем ниже твоей цены, а такие условия часто закрыты NDA.',
    'Вежливо закрыть чужие условия и сразу назвать свою вилку: «Условия клиента раскрыть не могу, для такой работы мой диапазон…».'),
  weakness('first-number', 'Соглашаешься на первую цифру клиента', 'negotiation', 1,
    'Первое предложение клиента принимаешь в ту же секунду: без паузы, встречной цифры и обмена на условия.',
    'Взять паузу, разделить объём работ и назвать свою цифру или обмен: цена против объёма, срока или прав.'),
  weakness('beginner-framing', 'Подаёшь себя новичком', 'positioning', 2,
    'Возраст, отсутствие образования, «только начал» и «недавно» звучат раньше доказательств и до разговора о цене. Покупатель слышит «дёшево и джун».',
    'На вопросы о себе: роль, годы опыта, жанр, цифра и текущий клиент. Про возраст и учёбу одной фразой и сразу к фактам.'),
  weakness('no-leverage', 'Не включаешь рычаг: нет цифр', 'positioning', 2,
    'Собеседник сам говорит о результате или формате, а ты не подкрепляешь это своими цифрами: просмотрами, ростом, результатами клиентов.',
    'Держать наготове две-три проверенные цифры и вставлять одну, как только собеседник заговорил о результате или ценности.'),
  weakness('bio-not-pitch', 'Биография вместо питча', 'structure', 3,
    'На «расскажи о себе» идёт хронология на минуты вместо короткого питча под задачу собеседника.',
    'Питч на 30–45 секунд: кто ты, жанр, доказательство цифрой, свежий клиент и мост к их задаче.'),
  weakness('weak-case-first', 'Слабый или старый кейс первым', 'positioning', 3,
    'На вопрос о брендах и недавних клиентах первым звучит старый или слабый проект, а свежий сильный кейс теряется.',
    'Отвечать на «с кем работал» сильнейшим свежим кейсом, остальное одной фразой.'),
  weakness('no-discovery', 'Мало вопросов, нет следующего шага', 'questions', 3,
    'Не узнаёшь объём, бюджет, сроки, кто решает и какие права нужны, и уходишь без договорённости, кто что делает дальше.',
    'Задать вопрос по делу, когда собеседник описывает задачу, и закрыть звонок конкретным шагом: кто, что и когда.'),
  weakness('recap-drops-addon', 'Теряешь свои доплаты в резюме', 'closing', 3,
    'В итоговом резюме договорённостей пропадают доплаты, на которые собеседник уже согласился.',
    'Перед прощанием проговорить условия по пунктам, включая свои доплаты, и закрепить их письмом.'),
  weakness('terms-vague', 'Условия не зафиксированы', 'negotiation', 3,
    'Процент и его база, отчётность, срок лицензии, форматы или порядок оплаты остаются устными и размытыми.',
    'Назвать недостающие условия вслух и отправить письмо, которое их фиксирует.'),
  weakness('labels-not-facts', 'Ярлыки вместо фактов', 'positioning', 4,
    'Прилагательные и модные ярлыки вместо проверяемых фактов: имён клиентов, цифр и результатов.',
    'Каждый ярлык заменить фактом: клиент, цифра или результат.'),
  weakness('no-research', 'Не изучил собеседника заранее', 'other', 5,
    'Не открыл продукт или сайт собеседника до звонка, и ответ на прямой вопрос о нём выходит смазанным.',
    'За десять минут до звонка изучить продукт собеседника и подготовить одну конкретную деталь.'),
  weakness('permission-asking', 'Просишь разрешения продолжать', 'structure', 5,
    'Посреди ответа спрашиваешь, можно ли рассказать ещё. Звучит неуверенно и отдаёт инициативу.',
    'Заканчивать мысль точкой и переходить к следующей без вопроса-разрешения.'),
  strength('method-clear', 'Метод одной фразой', 'structure',
    'Объясняешь свой процесс коротко и понятно, одной-двумя фразами.',
    'Держать эту формулировку и использовать её в каждом первом звонке.'),
  strength('honest-correction', 'Честно поправляешь неверное', 'positioning',
    'Спокойно поправляешь неверное предположение собеседника о своих работах вместо выгодной недомолвки.',
    'Поправлять так же коротко и сразу показывать, чем эта работа полезна клиенту.'),
  strength('holds-stated-price', 'Держишь названную цену', 'negotiation',
    'На прямой вопрос о цене называешь свою ставку и не опускаешь её сразу.',
    'Держать цену и дальше, а скидку давать только в обмен на объём или условия.'),
  strength('mission-fit', 'Настоящее совпадение с миссией', 'positioning',
    'Личная история или убеждение совпадает с задачей клиента, звучит по-настоящему и вызывает отклик.',
    'Готовить к звонку одну личную связь с задачей клиента и подкреплять её фактом.'),
  strength('proposes-structure', 'Сам предлагаешь формат сотрудничества', 'negotiation',
    'Сам предлагаешь, как начать работу (тест, пакет, этапы), и ведёшь разговор к договорённости.',
    'Предлагать формат и сразу привязывать к нему цену и следующий шаг.'),
];

/** Spoken-language patterns: created from language errors with these tags; all start in 'watch' until confirmed. */
export const LANGUAGE_PATTERNS: PatternDefinition[] = [
  weakness('aux-questions', 'Вопросы без do/does', 'language', 4,
    'Вопрос строится без вспомогательного глагола или с лишним is: «Is it sound good?» вместо «Does that sound good?».',
    'Сказать вопрос с do или does и сразу задать ещё один на другую тему.', ALL),
  weakness('past-participle', 'Формы прошедшего: «I seen»', 'language', 4,
    'Причастие без have: «I seen» вместо «I\'ve seen» или «I saw».',
    'Сказать фразу с I\'ve seen или I saw и тут же новую фразу о другом.', ALL),
  weakness('agreement', 'Согласование глагола', 'language', 4,
    'Глагол не согласован с подлежащим: «a guy who don\'t» вместо «who doesn\'t».',
    'Проговорить пары he/she/who doesn\'t и использовать их в новой фразе.', ALL),
  weakness('compound-age', 'Возраст как определение', 'language', 4,
    '«20 years old guy» вместо «a 20-year-old».',
    'Сказать возраст как определение и сразу перейти к фактам о работе.', ALL),
  weakness('prep-direction', 'Предлог направления', 'language', 4,
    '«go in London» вместо «go to London»: направление требует to.',
    'Рассказать о трёх поездках с go to, move to, fly to.', ALL),
  weakness('be-based', 'Пропущенный глагол be', 'language', 4,
    '«I based in …» вместо «I\'m based in …».',
    'Представиться с I\'m based in и I work with.', ALL),
  weakness('will-in-if-clause', 'will после if', 'language', 4,
    '«if you will want» вместо «if you want»: в условии после if будущее время не ставится.',
    'Сказать три условия с if you want, if you need, if it works.', ALL),
  weakness('indirect-question', 'Косвенный вопрос', 'language', 4,
    '«I want to know you want…» вместо «I want to know if you want…».',
    'Задать косвенный вопрос с if или whether и прямой порядок слов.', ALL),
];

/** Older slugs from planning drafts and plausible model variants → canonical ids. */
export const PATTERN_ALIASES: Record<string, string> = {
  'other-client-fees': 'fee-disclosure', 'client-fee-disclosure': 'fee-disclosure', 'fees-disclosure': 'fee-disclosure',
  'first-number-accept': 'first-number', 'accepts-first-number': 'first-number', 'instant-acceptance': 'first-number',
  'bio-instead-of-pitch': 'bio-not-pitch', 'biography-instead-of-pitch': 'bio-not-pitch',
  'no-questions-no-next-step': 'no-discovery', 'no-questions': 'no-discovery', 'no-next-step': 'no-discovery',
  'permission-mid-answer': 'permission-asking', 'asks-permission': 'permission-asking',
  'weak-recent-client': 'weak-case-first', 'weak-case': 'weak-case-first',
  'no-proof-numbers': 'no-leverage', 'no-metrics': 'no-leverage',
  'vague-terms': 'terms-vague', 'unclear-terms': 'terms-vague',
  'strong-mission-fit': 'mission-fit', 'holds-price': 'holds-stated-price',
  'drops-addon-in-recap': 'recap-drops-addon',
};

const ALL_DEFINITIONS = new Map([...SEED_PATTERNS, ...LANGUAGE_PATTERNS].map(item => [item.id, item]));

export function catalogPattern(id: string): PatternDefinition | null { return ALL_DEFINITIONS.get(id) ?? null; }
export function isLanguageTag(id: string): boolean { return LANGUAGE_PATTERNS.some(item => item.id === id); }

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,6}$/;
/** Canonical pattern id for a model-supplied id, or null when it is not a valid slug. */
export function canonicalPatternId(value: string | null | undefined): string | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const id = PATTERN_ALIASES[slug] ?? slug;
  return SLUG.test(id) && id.length >= 3 && id.length <= 48 ? id : null;
}
