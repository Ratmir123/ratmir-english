'use client';

/** «Транскрипт»: speaker-coloured lines, click a time to play the processed call audio from there,
 * mark mis-heard lines (never used to teach), then offer a re-analysis. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwiseIcon, FlagIcon, PauseIcon, PlayIcon, WarningIcon } from '@phosphor-icons/react';
import { api, mediaUrl } from '@/lib/client/api';
import type { CallDetail, CallSegment } from '@/lib/calls/types';
import { cx, kit, Spinner } from './kit';
import { formatClock, formatDay } from './format';
import styles from './review.module.css';

const OTHER_COLOURS = ['var(--k-violet-ink)', 'var(--k-cyan-ink)', 'var(--k-pink-ink)', 'var(--k-warning-ink)'];

export function speakerColours(detail: Pick<CallDetail, 'speakers'>): Record<string, string> {
  const map: Record<string, string> = {};
  let index = 0;
  for (const speaker of detail.speakers) {
    map[speaker.id] = speaker.isMe ? 'var(--k-lime-ink)' : OTHER_COLOURS[index++ % OTHER_COLOURS.length];
  }
  return map;
}

/** Index of the segment playing at `time` (segments are chronological). */
export function segmentAt(segments: readonly CallSegment[], time: number): number {
  let found = -1;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.start === null) continue;
    if (segment.start > time + 0.05) break;
    if (segment.end === null || time <= segment.end + 0.3) found = index;
  }
  return found;
}

export function CallTranscript({ detail, seek, onDetail, onReanalyse, reanalysing }: {
  detail: CallDetail; seek: { at: number; nonce: number } | null; onDetail: (next: CallDetail) => void;
  onReanalyse: () => void; reanalysing: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(detail.durationSeconds);
  const [audioError, setAudioError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVerbatim, setShowVerbatim] = useState(false);
  const colours = useMemo(() => speakerColours(detail), [detail]);
  const speakers = useMemo(() => new Map(detail.speakers.map(speaker => [speaker.id, speaker])), [detail.speakers]);
  const current = useMemo(() => (playing || time > 0 ? segmentAt(detail.segments, time) : -1), [detail.segments, time, playing]);
  const disputed = detail.segments.filter(segment => segment.disputed).length;
  const hasVerbatim = detail.segments.some(segment => segment.verbatim && segment.verbatim !== segment.text);
  const expired = !!detail.audioExpiresAt && new Date(detail.audioExpiresAt).getTime() < Date.now();
  const audioSrc = detail.audioUrl && !expired ? mediaUrl(detail.audioUrl) : null;

  function playFrom(at: number) {
    const element = audio.current;
    if (!element) return;
    try { element.currentTime = Math.max(0, at - 0.3); } catch { /* not seekable yet */ }
    void element.play().catch(() => setAudioError(true));
  }
  useEffect(() => {
    if (!seek) return;
    if (audioSrc) playFrom(seek.at);
    const index = segmentAt(detail.segments, seek.at);
    const target = index >= 0 ? document.getElementById(`seg-${detail.id}-${detail.segments[index].id}`) : null;
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.nonce]);

  async function toggleDispute(segment: CallSegment) {
    setBusy(segment.id); setError(null);
    try { onDetail(await api<CallDetail>(`calls/${detail.id}/segments`, { segmentId: segment.id, disputed: !segment.disputed })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось отметить строку.'); }
    finally { setBusy(null); }
  }

  if (!detail.segments.length) {
    return <div className={cx(kit.glass, styles.section)}><p className={styles.muted}>{detail.source === 'memory' ? 'Звонок описан по памяти — расшифровки нет.' : detail.source === 'debrief' ? 'Импортирован готовый разбор — расшифровки нет.' : 'Расшифровки пока нет.'}</p></div>;
  }

  return (
    <div className={styles.review}>
      {audioSrc ? (
        <div className={cx(kit.chrome, styles.player)}>
          <button type="button" className={cx(kit.iconBtn)} style={{ background: 'var(--k-cta-bg)', color: 'var(--k-cta-fg)' }}
            onClick={() => { const element = audio.current; if (!element) return; if (element.paused) void element.play().catch(() => setAudioError(true)); else element.pause(); }}
            aria-label={playing ? 'Пауза' : 'Слушать запись'}>
            {playing ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
          </button>
          <input className={styles.scrub} type="range" min={0} max={Math.max(1, Math.round(duration ?? 0))} step={1} value={Math.round(time)}
            aria-label="Позиция в записи" onChange={event => { const element = audio.current; if (element) element.currentTime = Number(event.target.value); }} />
          <span className={styles.playerTime}>{formatClock(time)} / {formatClock(duration)}</span>
          <audio ref={audio} src={audioSrc} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
            onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }}
            onError={() => setAudioError(true)} />
        </div>
      ) : null}

      <div className={styles.transcriptTools}>
        <span className={kit.muted} style={{ fontSize: 13 }}>
          {audioError ? 'Запись не открылась — текст остаётся.'
            : expired || !detail.audioUrl ? (detail.source === 'audio' ? 'Аудио удалено после 30 дней — текст и разбор остаются.' : 'Импорт текста — без аудио.')
              : detail.audioExpiresAt ? `Нажми на время, чтобы послушать. Аудио хранится до ${formatDay(detail.audioExpiresAt)}.` : 'Нажми на время, чтобы послушать этот момент.'}
        </span>
        {hasVerbatim ? (
          <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} aria-pressed={showVerbatim} onClick={() => setShowVerbatim(value => !value)}>
            {showVerbatim ? 'Скрыть дословно' : 'Мои реплики дословно'}
          </button>
        ) : null}
      </div>

      {disputed ? (
        <div className={styles.banner} role="status">
          <WarningIcon size={18} weight="bold" />
          <span style={{ flex: 1 }}>Отмечено неверно расслышанных строк: {disputed}. Они не используются для разбора английского после переразбора.</span>
          {detail.review ? (
            <button type="button" className={cx(kit.btn, kit.secondary, kit.small)} disabled={reanalysing} onClick={onReanalyse}>
              {reanalysing ? <Spinner /> : <ArrowsClockwiseIcon size={14} weight="bold" />}Переразобрать
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <div className={styles.banner} role="alert" style={{ background: 'var(--k-error-soft)', color: 'var(--k-error-ink)' }}><WarningIcon size={18} weight="bold" />{error}</div> : null}

      <div className={cx(kit.glass, styles.lines)} role="list" aria-label="Расшифровка звонка">
        {detail.segments.map((segment, index) => {
          const speaker = segment.speaker ? speakers.get(segment.speaker) : undefined;
          return (
            <div key={segment.id} id={`seg-${detail.id}-${segment.id}`} role="listitem" className={styles.line} data-current={index === current} data-disputed={!!segment.disputed}>
              {segment.start !== null && audioSrc
                ? <button type="button" className={kit.time} onClick={() => playFrom(segment.start!)} aria-label={`Слушать с ${formatClock(segment.start)}`}>{formatClock(segment.start)}</button>
                : <span className={kit.time} style={{ background: 'transparent' }}>{formatClock(segment.start)}</span>}
              <div className={styles.lineBody}>
                <span className={styles.who} style={{ color: segment.speaker ? colours[segment.speaker] : 'var(--k-text-3)' }}>
                  <span className={styles.speakerDot} style={{ background: segment.speaker ? colours[segment.speaker] : 'var(--k-text-3)' }} />
                  {speaker?.label ?? 'Неизвестно'}
                </span>
                <p className={cx(styles.lineText, kit.en)} lang="en">{segment.text}</p>
                {showVerbatim && segment.verbatim && segment.verbatim !== segment.text ? <p className={styles.verbatim} lang="en">дословно: {segment.verbatim}</p> : null}
              </div>
              <button type="button" className={cx(kit.iconBtn, styles.flag)} style={{ width: 36, height: 36 }} aria-pressed={!!segment.disputed}
                disabled={busy === segment.id} onClick={() => void toggleDispute(segment)}
                title={segment.disputed ? 'Вернуть строку' : 'Неверно расслышано'} aria-label={segment.disputed ? 'Снять отметку «неверно расслышано»' : 'Отметить: неверно расслышано'}>
                {busy === segment.id ? <Spinner /> : <FlagIcon size={16} weight={segment.disputed ? 'fill' : 'bold'} color={segment.disputed ? 'var(--k-warning-ink)' : undefined} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
