'use client';

/*
 * Practice → «Для тебя» → «Мои фразы» (planning/v05/PASS-0.5.3.md §1.6): how many are saved; when some wait, «N ждут
 * повторения», up to three of them as chips and «Повторить» (a phrase round); always «Запомнить» (the capture card in a sheet)
 * and «Все» (the phrases sheet). Empty: one line, plus the PC shortcut. iPhone: ios/Sources/PracticeForYou.swift.
 */
import { useMemo } from 'react';
import { CaretRightIcon, PlusIcon } from '@phosphor-icons/react';
import { phrasesOverview, shortcutHint, waitingLabel } from '@/lib/phrases/labels';
import { useApp } from '../app/app-context';
import { useDesktopStatus } from '../capture/use-capture';
import styles from './phrases.module.css';

export function PhrasesCard() {
  const app = useApp();
  const phrases = app.data.state?.phrases;
  const overview = useMemo(() => phrasesOverview(phrases), [phrases]);
  const status = useDesktopStatus();
  const busy = !!app.lesson.starting || !!app.lesson.busy;
  const hint = shortcutHint(status);
  return <section className={styles.card} aria-labelledby="practice-phrases" data-enter data-testid="practice-phrases">
    <div className={styles.cardHead}>
      <h3 id="practice-phrases">Мои фразы{overview.total > 0 && <span className={`${styles.count} tabular`}> · {overview.total}</span>}</h3>
      <button type="button" className={`text-button ${styles.all}`} onClick={() => app.openPhrases()} aria-haspopup="dialog" data-testid="practice-phrases-all">
        Все<CaretRightIcon size={15} aria-hidden="true" /></button>
    </div>
    {overview.due > 0 ? <>
      <p className={styles.waiting}>{waitingLabel(overview.due)}</p>
      <ul className={styles.chips} aria-label="Ждут повторения">
        {overview.chips.map(chip => <li key={chip.id}>
          <button type="button" className={styles.chip} lang="en" onClick={() => app.openPhrases(chip.id)} aria-haspopup="dialog">{chip.text}</button>
        </li>)}
      </ul>
    </> : overview.total > 0
      ? <p className={styles.quiet}>Сейчас повторять нечего{overview.next ? ` · следующая ${overview.next}` : ''}.</p>
      : <div className={styles.status}>
        <p className={styles.quiet}>Запоминай фразы, которые встретил: они вернутся в разговорах.</p>
        {hint && <p className="footnote">{hint}</p>}
      </div>}
    <div className={styles.cardActions}>
      {overview.due > 0 && <button type="button" className="button primary small" onClick={() => app.lesson.startPhraseRound()} disabled={busy}
        data-testid="practice-phrases-round">Повторить</button>}
      <button type="button" className="button secondary small" onClick={app.openCapture} aria-haspopup="dialog" data-testid="practice-phrases-capture">
        <PlusIcon size={15} aria-hidden="true" />Запомнить</button>
    </div>
  </section>;
}
