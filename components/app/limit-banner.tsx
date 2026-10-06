'use client';

import { useEffect, useState } from 'react';
import { CaretRightIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { limitNotice } from '@/lib/limit-notice';
import { useApp } from './app-context';
import styles from './limit-banner.module.css';

/** While a notice is shown it re-reads the clock: «примерно через 25 мин» counts down and a passed limit disappears. */
const TICK_MS = 30_000;

/**
 * Today's compact limit notice (PASS-0.5.3 §2): the first matching rule of lib/limit-notice.ts in one line — warning
 * or danger — and a tap opens Profile with the row that explains it («Тренер и лимиты» or «Голос»). It usually arrives
 * after the staircase (limits load after the state), so it rises with `.reveal`, never as a `[data-enter]` block.
 */
export function LimitBanner() {
  const app = useApp();
  const [now, setNow] = useState(() => Date.now());
  const notice = limitNotice(app.data.usage, app.data.state?.audioUsage, Math.max(now, Date.now()));
  const shown = notice !== null;
  useEffect(() => {
    if (!shown) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [shown]);
  if (!notice) return null;
  return <button type="button" className={`reveal ${styles.banner}`} data-tone={notice.tone} data-kind={notice.kind} data-testid="limit-banner"
    onClick={() => app.go('profile', { profileSection: notice.section })}>
    <WarningCircleIcon size={20} weight="fill" className={styles.icon} aria-hidden="true" />
    <span className={styles.copy}>
      <strong>{notice.title}</strong>
      <span>{notice.detail}</span>
    </span>
    <span className="visually-hidden">Открыть в профиле</span>
    <CaretRightIcon size={16} className={styles.chevron} aria-hidden="true" />
  </button>;
}
