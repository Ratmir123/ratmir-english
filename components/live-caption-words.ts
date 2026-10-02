export type CaptionWord = { id: number; text: string; space: string };
export type CaptionWords = { text: string; leading: string; words: CaptionWord[]; nextId: number };

export const emptyCaptionWords: CaptionWords = { text: '', leading: '', words: [], nextId: 0 };

function identity(text: string) {
  return text.toLocaleLowerCase('en').replace(/[.,!?;:…]+$/u, '');
}

/** Recognition can rewrite a partial word or an earlier phrase. Keep existing
 * nodes for the stable prefix/suffix and replacements, so only added words enter. */
export function reconcileCaptionWords(previous: CaptionWords, text: string): CaptionWords {
  if (text === previous.text) return previous;
  const incoming = [...text.matchAll(/(\S+)(\s*)/gu)].map(match => ({ text: match[1], space: match[2] }));
  const leading = text.match(/^\s*/u)?.[0] ?? '';
  const old = previous.words;
  let prefix = 0, suffix = 0, nextId = previous.nextId;
  while (prefix < old.length && prefix < incoming.length && identity(old[prefix].text) === identity(incoming[prefix].text)) prefix++;
  while (suffix < old.length - prefix && suffix < incoming.length - prefix
    && identity(old[old.length - suffix - 1].text) === identity(incoming[incoming.length - suffix - 1].text)) suffix++;
  const oldMiddleCount = old.length - prefix - suffix;
  const words = incoming.map((word, index) => {
    const existing = index < prefix ? old[index]
      : index >= incoming.length - suffix ? old[old.length - (incoming.length - index)]
        : index - prefix < oldMiddleCount ? old[index] : undefined;
    return { ...word, id: existing?.id ?? nextId++ };
  });
  return { text, leading, words, nextId };
}
