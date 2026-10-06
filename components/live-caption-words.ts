/**
 * Pure model of the learner's live captions (MOTION-PASS-0.5.2 §5): stable word identities through partial results,
 * in-place revisions, and the reveal pacing that turns bursty recognition into a calm word-by-word flow.
 */
export type CaptionWord = {
  /** Stable identity; also the arrival order (ids only grow), which is the reveal order. */
  id: number;
  text: string;
  space: string;
  /** When the word first arrived (caller clock, ms). */
  at: number;
  /** Bumps when recognition rewrote an existing word: the view cross-fades it in place. */
  rev: number;
  /** The text the last revision replaced (fades out under the new text). */
  previous?: string;
};
export type CaptionWords = { text: string; leading: string; words: CaptionWord[]; nextId: number };

export const emptyCaptionWords: CaptionWords = { text: '', leading: '', words: [], nextId: 0 };

/** Case and trailing punctuation are not a different word ("i" → "I", "maybe" → "maybe?"). */
function identity(text: string) {
  return text.toLocaleLowerCase('en').replace(/[.,!?;:…]+$/u, '');
}

/** A word extended this soon after it arrived just completes ("thi" → "think"); later changes cross-fade. */
export const CAPTION_GROW_MS = 120;

/**
 * Recognition can extend the last word, add punctuation or rewrite an earlier phrase (the final `completed` text).
 * Existing words keep their identity for the stable prefix/suffix and for in-place replacements, so only really new
 * words enter; a replacement bumps `rev` (cross-fade) unless it changed only case or punctuation, or merely grew within
 * CAPTION_GROW_MS of arriving — those update silently and never flash. Words not shown yet (id > shownThrough) change
 * silently too.
 */
export function reconcileCaptionWords(previous: CaptionWords, text: string, now = 0, shownThrough = Infinity): CaptionWords {
  if (text === previous.text) return previous;
  const incoming = [...text.matchAll(/(\S+)(\s*)/gu)].map(match => ({ text: match[1], space: match[2] }));
  const leading = text.match(/^\s*/u)?.[0] ?? '';
  const old = previous.words;
  let prefix = 0, suffix = 0, nextId = previous.nextId;
  while (prefix < old.length && prefix < incoming.length && identity(old[prefix].text) === identity(incoming[prefix].text)) prefix++;
  while (suffix < old.length - prefix && suffix < incoming.length - prefix
    && identity(old[old.length - suffix - 1].text) === identity(incoming[incoming.length - suffix - 1].text)) suffix++;
  const oldMiddleCount = old.length - prefix - suffix;
  const words = incoming.map((word, index): CaptionWord => {
    const kept = index < prefix ? old[index]
      : index >= incoming.length - suffix ? old[old.length - (incoming.length - index)] : undefined;
    if (kept) return kept.text === word.text && kept.space === word.space ? kept : { ...kept, text: word.text, space: word.space };
    const replaced = index - prefix < oldMiddleCount ? old[index] : undefined;
    if (!replaced) return { id: nextId++, text: word.text, space: word.space, at: now, rev: 0 };
    const before = identity(replaced.text), after = identity(word.text);
    const justCompleted = after.startsWith(before) && now - replaced.at <= CAPTION_GROW_MS;
    if (replaced.id > shownThrough || before === after || justCompleted) return { ...replaced, text: word.text, space: word.space };
    return { ...replaced, text: word.text, space: word.space, rev: replaced.rev + 1, previous: replaced.text };
  });
  return { text, leading, words, nextId };
}

/** One word per this many ms while the queue is short (calm, faster than speech). */
export const REVEAL_WORD_MS = 55;
/** No word waits longer than this after it arrived; bursts are compressed to meet it. */
export const REVEAL_MAX_LAG_MS = 350;

/**
 * Reveal pacing. `waiting` holds the arrival times of the words not shown yet, in reveal order (non-decreasing);
 * `anchor` is when the previous word was shown. A word that arrives after a pause shows at once; the next ones follow
 * one REVEAL_WORD_MS apart, and the pace tightens whenever that would leave any word more than REVEAL_MAX_LAG_MS
 * behind its arrival. Returns how many words to show at `now` and the new anchor.
 */
export function paceReveal(waiting: readonly number[], anchor: number, now: number): { count: number; anchor: number } {
  if (!waiting.length) return { count: 0, anchor };
  let count = 0;
  // Overdue words (a throttled frame, an enormous burst) show at once; the cadence continues from now.
  while (count < waiting.length && now - waiting[count] >= REVEAL_MAX_LAG_MS) count++;
  if (count) anchor = now;
  // The k-th remaining word shows at most (k + 1) intervals from now: keep each one inside its deadline.
  let interval = REVEAL_WORD_MS;
  for (let index = count; index < waiting.length; index++) {
    interval = Math.min(interval, (waiting[index] + REVEAL_MAX_LAG_MS - now) / (index - count + 1));
  }
  let next = anchor + interval;
  // After a pause (the cadence is more than a word behind) it restarts: the first waiting word is due now, not a
  // backlog of missed intervals. Within a burst the cadence just catches up, a few words per frame if needed.
  if (next < now - REVEAL_WORD_MS) next = now;
  // Exact cadence (frames only quantise it); several words per frame when the pace is tighter than a frame.
  while (count < waiting.length && next <= now + 0.5) { count++; anchor = next; next += interval; }
  return { count, anchor };
}

/** Words shown at `through` (every id ≤ through), oldest first. */
export function shownWords(words: readonly CaptionWord[], through: number): CaptionWord[] {
  return words.filter(word => word.id <= through);
}

/** Arrival times of the words still waiting after `through`, in reveal (id) order. */
export function waitingArrivals(words: readonly CaptionWord[], through: number): { ids: number[]; arrivals: number[] } {
  const waiting = words.filter(word => word.id > through).sort((left, right) => left.id - right.id);
  return { ids: waiting.map(word => word.id), arrivals: waiting.map(word => word.at) };
}
