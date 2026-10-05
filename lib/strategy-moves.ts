/**
 * Eight observable communication-strategy moves, scored 0/1/2 (null = no opportunity).
 * Shared by the placement roleplay, real-call reviews and strategy practice. Never folded into a CEFR band.
 */
export type StrategyMoveId = 'answer-first' | 'positioning' | 'proof' | 'discovery' | 'anchor-hold' | 'confidential' | 'recap' | 'close';

export const STRATEGY_MOVES: { id: StrategyMoveId; title: string; good: string; bad: string }[] = [
  { id: 'answer-first', title: 'Ответ первым', good: 'Первое предложение отвечает на вопрос', bad: 'Сначала предыстория, потом ответ' },
  { id: 'positioning', title: 'Самоподача', good: 'Роль, жанр и текущий клиент без оговорок', bad: 'Возраст, «нет образования», «только начал»' },
  { id: 'proof', title: 'Факты вместо ярлыков', good: 'Цифра, имя или результат', bad: 'Ярлыки вроде «AI native», «очень креативный»' },
  { id: 'discovery', title: 'Вопросы по делу', good: 'Вопрос про объём, бюджет, сроки, решение или права', bad: 'Ни одного вопроса или только small talk' },
  { id: 'anchor-hold', title: 'Якорь и цена', good: 'Своя цифра, встречное предложение или обмен', bad: 'Мгновенное согласие с первой цифрой' },
  { id: 'confidential', title: 'Чужие условия', good: 'Вежливо отказал и назвал свой диапазон', bad: 'Назвал гонорар или сроки другого клиента' },
  { id: 'recap', title: 'Резюме условий', good: 'Гонорар, доплаты, процент, база, срок лицензии, сроки', bad: 'Резюме, где пропали свои доплаты' },
  { id: 'close', title: 'Следующий шаг', good: 'Кто, что и когда', bad: '«Будем на связи»' },
];

export type StrategyMoveScore = { id: StrategyMoveId; score: 0 | 1 | 2 | null; quote: string | null; at?: number | null };
