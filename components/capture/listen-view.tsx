'use client';

/*
 * What «Послушать» shows (planning/v05/PASS-0.5.4.md §1.4): the recording (a pill by the PC chubrik, or the card's own
 * recording view in the in-app sheet), «Расшифровываю…», the transcript with «Разбираю…», then the explanation — what it
 * is about, the expressions saved to «Мои фразы» (× removes one), what else is worth noticing and the transcript itself.
 * One sunken well at most (the transcript); the phrases and points are plain lists inside the card.
 */
import { useState } from 'react';
import { ArrowRightIcon, StopIcon, XIcon } from '@phosphor-icons/react';
import { LISTEN_MAX_SECONDS, type ListenPhrase } from '@/lib/phrases/types';
import { LISTEN_COPY, listenTime, type Listen } from './use-listen';
import styles from './listen.module.css';

const plural = (count: number, one: string, few: string, many: string) => {
  const ten = count % 10, hundred = count % 100;
  return ten === 1 && hundred !== 11 ? one : ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14) ? few : many;
};

/** «Запомнил 2 фразы» / «Фразы уже в копилке» / the server's note. */
export function listenSummary(listen: Pick<Listen, 'clip' | 'slow'>): string {
  const clip = listen.clip;
  if (!clip) return '';
  if (listen.slow && clip.status === 'analyzing') return 'Разбираю дольше обычного — фразы появятся в «Моих фразах».';
  const fresh = clip.phrases.filter(item => !item.duplicate).length;
  if (fresh) return `Запомнил ${fresh} ${plural(fresh, 'фразу', 'фразы', 'фраз')}. Повторим в разговорах`;
  if (clip.phrases.length) return 'Эти фразы уже в копилке';
  return clip.note || 'Тут нечего запомнить — попробуй кусок с речью.';
}

/** The small recording pill beside the PC chubrik: pulsing dot, time, «Стоп», ×. */
export function ListenPill({ listen, className }: { listen: Listen; className?: string }) {
  const recording = listen.phase === 'recording';
  return <div className={`${styles.pill} ${className ?? ''}`} data-warn={listen.warn || undefined} role="group" aria-label="Запись звука">
    <span className={styles.dot} data-live={recording || undefined} aria-hidden="true" />
    <span className={styles.time} aria-live="off">{recording ? listenTime(listen.elapsed) : 'Подключаюсь…'}</span>
    {listen.warn && <span className={styles.pillWarn}>ещё {LISTEN_MAX_SECONDS - listen.elapsed} с</span>}
    <button type="button" className={`button primary small ${styles.stop}`} onClick={listen.stop} disabled={!recording} data-testid="listen-stop">
      <StopIcon size={15} weight="fill" aria-hidden="true" />Стоп</button>
    <button type="button" className={`icon-button plain ${styles.pillClose}`} onClick={listen.cancel} aria-label="Отменить запись" data-testid="listen-cancel">
      <XIcon size={16} aria-hidden="true" /></button>
  </div>;
}

function PhraseRow({ item, onRemove }: { item: ListenPhrase; onRemove: (id: string) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const phrase = item.phrase;
  const target = phrase.phrase?.trim() || phrase.text;
  const remove = async () => {
    setState('busy');
    try { await onRemove(phrase.id); } catch { setState('failed'); }
  };
  return <li className={styles.phraseRow}>
    <div className={styles.phraseCopy}>
      <p className={styles.phrase} lang="en">{target}</p>
      {phrase.meaning && <p className={styles.meaning}>{phrase.meaning}</p>}
      {phrase.heard && <p className={styles.heard}>Услышал: «<span lang="en">{phrase.heard}</span>»</p>}
      {item.duplicate && <p className={styles.duplicate}>Уже в копилке</p>}
      {state === 'failed' && <p className={styles.error} role="alert">Не получилось убрать. Попробуй ещё раз.</p>}
    </div>
    {!item.duplicate && <button type="button" className={`icon-button plain ${styles.remove}`} onClick={() => void remove()} disabled={state === 'busy'}
      aria-label={`Убрать «${target}» из «Моих фраз»`} title="Убрать из «Моих фраз»"><XIcon size={16} aria-hidden="true" /></button>}
  </li>;
}

/** The card's content while «Послушать» is busy or has a result. */
export function ListenView({ listen, headingId, onOpenPhrases }: { listen: Listen; headingId?: string; onOpenPhrases?: () => void }) {
  const copy = LISTEN_COPY[listen.source];
  const clip = listen.clip;
  if (listen.phase === 'starting' || listen.phase === 'recording') {
    return <div className={styles.view} data-testid="listen-recording">
      <h2 id={headingId} className={styles.title}>Слушаю</h2>
      <p className={styles.hint}>{copy.hint}</p>
      <div className={styles.meter} data-warn={listen.warn || undefined}>
        <span className={styles.dot} data-live={listen.phase === 'recording' || undefined} aria-hidden="true" />
        <span className={styles.bigTime}>{listen.phase === 'recording' ? listenTime(listen.elapsed) : '0:00'}</span>
        <span className={styles.limit}>из {listenTime(LISTEN_MAX_SECONDS)}</span>
      </div>
      {listen.warn && <p className={styles.warn} role="status">Через {LISTEN_MAX_SECONDS - listen.elapsed} с запись остановится сама.</p>}
      <div className={styles.actions}>
        <button type="button" className="button primary small" onClick={listen.stop} disabled={listen.phase !== 'recording'} data-testid="listen-stop">
          <StopIcon size={16} weight="fill" aria-hidden="true" />Стоп</button>
        <button type="button" className="text-button" onClick={listen.cancel}>Отмена</button>
      </div>
    </div>;
  }
  if (listen.phase === 'uploading') {
    return <div className={styles.view} data-testid="listen-uploading">
      <h2 id={headingId} className={styles.title}>Расшифровываю…</h2>
      <p className={styles.working}><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>Отправил запись, сейчас будет текст</p>
    </div>;
  }
  if (listen.phase === 'failed') {
    return <div className={styles.view} data-testid="listen-failed">
      <h2 id={headingId} className={styles.title}>Не получилось</h2>
      <p className={styles.error} role="alert">{listen.error || LISTEN_COPY.failed}</p>
      <div className={styles.actions}>
        <button type="button" className="button primary small" onClick={() => void listen.start()}>Попробовать ещё раз</button>
        <button type="button" className="text-button" onClick={listen.reset}>Назад</button>
      </div>
    </div>;
  }
  if (!clip) return null;
  const analyzing = listen.phase === 'analyzing';
  const done = clip.status !== 'analyzing';
  return <div className={styles.view} data-testid={analyzing ? 'listen-analyzing' : 'listen-ready'}>
    <div className={styles.head}>
      <h2 id={headingId} className={styles.title}>{analyzing ? 'Разбираю…' : 'Послушал!'}</h2>
      {!analyzing && <p className={styles.sub}>{listenSummary(listen)}</p>}
    </div>
    {analyzing && <p className={styles.working}><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>Объясню, что тут интересного</p>}
    {done && clip.gist && <p className={styles.gist}><strong>О чём:</strong> {clip.gist}</p>}
    {done && clip.phrases.length > 0 && <ul className={styles.phrases} aria-label="Фразы из записи">
      {clip.phrases.map(item => <PhraseRow key={item.phrase.id} item={item} onRemove={listen.removePhrase} />)}
    </ul>}
    {done && clip.points.length > 0 && <section className={styles.points} aria-label="Что ещё заметил">
      <h3 className={styles.pointsTitle}>Что ещё заметил</h3>
      <ul>{clip.points.map((point, index) => <li key={index}>{point}</li>)}</ul>
    </section>}
    {clip.transcript && (analyzing
      ? <p className={styles.transcript} lang="en">{clip.transcript}</p>
      : <details className={styles.details}><summary>Текст записи · {listenTime(clip.seconds)}</summary><p className={styles.transcript} lang="en">{clip.transcript}</p></details>)}
    {!analyzing && <div className={styles.actions}>
      <button type="button" className="button primary small" onClick={() => void listen.start()} data-testid="listen-again">Послушать ещё</button>
      {onOpenPhrases && <button type="button" className="text-button" onClick={onOpenPhrases}>Мои фразы<ArrowRightIcon size={15} aria-hidden="true" /></button>}
      <button type="button" className="text-button" onClick={listen.reset}>Готово</button>
    </div>}
  </div>;
}
