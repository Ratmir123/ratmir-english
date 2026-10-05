'use client';

/**
 * «Созвоны» tab, in reading order: upload entry, the calls list (one surface, a row per call with its state),
 * then «Мои паттерны» — or the selected call (Разбор · Тренировки · Транскрипт). Master–detail when the
 * content area is ≥1000px wide, stacked otherwise.
 * Polls GET calls every 3 s only while something is processing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeftIcon, CursorClickIcon, FileTextIcon, PhoneCallIcon, TargetIcon } from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CallStatus, CallSummary } from '@/lib/calls/types';
import type { AppState, Mode } from '@/lib/types';
import { Chip, cx, kit, ProgressBar, useInterval } from './kit';
import { CALL_STATUS, formatDay, formatDuration, isCallProcessing, plural, SOURCE_LABEL } from './format';
import { dismissUpload, getServerUploadsSnapshot, getUploadsSnapshot, subscribeUploads, type UploadJob } from './upload-store';
import { CallUploadCard } from './upload-call';
import { CallDetailView, UploadProgress } from './call-detail';
import { PatternsPanel } from './patterns-panel';
import styles from './calls.module.css';

/** One call as a list row: title with its state, who/when, then the one line that matters for that state. */
function CallItem({ call, job, selected, onSelect }: { call: CallSummary; job: UploadJob | null; selected: boolean; onSelect: () => void }) {
  const status = CALL_STATUS[call.status];
  const processing = isCallProcessing(call.status);
  const meta = [call.counterpart, formatDay(call.occurredAt ?? call.createdAt), formatDuration(call.durationSeconds), call.source !== 'audio' ? SOURCE_LABEL[call.source] : null]
    .filter(Boolean).join(' · ');
  const drillsLeft = call.drillsTotal - call.drillsDone;
  return (
    <li>
      <button type="button" className={styles.item} aria-current={selected || undefined} onClick={onSelect}>
        <span className={styles.itemTop}>
          <strong>{call.title}</strong>
          <Chip tone={status.tone}>{status.label}</Chip>
        </span>
        {meta ? <span className={styles.itemMeta}>{meta}</span> : null}
        {call.status === 'ready' && (call.topCost || call.outcome) ? (
          <span className={styles.itemLine}>{call.topCost ? <><em>Дороже всего:</em> {call.topCost}</> : call.outcome}</span>
        ) : null}
        {processing ? (
          <span className={styles.itemProgress}>
            <span>{call.progress?.stage ?? 'В очереди на разбор'}{call.progress ? <span className={kit.num}> · {Math.round(call.progress.percent)}%</span> : null}</span>
            {call.progress ? <ProgressBar value={call.progress.percent / 100} label={call.progress.stage ?? status.label} /> : null}
          </span>
        ) : null}
        {call.status === 'needs-speaker' ? <span className={styles.itemLine}>Подтверди, кто из собеседников ты — и разбор продолжится.</span> : null}
        {call.status === 'error' ? <span className={styles.itemLine}>{call.error ?? 'Разбор не получился — можно повторить.'}</span> : null}
        {call.status === 'awaiting-upload' ? (
          job ? <span className={styles.itemProgress}><UploadProgress job={job} compact /></span>
            : <span className={styles.itemLine}>Загрузка прервалась — открой, чтобы продолжить.</span>
        ) : null}
        {call.status === 'ready' && call.drillsTotal ? (
          <span className={styles.itemMeta}><TargetIcon size={14} aria-hidden="true" />{drillsLeft
            ? `${drillsLeft} ${plural(drillsLeft, ['тренировка ждёт', 'тренировки ждут', 'тренировок ждут'])}`
            : 'Все тренировки пройдены'}</span>
        ) : null}
      </button>
    </li>
  );
}

function PendingUpload({ job }: { job: UploadJob }) {
  return (
    <li className={styles.uploadRow}>
      <div className={styles.uploadHead}><FileTextIcon size={18} aria-hidden="true" /><strong>{job.title}</strong></div>
      <UploadProgress job={job} compact />
      {job.phase === 'error' ? <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} style={{ justifySelf: 'start' }} onClick={() => dismissUpload(job.key)}>Убрать</button> : null}
    </li>
  );
}

export function CallsScreen({ state, onRefresh, onStartDrill, initialCallId }: {
  state: AppState; onRefresh: () => Promise<void>; onStartDrill: (drillId: string, mode: Mode) => void; initialCallId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialCallId ?? null);
  const [calls, setCalls] = useState<CallSummary[]>(state.calls ?? []);
  const uploads = useSyncExternalStore(subscribeUploads, getUploadsSnapshot, getServerUploadsSnapshot);
  const root = useRef<HTMLElement>(null);
  const statuses = useRef(new Map<string, CallStatus>());
  const refreshing = useRef(false);

  useEffect(() => { if (initialCallId) setSelected(initialCallId); }, [initialCallId]);
  useEffect(() => { setCalls(state.calls ?? []); }, [state.calls]);

  const refreshApp = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { await onRefresh(); } catch { /* the shell shows its own error */ } finally { refreshing.current = false; }
  }, [onRefresh]);

  const fetchCalls = useCallback(async () => {
    try {
      const result = await api<{ calls: CallSummary[] }>('calls');
      let settled = false;
      for (const call of result.calls) {
        const before = statuses.current.get(call.id);
        if (before && before !== call.status && isCallProcessing(before) && !isCallProcessing(call.status)) settled = true;
      }
      setCalls(result.calls);
      // Patterns, drills and facts change when a review lands: sync the whole app state once.
      if (settled) void refreshApp();
    } catch { /* keep the last list; the next tick retries */ }
  }, [refreshApp]);

  useEffect(() => { statuses.current = new Map(calls.map(call => [call.id, call.status])); }, [calls]);

  const processing = calls.some(call => isCallProcessing(call.status));
  useInterval(() => { void fetchCalls(); }, processing ? 3000 : null);

  // A finished upload moves the call to «queued»: refetch once, then drop the finished job.
  const doneKeys = uploads.filter(job => job.phase === 'done').map(job => job.key).join('|');
  useEffect(() => {
    if (!doneKeys) return;
    void fetchCalls().then(() => { for (const key of doneKeys.split('|')) dismissUpload(key); });
  }, [doneKeys, fetchCalls]);

  const select = useCallback((id: string | null) => {
    setSelected(id);
    requestAnimationFrame(() => root.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
  }, []);

  const pendingJobs = uploads.filter(job => !job.callId && job.phase !== 'cancelled');
  const selectedSummary = useMemo(() => calls.find(call => call.id === selected) ?? null, [calls, selected]);
  const patterns = state.patterns ?? [];
  const drills = state.drills ?? [];
  const needsAction = calls.filter(call => call.status === 'needs-speaker').length;

  return (
    <section ref={root} className={cx(kit.scope, styles.screen)} data-view={selected ? 'detail' : 'list'} aria-label="Созвоны">
      <div className={styles.layout}>
        <div className={styles.listPane}>
          <div className={styles.pageHead}>
            <h1>Созвоны</h1>
            <p>Загрузи звонок — получишь разбор, тренировки из своих же моментов и обновлённые паттерны.</p>
          </div>
          <CallUploadCard onCreated={id => { void fetchCalls(); void refreshApp(); select(id); }} />
          {pendingJobs.length || calls.length ? (
            <section className={styles.callsBlock} aria-labelledby="calls-list-title">
              <div className={styles.sectionTitle}>
                <h2 id="calls-list-title">Звонки</h2>
                {needsAction
                  ? <Chip tone="violet">{needsAction} {plural(needsAction, ['ждёт тебя', 'ждут тебя', 'ждут тебя'])}</Chip>
                  : <span className={styles.sectionCount}>{calls.length} {plural(calls.length, ['звонок', 'звонка', 'звонков'])}</span>}
              </div>
              <ul className={cx(kit.glass, styles.list)}>
                {pendingJobs.map(job => <PendingUpload key={job.key} job={job} />)}
                {calls.map(call => (
                  <CallItem key={call.id} call={call} job={uploads.find(job => job.callId === call.id) ?? null}
                    selected={call.id === selected} onSelect={() => select(call.id)} />
                ))}
              </ul>
              {selected ? (
                <button type="button" className={cx(kit.btn, kit.quiet, kit.small, styles.patternsLink)} onClick={() => select(null)}>
                  <TargetIcon size={16} />Мои паттерны
                </button>
              ) : null}
            </section>
          ) : (
            <div className={cx(kit.glass, styles.empty)}>
              <h2>Первый звонок — первый разбор</h2>
              <ul>
                <li><PhoneCallIcon size={18} aria-hidden="true" />Итог, что сработало и что стоило денег — с цитатами и временем.</li>
                <li><CursorClickIcon size={18} aria-hidden="true" />«Как сказать сильнее» — твоим голосом, можно послушать.</li>
                <li><TargetIcon size={18} aria-hidden="true" />Тренировки из твоих моментов и паттерны от звонка к звонку.</li>
              </ul>
            </div>
          )}
        </div>
        <div className={styles.detailPane}>
          {selected ? (
            <>
              <button type="button" className={cx(kit.btn, kit.quiet, kit.small, styles.backButton)} style={{ justifySelf: 'start' }} onClick={() => select(null)}>
                <ArrowLeftIcon size={16} weight="bold" />Все звонки
              </button>
              <CallDetailView key={selected} callId={selected} summary={selectedSummary} patterns={patterns} uploads={uploads}
                onChanged={() => { void fetchCalls(); void refreshApp(); }}
                onDeleted={() => { setSelected(null); void fetchCalls(); void refreshApp(); }}
                onStartDrill={onStartDrill} />
            </>
          ) : (
            <PatternsPanel patterns={patterns} drills={drills} onStartDrill={onStartDrill} onChanged={() => void refreshApp()} />
          )}
        </div>
      </div>
    </section>
  );
}
