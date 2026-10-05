import type { CallSegment } from '../../calls/types';

/**
 * Quote grounding for call reviews. A quote is accepted only when its words appear in order, as whole words, inside one
 * segment (or a short run of consecutive segments of the same side). Matching ignores case, whitespace, punctuation and
 * typographic quote/dash variants; "..." inside a quote may skip words between exact fragments.
 */
export function normaliseText(value: string): string {
  return value.normalize('NFKC')
    .replace(/[’‘ʼ`´]/gu, "'")
    .replace(/[‐‑‒–—―−]/gu, '-')
    .toLowerCase()
    .replace(/[*_~#>|"“”„«»()[\]{}]/gu, ' ')
    .replace(/[.,;:!?…]+/gu, ' ')
    .replace(/(^|\s)[-']+(?=\s|$)/gu, ' ')
    .replace(/(^|\s)'+/gu, '$1')
    .replace(/'+(?=\s|$)/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Split a quote on ellipses into exact fragments (normalised, non-empty). */
export function quoteParts(quote: string): string[] {
  return quote.split(/\[\s*(?:\.{3}|…)\s*\]|\.{3,}|…/u).map(normaliseText).filter(part => part.length >= 2);
}

/** Index of a whole-word occurrence of needle in a normalised haystack at or after `from`, or -1. */
export function findWords(haystack: string, needle: string, from = 0): number {
  let index = haystack.indexOf(needle, from);
  while (index >= 0) {
    const end = index + needle.length;
    if ((index === 0 || haystack[index - 1] === ' ') && (end === haystack.length || haystack[end] === ' ')) return index;
    index = haystack.indexOf(needle, index + 1);
  }
  return -1;
}

/** All fragments in order; the first one must start before `firstLimit` (inside the first segment of a window). */
export function fragmentsMatch(window: string, parts: string[], firstLimit = Number.POSITIVE_INFINITY): boolean {
  if (!parts.length) return false;
  let from = 0;
  for (;;) {
    const index = findWords(window, parts[0], from);
    if (index < 0 || index >= firstLimit) return false;
    let cursor = index + parts[0].length;
    let ok = true;
    for (const part of parts.slice(1)) {
      const next = findWords(window, part, cursor);
      if (next < 0) { ok = false; break; }
      cursor = next + part.length;
    }
    if (ok) return true;
    from = index + 1;
  }
}

export type QuoteSide = 'me' | 'other' | 'any';
export interface QuoteLocation { segmentId: string; start: number | null; index: number; viaVerbatimOnly: boolean; viaTextOnly: boolean }

interface Indexed { segment: CallSegment; side: 'me' | 'other' | null; text: string; verbatim: string | null }

/** Locates quotes in call segments. Disputed segments (marked as mis-heard) are never a valid source. */
export class QuoteIndex {
  private readonly items: Indexed[];

  constructor(segments: CallSegment[], meIds: ReadonlySet<string>) {
    this.items = segments.map(segment => ({
      segment,
      side: segment.speaker === null ? null : meIds.has(segment.speaker) ? 'me' : 'other',
      text: normaliseText(segment.text),
      verbatim: typeof segment.verbatim === 'string' && segment.verbatim.trim() ? normaliseText(segment.verbatim) : null,
    }));
  }

  get size(): number { return this.items.length; }

  private sideOk(item: Indexed, side: QuoteSide): boolean {
    if (item.segment.disputed) return false;
    if (side === 'any' || item.side === null) return true;
    return item.side === side;
  }

  private sameRun(first: Indexed, next: Indexed, side: QuoteSide): boolean {
    if (next.segment.disputed) return false;
    if (side === 'any') return next.segment.speaker === first.segment.speaker;
    return this.sideOk(next, side) && next.side === first.side;
  }

  private matches(parts: string[], side: QuoteSide, variant: 'text' | 'verbatim'): number[] {
    const found: number[] = [];
    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index];
      if (!this.sideOk(item, side)) continue;
      const first = variant === 'verbatim' ? item.verbatim ?? item.text : item.text;
      if (!first) continue;
      let window = first;
      for (let next = index + 1; next < this.items.length && next < index + 3 && this.sameRun(item, this.items[next], side); next++) {
        const other = this.items[next];
        window += ' ' + (variant === 'verbatim' ? other.verbatim ?? other.text : other.text);
      }
      if (fragmentsMatch(window, parts, first.length)) found.push(index);
    }
    return found;
  }

  /** Find a quote on the given side. preferAt picks the closest occurrence when the quote appears more than once. */
  locate(quote: string | null | undefined, side: QuoteSide, preferAt?: number | null): QuoteLocation | null {
    if (!quote) return null;
    const parts = quoteParts(quote);
    if (!parts.length || parts.join(' ').length < 3) return null;
    const byText = this.matches(parts, side, 'text');
    const byVerbatim = this.matches(parts, side, 'verbatim');
    const all = [...new Set([...byText, ...byVerbatim])].sort((left, right) => left - right);
    if (!all.length) return null;
    let chosen = all[0];
    if (typeof preferAt === 'number' && Number.isFinite(preferAt)) {
      let best = Number.POSITIVE_INFINITY;
      for (const index of all) {
        const start = this.items[index].segment.start;
        const distance = start === null ? Number.POSITIVE_INFINITY : Math.abs(start - preferAt);
        if (distance < best) { best = distance; chosen = index; }
      }
    }
    const item = this.items[chosen];
    return { segmentId: item.segment.id, start: item.segment.start, index: chosen,
      viaVerbatimOnly: !byText.includes(chosen) && byVerbatim.includes(chosen),
      viaTextOnly: byText.includes(chosen) && !byVerbatim.includes(chosen) && item.verbatim !== null };
  }

  /** Start of the segment nearest to `at` within `tolerance` seconds (for timeline moments without quotes). */
  snap(at: number | null | undefined, tolerance = 20): number | null {
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    let best: number | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const item of this.items) {
      const start = item.segment.start;
      if (start === null) continue;
      const gap = Math.abs(start - at);
      if (gap < distance) { distance = gap; best = start; }
    }
    return distance <= tolerance ? best : null;
  }

  /** Lenient grounding for lightly cleaned lines (drill seeds): best token coverage over short runs of one side. */
  coverage(line: string, side: QuoteSide): { coverage: number; start: number | null } {
    const tokens = tokensOf(line);
    if (!tokens.length) return { coverage: 0, start: null };
    let best = { coverage: 0, start: null as number | null };
    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index];
      if (!this.sideOk(item, side)) continue;
      let window = item.text;
      for (let next = index + 1; next < this.items.length && next < index + 3 && this.sameRun(item, this.items[next], side); next++) window += ' ' + this.items[next].text;
      const available = new Map<string, number>();
      for (const token of window.split(' ')) available.set(token, (available.get(token) ?? 0) + 1);
      let hits = 0;
      for (const token of tokens) {
        const count = available.get(token) ?? 0;
        if (count > 0) { hits++; available.set(token, count - 1); }
      }
      const value = hits / tokens.length;
      if (value > best.coverage) best = { coverage: value, start: item.segment.start };
    }
    return best;
  }
}

export function tokensOf(value: string): string[] {
  return normaliseText(value).split(' ').filter(token => token.length >= 2);
}

/** Quotes for debrief/memory sources: any exact fragment sequence inside the source text. */
export class TextQuoteIndex {
  private readonly text: string;
  readonly timestamps: Set<number>;

  constructor(source: string) {
    this.text = normaliseText(source);
    this.timestamps = new Set<number>();
    for (const match of source.matchAll(/(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g)) {
      const seconds = (match[1] ? Number(match[1]) * 3600 : 0) + Number(match[2]) * 60 + Number(match[3]);
      if (Number(match[3]) < 60) this.timestamps.add(seconds);
    }
  }

  contains(quote: string | null | undefined): boolean {
    if (!quote) return false;
    const parts = quoteParts(quote);
    return parts.length > 0 && parts.join(' ').length >= 3 && fragmentsMatch(this.text, parts);
  }

  /** Keep `at` only when that time is written in the source. */
  time(at: number | null | undefined): number | null {
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    const rounded = Math.round(at);
    return this.timestamps.has(rounded) ? rounded : null;
  }
}

export function hasCyrillic(value: string): boolean { return /[А-Яа-яЁё]/u.test(value); }

/** At least ~60% of letters are Latin (English model lines, corrections and messages). */
export function mostlyLatin(value: string): boolean {
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  const cyrillic = (value.match(/[А-Яа-яЁё]/gu) ?? []).length;
  return latin > 0 && latin >= (latin + cyrillic) * 0.6;
}

export function slugify(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 48);
}

export function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}

export function clipBlock(value: string, max: number): string {
  const text = value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
