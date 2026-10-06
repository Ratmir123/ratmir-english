// «Мои фразы» usage detection (planning/v05/PASS-0.5.3.md §1.4). Pure: the server runs it over the learner's own turns when a
// conversation with saved phrases finishes, and the enrichment/plan code uses it to keep the target out of cues and partner lines.
// Tolerant to inflection ("circled back"), a few inserted words, common irregular verbs and placeholder slots
// ("get someone up to speed" → "get the new designer up to speed"); Russian or unrelated text never counts.

/** A conversation turn as the detector needs it (lib/types.ts Turn is compatible). */
export interface PhraseTurn { id: string; text: string; support: number; role?: 'user' | 'assistant'; disputed?: boolean }
export interface PhraseUse {
  used: boolean;
  /** The use came in a turn where the learner had a hint (or edited the transcript): support > 0. */
  hinted: boolean;
  turnId: string | null;
  /** The learner sentence that used it, at most 160 characters. */
  quote: string | null;
}

export const PHRASE_QUOTE_LIMIT = 160;
/** Other words allowed between two neighbouring words of the expression. */
const GAP = 3;
/** Extra room where the expression has a slot the speaker fills with a noun phrase ("someone" → "the new designer"). */
const SLOT_GAP = 3;
/** A saved "expression" longer than this is a passage: only its beginning is matched. */
const MAX_TARGET_WORDS = 40;

/** Slots the speaker fills with their own noun phrase. */
const SLOTS = new Set(['someone', 'somebody', 'something', 'sb', 'sth', 'smb', "someone's", "somebody's", "sb's", "smb's", "sth's"]);
/** Placeholders and function words that vary freely around an expression (§1.4), plus the obvious pronoun variants. */
const DROPPED = new Set([...SLOTS, "one's", 'oneself', 'your', 'my', 'his', 'her', 'their', 'our', 'its',
  'myself', 'yourself', 'himself', 'herself', 'ourselves', 'yourselves', 'themselves', 'me', 'you', 'him', 'us', 'them',
  'a', 'an', 'the', 'to', 'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being']);

const IRREGULAR: Record<string, string> = {};
for (const [base, ...forms] of [
  ['go', 'goes', 'going', 'went', 'gone'], ['take', 'took', 'taken'], ['get', 'got', 'gotten'], ['make', 'made'], ['come', 'came'],
  ['give', 'gave', 'given'], ['keep', 'kept'], ['bring', 'brought'], ['think', 'thought'], ['catch', 'caught'], ['run', 'ran'],
  ['say', 'said'], ['tell', 'told'], ['find', 'found'], ['feel', 'felt'], ['leave', 'left'], ['hold', 'held'], ['stand', 'stood'],
  ['speak', 'spoke', 'spoken'], ['break', 'broke', 'broken'], ['write', 'wrote', 'written'], ['know', 'knew', 'known'],
  ['see', 'saw', 'seen'], ['do', 'does', 'doing', 'did', 'done'], ['have', 'has', 'had', 'having'],
  ['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being'],
]) for (const form of forms) IRREGULAR[form] = base;

interface Token { word: string; base: string; start: number; end: number }
interface TargetWord { base: string; gapBefore: number }

const WORD = /[\p{L}\p{N}]+(?:['’‘ʼ][\p{L}\p{N}]+)*/gu;

/** Lower case, ’ → ', punctuation stripped; offsets point into the original text. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0].normalize('NFKC').toLowerCase().replace(/['’‘ʼ]/gu, "'");
    const start = match.index ?? 0;
    tokens.push({ word, base: IRREGULAR[word] ?? word, start, end: start + match[0].length });
  }
  return tokens;
}

/** Same word: equal, or a shared prefix of at least max(3, shorter length − 2) letters ("circle"/"circled", "page"/"pages"). */
function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const need = Math.max(3, Math.min(left.length, right.length) - 2);
  if (left.length < need || right.length < need) return false;
  for (let index = 0; index < need; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** The words of the expression that must be heard, with the room allowed before each of them. */
function targetWords(target: string): TargetWord[] {
  const tokens = tokenize(target);
  const collect = (keep: (token: Token) => boolean) => {
    const words: TargetWord[] = [];
    let slot = false;
    for (const token of tokens) {
      if (!keep(token)) { if (SLOTS.has(token.word)) slot = true; continue; }
      words.push({ base: token.base, gapBefore: words.length ? GAP + (slot ? SLOT_GAP : 0) : 0 });
      slot = false;
      if (words.length >= MAX_TARGET_WORDS) break;
    }
    return words;
  };
  const content = collect(token => !DROPPED.has(token.word));
  // An expression made almost only of function words ("to be honest") keeps them: one word alone would match too much.
  if (content.length <= 1 && tokens.some(token => DROPPED.has(token.word) && !SLOTS.has(token.word))) {
    const full = collect(token => !SLOTS.has(token.word));
    if (full.length > content.length) return full;
  }
  return content;
}

/** The earliest span of the turn that says the expression: its words in order, at most GAP others between neighbours. */
function findSpan(words: TargetWord[], tokens: Token[]): { from: number; to: number } | null {
  const total = words.length;
  if (!total || !tokens.length) return null;
  // All words of a short expression; at least 80 % of a longer one.
  const required = total <= 3 ? total : Math.ceil(total * 0.8);
  const skips = total - required;
  const positions = words.map(word => tokens.flatMap((token, index) => sameWord(word.base, token.base) ? [index] : []));
  // chains[t] maps a token position matched by word t to the longest chain ending there and where that chain starts.
  const chains: Map<number, { length: number; from: number }>[] = words.map(() => new Map());
  let best: { from: number; to: number } | null = null;
  for (let t = 0; t < total; t++) {
    for (const position of positions[t]) {
      let length = 1; let from = position;
      for (let previous = Math.max(0, t - skips - 1); previous < t; previous++) {
        let allowed = t - previous - 1; // a skipped word of the expression may sound as another word
        for (let k = previous + 1; k <= t; k++) allowed += words[k].gapBefore;
        for (const earlier of positions[previous]) {
          if (earlier >= position || position - earlier - 1 > allowed) continue;
          const chain = chains[previous].get(earlier);
          if (chain && chain.length + 1 > length) { length = chain.length + 1; from = chain.from; }
        }
      }
      chains[t].set(position, { length, from });
      if (length >= required && (!best || position < best.to || (position === best.to && from > best.from))) best = { from, to: position };
    }
  }
  return best;
}

const BOUNDARY = /[.!?…\n]/u;
/** The learner sentence around the matched words, at most 160 characters (cut around the match with an ellipsis). */
function quoteAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !BOUNDARY.test(text[from - 1])) from--;
  let to = end;
  while (to < text.length && !BOUNDARY.test(text[to])) to++;
  if (to < text.length && text[to] !== '\n') to++;
  while (from < start && /\s/u.test(text[from])) from++;
  while (to > end && /\s/u.test(text[to - 1])) to--;
  const tidy = (value: string) => value.replace(/\s+/gu, ' ').trim();
  if (to - from <= PHRASE_QUOTE_LIMIT) return tidy(text.slice(from, to));
  if (end - start >= PHRASE_QUOTE_LIMIT - 2) return `${tidy(text.slice(start, start + PHRASE_QUOTE_LIMIT - 1))}…`;
  const room = PHRASE_QUOTE_LIMIT - (end - start) - 2;
  let right = Math.min(to - end, Math.ceil(room / 2));
  const left = Math.min(start - from, room - right);
  right = Math.min(to - end, room - left);
  const head = start - left; const tail = end + right;
  return `${head > from ? '…' : ''}${tidy(text.slice(head, tail))}${tail < to ? '…' : ''}`;
}

const NONE: PhraseUse = { used: false, hinted: false, turnId: null, quote: null };

/**
 * Did the learner say the expression? Only the learner's own, undisputed turns count. An independent use (support 0) wins over a
 * hinted one; otherwise the first hinted use is reported.
 */
export function findPhraseUse(target: string, learnerTurns: readonly PhraseTurn[]): PhraseUse {
  const words = targetWords(target ?? '');
  if (!words.length) return NONE;
  let hinted: PhraseUse | null = null;
  for (const turn of learnerTurns) {
    if ((turn.role && turn.role !== 'user') || turn.disputed || !turn.text?.trim()) continue;
    const tokens = tokenize(turn.text);
    const span = findSpan(words, tokens);
    if (!span) continue;
    const use: PhraseUse = { used: true, hinted: turn.support > 0, turnId: turn.id, quote: quoteAround(turn.text, tokens[span.from].start, tokens[span.to].end) };
    if (!use.hinted) return use;
    hinted ??= use;
  }
  return hinted ?? NONE;
}

/**
 * The text gives the expression away: it says the expression, or contains all of its content words anywhere. Recall cues and
 * the partner's lines must not.
 */
export function phraseLeaks(target: string, text: string | null | undefined): boolean {
  const words = targetWords(target ?? '');
  if (!words.length || !text?.trim()) return false;
  const tokens = tokenize(text);
  if (findSpan(words, tokens)) return true;
  return words.every(word => tokens.some(token => sameWord(word.base, token.base)));
}
