/**
 * Placement result → presentation rows (audit-product §2.9: shape first, ranges, basis, never percentages,
 * skipped = «не измерено»). Pure — unit-tested in tests/web-placement-flow.test.ts.
 */
import { CEFR_LEVELS, CEFR_VALUE, type CEFRLevel, type Confidence, type PlacementResult, type PlacementSkillId, type PlacementView } from '@/lib/placement/types';
import { STRATEGY_MOVES, type StrategyMoveId } from '@/lib/strategy-moves';

export const SKILL_TITLE: Record<PlacementSkillId, string> = {
  listening: 'Понимание на слух', reading: 'Чтение', grammar: 'Грамматика', vocabulary: 'Слова', speaking: 'Речь', interaction: 'Разговор',
};
export const SKILL_ORDER: PlacementSkillId[] = ['listening', 'reading', 'grammar', 'vocabulary', 'speaking', 'interaction'];
export const CONFIDENCE_LABEL: Record<Confidence, string> = { low: 'низкая', medium: 'средняя', high: 'высокая' };
export const NOT_MEASURED = 'не измерено';

export interface SkillRow {
  id: PlacementSkillId;
  title: string;
  measured: boolean;
  label: string;                 // 'B1+' or 'не измерено'
  range: string | null;          // 'B1–B2' (or 'B1' when from = to)
  /** Range on the 6-band axis for the bar: 0–1 positions of the band edges. */
  rangeStart: number; rangeEnd: number;
  /** 0–1 position of the point estimate. */
  marker: number | null;
  confidence: string;            // 'средняя'
  basis: string;
  note: string;
}

/** Band index (A1 = 0 … C2 = 5) → fraction of the axis. */
function axis(level: CEFRLevel, edge: 'start' | 'end'): number {
  const index = CEFR_LEVELS.indexOf(level);
  return (index + (edge === 'end' ? 1 : 0)) / CEFR_LEVELS.length;
}

export function skillRows(result: PlacementResult): SkillRow[] {
  return SKILL_ORDER.map(id => {
    const skill = result.skills.find(item => item.id === id);
    const measured = !!skill && skill.level !== null && skill.score !== null;
    if (!skill || !measured) {
      return { id, title: SKILL_TITLE[id], measured: false, label: NOT_MEASURED, range: null, rangeStart: 0, rangeEnd: 0, marker: null,
        confidence: skill ? CONFIDENCE_LABEL[skill.confidence] : CONFIDENCE_LABEL.low, basis: skill?.basis || 'Раздел пропущен', note: skill?.note || '' };
    }
    const range = skill.range;
    const from = range?.from ?? skill.level!;
    const to = range?.to ?? skill.level!;
    const ordered = CEFR_VALUE[from] <= CEFR_VALUE[to] ? [from, to] as const : [to, from] as const;
    return {
      id, title: SKILL_TITLE[id], measured: true, label: skill.label || skill.level!,
      range: ordered[0] === ordered[1] ? ordered[0] : `${ordered[0]}–${ordered[1]}`,
      rangeStart: axis(ordered[0], 'start'), rangeEnd: axis(ordered[1], 'end'),
      marker: scoreToAxis(skill.score!),
      confidence: CONFIDENCE_LABEL[skill.confidence], basis: skill.basis, note: skill.note,
    };
  });
}

/** Continuous score 1–6 → axis position 0–1 (centre of band at x.5). */
export function scoreToAxis(score: number): number {
  const clamped = Math.min(6.49, Math.max(0.5, score));
  return (clamped - 0.5) / 6;
}

/** "навыки от A2+ до B2" — the spread across measured skills (the profile's shape in one line). */
export function skillSpread(result: PlacementResult): { low: string; high: string; gap: number } | null {
  const measured = result.skills.filter(skill => skill.score !== null && skill.label);
  if (measured.length < 2) return null;
  const sorted = [...measured].sort((a, b) => a.score! - b.score!);
  const low = sorted[0]; const high = sorted[sorted.length - 1];
  return { low: `${SKILL_TITLE[low.id].toLowerCase()} ${low.label}`, high: `${SKILL_TITLE[high.id].toLowerCase()} ${high.label}`, gap: high.score! - low.score! };
}

export interface MoveRow { id: StrategyMoveId; title: string; score: 0 | 1 | 2 | null; glyph: '✓' | '½' | '✗' | '—'; meaning: string; quote: string | null }

/** The 8 strategy moves in canonical order. Counts only — never a CEFR band. */
export function moveRows(result: PlacementResult): { rows: MoveRow[]; strong: number; withOpportunity: number } {
  const scores = new Map(result.communication.moves.map(move => [move.id, move]));
  const rows = STRATEGY_MOVES.map(move => {
    const score = scores.get(move.id);
    const value = score ? score.score : null;
    const glyph: MoveRow['glyph'] = value === 2 ? '✓' : value === 1 ? '½' : value === 0 ? '✗' : '—';
    const meaning = value === 2 ? move.good : value === 0 ? move.bad : value === 1 ? `Частично: ${lowerFirst(move.good)}` : 'Не было повода';
    return { id: move.id, title: move.title, score: value, glyph, meaning, quote: score?.quote ?? null };
  });
  return { rows, strong: rows.filter(row => row.score === 2).length, withOpportunity: rows.filter(row => row.score !== null).length };
}

function lowerFirst(text: string) { return text ? text[0].toLowerCase() + text.slice(1) : text; }

export interface TimingFigure { id: string; value: string; label: string }

/** Speaking timing figures in Russian (only the ones that were measured). */
export function timingFigures(timing: PlacementResult['speaking']['timing']): TimingFigure[] {
  if (!timing) return [];
  const figures: TimingFigure[] = [];
  const decimal = (value: number) => value.toFixed(1).replace('.', ',');
  if (timing.wordsPerMinute !== null) figures.push({ id: 'wpm', value: String(Math.round(timing.wordsPerMinute)), label: 'слов в минуту' });
  if (timing.pausesPerMinute !== null) figures.push({ id: 'pauses', value: String(Math.round(timing.pausesPerMinute)), label: 'пауз в минуту' });
  if (timing.meanLengthOfRun !== null) figures.push({ id: 'mlr', value: decimal(timing.meanLengthOfRun), label: 'слов между паузами' });
  if (timing.longestPauseSeconds !== null) figures.push({ id: 'longest', value: `${decimal(timing.longestPauseSeconds)} с`, label: 'самая длинная пауза' });
  if (timing.latencySeconds !== null) figures.push({ id: 'latency', value: `${decimal(timing.latencySeconds)} с`, label: 'до первого слова' });
  if (timing.fillersPerMinute !== null) figures.push({ id: 'fillers', value: decimal(timing.fillersPerMinute), label: 'заполнителей в минуту' });
  return figures;
}

export const CRITERIA: { id: 'range' | 'accuracy' | 'fluency' | 'coherence'; title: string }[] = [
  { id: 'range', title: 'Запас' }, { id: 'accuracy', title: 'Точность' }, { id: 'fluency', title: 'Беглость' }, { id: 'coherence', title: 'Связность' },
];

/** Lowest speaking criterion = the main brake (shown as «главный тормоз»). */
export function speakingBrake(result: PlacementResult): 'range' | 'accuracy' | 'fluency' | 'coherence' | null {
  const values = CRITERIA.map(item => ({ id: item.id, level: result.speaking[item.id] }))
    .filter((item): item is { id: typeof item.id; level: CEFRLevel } => item.level !== null);
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => CEFR_VALUE[a.level] - CEFR_VALUE[b.level]);
  return CEFR_VALUE[sorted[0].level] < CEFR_VALUE[sorted[sorted.length - 1].level] ? sorted[0].id : null;
}

const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const DAY_YEAR = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
export function dayLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return (date.getFullYear() === now.getFullYear() ? DAY : DAY_YEAR).format(date).replace(/\s?г\.$/, '');
}

/** Retake button note: before retakeAvailableAt the retake is allowed but flagged as within noise. */
export function retakeNote(view: Pick<PlacementView, 'retakeAvailableAt'>, now = new Date()): { early: boolean; text: string | null } {
  if (!view.retakeAvailableAt) return { early: false, text: null };
  const at = new Date(view.retakeAvailableAt);
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return { early: false, text: 'Пора пересдать: новые задания покажут, что изменилось.' };
  return { early: true, text: `Лучше пересдавать с ${dayLabel(view.retakeAvailableAt, now)}: за пару недель изменения обычно в пределах погрешности.` };
}

export interface SparkPoint { x: number; y: number; label: string; date: string | null; score: number }

/** History sparkline points (oldest first), y: 0 = C2 top, 1 = A1 bottom. Only shown when > 1 result. */
export function sparkline(history: PlacementView['history'], now = new Date()): SparkPoint[] {
  if (history.length < 2) return [];
  const scores = history.map(item => item.score).filter(Number.isFinite);
  const min = Math.max(1, Math.floor(Math.min(...scores) - 0.5));
  const max = Math.min(6, Math.ceil(Math.max(...scores) + 0.5));
  const span = Math.max(1, max - min);
  return history.map((item, index) => ({
    x: history.length === 1 ? 0.5 : index / (history.length - 1),
    y: 1 - (Math.min(max, Math.max(min, item.score)) - min) / span,
    label: item.overall, date: dayLabel(item.completedAt, now), score: item.score,
  }));
}

/** Level badge fill: share of the A1…C2 ladder (for the liquid badge animation only — never shown as a number). */
export function badgeFill(score: number): number {
  return 0.12 + 0.88 * ((Math.min(6, Math.max(1, score)) - 1) / 5);
}

export const REVIEW_SECTION_TITLE: Record<'listening' | 'reading' | 'language', string> = { listening: 'Аудирование', reading: 'Чтение', language: 'Грамматика и слова' };
