'use client';

import { useEffect } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useApp } from '../app/app-context';
import { MODE_LABEL, sessionStatusLabel, sessionTone, TAB_NAMES } from '../app/labels';
import { ConversationView, Turns } from './conversation';
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
  const tone = sessionTone(s);
  const mode = (s.baseline ? 'Старая стартовая проба' : MODE_LABEL[s.mode]) + (s.lesson.track === 'ielts-foundation' ? ' · Основа для IELTS' : '');
  const avoid = conversation ? (s.lesson.mustAvoid ?? []).slice(0, 6) : [];
  // Top-level blocks carry data-enter: opening a lesson runs the 'screen' staircase (MOTION-PASS-0.5.2 §2).
  return <div className={`screen ${styles.session}`} data-screen="session">
    <header className={styles.header} data-enter="">
      <button type="button" className={`text-button ${styles.back}`} onClick={() => { lesson.voice.stop(); app.nav.closeSession(); }}>
        <CaretLeftIcon size={16} weight="bold" />{TAB_NAMES[app.nav.returnTab]}</button>
      <h1 tabIndex={-1} data-screen-heading className={styles.title}>{s.lesson.title}</h1>
      {/* A failed review already has its banner below: the line then names only the mode. */}
      <p className={styles.meta}>
        {s.status === 'error' ? <span>{mode}</span> : tone !== 'neutral' ? <><span className={`chip ${tone}`}>{sessionStatusLabel(s)}</span><span>{mode}</span></>
          : <span>{sessionStatusLabel(s)} · {mode}</span>}
      </p>
      <div className={styles.brief}>
        <p><strong>Задача:</strong> {s.lesson.goal}</p>
        {avoid.length > 0 && <p className={styles.avoid}><strong>Не говори:</strong> {avoid.map((item, index) => <span key={item}>{index > 0 && ', '}<q lang="en">{item}</q></span>)}</p>}
        {s.lesson.why && <details className={styles.why}><summary>Зачем это<CaretRightIcon size={14} weight="bold" className={styles.caret} /></summary><p>{s.lesson.why}</p></details>}
      </div>
    </header>
    <ErrorBanner />
    <ProcessingNote />
    {conversation && <ConversationView />}
    {failedWithoutReview && <section className={`surface ${styles.failedTranscript}`} data-enter="" aria-labelledby="saved-turns">
      <h2 id="saved-turns" className={styles.blockTitle}>Твои ответы сохранены</h2>
      <Turns turns={s.turns} />
    </section>}
    {s.status === 'analysing' && <AnalysisWaiting />}
    {!!s.analysis && s.status !== 'analysing' && <ReviewView />}
  </div>;
}
