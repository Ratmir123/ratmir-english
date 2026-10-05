'use client';

import { useRef } from 'react';
import { PlayIcon } from '@phosphor-icons/react';
import type { Session, SpeechTiming, TimingFeedback } from '@/lib/types';
import { validSpeechTiming } from '@/lib/speech-timing';
import styles from './speech-timing.module.css';

const seconds = (value: number) => new Intl.NumberFormat('ru', { maximumFractionDigits: 1 }).format(value) + ' с';
const segmentNames = { speech: 'Обнаруженная речь', pause: 'Внутренняя пауза', 'leading-silence': 'До речи', 'trailing-silence': 'После речи', gap: 'Короткий промежуток' };

function groundedFeedback(timing: SpeechTiming, values: TimingFeedback[]) {
  return values.filter(value => Number.isFinite(value.startSeconds) && Number.isFinite(value.endSeconds)
    && value.startSeconds >= 0 && value.endSeconds > value.startSeconds && value.endSeconds <= timing.durationSeconds
    && Math.abs(value.durationSeconds - (value.endSeconds - value.startSeconds)) < 0.11
    && timing.segments.some(segment => segment.kind === 'pause' && Math.abs(segment.startSeconds - value.startSeconds) < 0.11 && Math.abs(segment.endSeconds - value.endSeconds) < 0.11));
}

function TimingRecording({ timing, title, feedback }: { timing: SpeechTiming; title: string; feedback: TimingFeedback[] }) {
  const audio = useRef<HTMLAudioElement>(null);
  const notes = timing.quality === 'usable' ? groundedFeedback(timing, feedback) : [];
  function playFrom(start: number) {
    const element = audio.current; if (!element) return;
    element.currentTime = Math.max(0, start - 0.7);
    void element.play().catch(() => { /* The native controls remain available if playback is blocked. */ });
  }
  return <details className={styles.recording}>
    <summary><strong>{title}</strong><span>{seconds(timing.durationSeconds)} · {timing.quality === 'usable' ? 'Есть измерения' : timing.quality === 'limited' ? 'Измерения ограничены' : 'Речь не обнаружена'}</span></summary>
    <div className={styles.recordingContent}>
      <div className={styles.timeline} role="img" aria-label={`Речь и промежутки в оригинале. ${timing.segments.map(segment => `${segmentNames[segment.kind]}: ${seconds(segment.startSeconds)} — ${seconds(segment.endSeconds)}`).join('; ')}`}>
        {timing.segments.map((segment, index) => <span key={index} data-kind={segment.kind} style={{ width: (segment.endSeconds - segment.startSeconds) / timing.durationSeconds * 100 + '%' }} title={`${segmentNames[segment.kind]}: ${seconds(segment.startSeconds)} – ${seconds(segment.endSeconds)}`} />)}
      </div>
      <div className={styles.legend}><span><i data-kind="speech" />Речь</span><span><i data-kind="pause" />Паузы внутри ответа</span><span><i data-kind="gap" />Другие промежутки</span></div>
      <dl className={styles.metrics}>
        <div><dt>Обнаруженная речь</dt><dd>{seconds(timing.detectedSpeechSeconds)}</dd></div>
        <div><dt>Внутренние паузы</dt><dd>{timing.internalPauseCount} · {seconds(timing.internalPauseSeconds)}</dd></div>
        <div><dt>Самая длинная пауза</dt><dd>{seconds(timing.longestPauseSeconds)}</dd></div>
      </dl>
      <audio ref={audio} controls preload="none" src={'/api/audio/' + encodeURIComponent(timing.audioFile)} aria-label={'Оригинал: ' + title} />
      {timing.quality === 'limited' && <p className={styles.caution}>Измерения ограничены длиной или качеством записи. Эти числа описывают оригинал, но не позволяют судить о твоей беглости.</p>}
      {timing.quality === 'no-speech' && <p className={styles.caution}>Детектор не нашёл речь. Послушай оригинал: тихий голос и фоновые звуки могут мешать измерению.</p>}
      {notes.map((note, index) => <div key={index} className={styles.feedback}><p>{note.observation}</p><button type="button" className="text-button" onClick={() => playFrom(note.startSeconds)}><PlayIcon size={16} />Послушать этот момент</button><p>{note.practice}</p></div>)}
      {timing.approximateWordsPerMinute !== null && <p className={styles.pace}>Примерный темп: {Math.round(timing.approximateWordsPerMinute)} распознанных слов/мин. Зависит от расшифровки и включает внутренние паузы; это не оценка произношения.</p>}
      {timing.transcriptEdited && <p className={styles.caution}>Текст исправлен. Паузы относятся к исходному аудио; темп по словам не рассчитывается.</p>}
      {timing.limitations.length > 0 && <details className={styles.limitations}><summary>Как читать эти измерения</summary>{timing.limitations.map((value, index) => <p key={index}>{value}</p>)}</details>}
    </div>
  </details>;
}

export function SpeechTimingPanel({ session }: { session: Session }) {
  const recordings = session.turns.filter(turn => turn.role === 'user' && turn.source === 'audio' && !turn.disputed && validSpeechTiming(turn.speechTiming, turn.audioFile));
  const retries = session.retries.flatMap((retry, index) => validSpeechTiming(retry.speechTiming, retry.audioFile) ? [{ retry, index }] : []);
  if (!recordings.length && !retries.length) return null;
  return <section className={`surface ${styles.panel}`} aria-labelledby={'timing-' + session.id}>
    <h2 id={'timing-' + session.id}>Ритм твоей речи</h2>
    <p className={styles.intro}>По исходной записи: где детектор нашёл речь и промежутки между ней. Паузы измеряются по записи, даже если расшифровка их пропустила. Их причина и качество произношения здесь не оцениваются.</p>
    {recordings.map((turn, index) => <TimingRecording key={turn.id} title={'Запись ' + (index + 1)} timing={turn.speechTiming!} feedback={session.analysis?.timingFeedback?.filter(value => value.turnId === turn.id) ?? []} />)}
    {retries.map(({ retry, index }) => <TimingRecording key={retry.id || 'retry-' + index} title={'Новая попытка ' + (index + 1)} timing={retry.speechTiming!} feedback={[]} />)}
  </section>;
}
