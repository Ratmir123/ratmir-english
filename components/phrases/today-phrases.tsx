'use client';

/*
 * Today: one compact row under the day's card while saved phrases wait — «Мои фразы · N ждут повторения» → «Повторить»
 * (planning/v05/PASS-0.5.3.md §1.6). Hidden otherwise, never the primary card. The row itself opens the phrases sheet.
 */
import { useMemo, useState } from 'react';
import { ChatTeardropTextIcon } from '@phosphor-icons/react';
import { duePhraseCount } from '@/lib/phrases/schedule';
import { waitingLabel } from '@/lib/phrases/labels';
import { useApp } from '../app/app-context';
import styles from './phrases.module.css';

export function TodayPhrases() {
  const app = useApp();
  const phrases = app.data.state?.phrases;
  const due = useMemo(() => duePhraseCount(phrases), [phrases]);
  // In the staircase when it is there from the start; a row that appears later only reveals (PASS-0.5.3 §5.5).
  const [atMount] = useState(() => due > 0);
  if (due <= 0) return null;
  const busy = !!app.lesson.starting || !!app.lesson.busy;
  return <div className={`surface flat ${styles.today}${atMount ? '' : ' reveal'}`} data-enter={atMount ? '' : undefined} data-testid="today-phrases">
    <button type="button" className={styles.todayOpen} onClick={() => app.openPhrases()} aria-haspopup="dialog">
      <span className={styles.todayIcon} aria-hidden="true"><ChatTeardropTextIcon size={20} /></span>
      <span className={styles.todayCopy}><strong>Мои фразы</strong><span> · {waitingLabel(due)}</span></span>
    </button>
    <button type="button" className="button small secondary" onClick={() => app.lesson.startPhraseRound()} disabled={busy}
      data-testid="today-phrases-round">Повторить</button>
  </div>;
}
