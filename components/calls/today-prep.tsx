'use client';

/*
 * Today: one row for an upcoming call (PASS-0.5.5 §3) — «Созвон · {title}», who and when, «Репетиция» and the row itself opens the
 * prep in Созвоны. Shown for a ready prep made within a day or whose call is still ahead (todayPrep); hidden otherwise.
 */
import { useState } from 'react';
import { PhoneCallIcon } from '@phosphor-icons/react';
import { PREP_COPY, todayPrep } from '@/lib/preps/types';
import { useApp } from '../app/app-context';
import styles from './prep.module.css';

export function TodayPrep() {
  const app = useApp();
  const prep = todayPrep(app.data.state?.preps);
  // In the staircase when it is there from the start; a row that appears later only reveals.
  const [atMount] = useState(() => !!prep);
  if (!prep) return null;
  const busy = !!app.lesson.starting || !!app.lesson.busy;
  const meta = [prep.counterpart, prep.when].filter(Boolean).join(' · ');
  return <div className={`surface flat ${styles.today}${atMount ? '' : ' reveal'}`} data-enter={atMount ? '' : undefined} data-testid="today-prep">
    <button type="button" className={styles.todayOpen} onClick={() => app.go('calls', { prepId: prep.id })}>
      <span className={styles.todayIcon} aria-hidden="true"><PhoneCallIcon size={20} /></span>
      <span className={styles.todayCopy}><strong>{PREP_COPY.todayTitle} · {prep.title ?? PREP_COPY.sheetTitle}</strong>{meta ? <small>{meta}</small> : null}</span>
    </button>
    <button type="button" className="button small primary" onClick={() => app.start({ prepId: prep.id, mode: 'call', from: 'today' })} disabled={busy}
      data-testid="today-prep-rehearse">Репетиция</button>
  </div>;
}
