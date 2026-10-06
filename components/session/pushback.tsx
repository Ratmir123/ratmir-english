'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleNotchIcon, EyeIcon, PaperPlaneRightIcon, ShieldCheckIcon, SpeakerHighIcon, SquareIcon } from '@phosphor-icons/react';
import type { Session } from '@/lib/types';
import { mediaUrl } from '@/lib/client/api';
import { useApp } from '../app/app-context';
import { LiveCaptions } from '../live-captions';
import { MicButton } from './dock';
import { RecordingEvidence } from './recording-panels';
import styles from './session.module.css';

type Retry = Session['retries'][number];

/**
 * Pushback round (CONTRACT §3): after an improved retry the partner objects once. Holding it earns the
 * «Выдержал давление» badge. Optional — completion never waits for it.
 */
export function PushbackRound({ retry, retryId }: { retry: Retry; retryId: string }) {
  const app = useApp();
  const lesson = app.lesson;
  const voice = lesson.voice;
  const session = lesson.session!;
  const pushback = retry.pushback!;
  const [skipped, setSkipped] = useState(false);
  const [audio, setAudio] = useState<'idle' | 'loading' | 'playing'>('idle');
  // MOTION-PASS-0.5.2 §6: the objection is heard first; its text is revealed on request, or stands in when the voice fails.
  const [revealed, setRevealed] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const file = useRef<string | null>(pushback.audioFile ?? null);
  useEffect(() => () => { player.current?.pause(); player.current = null; }, []);
  const draft = lesson.draftFor(session.id, 'pushback', retryId);
  const audioReady = !!app.data.status?.audio.configured;
  const capturing = voice.state === 'listening' || voice.state === 'transcribing';
  const pending = !!lesson.busy || capturing || voice.state === 'thinking';
  const contextKey = `${session.id}:pushback:${retryId}`;
  // Hidden while the voice status is still unknown too (same rule as the conversation); shown when voice is off or failed.
  const textShown = lesson.voiceUnavailable || voiceFailed || revealed;

  const play = async () => {
    if (audio === 'playing') { player.current?.pause(); player.current = null; setAudio('idle'); return; }
    voice.stop();
    setAudio('loading');
    const name = file.current ?? await lesson.pushbackSpeech(retryId);
    if (!name) { setAudio('idle'); setVoiceFailed(true); return; }
    file.current = name;
    const element = new Audio(mediaUrl('audio/' + encodeURIComponent(name)));
    player.current = element;
    element.onended = () => { if (player.current === element) { player.current = null; setAudio('idle'); } };
    element.onerror = () => { if (player.current === element) { player.current = null; setAudio('idle'); setVoiceFailed(true); } };
    try { await element.play(); setAudio('playing'); } catch { if (player.current === element) { player.current = null; setAudio('idle'); setVoiceFailed(true); } }
  };

  if (pushback.held !== null || pushback.reply) {
    return <section className={styles.pushback} data-held={pushback.held === true} aria-label="Раунд давления">
      <div className={styles.pushbackHead}>
        {pushback.held ? <span className="chip lime"><ShieldCheckIcon size={15} weight="fill" />Выдержал давление</span> : <span className="chip warning">Давление пока продавило</span>}
      </div>
      <p className={styles.pushbackLine} lang="en">«{pushback.npcLine}»</p>
      {pushback.reply && <blockquote lang="en" className={styles.quote}>{pushback.reply}</blockquote>}
      {pushback.feedback && <p className={styles.feedback}>{pushback.feedback}</p>}
    </section>;
  }
  if (skipped) return <button type="button" className="text-button" onClick={() => setSkipped(false)}>Вернуться к возражению собеседника</button>;
  return <section className={styles.pushback} aria-labelledby={`pushback-${retryId}`}>
    <div className={styles.pushbackHead}>
      <h4 id={`pushback-${retryId}`}>Раунд давления<span> · по желанию</span></h4>
      <button type="button" className="text-button muted" onClick={() => setSkipped(true)}>Пропустить</button>
    </div>
    <p className="caption">Собеседник не сдаётся. Удержи свою позицию ещё раз — это не обязательно для завершения.</p>
    <div className={styles.pushbackObjection}>
      {textShown ? <p key="line" lang="en" className={`${styles.pushbackLine} ${styles.revealed}`}>«{pushback.npcLine}»</p>
        : <p key="hidden" className={styles.pushbackHidden}>Возражение звучит голосом — послушай его. Текст можно открыть.</p>}
      <div className={styles.pushbackTools}>
        {audioReady && <button type="button" className="icon-button" onClick={() => void play()} aria-label={audio === 'playing' ? 'Остановить' : 'Послушать возражение'} disabled={audio === 'loading'}>
          {audio === 'loading' ? <CircleNotchIcon size={18} className={styles.spin} /> : audio === 'playing' ? <SquareIcon size={16} weight="fill" /> : <SpeakerHighIcon size={18} weight="fill" />}
        </button>}
        {!lesson.voiceUnavailable && !voiceFailed && (revealed
          ? <button type="button" className="text-button muted" onClick={() => setRevealed(false)}>Скрыть текст</button>
          : <button type="button" className="button small tinted" onClick={() => setRevealed(true)}><EyeIcon size={15} />Показать текст</button>)}
      </div>
    </div>
    <RecordingEvidence intent="pushback" retryId={retryId} />
    {audioReady && <LiveCaptions store={voice.transcriptStore} contextKey={contextKey} />}
    <div className={styles.pushbackComposer}>
      {audioReady && <MicButton contextKey={contextKey} size="small" testId="pushback-record" disabled={pending || voice.hasUnuploadedRecording || !!draft?.audioFile} />}
      <textarea className={styles.field} lang="en" rows={2} aria-label="Твой ответ на возражение" placeholder="Hold your position…" value={draft?.text ?? ''}
        disabled={pending} onChange={event => lesson.changeDraft('pushback', event.target.value, retryId)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && draft?.text.trim()) { event.preventDefault(); void lesson.pushback(retryId, event.currentTarget); } }} />
      <button type="button" className="button secondary" disabled={pending || !draft?.text.trim()} onClick={event => void lesson.pushback(retryId, event.currentTarget)}>
        Ответить<PaperPlaneRightIcon size={16} weight="fill" /></button>
    </div>
  </section>;
}
