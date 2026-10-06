// «Мои фразы» words on the web client (planning/v05/PASS-0.5.3.md §1.6): due labels, Russian plural forms, history lines,
// the Practice/Today overview, the review block notes and the capture field helpers. Pure (no React, no DOM, no fetch);
// unit-tested in tests/phrases-labels.test.ts. The iPhone shows the same strings; change both together.
import { PHRASE_TEXT_LIMIT, type PhraseHistoryResult, type PhraseResult, type SavedPhrase } from './types';
import { duePhraseCount, mostlyLatin, phraseIsUsable, phraseRoundCandidates, phraseTarget } from './schedule';

/** Hidden lesson family of a phrase round (lib/server/teacher.ts `phraseLessonPlan`). */
export const PHRASE_ROUND_FAMILY = 'my-phrases';
/** Chips on the Practice card. */
export const PHRASE_CHIPS = 3;

const DAY_MS = 86_400_000;
const time = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

// ── Russian plural forms ──

export type PluralForms = readonly [one: string, few: string, many: string];

/** Russian plural: ruPlural(3, ['фраза', 'фразы', 'фраз']) → 'фразы'; 11–14 always take the third form. */
export function ruPlural(value: number, forms: PluralForms): string {
  const n = Math.abs(Math.trunc(value)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last > 1 && last < 5) return forms[1];
  return forms[2];
}

const PHRASES: PluralForms = ['фраза', 'фразы', 'фраз'];
const DAYS: PluralForms = ['день', 'дня', 'дней'];
const WAIT: PluralForms = ['ждёт', 'ждут', 'ждут'];

/** «1 фраза», «3 фразы», «5 фраз». */
export const phraseCount = (value: number) => `${value} ${ruPlural(value, PHRASES)}`;
/** Practice card and Today row: «3 ждут повторения», «1 ждёт повторения». */
export const waitingLabel = (value: number) => `${value} ${ruPlural(value, WAIT)} повторения`;
/** With the noun (the launch line): «1 фраза ждёт повторения», «5 фраз ждут повторения». */
export const phrasesWaitingLabel = (value: number) => `${phraseCount(value)} ${ruPlural(value, WAIT)} повторения`;

// ── Days ──

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const shortFormats = new Map<string, Intl.DateTimeFormat>();
function cached(map: Map<string, Intl.DateTimeFormat>, timeZone: string | undefined, make: () => Intl.DateTimeFormat) {
  const key = timeZone ?? '';
  let format = map.get(key);
  if (!format) { format = make(); map.set(key, format); }
  return format;
}

/** Calendar day number (days since 1970-01-01) of `at` in `timeZone` (default: the device's time zone). */
export function calendarDay(at: number, timeZone?: string): number {
  const format = cached(dayFormats, timeZone, () => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const parts = format.formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
  return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS);
}

/** «сегодня», «завтра», «через 3 дня» (by calendar days; a moment that has already come reads «сегодня»). */
export function dueInLabel(at: number, now: number, timeZone?: string): string {
  if (at <= now) return 'сегодня';
  const days = calendarDay(at, timeZone) - calendarDay(now, timeZone);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${ruPlural(days, DAYS)}`;
}

/** «06.10» */
export function shortDay(at: string | number, timeZone?: string): string {
  const value = time(at);
  if (!value) return '';
  return cached(shortFormats, timeZone, () => new Intl.DateTimeFormat('ru', { timeZone, day: '2-digit', month: '2-digit' })).format(new Date(value));
}

// ── One phrase ──

/** What a row shows first: the English expression once Sol found it, otherwise what he saved. */
export function phraseHeadline(phrase: Pick<SavedPhrase, 'enrichment' | 'phrase' | 'text'>): string {
  return phrase.enrichment === 'ready' && phrase.phrase?.trim() ? phrase.phrase.trim() : phrase.text.trim();
}

/** The headline is English (bold EN style, `lang="en"`). */
export function headlineIsEnglish(phrase: Pick<SavedPhrase, 'enrichment' | 'phrase' | 'text'>): boolean {
  return (phrase.enrichment === 'ready' && !!phrase.phrase?.trim()) || mostlyLatin(phrase.text);
}

/**
 * Right side of a row in «Мои фразы»: «сегодня» / «завтра» / «через 3 дня» / «выучена» / «уже знаю». Null while Sol is
 * still working on it, or when it has no English target yet (a Russian text whose enrichment failed).
 */
export function phraseDueLabel(phrase: SavedPhrase, now = Date.now(), timeZone?: string): string | null {
  if (phrase.archived) return 'уже знаю';
  if (phrase.status === 'learned') return 'выучена';
  if (!phraseTarget(phrase)) return null;
  return dueInLabel(time(phrase.dueAt), now, timeZone);
}

/** Why Sol could not take it apart (its own note when it gave one). */
export function enrichmentProblem(phrase: Pick<SavedPhrase, 'note'>): string {
  return phrase.note?.trim() || 'Разбор не получился.';
}

export const HISTORY_RESULT_LABEL: Record<PhraseHistoryResult, string> = {
  used: 'сказал в разговоре',
  hinted: 'сказал с подсказкой',
  missed: 'не прозвучала',
  offered: 'повода не было',
};

/** «06.10 · сказал в разговоре», «05.10 · не прозвучала». */
export function phraseHistoryLine(entry: { at: string; result: PhraseHistoryResult }, timeZone?: string): string {
  const day = shortDay(entry.at, timeZone);
  const label = HISTORY_RESULT_LABEL[entry.result] ?? '';
  return day ? `${day} · ${label}` : label;
}

// ── Lists ──

/**
 * «К повторению»: every phrase waiting now, in the order the server's round takes them (`phraseRoundCandidates`: practised
 * ones by `dueAt`, then the new ones, oldest first), so the list, the chips and «Повторить · N» show what a round will hold.
 */
export function phrasesToRepeat(phrases: readonly SavedPhrase[] | null | undefined, now = Date.now()): SavedPhrase[] {
  return phraseRoundCandidates(phrases, now, Number.POSITIVE_INFINITY);
}

/** «Все»: everything saved, archived included, newest first. */
export function allPhrases(phrases: readonly SavedPhrase[] | null | undefined): SavedPhrase[] {
  return [...(phrases ?? [])].sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

export type PhrasesOverview = {
  /** Everything saved (archived included). */
  total: number;
  /** Waiting now (new ones included). */
  due: number;
  /** How many one round takes («Повторить · N»). */
  round: number;
  /** Up to PHRASE_CHIPS of the waiting ones, in round order. */
  chips: { id: string; text: string }[];
  /** When nothing waits: the nearest next practice («завтра», «через 3 дня»); null when nothing is scheduled. */
  next: string | null;
};

/** What the Practice card, the Today row and the sheet footer show. */
export function phrasesOverview(phrases: readonly SavedPhrase[] | null | undefined, now = Date.now(), timeZone?: string): PhrasesOverview {
  const list = phrases ?? [];
  const due = duePhraseCount(list, now);
  const round = phraseRoundCandidates(list, now);
  let next: string | null = null;
  if (!due) {
    const upcoming = list.filter(phrase => phraseIsUsable(phrase)).map(phrase => time(phrase.dueAt)).filter(at => at > now).sort((a, b) => a - b)[0];
    if (upcoming !== undefined) next = dueInLabel(upcoming, now, timeZone);
  }
  return {
    total: list.length,
    due,
    round: round.length,
    chips: round.slice(0, PHRASE_CHIPS).map(phrase => ({ id: phrase.id, text: phraseTarget(phrase) ?? phraseHeadline(phrase) })),
    next,
  };
}

/** A phrase the server returned goes into the list: replaced in place (never by an older copy) or added on top. */
export function upsertPhrase(list: readonly SavedPhrase[] | null | undefined, phrase: SavedPhrase): SavedPhrase[] {
  const current = (list ?? []) as SavedPhrase[];
  const index = current.findIndex(item => item.id === phrase.id);
  if (index < 0) return [phrase, ...current];
  if (time(current[index].updatedAt) > time(phrase.updatedAt)) return current;
  const next = current.slice();
  next[index] = phrase;
  return next;
}

export function removePhrase(list: readonly SavedPhrase[] | null | undefined, id: string): SavedPhrase[] {
  return (list ?? []).filter(item => item.id !== id);
}

// ── Review block «Фразы из копилки» ──

export function isPhraseRound(lesson: { familyId?: string | null }): boolean {
  return lesson.familyId === PHRASE_ROUND_FAMILY;
}

/**
 * The supports line of a live lesson in «С опорами» (session header): a phrase round shows its Russian cues («Вспомни: …»), an
 * ordinary session the cues of the phrases woven into it («Из твоих фраз: …»). Both come from the plan's languageFocus, which the
 * server writes without the English targets. «Как на созвоне» shows nothing. The iPhone mirrors it (PhraseLabels.supportLine).
 */
export function phraseSupportLine(lesson: { familyId?: string | null; languageFocus?: string | null; phraseIds?: string[] | null }, mode: string):
  { label: 'Вспомни' | 'Из твоих фраз'; text: string } | null {
  if (mode !== 'learning' || !lesson.phraseIds?.length) return null;
  const focus = (lesson.languageFocus ?? '').trim();
  if (isPhraseRound(lesson)) {
    const cues = focus.replace(/^Вспомни:?\s*/u, '').trim();
    return cues ? { label: 'Вспомни', text: cues.replace(/\.$/u, '') } : null;
  }
  const marker = focus.lastIndexOf('Из твоих фраз:');
  const cues = marker >= 0 ? focus.slice(marker + 'Из твоих фраз:'.length).trim() : '';
  return cues ? { label: 'Из твоих фраз', text: cues } : null;
}

/** The quiet line under a phrase in the review; null when the learner's own sentence speaks for itself. */
export function phraseResultNote(result: Pick<PhraseResult, 'used' | 'hinted'>, round: boolean): string | null {
  if (result.used) return result.hinted ? 'С подсказкой — вернётся завтра' : null;
  return round ? 'Не прозвучала — вернётся завтра' : 'Повода не было';
}

// ── Capture ──

/** The shortcut line on PC: the accelerator that really registered, or where to find the capture instead. */
export function shortcutHint(status: { shortcut?: string | null; shortcutRegistered?: boolean } | null | undefined): string | null {
  if (!status) return null;
  const shortcut = status.shortcut?.trim();
  return status.shortcutRegistered && shortcut ? `${shortcut} — из любого окна` : 'Горячая клавиша занята — открывай из значка в трее';
}

/** The text «Запомнить» sends: trimmed, 1–600 characters with at least one letter; null when there is nothing to save. */
export function captureText(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > PHRASE_TEXT_LIMIT || !/\p{L}/u.test(text)) return null;
  return text;
}

/**
 * «Вставить»: the clipboard text goes where the caret is (replacing a selection), separated from neighbouring words by a
 * space, and clipped so the field never exceeds `limit`.
 */
export function insertText(current: string, inserted: string, selection: { start: number; end: number } | null | undefined, limit = PHRASE_TEXT_LIMIT) {
  const clamp = (value: number) => Math.min(current.length, Math.max(0, Math.trunc(value)));
  const start = clamp(selection?.start ?? current.length);
  const end = Math.max(start, clamp(selection?.end ?? start));
  const before = current.slice(0, start);
  const after = current.slice(end);
  const clean = inserted.replace(/\r\n?/g, '\n').trim();
  const lead = before && !/\s$/.test(before) && clean ? ' ' : '';
  const tail = after && !/^\s/.test(after) && clean ? ' ' : '';
  const room = Math.max(0, limit - before.length - after.length - lead.length - tail.length);
  const piece = clean.slice(0, room);
  const text = piece ? before + lead + piece + tail + after : current;
  return { text, caret: piece ? before.length + lead.length + piece.length : end, truncated: piece.length < clean.length };
}
