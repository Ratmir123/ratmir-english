/**
 * Pure presentation helpers for real calls, patterns, drills and the playbook (W3).
 * No React, no DOM: unit-tested in tests/web-calls-format.test.ts.
 */
import {
  CALL_AUDIO_EXTENSIONS, CALL_TRANSCRIPT_EXTENSIONS,
  type CallContext, type CallReview, type CallSourceType, type CallStatus, type CommunicationPattern,
  type CostCategory, type DealModel, type DrillType, type FactKind, type PatternOutcome, type PersonalDrill,
} from '@/lib/calls/types';

export type Tone = 'neutral' | 'lime' | 'violet' | 'cyan' | 'warning' | 'error' | 'pink';
/** CSS colour for small text in a tone (kit tokens). */
export function toneInk(tone: Tone): string { return tone === 'neutral' ? 'var(--k-text-2)' : `var(--k-${tone}-ink)`; }

/* ───────────── time & numbers ───────────── */

/** 0 → "0:00", 125 → "2:05", 3725 → "1:02:05". Null/invalid → "—". */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Human duration: 45 → "45 с", 720 → "12 мин", 3900 → "1 ч 5 мин". */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.round(seconds)} с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** "21 октября" (year added when it differs from `now`). Invalid → null. */
export function formatDay(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return (date.getFullYear() === now.getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(date).replace(/\s?г\.$/, '');
}

const NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const SYMBOL: Record<DealModel['currency'], string> = { USD: '$', EUR: '€' };

/** 16666.7 → "$16 667" (no-break space grouping on every ICU build, symbol first as in the owner's notes). */
export function formatMoney(value: number | null | undefined, currency: DealModel['currency'] = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '−' : '';
  return `${sign}${SYMBOL[currency]}${NUMBER.format(Math.abs(Math.round(value))).replace(/\s/g, '\u00a0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} МБ`;
  return `${(mb / 1024).toFixed(2).replace('.', ',')} ГБ`;
}

/** Russian plural: plural(5, ['звонок', 'звонка', 'звонков']). */
export function plural(count: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(Math.trunc(count)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/* ───────────── calls ───────────── */

export const CALL_STATUS: Record<CallStatus, { label: string; tone: Tone }> = {
  'awaiting-upload': { label: 'Ждёт загрузки', tone: 'warning' },
  queued: { label: 'В очереди', tone: 'neutral' },
  processing: { label: 'Расшифровка', tone: 'cyan' },
  'needs-speaker': { label: 'Кто есть кто?', tone: 'violet' },
  analysing: { label: 'Пишем разбор', tone: 'cyan' },
  ready: { label: 'Разбор готов', tone: 'lime' },
  error: { label: 'Ошибка', tone: 'error' },
};

/** Server-side work is running: the client polls only in these states. */
export function isCallProcessing(status: CallStatus): boolean {
  return status === 'queued' || status === 'processing' || status === 'analysing';
}

export const CONTEXT_LABEL: Record<CallContext, string> = { work: 'Работа', life: 'Жизнь', relocation: 'Переезд', other: 'Другое' };
export const SOURCE_LABEL: Record<CallSourceType, string> = { audio: 'Запись', transcript: 'Расшифровка', debrief: 'Готовый разбор', memory: 'По памяти' };

export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  positioning: 'Самоподача', negotiation: 'Переговоры', confidentiality: 'Конфиденциальность', structure: 'Структура',
  questions: 'Вопросы', closing: 'Следующий шаг', listening: 'Слушание', language: 'Английский', fluency: 'Беглость', other: 'Другое',
};

export const IMPACT_LABEL: Record<'high' | 'medium' | 'low', { label: string; tone: Tone }> = {
  high: { label: 'Дорого', tone: 'error' },
  medium: { label: 'Заметно', tone: 'warning' },
  low: { label: 'Мелочь', tone: 'neutral' },
};

export const LANGUAGE_IMPACT_LABEL: Record<'meaning' | 'seniority' | 'minor', { label: string; tone: Tone }> = {
  meaning: { label: 'Меняет смысл', tone: 'error' },
  seniority: { label: 'Звучит младше', tone: 'warning' },
  minor: { label: 'Мелочь', tone: 'neutral' },
};

export const CLARITY_LABEL: Record<'explicit' | 'implied' | 'unclear', { label: string; tone: Tone }> = {
  explicit: { label: 'Прямо', tone: 'lime' },
  implied: { label: 'Подразумевается', tone: 'warning' },
  unclear: { label: 'Неясно', tone: 'error' },
};

/* ───────────── files ───────────── */

export type CallFileKind = 'audio' | 'transcript' | 'debrief';

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/** Classify a picked/dropped file. Markdown defaults to a ready-made debrief (the learner can switch). */
export function classifyCallFile(name: string, mime = ''): CallFileKind | null {
  const ext = fileExtension(name);
  if ((CALL_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio';
  if (ext === 'md') return 'debrief';
  if ((CALL_TRANSCRIPT_EXTENSIONS as readonly string[]).includes(ext)) return 'transcript';
  if (/^(audio|video)\//.test(mime)) return 'audio';
  if (/^text\//.test(mime)) return 'transcript';
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', wav: 'audio/wav', webm: 'video/webm',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', mkv: 'video/x-matroska',
};
export function guessMime(name: string, mime = ''): string {
  return mime || MIME_BY_EXT[fileExtension(name)] || 'application/octet-stream';
}

/** "agency_screening-final.mp4" → "agency screening final". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 120) || 'Звонок';
}

export const FILE_ACCEPT = [
  'audio/*', 'video/*',
  ...CALL_AUDIO_EXTENSIONS.map(ext => '.' + ext),
  ...CALL_TRANSCRIPT_EXTENSIONS.map(ext => '.' + ext),
].join(',');

/** UTF-8 size of a string (transcripts ≤ 400 KB, debriefs ≤ 200 KB on the server). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
export const TEXT_LIMIT_BYTES: Record<'transcript' | 'debrief' | 'memory', number> = { transcript: 400_000, debrief: 200_000, memory: 60_000 };
export const MEMORY_MIN_CHARS = 40;
/** The server rejects shorter debrief imports. */
export const DEBRIEF_MIN_CHARS = 200;

/* ───────────── deal table ───────────── */

export interface DealRowView { base: string; percentFee: string; total: string; belowFloor: boolean; baseValue: number; totalValue: number }
export interface DealView {
  currency: DealModel['currency'];
  formula: string;               // e.g. "Фикс $400 + 2% от рекламных трат"
  floor: string | null;          // learner's floor for this deliverable, formatted
  rows: DealRowView[];
  breakEven: string | null;      // "$16 667"
  breakEvenNote: string | null;  // Russian sentence
}

/** Deal table for the «Сделка» block. Uses the server table; falls back to computing it from the model. */
export function dealView(review: Pick<CallReview, 'dealModel' | 'dealTable' | 'breakEven'>): DealView | null {
  const model = review.dealModel;
  if (!model || !Number.isFinite(model.fixedFee)) return null;
  const currency = model.currency === 'EUR' ? 'EUR' : 'USD';
  const percent = model.percent !== null && Number.isFinite(model.percent) ? model.percent : null;
  const source = review.dealTable && review.dealTable.length
    ? review.dealTable
    : percent === null ? [] : model.scenarios.filter(Number.isFinite).map(base => {
      const percentFee = (base * percent) / 100;
      return { base, percentFee, total: model.fixedFee + percentFee };
    });
  const floor = model.floor !== null && Number.isFinite(model.floor) ? model.floor : null;
  const rows = [...source].sort((a, b) => a.base - b.base).map(row => ({
    base: formatMoney(row.base, currency), percentFee: formatMoney(row.percentFee, currency), total: formatMoney(row.total, currency),
    belowFloor: floor !== null && row.total < floor, baseValue: row.base, totalValue: row.total,
  }));
  const percentText = percent === null ? '' : ` + ${String(percent).replace('.', ',')}%${model.base ? ` от ${lowerFirst(model.base)}` : ''}`;
  const breakEven = review.breakEven !== null && review.breakEven !== undefined && Number.isFinite(review.breakEven) ? review.breakEven : null;
  return {
    currency,
    formula: `Фикс ${formatMoney(model.fixedFee, currency)}${percentText}`,
    floor: floor === null ? null : formatMoney(floor, currency),
    rows,
    breakEven: breakEven === null ? null : formatMoney(breakEven, currency),
    breakEvenNote: breakEven === null || floor === null ? null
      : `До твоего пола ${formatMoney(floor, currency)} сделка добирает только при базе от ${formatMoney(breakEven, currency)}.`,
  };
}
function lowerFirst(text: string): string { return text ? text[0].toLowerCase() + text.slice(1) : text; }

/* ───────────── follow-up placeholders ───────────── */

export type TextPart = { text: string; placeholder: boolean };
/** "Hi [[name]], …" → [{text:'Hi '}, {text:'name', placeholder:true}, …]. */
export function splitPlaceholders(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /\[\[([^\]]+?)\]\]/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), placeholder: false });
    parts.push({ text: match[1].trim(), placeholder: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), placeholder: false });
  return parts;
}

/* ───────────── patterns ───────────── */

export const PATTERN_STATUS: Record<CommunicationPattern['status'], { label: string; tone: Tone; hint: string }> = {
  watch: { label: 'Замечено', tone: 'neutral', hint: 'Видели один раз. Это про тебя?' },
  active: { label: 'В работе', tone: 'warning', hint: 'Повторяется. Тренируем.' },
  improving: { label: 'Лучше', tone: 'violet', hint: 'Получается всё чаще.' },
  resolved: { label: 'Закрыто', tone: 'lime', hint: 'Три реальных звонка подряд без повтора.' },
};

export const OUTCOME_GLYPH: Record<PatternOutcome, { glyph: string; label: string; tone: Tone }> = {
  repeated: { glyph: '●', label: 'повторилось', tone: 'error' },
  new: { glyph: '●', label: 'замечено впервые', tone: 'error' },
  avoided: { glyph: '○', label: 'был повод — справился', tone: 'lime' },
  improved: { glyph: '◐', label: 'частично лучше', tone: 'violet' },
  'no-opportunity': { glyph: '·', label: 'не было повода', tone: 'neutral' },
};

/** Cost rank (1 = most expensive) in words, in the same vocabulary as a review's cost impact. */
export function costRankLabel(rank: number): { label: string; tone: Tone } {
  if (rank <= 2) return { label: 'Стоит дорого', tone: 'error' };
  if (rank === 3) return { label: 'Стоит заметно', tone: 'warning' };
  return { label: 'Стоит немного', tone: 'neutral' };
}

const times = (count: number) => `${count} ${plural(count, ['раз', 'раза', 'раз'])}`;

/** Plain totals per pattern: real calls (avoided / repeated) and practice (attempts, independent successes).
 *  {0 avoided, 1 repeated} → "В звонках: повторилось 1 раз"; no attempts → "В тренировках: ещё не было". */
export function roundsLabel(pattern: Pick<CommunicationPattern, 'real' | 'practice'>): { real: string; practice: string } {
  const avoided = Math.max(0, pattern.real.avoided | 0);
  const repeated = Math.max(0, pattern.real.repeated | 0);
  const attempts = Math.max(0, pattern.practice.attempts | 0);
  const successes = Math.min(attempts, Math.max(0, pattern.practice.independentSuccesses | 0));
  const real = [avoided ? `справился ${times(avoided)}` : '', repeated ? `повторилось ${times(repeated)}` : ''].filter(Boolean).join(', ');
  const practice = !attempts ? 'ещё не было'
    : `${attempts} ${plural(attempts, ['попытка', 'попытки', 'попыток'])}, ${successes ? `без опор справился ${times(successes)}` : 'без опор пока не получилось'}`;
  return { real: `В звонках: ${real || 'повода ещё не было'}`, practice: `В тренировках: ${practice}` };
}

/** Weaknesses first (by cost, then recency), then strengths; dismissed ones go to a separate list. */
export function sortPatterns(patterns: readonly CommunicationPattern[]): { weaknesses: CommunicationPattern[]; strengths: CommunicationPattern[]; dismissed: CommunicationPattern[] } {
  const recent = (a: CommunicationPattern, b: CommunicationPattern) => b.lastSeenAt.localeCompare(a.lastSeenAt);
  const visible = patterns.filter(pattern => !pattern.dismissed);
  const weaknesses = visible.filter(pattern => pattern.kind === 'weakness');
  return {
    // Open weaknesses by cost (1 = most expensive); resolved ones sink to the end.
    weaknesses: [
      ...weaknesses.filter(pattern => pattern.status !== 'resolved').sort((a, b) => a.costRank - b.costRank || recent(a, b)),
      ...weaknesses.filter(pattern => pattern.status === 'resolved').sort(recent),
    ],
    strengths: visible.filter(pattern => pattern.kind === 'strength').sort(recent),
    dismissed: patterns.filter(pattern => pattern.dismissed),
  };
}

/* ───────────── drills ───────────── */

export const DRILL_TYPE_LABEL: Record<DrillType, string> = {
  replay: 'Переиграть момент', pitch: 'Питч', price: 'Цена', questions: 'Вопросы', closing: 'Следующий шаг',
  language: 'Английский', story: 'История', followup: 'Письмо после звонка', rapidfire: 'Быстрые вопросы', cards: 'Карточки',
};

/** Due label without guilt: overdue drills are simply "можно сегодня". */
export function dueLabel(dueAt: string | null, now: Date = new Date()): { label: string; due: boolean } {
  if (!dueAt) return { label: 'Когда удобно', due: false };
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return { label: 'Когда удобно', due: false };
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(date) - start(now)) / 86_400_000);
  if (days <= 0) return { label: 'Можно сегодня', due: true };
  if (days === 1) return { label: 'Завтра', due: false };
  return { label: `Через ${days} ${plural(days, ['день', 'дня', 'дней'])}`, due: false };
}

/** Due/new first, then started, then scheduled later, then done; newest first inside a group. */
export function sortDrills(drills: readonly PersonalDrill[], now: Date = new Date()): PersonalDrill[] {
  const rank = (drill: PersonalDrill) => {
    if (drill.status === 'done') return 4;
    if (drill.status === 'started') return 1;
    return dueLabel(drill.dueAt, now).due || !drill.dueAt ? 0 : 2;
  };
  return [...drills].sort((a, b) => rank(a) - rank(b)
    || (a.dueAt && b.dueAt ? a.dueAt.localeCompare(b.dueAt) : 0)
    || b.createdAt.localeCompare(a.createdAt));
}

/* ───────────── facts ───────────── */

export const FACT_KIND_LABEL: Record<FactKind, string> = {
  rate: 'Ставки', floor: 'Пол цены', case: 'Кейсы', metric: 'Цифры и результаты', confidential: 'Конфиденциально',
  relocation: 'Переезд', counterpart: 'Собеседники', positioning: 'Самоподача', preference: 'Предпочтения', other: 'Другое',
};
export const FACT_KIND_ORDER: FactKind[] = ['rate', 'floor', 'case', 'metric', 'positioning', 'confidential', 'counterpart', 'relocation', 'preference', 'other'];
