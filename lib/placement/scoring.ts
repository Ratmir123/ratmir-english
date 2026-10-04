/**
 * Placement scoring helpers — pure functions (no I/O). Implements planning/v05/audit-product.md §2.6 timing metrics and
 * the fluency guardrail, §2.8 aggregation (speaking median of criteria on the two highest tasks, interaction mean,
 * overall median, confidence caps) and the §2.9 presentation pieces (ranges, headline, notes).
 */
import { cefrFromScore, type CEFRLevel, type Confidence, type PlacementSkillId } from './types';
import type { SpeechTiming } from '../types';

/** Rating scale used by the scorer (audit §2.6). "+" = clearly above a band but not yet the next one. */
export const HALF_BANDS = ['A1', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C2'] as const;
export type HalfBand = typeof HALF_BANDS[number];
const BAND_BASE: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export function halfBandScore(band: HalfBand): number { return BAND_BASE[band.slice(0, 2)] + (band.endsWith('+') ? 0.5 : 0); }
export function floorHalfBand(score: number): number { return Math.floor(score * 2 + 1e-9) / 2; }
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

export function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const CONFIDENCE_ORDER: readonly Confidence[] = ['low', 'medium', 'high'];
export function lowerConfidence(value: Confidence, steps = 1): Confidence {
  return CONFIDENCE_ORDER[Math.max(0, CONFIDENCE_ORDER.indexOf(value) - steps)];
}
export function minConfidence(values: readonly Confidence[]): Confidence {
  return values.length ? CONFIDENCE_ORDER[Math.min(...values.map(value => CONFIDENCE_ORDER.indexOf(value)))] : 'low';
}
export function capConfidence(value: Confidence, cap: Confidence): Confidence {
  return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.indexOf(value), CONFIDENCE_ORDER.indexOf(cap))];
}
export const CONFIDENCE_RU: Record<Confidence, string> = { low: 'низкая', medium: 'средняя', high: 'высокая' };

// ---------------------------------------------------------------------------------------------------------------------
// Timing metrics from server-measured VAD timing and the verbatim ASR transcript (code only, never the model).

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
export function countWords(text: string): number { return text.match(WORD)?.length ?? 0; }
/** Hesitation fillers kept by the verbatim recogniser; "you know" is counted separately (it can be a discourse marker). */
export function countFillers(text: string): { fillers: number; youKnow: number } {
  return { fillers: text.match(/\b(?:u+m+|u+h+|e+r+m*|h+m+|uhm+)\b/giu)?.length ?? 0,
    youKnow: text.match(/\byou know\b/giu)?.length ?? 0 };
}

export interface TimingMetrics {
  quality: SpeechTiming['quality'];
  /** Usable for pace claims: VAD quality 'usable' and the transcript was not edited. */
  usable: boolean;
  spanSeconds: number; speechSeconds: number; words: number | null;
  wordsPerMinute: number | null; pausesPerMinute: number | null; meanLengthOfRun: number | null;
  longestPauseSeconds: number; latencySeconds: number | null;
  fillers: number; youKnow: number; fillersPerMinute: number | null;
}

/** wpm (pauses included), pauses ≥ 0.6 s per minute of speech span, mean length of run, latency after auto-start, fillers. */
export function speechTimingMetrics(timing: SpeechTiming | null | undefined, verbatim: string, options: { autoStart: boolean }): TimingMetrics | null {
  if (!timing) return null;
  const span = timing.speechSpanSeconds;
  const { fillers, youKnow } = countFillers(verbatim);
  const words = timing.recognizedWords;
  return {
    quality: timing.quality, usable: timing.quality === 'usable' && !timing.transcriptEdited,
    spanSeconds: span, speechSeconds: timing.detectedSpeechSeconds, words,
    wordsPerMinute: timing.approximateWordsPerMinute === null ? null : round(timing.approximateWordsPerMinute),
    pausesPerMinute: span >= 5 ? round(timing.internalPauseCount * 60 / span) : null,
    meanLengthOfRun: words !== null && !timing.transcriptEdited ? round(words / (timing.internalPauseCount + 1)) : null,
    longestPauseSeconds: timing.longestPauseSeconds,
    latencySeconds: options.autoStart && timing.quality !== 'no-speech' ? round(timing.leadingSilenceSeconds) : null,
    fillers, youKnow, fillersPerMinute: span >= 5 ? round(fillers * 60 / span) : null,
  };
}

/** Heuristic timing band for prepared monologues (A2 = 2 … C1 = 5): the median of the wpm, pause and run-length bands. */
export function timingBand(metrics: TimingMetrics | null): number | null {
  if (!metrics || metrics.wordsPerMinute === null || metrics.pausesPerMinute === null || metrics.meanLengthOfRun === null) return null;
  const wpm = metrics.wordsPerMinute; const pauses = metrics.pausesPerMinute; const run = metrics.meanLengthOfRun;
  const wpmBand = wpm < 80 ? 2 : wpm < 105 ? 3 : wpm <= 135 ? 4 : 5;
  const pauseBand = pauses > 14 ? 2 : pauses >= 9 ? 3 : pauses >= 5 ? 4 : 5;
  const runBand = run < 5 ? 2 : run < 9 ? 3 : run <= 14 ? 4 : 5;
  return median([wpmBand, pauseBand, runBand]);
}

export const TIMING_CONFLICT_NOTE = 'Темп и оценка разбора расходятся';
/**
 * Timing is a guardrail, never a top-end classifier: fluencyFinal = clamp(sol, band − 0.5, band + 1.0) when the recording's
 * timing is usable and the speech span is at least 20 s. Otherwise the model rating stays and confidence drops a step.
 */
export function fluencyGuardrail(sol: number, metrics: TimingMetrics | null): { final: number; band: number | null; applied: boolean; conflict: boolean } {
  const band = metrics && metrics.usable && metrics.spanSeconds >= 20 ? timingBand(metrics) : null;
  if (band === null) return { final: sol, band: null, applied: false, conflict: false };
  return { final: Math.min(band + 1, Math.max(band - 0.5, sol)), band, applied: true, conflict: Math.abs(sol - band) >= 1.5 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Aggregation (audit §2.8).

export type RatedRole = 'P1' | 'P2' | 'F2' | 'P3';
export interface SpeakingTaskRating {
  role: RatedRole;
  /** CEFR value of the task level (A2 = 2 …). Ratings are capped at task level + 1. */
  taskLevel: number;
  insufficient: boolean; edited: boolean;
  timingQuality: SpeechTiming['quality'] | null;
  range: number | null; accuracy: number | null; fluency: number | null; coherence: number | null;
  metrics: TimingMetrics | null;
}
export type SpeakingCriterion = 'range' | 'accuracy' | 'fluency' | 'coherence';
export interface SpeakingAggregate {
  score: number | null;
  criteria: Record<SpeakingCriterion, number | null>;
  confidence: Confidence;
  usedRoles: RatedRole[];
  conflict: boolean;
  guardrailMissing: boolean;
  usableRecordings: number;
  limitedRecordings: number;
}
const ROLE_PRIORITY: Record<RatedRole, number> = { P3: 0, P2: 1, P1: 2, F2: 3 };

/** Speaking = median of the four criteria, each the mean of its (capped) ratings on the two highest tasks, rounded down to a half band. */
export function aggregateSpeaking(tasks: readonly SpeakingTaskRating[]): SpeakingAggregate {
  const usableRecordings = tasks.filter(task => !task.insufficient).length;
  const limitedRecordings = tasks.filter(task => task.timingQuality === 'limited').length;
  const rated = tasks.filter(task => !task.insufficient && task.range !== null && task.accuracy !== null
    && task.fluency !== null && task.coherence !== null);
  const chosen = [...rated].sort((left, right) => ROLE_PRIORITY[left.role] - ROLE_PRIORITY[right.role]).slice(0, 2);
  const empty = { range: null, accuracy: null, fluency: null, coherence: null };
  if (!chosen.length) return { score: null, criteria: empty, confidence: 'low', usedRoles: [], conflict: false, guardrailMissing: false, usableRecordings, limitedRecordings };
  let conflict = false; let guardrailMissing = false;
  const values: Record<SpeakingCriterion, { value: number; weight: number }[]> = { range: [], accuracy: [], fluency: [], coherence: [] };
  for (const task of chosen) {
    const cap = task.taskLevel + 1;
    const weight = task.edited ? 0.5 : 1;
    const guard = fluencyGuardrail(Math.min(cap, task.fluency!), task.metrics);
    conflict ||= guard.conflict; guardrailMissing ||= !guard.applied;
    values.range.push({ value: Math.min(cap, task.range!), weight });
    values.accuracy.push({ value: Math.min(cap, task.accuracy!), weight });
    values.fluency.push({ value: Math.min(cap, guard.final), weight });
    values.coherence.push({ value: Math.min(cap, task.coherence!), weight });
  }
  const mean = (list: { value: number; weight: number }[]) => list.reduce((sum, item) => sum + item.value * item.weight, 0) / list.reduce((sum, item) => sum + item.weight, 0);
  const raw = { range: mean(values.range), accuracy: mean(values.accuracy), fluency: mean(values.fluency), coherence: mean(values.coherence) };
  const score = floorHalfBand(median(Object.values(raw))!);
  let confidence: Confidence = 'medium';
  if (usableRecordings < 3 || limitedRecordings >= 2 || conflict) confidence = lowerConfidence(confidence);
  if (guardrailMissing) confidence = lowerConfidence(confidence);
  return { score, criteria: { range: floorHalfBand(raw.range), accuracy: floorHalfBand(raw.accuracy), fluency: floorHalfBand(raw.fluency),
    coherence: floorHalfBand(raw.coherence) }, confidence, usedRoles: chosen.map(task => task.role), conflict, guardrailMissing,
  usableRecordings, limitedRecordings };
}

/** Interaction = mean of the roleplay band and the unprepared follow-up band, rounded down to a half band; "medium" at best. */
export function aggregateInteraction(input: { roleplay: number | null; followUp: number | null; answeredTurns: number; editedTurns: number }): { score: number | null; confidence: Confidence } {
  const values = [input.roleplay, input.followUp].filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return { score: null, confidence: 'low' };
  const score = floorHalfBand(values.reduce((sum, value) => sum + value, 0) / values.length);
  const confidence: Confidence = input.roleplay !== null && input.answeredTurns >= 3 && input.editedTurns < input.answeredTurns ? 'medium' : 'low';
  return { score, confidence };
}

/** Overall = median of the available skill scores; confidence = the lowest contributing one, at most "medium". */
export function overallFromSkills(skills: readonly { score: number | null; confidence: Confidence }[]): { score: number; level: CEFRLevel; label: string; confidence: Confidence } | null {
  const available = skills.filter(skill => skill.score !== null && Number.isFinite(skill.score));
  if (!available.length) return null;
  const score = Math.round(median(available.map(skill => skill.score!))! * 1000) / 1000;
  return { score, ...cefrFromScore(score), confidence: capConfidence(minConfidence(available.map(skill => skill.confidence)), 'medium') };
}

/** Band range for a rated (non-posterior) skill: ±0.5 band at medium confidence, ±0.75 at low. */
export function ratedRange(score: number, confidence: Confidence): { from: CEFRLevel; to: CEFRLevel } {
  const half = confidence === 'low' ? 0.75 : 0.5;
  return { from: cefrFromScore(score - half).level, to: cefrFromScore(score + half).level };
}

// ---------------------------------------------------------------------------------------------------------------------
// Presentation (Russian).

export function plural(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10; const mod100 = count % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${count} ${form}`;
}

/** Shape first: the main gap between understanding, language and speech, or an even profile. */
export function placementHeadline(scores: Partial<Record<PlacementSkillId, number | null>>, overallLabel: string): string {
  const mean = (ids: PlacementSkillId[]) => {
    const values = ids.map(id => scores[id]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const receptive = mean(['listening', 'reading']);
  const productive = mean(['speaking', 'interaction']);
  const language = mean(['grammar', 'vocabulary']);
  if (productive === null) return `Понимание и язык около ${overallLabel}. Речь в этот раз не измерена.`;
  if (receptive !== null) {
    const gap = receptive - productive;
    if (gap >= 1.25) return 'Понимаешь заметно лучше, чем говоришь, больше чем на уровень.';
    if (gap >= 0.75) return 'Понимаешь лучше, чем говоришь, примерно на уровень.';
    if (gap >= 0.5) return 'Понимаешь немного лучше, чем говоришь.';
    if (gap <= -0.75) return 'Говоришь увереннее, чем понимаешь на слух и в тексте.';
  }
  if (language !== null && scores.grammar !== null && scores.grammar !== undefined) {
    const others = (['listening', 'reading', 'vocabulary', 'speaking', 'interaction'] as const)
      .map(id => scores[id]).filter((value): value is number => typeof value === 'number');
    if (others.length && scores.grammar <= Math.min(...others) - 0.75) return 'Грамматика отстаёт от остальных навыков и тянет речь вниз.';
  }
  return `Навыки ровные, около ${overallLabel}.`;
}

/** What a band means for real work calls (one or two sentences per skill and band). */
export const SKILL_BAND_NOTES: Record<PlacementSkillId, Record<CEFRLevel, string>> = {
  listening: {
    A1: 'На звонке пока понятны отдельные слова и знакомые фразы. Нужны медленная речь, повторы и письменное подтверждение.',
    A2: 'Простые медленные вопросы о деле понятны. На обычном темпе собеседника стоит переспрашивать и подтверждать письменно.',
    B1: 'Главное в ясной рабочей речи понятно. Быстрые носители, сленг и цифры на ходу пока требуют переспросить.',
    B2: 'Большая часть рабочего разговора понятна на живом темпе. Шутки, намёки и быстрые перебивки иногда теряются.',
    C1: 'Быстрый и неформальный разговор понятен, включая намёки. Трудности бывают только с сильным акцентом или шумом.',
    C2: 'Понятен практически любой живой разговор, включая быстрые оговорки и подтекст.',
  },
  reading: {
    A1: 'Понятны отдельные слова и очень короткие сообщения. Брифы и письма пока лучше читать с переводчиком.',
    A2: 'Короткие простые сообщения понятны. Брифы и условия лучше читать с переводчиком и уточнять детали.',
    B1: 'Обычные письма и простые брифы понятны. В длинных условиях и юридических формулировках детали легко упустить.',
    B2: 'Брифы, письма и большинство условий понятны. Тонкие оговорки в договорах стоит перечитывать.',
    C1: 'Сложные тексты, включая договоры, понятны в деталях вместе с подтекстом.',
    C2: 'Читаешь любые тексты почти как носитель, включая тонкие оговорки.',
  },
  grammar: {
    A1: 'Пока работают в основном заученные фразы. Вопросы и прошедшее время ещё не собраны.',
    A2: 'Простые фразы получаются, но базовые ошибки в вопросах, временах и артиклях звучат по-ученически и иногда меняют смысл.',
    B1: 'Обычные фразы строишь уверенно. Ошибки заметны в сложных конструкциях и длинных предложениях.',
    B2: 'Грамматика надёжная: ошибки не мешают пониманию и не звучат по-детски.',
    C1: 'Сложные конструкции под контролем, ошибки редкие.',
    C2: 'Грамматика на уровне образованного носителя.',
  },
  vocabulary: {
    A1: 'Словарь пока базовый. Рабочую тему без помощи не описать.',
    A2: 'Хватает слов для простых фраз о работе и быте. Для деталей проекта и условий не хватает точных слов.',
    B1: 'Хватает слов для знакомых рабочих тем, иногда через объяснения. Точных деловых выражений пока мало.',
    B2: 'Словарь позволяет ясно обсуждать проект, сроки и условия. Идиомы и тонкие оттенки пока ограничены.',
    C1: 'Широкий словарь: выбираешь точные слова и подходящий тон.',
    C2: 'Словарь гибкий и точный, включая идиомы и оттенки.',
  },
  speaking: {
    A1: 'Пока получаются отдельные фразы. Рабочий звонок без подготовки даётся очень трудно.',
    A2: 'Простые ответы получаются, но длинные мысли рассыпаются. На звонке это звучит неуверенно.',
    B1: 'Мысль доносишь, но с паузами и ошибками в длинных фразах. Подготовленные ответы звучат заметно лучше импровизации.',
    B2: 'Говоришь достаточно свободно для рабочих звонков. Ошибки не мешают, но точность и связки ещё можно поднять.',
    C1: 'Говоришь свободно и точно, сложная тема не сбивает.',
    C2: 'Речь гибкая и точная, почти без усилий.',
  },
  interaction: {
    A1: 'Разговор держится на собеседнике. Неожиданные вопросы пока сбивают.',
    A2: 'На вопросы отвечаешь, но редко сам ведёшь разговор и уточняешь детали.',
    B1: 'Поддерживаешь разговор на знакомые темы и можешь уточнить детали. Держать инициативу и торговаться пока трудно.',
    B2: 'Уверенно ведёшь обмен репликами, уточняешь и подхватываешь мысли собеседника.',
    C1: 'Легко управляешь разговором: держишь слово и связываешь свои мысли с чужими.',
    C2: 'Ведёшь разговор как носитель, тонко и естественно.',
  },
};

/** Russian titles for common construct tags; unknown tags fall back to the scorer's title or a readable tag. */
export const TAG_TITLES: Record<string, string> = {
  // Language patterns seeded from real calls (audit Appendix C ids, shared with the bank tags).
  'question-aux': 'Вопросы с do/does/did', 'past-participle': "Третья форма глагола: I've seen, а не I seen",
  agreement: "Согласование: he doesn't, who doesn't", 'compound-age': 'Возраст как определение: a 20-year-old',
  'prep-direction': 'Предлоги направления: go to', 'be-based': "Глагол be: I'm based in", 'will-in-if-clause': 'Без will после if',
  'indirect-question': 'Косвенные вопросы: know if you want',
  // Other constructs.
  articles: 'Артикли a/the', prepositions: 'Предлоги', 'word-order': 'Порядок слов', tense: 'Времена глагола',
  'present-perfect': 'Present perfect для опыта и результата', 'past-simple': 'Прошедшее время', 'past-perfect': 'Past perfect',
  'conditional-1': 'Условные предложения первого типа', 'conditional-2': 'Условные предложения второго типа',
  'conditional-3': 'Условные предложения третьего типа', 'conditional-mixed': 'Смешанные условные предложения',
  relative: 'Придаточные с who/which/that', inversion: 'Инверсия для акцента', modality: 'Модальные глаголы',
  'modal-perfect': 'Модальные глаголы с have + третья форма', passive: 'Пассивный залог', 'reported-speech': 'Косвенная речь',
  'participle-clause': 'Причастные обороты', wish: 'Конструкция wish', purpose: 'Цель: to, so that', concession: 'Уступка: although, despite',
  cleft: 'Выделение: it was… that', comparatives: 'Сравнения', countability: 'Исчисляемые и неисчисляемые',
  'gerund-infinitive': 'Герундий и инфинитив', future: 'Будущее время и планы',
  collocation: 'Устойчивые сочетания', 'phrasal-verb': 'Фразовые глаголы', idiom: 'Идиомы', confusable: 'Похожие слова',
  'fixed-expression': 'Устойчивые выражения', 'meaning-in-context': 'Значение по контексту', register: 'Регистр речи',
  business: 'Деловая лексика',
  // Listening and reading constructs.
  inference: 'Выводы из сказанного', numbers: 'Числа и суммы на слух', attitude: 'Отношение говорящего',
  implicature: 'Подтекст и намёки', 'main-idea': 'Главная мысль', gist: 'Общий смысл', detail: 'Детали', dialogue: 'Диалог',
};
/** Constructs the scorer should prefer when an error fits (they join speaking errors to the bank's items). */
export const CORE_LANGUAGE_TAGS = ['question-aux', 'past-participle', 'agreement', 'compound-age', 'prep-direction', 'be-based',
  'will-in-if-clause', 'indirect-question', 'articles', 'prepositions', 'word-order', 'tense', 'present-perfect', 'collocation'] as const;
export function tagTitle(tag: string, fallback?: string | null): string {
  return TAG_TITLES[tag] ?? (fallback?.trim() || tag.replace(/[-_]+/g, ' '));
}
