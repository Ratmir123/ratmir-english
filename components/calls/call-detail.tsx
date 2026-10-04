'use client';

/** One call: header, processing/upload/speaker states, then «Разбор · Тренировки · Транскрипт». */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowCounterClockwiseIcon, CalendarBlankIcon, ClockIcon, FileTextIcon, PencilSimpleIcon, TrashIcon, UploadSimpleIcon, UserIcon, WarningIcon, XIcon,
} from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CallContext, CallDetail, CallSummary, CommunicationPattern, ProfileFact } from '@/lib/calls/types';
import type { Mode } from '@/lib/types';
import { Chip, cx, kit, ProgressBar, ProgressRing, Segmented, Sheet, Spinner, useInterval } from './kit';
import {
  CALL_STATUS, CONTEXT_LABEL, formatBytes, formatDay, formatDuration, isCallProcessing, SOURCE_LABEL,
} from './format';
import { cancelUpload, forgetCallUpload, pendingUploadFileName, resumeAudioUpload, retryUpload, type UploadJob } from './upload-store';
import { CallReviewView } from './call-review';
import { CallTranscript } from './call-transcript';
import { DrillsList } from './drills-list';
import styles from './review.module.css';

type Tab = 'review' | 'drills' | 'transcript';
const CONTEXTS: CallContext[] = ['work', 'life', 'relocation', 'other'];

export function UploadProgress({ job, compact }: { job: UploadJob; compact?: boolean }) {
  const fraction = job.total ? job.sent / job.total : 0;
  const label = job.phase === 'preparing' ? 'Извлекаю звук…' : job.phase === 'creating' ? 'Создаю звонок…' : job.phase === 'completing' ? 'Проверяю файл…'
    : job.phase === 'done' ? 'Загружено — ставлю в очередь' : job.phase === 'error' ? job.error ?? 'Загрузка остановилась' : `Загружаю · ${Math.round(fraction * 100)}%`;
  const seconds = job.bytesPerSecond && job.phase === 'uploading' ? Math.round((job.total - job.sent) / job.bytesPerSecond) : null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontWeight: 650 }}>
        <span style={{ color: job.phase === 'error' ? 'var(--k-error-ink)' : undefined }}>{label}</span>
        {job.phase === 'uploading' ? <span className={kit.num} style={{ color: 'var(--k-text-2)' }}>{formatBytes(job.sent)} из {formatBytes(job.total)}</span> : null}
      </div>
      {job.phase === 'preparing' || job.phase === 'creating' ? <ProgressBar value={0.04} label={label} /> : <ProgressBar value={fraction} label="Загрузка записи" />}
      {!compact && seconds !== null && seconds > 3 ? <span style={{ fontSize: 12, color: 'var(--k-text-3)' }}>≈ {formatDuration(seconds)} до конца · {job.prepared ? 'звук извлечён на компьютере' : 'исходный файл'}</span> : null}
      {job.note ? <span style={{ fontSize: 12, color: 'var(--k-warning-ink)' }}>{job.note}</span> : null}
    </div>
  );
}

export function CallDetailView({ callId, summary, patterns, uploads, onChanged, onDeleted, onStartDrill }: {
  callId: string; summary: CallSummary | null; patterns: CommunicationPattern[]; uploads: UploadJob[];
  onChanged: () => void; onDeleted: () => void; onStartDrill: (drillId: string, mode: Mode) => void;
}) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('review');
  const [seek, setSeek] = useState<{ at: number; nonce: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'delete' | 'edit' | null>(null);
  const previousStatus = useRef<string | null>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const prefix = `call-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const job = uploads.find(item => item.callId === callId) ?? null;

  const load = useCallback(async () => {
    try {
      const next = await api<CallDetail>(`calls/${encodeURIComponent(callId)}`);
      setDetail(current => (current && current.id === next.id && current.updatedAt === next.updatedAt && current.status === next.status ? current : next));
      setLoadError(null);
    } catch (reason) { setLoadError(reason instanceof Error ? reason.message : 'Не удалось открыть звонок.'); }
  }, [callId]);

  useEffect(() => { setDetail(null); setTab('review'); setSeek(null); setError(null); previousStatus.current = null; void load(); }, [callId, load]);
  // Summary from the list changed (polling) → reload the detail.
  useEffect(() => { if (summary && detail && (summary.status !== detail.status || summary.updatedAt !== detail.updatedAt)) void load(); }, [summary?.status, summary?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (job?.phase === 'done') void load(); }, [job?.phase, load]);
  const status = detail?.status ?? summary?.status ?? null;
  useInterval(() => { void load(); }, status && isCallProcessing(status) ? 3000 : null);
  useEffect(() => {
    if (!detail) return;
    const before = previousStatus.current;
    previousStatus.current = detail.status;
    if (before && before !== detail.status && !isCallProcessing(detail.status)) onChanged();
    if (detail.status === 'needs-speaker' || !detail.review) setTab(current => (current === 'review' && !detail.review && detail.segments.length ? 'transcript' : current));
  }, [detail, onChanged]);

  async function act(label: string, action: () => Promise<CallDetail>) {
    setBusy(label); setError(null);
    try { const next = await action(); setDetail(next); onChanged(); return next; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось.'); return null; }
    finally { setBusy(null); }
  }

  async function remove() {
    setBusy('delete'); setError(null);
    try {
      await api(`calls/${encodeURIComponent(callId)}`, undefined, 'DELETE');
      forgetCallUpload(callId); setSheet(null); onDeleted();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить.'); }
    finally { setBusy(null); }
  }

  async function resume(file: File | undefined) {
    if (!file || !detail) return;
    setError(null);
    const problem = await resumeAudioUpload(detail, file);
    if (problem) setError(problem);
  }

  const head = detail ?? summary;
  if (!head) {
    return (
      <div className={cx(kit.scope, styles.detail)}>
        <div className={cx(kit.solid, styles.head)}>
          {loadError ? <p className={styles.muted} role="alert">{loadError}</p> : <p className={styles.muted}><Spinner /> Открываю звонок…</p>}
        </div>
      </div>
    );
  }
  const statusInfo = CALL_STATUS[head.status];
  const review = detail?.review ?? null;
  const tabs = detail && (review || detail.segments.length) && head.status !== 'awaiting-upload';
  const facts = (next: ProfileFact[]) => {
    setDetail(current => current ? { ...current, facts: current.facts.map(fact => next.find(item => item.id === fact.id) ?? fact) } : current);
    onChanged();
  };

  return (
    <div className={cx(kit.scope, styles.detail)}>
      <header className={cx(kit.glass, styles.head, kit.rise)}>
        <div className={styles.headTop}>
          <div className={styles.headTitle}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip tone={statusInfo.tone}>{statusInfo.label}</Chip>
              <Chip>{SOURCE_LABEL[head.source]}</Chip>
              {review?.kind ? <Chip tone="violet">{review.kind}</Chip> : null}
            </div>
            <h2>{head.title}</h2>
            <div className={styles.metaLine}>
              {head.counterpart ? <span><UserIcon size={14} weight="bold" />{head.counterpart}</span> : null}
              {formatDay(head.occurredAt ?? head.createdAt) ? <span><CalendarBlankIcon size={14} weight="bold" />{formatDay(head.occurredAt ?? head.createdAt)}</span> : null}
              {formatDuration(head.durationSeconds) ? <span><ClockIcon size={14} weight="bold" />{formatDuration(head.durationSeconds)}</span> : null}
              <span>{CONTEXT_LABEL[head.context]}</span>
            </div>
          </div>
          <div className={styles.headActions}>
            {detail ? <button type="button" className={kit.iconBtn} onClick={() => setSheet('edit')} aria-label="Изменить детали звонка" title="Детали"><PencilSimpleIcon size={18} weight="bold" /></button> : null}
            <button type="button" className={kit.iconBtn} onClick={() => setSheet('delete')} aria-label="Удалить звонок" title="Удалить"><TrashIcon size={18} weight="bold" /></button>
          </div>
        </div>
        {head.outcome ? <p className={styles.outcome}>{head.outcome}</p> : null}
        {error ? <div className={styles.banner} role="alert" style={{ background: 'var(--k-error-soft)', color: 'var(--k-error-ink)' }}><WarningIcon size={18} weight="bold" />{error}</div> : null}
      </header>

      {head.status === 'awaiting-upload' ? (
        <div className={cx(kit.glass, styles.speakers)}>
          {job ? (
            <>
              <UploadProgress job={job} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {job.phase === 'error' ? <button type="button" className={cx(kit.btn, kit.primary, kit.small)} onClick={() => void retryUpload(job.key)}><ArrowCounterClockwiseIcon size={14} weight="bold" />Продолжить загрузку</button> : null}
                <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => { void cancelUpload(job.key).then(onDeleted); }}><XIcon size={14} weight="bold" />Отменить загрузку</button>
              </div>
            </>
          ) : (
            <>
              <strong>Загрузка прервалась{head.uploadedBytes ? ` на ${formatBytes(head.uploadedBytes)}` : ''}</strong>
              <p className={styles.muted}>Выбери тот же файл{pendingUploadFileName(head.id) ? ` («${pendingUploadFileName(head.id)}»)` : ''} — загрузка продолжится с того же места.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className={cx(kit.btn, kit.primary, kit.small)} onClick={() => resumeInput.current?.click()}><UploadSimpleIcon size={14} weight="bold" />Выбрать файл</button>
                <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => setSheet('delete')}>Удалить звонок</button>
              </div>
              <input ref={resumeInput} type="file" hidden accept="audio/*,video/*" onChange={event => { void resume(event.target.files?.[0]); event.target.value = ''; }} />
            </>
          )}
        </div>
      ) : null}

      {isCallProcessing(head.status) ? (
        <div className={cx(kit.glass, styles.progressCard)} aria-live="polite">
          <ProgressRing value={head.progress ? head.progress.percent / 100 : null} size={56} stroke={5} label="Готовность разбора">
            {head.progress ? <span className={styles.ringLabel}>{Math.round(head.progress.percent)}%</span> : null}
          </ProgressRing>
          <div>
            <strong>{head.progress?.stage ?? (head.status === 'queued' ? 'В очереди' : head.status === 'analysing' ? 'Пишу разбор' : 'Расшифровываю')}</strong>
            <p>Можно уйти с экрана — разбор продолжится сам. Обычно это 2–6 минут.</p>
          </div>
        </div>
      ) : null}

      {head.status === 'error' ? (
        <div className={cx(kit.glass, styles.speakers)}>
          <div className={styles.banner} style={{ background: 'var(--k-error-soft)', color: 'var(--k-error-ink)' }}><WarningIcon size={18} weight="bold" />{head.error ?? 'Разбор не получился.'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={cx(kit.btn, kit.primary, kit.small)} disabled={busy === 'retry'} onClick={() => void act('retry', () => api<CallDetail>(`calls/${encodeURIComponent(callId)}/retry`, {}))}>
              {busy === 'retry' ? <Spinner /> : <ArrowCounterClockwiseIcon size={14} weight="bold" />}Повторить
            </button>
            <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => setSheet('delete')}>Удалить</button>
          </div>
        </div>
      ) : null}

      {detail && detail.status === 'needs-speaker' ? <SpeakerConfirm detail={detail} onDone={next => { setDetail(next); onChanged(); }} /> : null}

      {!detail && loadError ? <div className={cx(kit.solid, styles.section)}><p className={styles.muted} role="alert">{loadError}</p></div> : null}
      {!detail && !loadError ? <div className={cx(kit.solid, styles.section)}><p className={styles.muted}><Spinner /> Загружаю разбор…</p></div> : null}

      {tabs && detail ? (
        <>
          <Segmented<Tab> label="Разделы звонка" block value={tab} onChange={setTab} idPrefix={prefix}
            options={[
              { id: 'review' as const, label: 'Разбор' },
              { id: 'drills' as const, label: 'Тренировки', badge: detail.drills.filter(drill => drill.status !== 'done').length || null },
              // Memory and debrief imports have no transcript to show.
              ...(detail.segments.length ? [{ id: 'transcript' as const, label: 'Транскрипт' }] : []),
            ]} />
          <div role="tabpanel" id={`${prefix}-panel-${tab}`} aria-labelledby={`${prefix}-tab-${tab}`}>
            {tab === 'review' ? (
              review ? <CallReviewView detail={detail} review={review} patterns={patterns} idPrefix={prefix} onFactsChanged={facts}
                onSeek={detail.segments.length ? at => { setTab('transcript'); setSeek({ at, nonce: Date.now() }); } : undefined} />
                : <div className={cx(kit.solid, styles.section)}><p className={styles.muted}>Разбор появится после обработки. Расшифровка уже во вкладке «Транскрипт».</p></div>
            ) : null}
            {tab === 'drills' ? (
              <div className={cx(kit.solid, styles.section)}>
                <div className={styles.sectionHead}><h3>Тренировки из этого звонка</h3><small>повторы: сегодня, +2, +5, +12 дней</small></div>
                <DrillsList drills={detail.drills} onStartDrill={onStartDrill} />
              </div>
            ) : null}
            {tab === 'transcript' ? (
              <CallTranscript detail={detail} seek={seek} onDetail={next => setDetail(next)} reanalysing={busy === 'reanalyse'}
                onReanalyse={() => void act('reanalyse', () => api<CallDetail>(`calls/${encodeURIComponent(callId)}/reanalyse`, {}))} />
            ) : null}
          </div>
        </>
      ) : null}

      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Удалить звонок?"
        footer={<>
          <button type="button" className={cx(kit.btn, kit.quiet)} onClick={() => setSheet(null)}>Оставить</button>
          <button type="button" className={cx(kit.btn, kit.primary, kit.danger)} disabled={busy === 'delete'} onClick={() => void remove()}>
            {busy === 'delete' ? <Spinner /> : <TrashIcon size={16} weight="bold" />}Удалить
          </button>
        </>}>
        <p className={styles.muted}>«{head.title}»: запись, расшифровка, разбор, тренировки и предложенные факты удалятся. Паттерны пересчитаются без этого звонка.</p>
      </Sheet>
      {detail ? <EditDetails open={sheet === 'edit'} detail={detail} onClose={() => setSheet(null)}
        onSaved={(next, reanalyse) => {
          setDetail(next); setSheet(null); onChanged();
          if (reanalyse) void act('reanalyse', () => api<CallDetail>(`calls/${encodeURIComponent(callId)}/reanalyse`, next.notes ? { notes: next.notes } : {}));
        }} /> : null}
    </div>
  );
}

function SpeakerConfirm({ detail, onDone }: { detail: CallDetail; onDone: (next: CallDetail) => void }) {
  const [me, setMe] = useState<string | null>(detail.speakers.find(speaker => speaker.isMe)?.id ?? null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  async function confirm() {
    if (!me) return;
    setBusy(true); setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(labels).map(([key, value]) => [key, value.trim()]).filter(([key, value]) => key !== me && value));
      onDone(await api<CallDetail>(`calls/${encodeURIComponent(detail.id)}/speakers`, { me, ...(Object.keys(clean).length ? { labels: clean } : {}) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось сохранить.'); }
    finally { setBusy(false); }
  }
  return (
    <section className={cx(kit.glass, styles.speakers, kit.rise)} aria-labelledby={`${ids}-who`}>
      <h3 id={`${ids}-who`}>Кто из собеседников ты?</h3>
      <p className={styles.muted}>Я не узнал твой голос уверенно. Посмотри на реплики и выбери себя — разбор будет про твои слова.</p>
      <div className={styles.speakerList} role="radiogroup" aria-labelledby={`${ids}-who`}>
        {detail.speakers.map(speaker => (
          <div key={speaker.id} className={styles.speaker} data-me={me === speaker.id}>
            <div className={styles.speakerHead}>
              <strong>{speaker.label}{speaker.talkSeconds ? <span className={kit.faint} style={{ fontWeight: 600 }}> · {formatDuration(speaker.talkSeconds)}</span> : null}</strong>
              <button type="button" role="radio" aria-checked={me === speaker.id} className={cx(kit.btn, me === speaker.id ? kit.primary : kit.secondary, kit.small)} onClick={() => setMe(speaker.id)}>
                {me === speaker.id ? 'Это я ✓' : 'Это я'}
              </button>
            </div>
            {speaker.sample.length ? <ul className={styles.samples}>{speaker.sample.slice(0, 3).map((line, index) => <li key={index} lang="en">{line}</li>)}</ul> : null}
            {me && me !== speaker.id ? (
              <input className={cx(kit.input, styles.speakerName)} placeholder="Имя (необязательно)" aria-label={`Имя для «${speaker.label}»`} maxLength={60}
                value={labels[speaker.id] ?? ''} onChange={event => setLabels(current => ({ ...current, [speaker.id]: event.target.value }))} />
            ) : null}
          </div>
        ))}
      </div>
      {error ? <p className={styles.muted} role="alert" style={{ color: 'var(--k-error-ink)' }}>{error}</p> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className={cx(kit.btn, kit.primary)} disabled={!me || busy} onClick={() => void confirm()}>{busy ? <Spinner /> : null}Подтвердить и разобрать</button>
      </div>
    </section>
  );
}

function EditDetails({ open, detail, onClose, onSaved }: { open: boolean; detail: CallDetail; onClose: () => void; onSaved: (next: CallDetail, reanalyse: boolean) => void }) {
  const [title, setTitle] = useState(detail.title);
  const [counterpart, setCounterpart] = useState(detail.counterpart ?? '');
  const [date, setDate] = useState(detail.occurredAt ? detail.occurredAt.slice(0, 10) : '');
  const [context, setContext] = useState<CallContext>(detail.context);
  const [notes, setNotes] = useState(detail.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  useEffect(() => {
    if (!open) return;
    setTitle(detail.title); setCounterpart(detail.counterpart ?? ''); setDate(detail.occurredAt ? detail.occurredAt.slice(0, 10) : '');
    setContext(detail.context); setNotes(detail.notes ?? ''); setError(null);
  }, [open, detail]);
  const canReanalyse = !!detail.review && detail.status === 'ready';
  async function save(reanalyse: boolean) {
    setBusy(true); setError(null);
    try {
      onSaved(await api<CallDetail>(`calls/${encodeURIComponent(detail.id)}/details`, {
        title: title.trim() || detail.title, counterpart: counterpart.trim(), context,
        occurredAt: date ? new Date(`${date}T12:00:00`).toISOString() : null, notes: notes.trim() || null,
      }), reanalyse);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось сохранить.'); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Детали звонка"
      footer={<>
        <button type="button" className={cx(kit.btn, kit.quiet)} onClick={onClose}>Отмена</button>
        {canReanalyse ? <button type="button" className={cx(kit.btn, kit.secondary)} disabled={busy} onClick={() => void save(true)}>Сохранить и переразобрать</button> : null}
        <button type="button" className={cx(kit.btn, kit.primary)} disabled={busy} onClick={() => void save(false)}>{busy ? <Spinner /> : null}Сохранить</button>
      </>}>
      <div className={kit.field}><label className={kit.label} htmlFor={`${ids}-t`}>Название</label><input id={`${ids}-t`} className={kit.input} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></div>
      <div className={kit.field}><label className={kit.label} htmlFor={`${ids}-c`}>Собеседник</label><input id={`${ids}-c`} className={kit.input} value={counterpart} maxLength={120} onChange={event => setCounterpart(event.target.value)} /></div>
      <div className={kit.field}><label className={kit.label} htmlFor={`${ids}-d`}>Дата</label><input id={`${ids}-d`} className={kit.input} type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
      <div className={kit.field}>
        <span className={kit.label}>Контекст</span>
        <Segmented<CallContext> label="Контекст" block value={context} onChange={setContext} options={CONTEXTS.map(id => ({ id, label: CONTEXT_LABEL[id] }))} />
      </div>
      <div className={kit.field}>
        <label className={kit.label} htmlFor={`${ids}-n`}>Цель и заметки</label>
        <textarea id={`${ids}-n`} className={kit.input} rows={3} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} />
      </div>
      {canReanalyse ? <p className={styles.muted} style={{ fontSize: 13 }}><FileTextIcon size={14} weight="bold" style={{ display: 'inline-block', verticalAlign: -2 }} /> Новая цель попадёт в разбор, только если переразобрать звонок — это займёт пару минут.</p> : null}
      {error ? <p className={styles.muted} role="alert" style={{ color: 'var(--k-error-ink)' }}>{error}</p> : null}
    </Sheet>
  );
}
