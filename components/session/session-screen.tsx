'use client';

import { useEffect } from 'react';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { useApp } from '../app/app-context';
import { MODE_LABEL, sessionStatusLabel, sessionTone, TAB_NAMES } from '../app/labels';
import { ConversationView } from './conversation';
import { AnalysisWaiting, ErrorBanner, ProcessingNote, ReviewView } from './review';
import styles from './session.module.css';

/** One lesson: conversation → analysing → review/retry → completed. Back returns to where it was opened. */
export function SessionScreen() {
  const app = useApp();
  const lesson = app.lesson;
  const s = lesson.session;
  // A ready review counts as seen once it is opened (the Today dot only marks new ones).
  const markReviewSeen = app.markReviewSeen;
  useEffect(() => { if (s?.status === 'review' && app.nav.sessionOpen) markReviewSeen(s.id); }, [s?.id, s?.status, app.nav.sessionOpen, markReviewSeen]);
  if (!s) return null;
  const conversation = s.status === 'active';
  const failedWithoutReview = s.status === 'error' && !s.analysis;
  const ieltsTitle = s.lesson.track === 'ielts-foundation' ? 'Основа для IELTS' : null;
  return <div className={`screen ${styles.session}`} data-screen="session">
    <header className={styles.header}>
      <button type="button" className="button small secondary" onClick={() => { lesson.voice.stop(); app.nav.closeSession(); }}>
        <CaretLeftIcon size={16} weight="bold" />{TAB_NAMES[app.nav.returnTab]}</button>
      <div className={styles.headerCopy}>
        <div className={styles.headerChips}><span className="chip glassy">{s.baseline ? 'Старая стартовая проба' : MODE_LABEL[s.mode]}</span>
          <span className={`chip ${sessionTone(s) === 'neutral' ? '' : sessionTone(s)}`}>{sessionStatusLabel(s)}</span>{ieltsTitle && <span className="chip">{ieltsTitle}</span>}</div>
        <h1 tabIndex={-1} data-screen-heading className={styles.title}>{s.lesson.title}</h1>
        <details className={styles.task}><summary>Твоя задача</summary><p>{s.lesson.goal}</p>{s.lesson.why && <p className="caption">{s.lesson.why}</p>}</details>
      </div>
    </header>
    <ErrorBanner />
    <ProcessingNote />
    {conversation && <ConversationView />}
    {failedWithoutReview && <section className={`glass flat ${styles.failedTranscript}`}><span className="eyebrow">Твои ответы сохранены</span>
      <ol className={styles.turns}>{s.turns.map(turn => <li key={turn.id} data-role={turn.role}><span className="eyebrow">{turn.role === 'user' ? 'Ты' : 'Собеседник'}</span><p lang="en">{turn.text}</p></li>)}</ol></section>}
    {s.status === 'analysing' && <AnalysisWaiting />}
    {!!s.analysis && s.status !== 'analysing' && <ReviewView />}
  </div>;
}
