import type { CallMetrics, CallSegment, CallSpeaker } from '../../calls/types';

/** Speaker cards and call metrics computed from segments (pure). Metrics are descriptive, never quotas. */

const FILLERS = /\b(?:u+h+m*|u+m+|e+r+m+|e+r+|a+h+|h+m+|m{2,})\b|\byou know\b/giu;
/** The counterpart asks to repeat right after his line: the only honest intelligibility proxy from a transcript. */
const CLARIFY = /^\W*(?:sorry|pardon|what|huh|come again)(?:\s*,?\s*(?:what|again))?\s*\?|\b(?:could|can|would) you (?:please )?(?:repeat|say (?:that|it) again)\b|\bsay (?:that|it) again\b|\bdidn'?t (?:catch|get|hear) (?:that|it|you)\b|\bcome again\?/iu;

function words(text: string): number { return text.split(/\s+/u).filter(token => /[\p{L}\p{N}]/u.test(token)).length; }
function duration(segment: CallSegment): number | null {
  return segment.start !== null && segment.end !== null && segment.end >= segment.start ? segment.end - segment.start : null;
}
function round(value: number, digits = 2): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Up to three short, recognisable lines spread across the call. */
function samples(segments: CallSegment[]): string[] {
  const candidates = segments.filter(segment => words(segment.text) >= 4);
  const pool = candidates.length ? candidates : segments;
  if (!pool.length) return [];
  const picks = pool.length <= 3 ? pool : [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]];
  return picks.map(segment => segment.text.length > 140 ? segment.text.slice(0, 139).trimEnd() + '…' : segment.text);
}

/**
 * Speaker cards: 'Ты' for the learner; a single other speaker takes the counterpart's name; several others are numbered by talk time.
 * Existing labels (from a transcript or the learner) are kept.
 */
export function buildSpeakers(segments: CallSegment[], options: { counterpart: string | null; meIds: ReadonlySet<string>; labels?: Record<string, string> }): CallSpeaker[] {
  const ids: string[] = [];
  for (const segment of segments) if (segment.speaker !== null && !ids.includes(segment.speaker)) ids.push(segment.speaker);
  const timed = segments.length > 0 && segments.every(segment => duration(segment) !== null);
  const cards = ids.map(id => {
    const own = segments.filter(segment => segment.speaker === id);
    const talk = timed ? round(own.reduce((sum, segment) => sum + (duration(segment) ?? 0), 0), 1) : null;
    return { id, isMe: options.meIds.has(id), talkSeconds: talk, sample: samples(own), lines: own.length };
  });
  const others = cards.filter(card => !card.isMe).sort((left, right) => (right.talkSeconds ?? right.lines) - (left.talkSeconds ?? left.lines));
  return [...cards.filter(card => card.isMe), ...others].map(card => {
    const index = others.indexOf(card);
    const fallback = card.isMe ? 'Ты' : others.length === 1 && options.counterpart ? options.counterpart : `Собеседник ${index + 1}`;
    const label = options.labels?.[card.id]?.trim() || fallback;
    return { id: card.id, label: label.slice(0, 80), isMe: card.isMe, talkSeconds: card.talkSeconds, sample: card.sample };
  });
}

export function computeMetrics(segments: CallSegment[], speakers: CallSpeaker[]): CallMetrics {
  const me = new Set(speakers.filter(speaker => speaker.isMe).map(speaker => speaker.id));
  const mine = (segment: CallSegment) => segment.speaker !== null && me.has(segment.speaker);
  const timed = segments.length > 0 && segments.every(segment => duration(segment) !== null);
  let myTurns = 0;
  let otherTurns = 0;
  let previousSide: boolean | null = null;
  let longest = 0;
  let runStart: number | null = null;
  let runEnd: number | null = null;
  const latencies: number[] = [];
  let clarify = 0;
  segments.forEach((segment, index) => {
    const side = mine(segment);
    if (side !== previousSide) { if (side) myTurns++; else otherTurns++; }
    if (side) {
      if (previousSide !== true) runStart = segment.start;
      runEnd = segment.end;
      if (timed && runStart !== null && runEnd !== null) longest = Math.max(longest, runEnd - runStart);
      const previous = segments[index - 1];
      if (timed && previous && !mine(previous) && segment.start !== null && previous.end !== null) {
        const gap = segment.start - previous.end;
        if (gap >= -1 && gap <= 15) latencies.push(Math.max(0, gap));
      }
    } else {
      const previous = segments[index - 1];
      if (previous && mine(previous) && CLARIFY.test(segment.text.trim())) clarify++;
    }
    previousSide = side;
  });
  const myTime = timed ? segments.filter(mine).reduce((sum, segment) => sum + (duration(segment) ?? 0), 0) : 0;
  const allTime = timed ? segments.filter(segment => segment.speaker !== null).reduce((sum, segment) => sum + (duration(segment) ?? 0), 0) : 0;
  const myWords = segments.filter(mine).reduce((sum, segment) => sum + words(segment.verbatim ?? segment.text), 0);
  const verbatim = segments.filter(segment => mine(segment) && typeof segment.verbatim === 'string');
  const verbatimTime = verbatim.reduce((sum, segment) => sum + (duration(segment) ?? 0), 0);
  const fillers = verbatim.reduce((sum, segment) => sum + (segment.verbatim!.match(FILLERS)?.length ?? 0), 0);
  return {
    myTalkShare: timed && allTime > 0 ? round(myTime / allTime, 3) : null,
    myWordsPerMinute: timed && myTime >= 20 ? Math.round(myWords / (myTime / 60)) : null,
    longestMonologueSeconds: timed && myTurns ? round(longest, 1) : null,
    myTurns, otherTurns,
    myQuestions: segments.filter(mine).reduce((sum, segment) => sum + ((segment.verbatim ?? segment.text).match(/\?/g)?.length ?? 0), 0),
    responseLatencyMedianSeconds: latencies.length ? round(median(latencies)!, 2) : null,
    fillersPerMinute: verbatimTime >= 20 ? round(fillers / (verbatimTime / 60), 1) : null,
    clarifyRequests: clarify,
  };
}
