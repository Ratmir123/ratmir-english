'use client';

import { useEffect, useId, useState } from 'react';
import {
  ArrowUpRightIcon, ArrowsClockwiseIcon, CircleNotchIcon, ClockIcon, GaugeIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import type { SubscriptionUsage } from '@/lib/types';
import { subscriptionView, type SubscriptionWindowView } from '@/lib/subscription-view';
import styles from './subscription-limits.module.css';

const USAGE_URL = 'https://chatgpt.com/settings/usage';

export interface SubscriptionLimitsProps {
  usage: SubscriptionUsage | null;
  loading: boolean;
  onRefresh: () => void;
  compact?: boolean;
}

function WindowLimit({ window }: { window: SubscriptionWindowView }) {
  return <div className={`${styles.window} ${!window.fresh ? styles.historical : ''}`}>
    <div className={styles.periodRow}>
      <h4>{window.periodLabel}</h4>
      {!window.fresh && <span className={styles.oldBadge}>Прошлая проверка</span>}
    </div>
    {window.percentLabel !== null ? <>
      <div className={styles.allowance}>
        <strong>{window.percentLabel}<span>%</span></strong>
        <span>{window.fresh ? 'осталось' : 'оставалось'}</span>
      </div>
      <div className={styles.meter} role="meter" aria-label={`${window.bucketLabel}, ${window.periodLabel}: ${window.fresh ? 'остаток' : 'остаток по прошлой проверке'}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remainingPercent!}
        aria-valuetext={`${window.percentLabel}% ${window.fresh ? 'осталось' : 'оставалось по прошлой проверке'}`}>
        <span style={{ transform: `scaleX(${window.remainingPercent! / 100})` }} />
      </div>
    </> : <p className={styles.unknownPercent}>Остаток не передан</p>}
    {window.resetLabel ? <div className={`${styles.reset} ${window.resetExpired ? styles.resetExpired : ''}`}>
      <ClockIcon size={15} aria-hidden="true" />
      <div><span>{window.resetRelative}</span><time dateTime={window.resetAt!}>{window.resetLabel}</time></div>
    </div> : <p className={styles.noReset}>Время сброса не указано</p>}
    {window.duplicateConflict && <p className={styles.noReset}>Данные периода расходятся. Обнови проверку.</p>}
    {window.low && <p className={styles.warning}>
      <WarningCircleIcon size={18} aria-hidden="true" />
      <span>{window.exhausted ? 'Лимит исчерпан. Новые ответы могут быть недоступны до сброса.' : 'Остаток небольшой. Учитывай его перед длинным занятием.'}</span>
    </p>}
  </div>;
}

export function SubscriptionLimits({ usage, loading, onRefresh, compact = false }: SubscriptionLimitsProps) {
  const headingId = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Re-evaluate freshness and passed resets without polling the model or announcing every minute.
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const view = subscriptionView(usage, Math.max(now, Date.now()));
  const bucketIds = [...new Set(view.windows.map(window => window.bucketId))];
  const initialLoading = loading && usage === null;

  return <section className={`${styles.card} ${compact ? styles.compact : ''}`} aria-labelledby={headingId} aria-busy={loading}>
    <div className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.symbol}><GaugeIcon size={19} aria-hidden="true" /></span>
        <h3 id={headingId}>Лимиты подписки</h3>
      </div>
      <button type="button" className={styles.refresh} onClick={onRefresh} disabled={loading}
        aria-label={loading ? 'Обновляю лимиты подписки' : 'Обновить лимиты подписки'} title={loading ? 'Обновляю лимиты' : 'Обновить лимиты'}>
        {loading ? <CircleNotchIcon className={styles.spinner} size={19} aria-hidden="true" /> : <ArrowsClockwiseIcon size={19} aria-hidden="true" />}
      </button>
    </div>
    {view.planLabel && <span className={styles.plan}>{view.planLabel}</span>}
    <p className={styles.scope}>{view.scopeLabel}</p>
    {initialLoading ? <div className={styles.loading} role="status">
      <span className={styles.skeletonNumber} aria-hidden="true" /><span className={styles.skeletonMeter} aria-hidden="true" />
      <span>Получаю лимиты подписки…</span>
    </div> : view.available ? <>
      {view.notice && <p className={styles.notice}><WarningCircleIcon size={17} aria-hidden="true" /><span>{view.notice}</span></p>}
      <div className={styles.buckets}>
        {bucketIds.map(bucketId => <div className={styles.bucket} key={bucketId}>
          {bucketIds.length > 1 && <h4 className={styles.bucketName}>{view.windows.find(window => window.bucketId === bucketId)!.bucketLabel}</h4>}
          <div className={styles.windows}>{view.windows.filter(window => window.bucketId === bucketId).map(window => <WindowLimit key={window.key} window={window} />)}</div>
        </div>)}
      </div>
    </> : <div className={styles.unavailable}>
      <span className={styles.unavailableTitle}>Остаток пока недоступен</span>
      <p>{view.unavailableText}</p>
    </div>}
    <div className={styles.footer}>
      {view.checkedLabel && <p>Проверено: <time dateTime={view.checkedAt!}>{view.checkedLabel}</time></p>}
      <a href={USAGE_URL} target="_blank" rel="noopener noreferrer">Открыть лимиты ChatGPT <ArrowUpRightIcon size={15} aria-hidden="true" /></a>
    </div>
  </section>;
}
