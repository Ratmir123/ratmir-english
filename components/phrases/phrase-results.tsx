'use client';

/*
 * Review block «Фразы из копилки» (planning/v05/PASS-0.5.3.md §1.5.4), right after the summary: ✓ «phrase» · meaning ·
 * «his sentence» for the ones he used; ○ for the rest — «Не прозвучала — вернётся завтра» in a phrase round, «Повода не было»
 * when they were only woven into an ordinary lesson. Sessions without phrase results (all older ones) show nothing.
 */
import { CheckIcon, CircleIcon } from '@phosphor-icons/react';
import type { Session } from '@/lib/types';
import { isPhraseRound, phraseResultNote } from '@/lib/phrases/labels';
import styles from './phrases.module.css';

export function PhraseResults({ session }: { session: Session }) {
  const results = session.phraseResults;
  if (!results?.length) return null;
  const round = isPhraseRound(session.lesson);
  const titleId = `phrase-results-${session.id}`;
  return <section className={`surface ${styles.results}`} data-enter="" aria-labelledby={titleId} data-testid="phrase-results">
    <h3 id={titleId}>Фразы из копилки</h3>
    <ul className={styles.resultList}>
      {results.map(result => {
        const note = phraseResultNote(result, round);
        return <li key={result.phraseId} data-used={result.used}>
          <span className={styles.mark} aria-hidden="true">{result.used ? <CheckIcon size={14} weight="bold" /> : <CircleIcon size={12} weight="bold" />}</span>
          <span className={styles.resultCopy}>
            <span className={styles.resultLine}>
              {result.used && <span className="visually-hidden">Прозвучала: </span>}
              <strong lang="en">«{result.phrase}»</strong>{result.meaning && <span> · {result.meaning}</span>}
            </span>
            {result.used && result.quote && <span className={styles.quote} lang="en">«{result.quote}»</span>}
            {note && <small>{note}</small>}
          </span>
        </li>;
      })}
    </ul>
  </section>;
}
