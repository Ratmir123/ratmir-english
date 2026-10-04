'use client';

import type { AppState } from '@/lib/types';
import { count } from '../app/labels';
import { weeklyRhythm } from '../app/today-plan';
import styles from './today.module.css';

/** Seven local days, informational only: no streaks, no loss, a missed day is just empty. */
export function WeeklyRhythm({ state, title = 'Ритм недели', headingId }: { state: AppState; title?: string; headingId: string }) {
  const rhythm = weeklyRhythm(state);
  return <section className={`glass ${styles.side}`} aria-labelledby={headingId}>
    <div className="section-title"><h2 id={headingId}>{title}</h2><span className="caption">{rhythm.total ? count(rhythm.total, ['практика', 'практики', 'практик']) + ' с разбором' : 'без спешки'}</span></div>
    <ol className={styles.week} aria-label={rhythm.days.map(day => `${day.label}: ${day.count}`).join(', ')}>
      {rhythm.days.map(day => <li key={day.key} data-today={day.today} data-done={day.count > 0}>
        <span className={styles.dot} aria-hidden="true">{day.count > 1 ? day.count : ''}</span><small>{day.label}</small>
      </li>)}
    </ol>
    <p className="caption">{rhythm.activeDays ? `${count(rhythm.activeDays, ['день', 'дня', 'дней'])} из 7 с практикой. Пропуск — просто пустой день.` : 'Первая практика появится здесь точкой. Без серий и штрафов.'}</p>
  </section>;
}
