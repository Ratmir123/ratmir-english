'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowsClockwiseIcon, BookOpenTextIcon, CaretRightIcon, CheckIcon, EyeIcon, LightbulbIcon, PlayIcon, SpeakerHighIcon, SquareIcon } from '@phosphor-icons/react';
import type { Session } from '@/lib/types';
import { useApp } from '../app/app-context';
import { CTA } from '../app/labels';
import { Companion, type MascotEmotion } from '../shell/companion';
import { ElapsedTime } from '../ui/elapsed';
import { Dock } from './dock';
import { FinishDialog, type FinishIntent } from './dialogs';
import { UnuploadedRecording } from './recording-panels';
import styles from './session.module.css';

type Turn = Session['turns'][number];

/**
 * The conversation as a plain list: who spoke, what was said. `note` and `extra` add review-only details; `hidden`
 * keeps a partner line that is still being listened to out of the list (with its own reveal).
 */
export function Turns({ turns, note, extra, hidden, onReveal }: {
  turns: Turn[]; note?: (turn: Turn) => string; extra?: (turn: Turn) => ReactNode;
  hidden?: (turn: Turn) => boolean; onReveal?: (turn: Turn) => void;
}) {
  return <ol className={styles.turns}>{turns.map(turn => <li key={turn.id} data-role={turn.role}>
    <span className={styles.speaker}>{turn.role === 'user' ? 'Ты' : 'Собеседник'}{note?.(turn)}</span>
    {hidden?.(turn) ? <p className={styles.turnHidden}>Текст скрыт, пока ты слушаешь.{onReveal && <> <button type="button" className="text-button" onClick={() => onReveal(turn)}>Показать текст</button></>}</p>
      : <p lang="en">{turn.text}</p>}
    {extra?.(turn)}
  </li>)}</ol>;
}

/** Reading passage or writing brief. `embedded` drops the surface when it sits inside another one. */
export function LessonMaterial({ material, embedded = false }: { material: NonNullable<Session['lesson']['material']>; embedded?: boolean }) {
  const label = material.type === 'reading-passage' ? 'Текст для чтения' : 'Задание для письма';
  return <section className={`${embedded ? '' : 'surface '}${styles.material}`} data-embedded={embedded} data-enter={embedded ? undefined : ''} aria-label={label}>
    <h2 className={styles.label}>{label}</h2>
    <p lang="en" className={styles.materialText}>{material.text}</p>
    <p lang="en" className={styles.materialInstruction}>{material.instruction}</p>
    <small>Учебный материал создан для этой практики, это не официальный экзаменационный вариант.</small>
  </section>;
}

/** Format 'pitch': a 30–45 s target while he speaks (S4 plan extras). Informational, never cuts him off. */
function PitchTimer({ listening }: { listening: boolean }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!listening) { started.current = null; return; }
    started.current = Date.now(); setSeconds(0);
    const timer = setInterval(() => { if (started.current) setSeconds(Math.floor((Date.now() - started.current) / 1000)); }, 250);
    return () => clearInterval(timer);
  }, [listening]);
  if (seconds === null) return <p className={styles.pitchTimer} data-zone="idle">Цель — 30–45 секунд: кто ты, жанр, доказательство, текущий клиент.</p>;
  const zone = seconds < 25 ? 'short' : seconds <= 45 ? 'good' : 'long';
  return <p className={styles.pitchTimer} data-zone={zone} role="timer" aria-live="off">
    <span className="tabular">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
    <span className={styles.pitchTrack} aria-hidden="true"><b data-zone="good" /><b data-zone="long" /><i style={{ transform: `scaleX(${Math.min(1, seconds / 60)})` }} /></span>
    <span>{zone === 'short' ? 'цель 30–45 с' : zone === 'good' ? 'в цели' : 'пора закругляться'}</span>
  </p>;
}

const VOICE_LABEL = { idle: 'Твой ход', listening: 'Слушаю тебя', transcribing: 'Распознаю речь', thinking: 'Готовлю ответ', speaking: 'Собеседник говорит', paused: 'Твой ход' } as const;

/** Active conversation: partner mascot with lip-sync, the partner's line, supports, and the dock. */
export function ConversationView() {
  const app = useApp();
  const lesson = app.lesson;
  const voice = lesson.voice;
  const s = lesson.session!;
  const audioReady = !!app.data.status?.audio.configured;
  const [finishIntent, setFinishIntent] = useState<FinishIntent | null>(null);
  const baseline = !!s.baseline;
  const textActivity = s.lesson.activity === 'reading' || s.lesson.activity === 'writing';
  const last = s.turns.at(-1);
  const lastPartner = s.turns.findLast(turn => turn.role === 'assistant');
  const opening = s.turns.find(turn => turn.role === 'assistant');
  const listening = voice.state === 'listening';
  const waitingReply = !!lesson.busy || !!s.processing;
  const pending = waitingReply || voice.state === 'thinking' || voice.state === 'transcribing';
  const userTurns = s.turns.filter(turn => turn.role === 'user');
  const baselineReplies = s.turns.filter(turn => turn.role === 'user' && turn.source === 'audio' && turn.audioFile && turn.support === 0 && !turn.transcriptEdited && !turn.disputed).length;
  const draft = lesson.draftFor(s.id, 'message');
  // MOTION-PASS-0.5.2 §6: every partner line arrives hidden, in both modes; a reveal applies to that line only.
  // Without a working voice (none configured, or this line's speech failed) the text stands in for it; while the server
  // status is still unknown the line stays hidden behind «Показать текст».
  const shown = (turn: Turn) => !baseline && lesson.partnerTextShown(turn);
  const forced = (turn: Turn) => lesson.partnerTextForced(turn);
  const partnerShown = !!lastPartner && shown(lastPartner);
  const status = listening ? VOICE_LABEL.listening : voice.playingLearnerRecording ? 'Слушаем твою запись' : waitingReply ? (lesson.busy || 'Собеседник готовит ответ') : VOICE_LABEL[voice.state];
  // MASCOT-SPEC §8: an error or a refused action (limits, budget) → sad; his own recording playing → listening.
  const emotion: MascotEmotion | undefined = (s.error || lesson.sessionError) && !waitingReply && !listening ? 'sad' : voice.playingLearnerRecording ? 'listening' : undefined;
  const mascotState = listening ? 'listening' : waitingReply || voice.state === 'transcribing' ? 'thinking' : voice.state === 'paused' ? 'idle' : voice.state;
  const finishReason = !userTurns.length ? 'Сначала ответь хотя бы раз.'
    : listening || voice.state === 'transcribing' ? 'Сначала закончи запись.'
      : voice.hasUnuploadedRecording ? 'Сначала распознай или удали запись.'
        : waitingReply ? 'Подожди ответ собеседника.'
          : baseline && baselineReplies < 2 ? 'Сначала хотя бы два своих ответа голосом.' : null;
  const awaitingPartner = last?.role === 'user' && !waitingReply;
  const showSupports = !baseline && s.mode === 'learning' && !textActivity;
  const showTranscript = !baseline && s.turns.length > 1;
  // Only the line he is about to answer is ever held back in «Весь разговор».
  const current = last?.role === 'assistant' ? last : undefined;
  // Finishing asks only when something unsent would be lost (MOTION-PASS-0.5.2 §8.5).
  const requestFinish = () => { if (draft?.text.trim()) setFinishIntent('finish'); else void lesson.sessionAction('finish'); };

  return <div className={styles.conversation}>
    <FinishDialog intent={finishIntent} textActivity={textActivity}
      onCancel={() => setFinishIntent(null)}
      onSendAndFinish={() => { setFinishIntent(null); void lesson.finishWithDraft('send'); }}
      onDiscardAndConfirm={() => { setFinishIntent(null); void lesson.finishWithDraft('discard'); }} />

    <section className={`surface ${styles.stage}`} data-voice={voice.state} data-enter="" aria-label="Разговор">
      <div className={styles.stageMascot}>
        <Companion state={mascotState} emotion={emotion} micLevelStore={voice.meterStore} speechLevelStore={voice.speechLevelStore} status={status} />
      </div>
      <p className={styles.voiceState} aria-live="polite">{status}{waitingReply && <> · <ElapsedTime startedAt={lesson.busySince ?? (s.processing ? Date.parse(s.processing.startedAt) : null)} /></>}</p>
      {s.lesson.format === 'pitch' && <PitchTimer listening={listening} />}
      {s.lesson.format === 'replay' && s.lesson.seed && <figure className={styles.seed}>
        <figcaption className={styles.label}>Реплика из твоего созвона</figcaption>
        {/* The seed is the partner's opening line: hidden while that line is the one to answer (unless revealed). */}
        {opening && (opening.id !== current?.id || shown(opening)) ? <blockquote key="seed" lang="en" className={styles.revealed}>«{s.lesson.seed}»</blockquote>
          : <p key="seed-hidden" className={styles.seedHidden}>Скрыта, пока ты слушаешь.{opening && !baseline && <> <button type="button" className="text-button" onClick={() => void lesson.revealPartnerText(opening.id)}>Показать текст</button></>}</p>}
      </figure>}
      {lastPartner && !textActivity && <div className={styles.partnerLine}>
        {partnerShown ? <p key={lastPartner.id + ':text'} lang="en" className={`${styles.partnerText} ${styles.revealed}`}>{lastPartner.text}</p>
          : <p key={lastPartner.id + ':hidden'} className={styles.partnerHidden}>Реплика собеседника звучит голосом. Текст можно открыть — это учтётся как опора.</p>}
        <div className={styles.partnerActions}>
          {audioReady && <button type="button" className="button small secondary" disabled={pending || listening}
            onClick={() => voice.state === 'speaking' ? voice.stop() : void voice.speak(s, lastPartner)}>
            {voice.state === 'speaking' && !voice.playingLearnerRecording ? <><SquareIcon size={14} weight="fill" />Стоп</> : <><SpeakerHighIcon size={15} weight="fill" />Ещё раз</>}</button>}
          {!baseline && !forced(lastPartner) && (partnerShown
            ? <button type="button" className="text-button muted" data-testid="hide-partner-text" onClick={() => lesson.hidePartnerText(lastPartner.id)}>Скрыть текст</button>
            : <button type="button" className="button small tinted" data-testid="show-partner-text" onClick={() => void lesson.revealPartnerText(lastPartner.id)}><EyeIcon size={15} />Показать текст</button>)}
        </div>
      </div>}
      {voice.autoplayBlocked && lastPartner && <div className={`banner info ${styles.stageBanner}`}><PlayIcon size={18} weight="fill" /><span className="banner-copy"><span>Браузер ждёт нажатия, чтобы включить звук.</span>
        <span className="banner-actions"><button type="button" className="button small primary" disabled={pending || listening} onClick={() => void voice.speak(s, lastPartner)}>Включить голос</button></span></span></div>}
      {voice.canRetry && !voice.hasUnuploadedRecording && <button type="button" className="button small secondary" disabled={pending || listening} onClick={() => void voice.retry()}><ArrowsClockwiseIcon size={15} />{voice.retryLabel || 'Повторить'}</button>}
    </section>

    {s.lesson.material && <LessonMaterial material={s.lesson.material} />}
    {textActivity && lastPartner && <section className={`surface ${styles.prompt}`} data-enter="" aria-labelledby="prompt-label"><h2 id="prompt-label" className={styles.label}>Собеседник</h2><p lang="en">{lastPartner.text}</p></section>}

    <UnuploadedRecording />
    {awaitingPartner && <div className="banner warning" role="status"><ArrowsClockwiseIcon size={18} /><span className="banner-copy">
      <span>{s.error ? `Собеседник не ответил: ${s.error}` : 'Твоя реплика сохранена, ответ собеседника не пришёл.'}</span>
      <span className="banner-actions"><button type="button" className="button small primary" disabled={pending} onClick={lesson.resend}>Повторить ответ собеседника</button></span></span></div>}

    {(showSupports || showTranscript) && <div className={`surface flat rows ${styles.tools}`} data-enter="">
      {showSupports && <section className={styles.supports} aria-labelledby="supports-title">
        <h2 id="supports-title"><LightbulbIcon size={18} />Подсказка</h2>
        <p className="caption">Сначала попробуй сам — опора учитывается в разборе.</p>
        <div className={styles.hintButtons}>{([1, 2, 3] as const).map(level => <button key={level} type="button" className="button small secondary" aria-pressed={lesson.hintLevel === level}
          disabled={pending || listening} onClick={() => void lesson.hint(level)}>{level === 1 ? 'Намёк' : level === 2 ? 'Конструкция' : 'Пример'}</button>)}</div>
        {lesson.hintText && <p className={styles.hint} lang="en">{lesson.hintText}</p>}
      </section>}
      {/* Opening the whole conversation counts as revealing the line he is about to answer (show-text); a line that
          arrives while it stays open is held back like in the card. */}
      {showTranscript && <details className={styles.transcript}
        onToggle={event => { if (event.currentTarget.open && current && !shown(current)) void lesson.revealPartnerText(current.id); }}>
        <summary><BookOpenTextIcon size={18} />{textActivity ? 'Задание и твои ответы' : 'Весь разговор'}<CaretRightIcon size={14} weight="bold" className={styles.caret} /></summary>
        <Turns turns={s.turns} hidden={turn => !textActivity && turn.id === current?.id && !shown(turn)}
          onReveal={turn => void lesson.revealPartnerText(turn.id)} />
      </details>}
    </div>}

    <div className={styles.dockArea} data-enter="chrome">
      <Dock intent="message" placeholder={s.lesson.activity === 'writing' ? 'Write your text here…' : 'Your reply…'} label={s.lesson.activity === 'writing' ? 'Твой текст по-английски' : 'Твой ответ по-английски'}
        sendLabel="Отправить" onSend={() => void lesson.send()} rows={s.lesson.activity === 'writing' ? 6 : 1}
        showMic={!textActivity}
        micBlockedReason={!audioReady ? (lesson.voiceUnavailable ? 'Голос не подключён — пиши текстом или подключи ключ в профиле.' : 'Проверяю, подключён ли голос…')
          : awaitingPartner ? 'Сначала получи ответ собеседника.' : null}
        inputBlockedReason={last?.role === 'user' ? 'Ждём ответ собеседника на твою реплику.' : null}
        footer={userTurns.length > 0 ? <button type="button" className="text-button" data-testid="request-finish" disabled={!!finishReason} onClick={requestFinish}
          title={finishReason ?? undefined}><CheckIcon size={16} />{CTA.finish}</button> : undefined} />
      {finishReason && userTurns.length > 0 && <p className={`disabled-reason ${styles.finishReason}`}>{finishReason}</p>}
    </div>
  </div>;
}
