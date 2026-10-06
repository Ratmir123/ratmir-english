'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ArrowDownIcon as ArrowDown } from '@phosphor-icons/react';
import { IDLE_TRANSCRIPT, type LiveTranscriptStore } from '@/lib/browser-audio';
import { emptyCaptionWords, paceReveal, reconcileCaptionWords, waitingArrivals, type CaptionWords } from './live-caption-words';
import styles from './live-captions.module.css';

type LiveCaptionsProps = { store: LiveTranscriptStore; contextKey: string };

const FOLLOW_MS = 240;
// One element instance: per-word renders of the captions never re-render the icon.
const ARROW = <ArrowDown size={14} />;
const clock = () => (typeof performance === 'undefined' ? 0 : performance.now());
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Close to the app's expo-out (cubic-bezier(.16,1,.3,1)): long, soft deceleration, no overshoot.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 5);

/**
 * Keeps the newest caption line in view with a short glide instead of jumps. Following stops only when the learner
 * scrolls back himself and resumes at the bottom or with «К текущим словам». Programmatic steps are told apart from
 * his scrolling by the position the glide itself wrote.
 */
function useFollow(viewport: RefObject<HTMLDivElement | null>) {
  const following = useRef(true);
  const written = useRef<number | null>(null);
  const glide = useRef(0);
  const [away, setAway] = useState(false);
  const stop = useCallback(() => { cancelAnimationFrame(glide.current); glide.current = 0; }, []);
  const follow = useCallback((instant = false) => {
    const element = viewport.current;
    if (!element || !following.current) return;
    const target = Math.max(0, element.scrollHeight - element.clientHeight);
    if (Math.abs(target - element.scrollTop) < 1) return;
    stop();
    if (instant || reducedMotion()) { element.scrollTop = target; written.current = element.scrollTop; return; }
    const from = element.scrollTop, started = clock();
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / FOLLOW_MS));
      element.scrollTop = from + (target - from) * easeOut(progress);
      written.current = element.scrollTop;
      glide.current = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    glide.current = requestAnimationFrame(step);
  }, [viewport, stop]);
  const onScroll = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    // Our own glide wrote this position: not the learner scrolling.
    if (written.current !== null && Math.abs(element.scrollTop - written.current) <= 1) return;
    const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop <= 4;
    following.current = atBottom;
    if (!atBottom) stop();
    setAway(!atBottom);
  }, [viewport, stop]);
  const resume = useCallback(() => { following.current = true; setAway(false); follow(); }, [follow]);
  const reset = useCallback(() => { following.current = true; written.current = null; setAway(false); stop(); }, [stop]);
  useEffect(() => stop, [stop]);
  return { follow, onScroll, resume, reset, away };
}

/**
 * The learner's own words while he speaks (MOTION-PASS-0.5.2 §5). Mounted with its composer and subscribed only to the
 * live-transcript store, so recognition deltas re-render this view alone. The area opens at full, fixed height the
 * moment a recording is requested (a one-line status + 3 lines; 2 on phones), words arrive one by one through a short
 * queue (live-caption-words.ts) and fade up from a slight blur, revisions cross-fade in place, and the newest line
 * glides in. After Stop the words stay until the checked text arrives; the area then folds away as the composer gets it.
 */
export const LiveCaptions = memo(function LiveCaptions({ store, contextKey }: LiveCaptionsProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE_TRANSCRIPT);
  const mine = snapshot.contextKey === contextKey;
  const phase = mine ? snapshot.phase : 'idle';
  const open = phase !== 'idle';
  const text = mine ? snapshot.text : '';
  const viewport = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState<CaptionWords>(emptyCaptionWords);
  const [through, setThrough] = useState(-1);
  const anchor = useRef(-Infinity);
  // Reconcile before committing the DOM: existing words keep their node, animation and identity.
  if (words.text !== text) setWords(reconcileCaptionWords(words, text, clock(), through));
  const { follow, onScroll, resume, reset, away } = useFollow(viewport);

  // A new recording starts from the top, following.
  const starting = phase === 'starting';
  useEffect(() => { if (starting) reset(); }, [starting, reset]);

  // Reveal queue: one word per frame budget (≈55 ms), compressed so nothing lags more than ≈350 ms.
  useEffect(() => {
    const { ids, arrivals } = waitingArrivals(words.words, through);
    if (!ids.length) return;
    let frame = requestAnimationFrame(function tick(now) {
      const step = paceReveal(arrivals, anchor.current, now);
      if (!step.count) { frame = requestAnimationFrame(tick); return; }
      anchor.current = step.anchor;
      setThrough(ids[step.count - 1]);
    });
    return () => cancelAnimationFrame(frame);
  }, [words, through]);

  // The newest visible line glides into view after every reveal or reflow.
  useLayoutEffect(() => { if (open) follow(); }, [open, words, through, follow]);
  useEffect(() => {
    const element = viewport.current;
    if (!element || !open) return;
    const observer = new ResizeObserver(() => follow(true));
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, follow]);

  const shown = words.words.filter(word => word.id <= through);
  const placeholder = phase === 'starting' ? 'Слова появятся здесь, как только начнёшь говорить.'
    : phase === 'finishing' ? 'Проверяю запись целиком…' : 'Начни говорить — слова появятся здесь. Это черновик расшифровки.';
  return <div className={styles.shell} data-open={open} data-phase={phase} data-context={contextKey} data-testid="live-caption-shell" inert={!open}>
    <section className={`live-caption ${styles.caption}`} data-testid={open ? 'live-caption' : undefined} aria-label="Живая расшифровка" aria-hidden={!open || undefined}>
      <div className={styles.heading}>
        <span key={snapshot.status} className={styles.status}>{(mine && snapshot.status) || 'Живые субтитры'}</span>
        <span className={styles.liveDot} data-live={phase === 'listening'} aria-hidden="true" />
      </div>
      <div className={styles.frame}>
        <div ref={viewport} className={styles.viewport} data-testid="live-caption-viewport" tabIndex={open ? 0 : -1} role="region"
          aria-label="Твои слова — предварительная расшифровка. После записи текст можно проверить и послушать оригинал." onScroll={onScroll}
          onKeyDown={event => { if (event.key === 'End' && !event.shiftKey) { event.preventDefault(); resume(); } }}>
          <p lang="en" className={styles.words}>{shown.length ? <>{words.leading}{shown.map(word => <span key={word.id}>
            <span className={styles.word} data-caption-id={word.id}>
              <span key={word.rev} className={word.rev ? styles.revised : undefined}>{word.text}</span>
              {word.rev > 0 && word.previous ? <span key={'was' + word.rev} className={styles.ghost} aria-hidden="true">{word.previous}</span> : null}
            </span>{word.space}</span>)}</>
            : <span key={phase} className={styles.placeholder}>{placeholder}</span>}</p>
        </div>
        <button type="button" className={styles.latest} data-visible={open && away} data-testid="caption-latest" tabIndex={open && away ? 0 : -1}
          aria-hidden={!(open && away) || undefined} onClick={resume}>{ARROW}К текущим словам</button>
      </div>
    </section>
  </div>;
});
