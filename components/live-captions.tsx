'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownIcon as ArrowDown } from '@phosphor-icons/react';
import { emptyCaptionWords, reconcileCaptionWords } from './live-caption-words';
import type { VoiceState } from './use-voice';
import styles from './live-captions.module.css';

type LiveCaptionsProps = { text: string; status: string; state: VoiceState };

export function LiveCaptions({ text, status, state }: LiveCaptionsProps) {
  const visible = state === 'listening' || state === 'transcribing';
  const viewport = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [words, setWords] = useState(emptyCaptionWords);
  // Reconcile before committing the DOM. Existing words keep their animation and
  // identity through partial results, including punctuation/capitalisation fixes.
  if (words.text !== text) setWords(reconcileCaptionWords(words, text));

  const followLatest = useCallback(() => {
    const element = viewport.current;
    if (!element || !following.current) return;
    const focus = document.activeElement;
    if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement
      || (focus instanceof HTMLElement && focus.isContentEditable)) return;
    // Immediate internal scrolling avoids queued smooth scrolls lagging behind
    // recognition. It never moves the page or takes keyboard focus.
    element.scrollTop = element.scrollHeight;
  }, []);

  useLayoutEffect(() => { if (visible) followLatest(); }, [words, visible, followLatest]);
  useEffect(() => {
    if (!visible) { following.current = true; setShowLatest(false); return; }
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(followLatest);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, followLatest]);

  if (!visible) return null;
  const resume = () => { following.current = true; setShowLatest(false); followLatest(); };
  return <section className={`live-caption ${styles.caption}`} data-testid="live-caption" aria-label="Живая расшифровка">
    <div className={styles.heading}><span className={styles.status}>{status || 'Живые субтитры'}</span><span className={styles.liveDot} aria-hidden="true" /></div>
    <div ref={viewport} className={styles.viewport} data-testid="live-caption-viewport" tabIndex={0} role="region" aria-label="Твои слова. Можно прокрутить предыдущие реплики."
      onScroll={event => {
        const element = event.currentTarget;
        const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop <= 20;
        following.current = atBottom;
        setShowLatest(!atBottom);
      }} onKeyDown={event => { if (event.key === 'End' && !event.shiftKey) { event.preventDefault(); resume(); } }}>
      <p lang="en" className={styles.words}>{words.words.length ? <>{words.leading}{words.words.map(word => <span key={word.id} data-caption-id={word.id}><span className={styles.word}>{word.text}</span>{word.space}</span>)}</>
        : <span className={styles.placeholder}>{state === 'listening' ? 'Начни говорить. Твои слова появятся здесь.' : 'Проверяем запись целиком…'}</span>}</p>
    </div>
    {showLatest && <button type="button" className={styles.latest} data-testid="caption-latest" onClick={resume}><ArrowDown size={14} />К текущим словам</button>}
    <small>Это предварительная расшифровка. После записи можно проверить текст и послушать оригинал.</small>
  </section>;
}
