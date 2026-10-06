'use client';

/**
 * «Созвоны» tab: one switch «Звонки · Паттерны · Плейбук» under the header (MOTION-PASS-0.5.2 §8, like the iPhone,
 * where patterns and the playbook live in this tab too). «Звонки»: upload entry and the calls list (one surface, a row
 * per call with its state), or the selected call (Разбор · Тренировки · Транскрипт) — master–detail when the content
 * area is ≥ 1000 px wide, stacked otherwise. «Паттерны» and «Мой плейбук» stay one tap away even with a call open.
 * Polls GET calls every 3 s only while something is processing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeftIcon, CursorClickIcon, FileTextIcon, PhoneCallIcon, TargetIcon } from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CallStatus, CallSummary } from '@/lib/calls/types';
import type { AppState, Mode } from '@/lib/types';
import { Chip, cx, kit, ProgressBar, Segmented, useInterval } from './kit';
import { CALL_STATUS, formatDay, formatDuration, isCallProcessing, plural, SOURCE_LABEL } from './format';
import { dismissUpload, getServerUploadsSnapshot, getUploadsSnapshot, subscribeUploads, type UploadJob } from './upload-store';
import { CallUploadCard } from './upload-call';
import { CallDetailView, UploadProgress } from './call-detail';
import { FactsPanel } from './facts-panel';
import { PatternsPanel } from './patterns-panel';
import type { CallsSection } from '../app/use-navigation';
import type { MascotEmotion } from '../shell/companion';
import { ScreenMascot } from '../shell/screen-mascot';
import styles from './calls.module.css';

const UPLOADING: UploadJob['phase'][] = ['creating', 'preparing', 'uploading', 'completing'];

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

export function CallsScreen({ state, onRefresh, onStartDrill, initialCallId, initialSection, sectionNonce }: {
  state: AppState; onRefresh: () => Promise<void>; onStartDrill: (drillId: string, mode: Mode) => void; initialCallId?: string | null;
  /** Open on «Паттерны» or «Плейбук» (e.g. Profile → «Мой плейбук»); a call id always opens «Звонки». */
  initialSection?: CallsSection | null; sectionNonce?: number;
}) {
  const [selected, setSelected] = useState<string | null>(initialCallId ?? null);
  const [section, setSectionValue] = useState<CallsSection>(initialCallId ? 'calls' : initialSection ?? 'calls');
  // A section picked here settles in softly; the screen's arrival is the staircase instead.
  const [switched, setSwitched] = useState(false);
  const setSection = (value: CallsSection) => { setSectionValue(value); setSwitched(true); };
  const [calls, setCalls] = useState<CallSummary[]>(state.calls ?? []);
  const uploads = useSyncExternalStore(subscribeUploads, getUploadsSnapshot, getServerUploadsSnapshot);
  const root = useRef<HTMLElement>(null);
  const statuses = useRef(new Map<string, CallStatus>());
  const refreshing = useRef(false);

  useEffect(() => { if (initialCallId) { setSelected(initialCallId); setSectionValue('calls'); } }, [initialCallId]);
  useEffect(() => { if (initialSection && !initialCallId) setSectionValue(initialSection); }, [initialSection, initialCallId, sectionNonce]);
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
  const facts = state.profileFacts ?? [];
  const factsToCheck = facts.filter(fact => fact.status === 'suggested').length;
  const selectedSummary = useMemo(() => calls.find(call => call.id === selected) ?? null, [calls, selected]);
  const patterns = state.patterns ?? [];
  const drills = state.drills ?? [];
  const needsAction = calls.filter(call => call.status === 'needs-speaker').length;
  const hasList = pendingJobs.length > 0 || calls.length > 0;
  // The screen's companion (MOTION-PASS-0.5.2 §3): thinking while a call is processed or uploaded, surprised when one
  // needs «кто есть кто», listening otherwise. Without calls it moves into the empty state, larger and curious.
  const working = calls.some(call => isCallProcessing(call.status)) || uploads.some(job => UPLOADING.includes(job.phase));
  const mood: MascotEmotion = working ? 'thinking' : needsAction ? 'surprised' : 'listening';
  // One companion per screen: without calls it sits, larger and curious, in the «Звонки» empty state instead.
  const headCompanion = hasList || section !== 'calls';

  return (
    <section ref={root} className={cx(kit.scope, styles.screen)} data-view={section === 'calls' && selected ? 'detail' : 'list'} aria-label="Созвоны">
      <div className={styles.pageHead} data-enter>
        <div className={styles.pageCopy}>
          <h1>Созвоны</h1>
          <p>Загрузи звонок — получишь разбор, тренировки из своих же моментов и обновлённые паттерны.</p>
        </div>
        {headCompanion ? <ScreenMascot emotion={mood} fluid className="screen-mascot" /> : null}
      </div>
      <div className={styles.sections} data-enter>
        <Segmented label="Разделы созвонов" idPrefix="calls" value={section} onChange={setSection} options={[
          { id: 'calls', label: 'Звонки', badge: needsAction || null },
          { id: 'patterns', label: 'Паттерны' },
          { id: 'playbook', label: 'Плейбук', badge: factsToCheck || null },
        ]} />
      </div>
      <div key={section} id={`calls-panel-${section}`} role="tabpanel" aria-labelledby={`calls-tab-${section}`} className={styles.panel}
        data-switched={switched || undefined}>
        {section === 'patterns' ? <div data-enter>
          <PatternsPanel patterns={patterns} drills={drills} onStartDrill={onStartDrill} onChanged={() => void refreshApp()} />
        </div> : section === 'playbook' ? <div className={cx(kit.glass, styles.playbook)} data-enter>
          <FactsPanel facts={facts} onChanged={() => void refreshApp()} />
        </div> : <div className={styles.layout}>
          <div className={styles.listPane}>
            <div data-enter><CallUploadCard onCreated={id => { void fetchCalls(); void refreshApp(); select(id); }} /></div>
            {hasList ? (
              <section className={styles.callsBlock} aria-labelledby="calls-list-title" data-enter>
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
              </section>
            ) : (
              <div className={cx(kit.glass, styles.empty)} data-enter>
                <div className={styles.emptyCopy}>
                  <h2>Первый звонок — первый разбор</h2>
                  <ul>
                    <li><PhoneCallIcon size={18} aria-hidden="true" />Итог, что сработало и что стоило денег — с цитатами и временем.</li>
                    <li><CursorClickIcon size={18} aria-hidden="true" />«Как сказать сильнее» — твоим голосом, можно послушать.</li>
                    <li><TargetIcon size={18} aria-hidden="true" />Тренировки из твоих моментов и паттерны от звонка к звонку.</li>
                  </ul>
                </div>
                <ScreenMascot emotion="curious" fluid className={styles.emptyMascot} />
              </div>
            )}
          </div>
          {selected ? <div className={styles.detailPane} data-enter>
            <button type="button" className={cx(kit.btn, kit.quiet, kit.small, styles.backButton)} style={{ justifySelf: 'start' }} onClick={() => select(null)}>
              <ArrowLeftIcon size={16} weight="bold" />Все звонки
            </button>
            <CallDetailView key={selected} callId={selected} summary={selectedSummary} patterns={patterns} uploads={uploads}
              onChanged={() => { void fetchCalls(); void refreshApp(); }}
              onDeleted={() => { setSelected(null); void fetchCalls(); void refreshApp(); }}
              onStartDrill={onStartDrill} />
          </div> : null}
        </div>}
      </div>
    </section>
  );
}
