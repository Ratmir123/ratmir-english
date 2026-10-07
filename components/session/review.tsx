'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRightIcon, ArrowsClockwiseIcon, CaretRightIcon, CheckCircleIcon, CheckIcon, CircleHalfIcon, CircleNotchIcon, PencilSimpleIcon, PhoneCallIcon,
  SpeakerHighIcon, SquareIcon, TargetIcon, WarningCircleIcon, XIcon,
} from '@phosphor-icons/react';
import type { Analysis, Session } from '@/lib/types';
import type { LessonPlanV05 } from '@/lib/training';
import { PREP_COPY } from '@/lib/preps/types';
import { STRATEGY_MOVES } from '@/lib/strategy-moves';
import { mediaUrl } from '@/lib/client/api';
import { practiceResult } from '@/lib/progression';
import { useApp } from '../app/app-context';
import { request, messageOf } from '../app/api';
import { CTA, shortDate, skillLabel } from '../app/labels';
import { Companion, type MascotEmotion } from '../shell/companion';
import { PhraseResults } from '../phrases/phrase-results';
import { SpeechTimingPanel } from '../speech-timing';
import { ElapsedTime } from '../ui/elapsed';
import { Dock } from './dock';
import { EditConfirmDialog, FinishDialog, type FinishIntent } from './dialogs';
import { LessonMaterial, Turns } from './conversation';
import { PushbackRound } from './pushback';
import { UnuploadedRecording } from './recording-panels';
import styles from './session.module.css';

/** Plays a model line through POST /api/tts — only on an explicit tap (it spends the voice budget). */
function useLineAudio() {
  const [state, setState] = useState<{ key: string | null; status: 'idle' | 'loading' | 'playing' }>({ key: null, status: 'idle' });
  const player = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, string>());
  useEffect(() => () => { player.current?.pause(); player.current = null; }, []);
  const stop = () => { player.current?.pause(); player.current = null; setState({ key: null, status: 'idle' }); };
  const play = async (key: string, text: string, onError: (message: string) => void) => {
    if (state.key === key && state.status !== 'idle') { stop(); return; }
    stop(); setState({ key, status: 'loading' });
    try {
      let file = cache.current.get(text);
      if (!file) { file = (await request<{ file: string }>('tts', { text: text.slice(0, 600) })).file; cache.current.set(text, file); }
      const element = new Audio(mediaUrl('audio/' + encodeURIComponent(file)));
      player.current = element;
      element.onended = () => { if (player.current === element) stop(); };
      await element.play();
      setState({ key, status: 'playing' });
    } catch (error) { setState({ key: null, status: 'idle' }); onError(messageOf(error, 'Озвучка недоступна.')); }
  };
  return { state, play };
}

const OUTCOME_LABEL = { yes: 'Цель достигнута', partly: 'Цель достигнута частично', no: 'Цель пока не достигнута', 'n/a': 'Без отдельной цели' } as const;
const HIT_LABEL = { repeated: 'Повторилось', avoided: 'Избежал', improved: 'Лучше', 'no-opportunity': 'Не было повода' } as const;
const IMPACT_LABEL = { meaning: 'Меняет смысл', seniority: 'Звучит слабее', minor: 'Мелочь' } as const;

function PatternHits({ analysis }: { analysis: Analysis }) {
  const { data } = useApp();
  const hits = (analysis.patternHits ?? []).filter(hit => hit.outcome !== 'no-opportunity');
  if (!hits.length) return null;
  const title = (id: string) => data.state?.patterns?.find(pattern => pattern.id === id)?.title ?? id;
  return <ul className={styles.hits} aria-label="Паттерны в этом занятии">{hits.map((hit, index) => <li key={index} data-outcome={hit.outcome} title={hit.quote}>
    {hit.outcome === 'repeated' ? <WarningCircleIcon size={17} weight="fill" /> : <CheckCircleIcon size={17} weight="fill" />}
    <span><strong>{HIT_LABEL[hit.outcome]}:</strong> {title(hit.patternId)}</span></li>)}</ul>;
}

/** v0.5 analysis extras: strategy moves (lib/strategy-moves labels), language errors that matter, debatable moments. */
function AnalysisDetails({ analysis }: { analysis: Analysis }) {
  const moves = (analysis.strategyMoves ?? []).filter(move => move.score !== null);
  const errors = (analysis.languageErrors ?? []).filter(error => error.impact !== 'minor');
  const debatable = (analysis.debatable ?? []).slice(0, 2);
  return <>
    {moves.length > 0 && <section className={`surface ${styles.details}`} data-enter="" aria-labelledby="review-moves">
      <h3 id="review-moves">Ходы разговора</h3>
      <ul className={styles.moves}>{moves.map(move => {
        const meta = STRATEGY_MOVES.find(item => item.id === move.id);
        const score = move.score ?? 0;
        return <li key={move.id} data-score={score}>
          <span className={styles.moveMark} aria-hidden="true">{score >= 2 ? <CheckIcon size={14} weight="bold" /> : score === 1 ? <CircleHalfIcon size={14} weight="fill" /> : <XIcon size={13} weight="bold" />}</span>
          <span className={styles.moveCopy}><strong>{meta?.title ?? move.id}</strong><small>{score >= 2 ? meta?.good : score === 1 ? 'Частично' : meta?.bad}</small>
            {move.quote && <q lang="en">{move.quote}</q>}</span>
          <span className="visually-hidden">{score >= 2 ? 'получилось' : score === 1 ? 'частично' : 'не получилось'}</span>
        </li>;
      })}</ul>
    </section>}
    {(errors.length > 0 || !!analysis.minorErrorsIgnored) && <section className={`surface ${styles.details}`} data-enter="" aria-labelledby="review-language">
      <h3 id="review-language">Английский</h3>
      {errors.length > 0 && <ul className={styles.errors}>{errors.map((error, index) => <li key={index}>
        <span className={styles.errorPair}><s lang="en">{error.quote}</s><ArrowRightIcon size={14} aria-hidden="true" /><span className="visually-hidden">лучше:</span><strong lang="en">{error.correction}</strong></span>
        <span className={styles.impact} data-impact={error.impact}>{IMPACT_LABEL[error.impact]}</span>
      </li>)}</ul>}
      {!!analysis.minorErrorsIgnored && <p className="caption">Мелких неточностей не трогаем: {analysis.minorErrorsIgnored}. Они не мешают смыслу.</p>}
    </section>}
    {debatable.length > 0 && <section className={`surface ${styles.details}`} data-enter="" aria-labelledby="review-debatable">
      <h3 id="review-debatable">Спорные моменты</h3>
      {debatable.map((item, index) => <div key={index} className={styles.debatable}>
        <strong>{item.title}</strong>{item.quote && <blockquote lang="en" className={styles.quote}>{item.quote}</blockquote>}
        <p><strong className={styles.forSide}>За:</strong> {item.forSide}</p><p><strong className={styles.againstSide}>Против:</strong> {item.againstSide}</p>
        <p className={styles.verdict}>{item.verdict}</p>
      </div>)}
    </section>}
  </>;
}

export function AnalysisWaiting() {
  const app = useApp();
  const s = app.lesson.session!;
  const [reveal, setReveal] = useState(false);
  const textActivity = s.lesson.activity === 'reading' || s.lesson.activity === 'writing';
  const lastPartner = s.turns.findLast(turn => turn.role === 'assistant');
  const stage = s.processing?.stage;
  const text = stage === 'queued' ? 'Разбор в очереди. Твои ответы сохранены.' : stage === 'evaluating' ? 'Сравниваю реплики и выбираю ближайшую правку.'
    : stage === 'waiting-retry' ? 'Сервис задержал разбор — попробую ещё раз сам.' : 'Проверяю смысл, английский и то, как ты использовал слова собеседника.';
  const started = Date.parse(s.processing?.startedAt || s.updatedAt);
  return <section className={`surface ${styles.waiting}`} data-enter="" aria-labelledby="analysis-title">
    <div className={styles.waitingMascot}><Companion state="thinking" status="Готовлю разбор" /></div>
    <h2 id="analysis-title">Разбираю твою попытку</h2>
    <p aria-live="polite" className="muted">{text}</p>
    <ElapsedTime startedAt={Number.isFinite(started) ? started : null} className="caption" />
    {!textActivity && lastPartner && <div className={styles.recall}>
      <strong>Пока ждём</strong><p className="caption">Что было важно собеседнику? Вспомни одну конкретную деталь.</p>
      <button type="button" className="button small secondary" onClick={() => setReveal(value => !value)}>{reveal ? 'Скрыть' : 'Проверить себя'}</button>
      {reveal && <p lang="en">{lastPartner.text}</p>}
    </div>}
    <p className="caption">Можно уйти — готовый разбор придёт сюда, а на главной появится отметка.</p>
    <button type="button" className="button secondary" onClick={() => app.nav.closeSession()}>Вернусь позже</button>
  </section>;
}

function Outcome({ session }: { session: Session }) {
  const app = useApp();
  const result = app.data.state?.progression?.recentResults.find(item => item.sessionId === session.id) ?? practiceResult(session);
  const fresh = app.lesson.lastCompletedId === session.id && !session.retryDeferred;
  const [celebrate] = useState(() => fresh ? 1 : 0);
  return <section className={`surface ${styles.outcome}`} data-enter="" data-testid="session-outcome" aria-labelledby={`outcome-${session.id}`}>
    <div className={styles.outcomeMascot}><Companion emotion={fresh ? 'love' : 'proud'} celebrate={celebrate} celebrateEmotion="love" status="Занятие сохранено" /></div>
    <div className={styles.outcomeCopy}>
      <h2 id={`outcome-${session.id}`}>{session.retryDeferred ? 'Новую попытку сделаешь позже.' : result?.improvedRetry ? 'Твоя мысль стала сильнее.' : 'Ещё одна практика за плечами.'}</h2>
      <p className={styles.outcomeFacts}>
        <span>{session.retryDeferred ? 'Сохранено на потом' : 'Занятие завершено'}</span>
        {result && <><span className={styles.xp}>+{result.xp} XP</span>
          <span>Навыков с наблюдениями: {Math.min(result.quality.observedTargets, result.quality.targetCount)} из {result.quality.targetCount}</span>
          {result.quality.independentSuccesses > 0 && <span>Самостоятельно: {result.quality.independentSuccesses}</span>}</>}
      </p>
      {/* MOTION-PASS-0.5.2 §8.5: right after finishing, «Следующий шаг» leads to Сегодня (the plan picks it up there);
          a finished lesson opened later is simply left with «На главную». One action each, never both to the same place. */}
      <div className={styles.outcomeActions}>
        {fresh ? <button type="button" className="button primary" data-testid="outcome-next" onClick={() => app.go('today')}>{CTA.next}<ArrowRightIcon size={17} /></button>
          : <button type="button" className="button secondary" data-testid="outcome-home" onClick={() => app.go('today')}>{CTA.home}</button>}
      </div>
    </div>
  </section>;
}

function TurnEditor({ session, turnId, original, onDone }: { session: Session; turnId: string; original: string; onDone: () => void }) {
  const { lesson } = useApp();
  const [text, setText] = useState(original);
  const [confirm, setConfirm] = useState<null | { disputed: boolean }>(null);
  const [saving, setSaving] = useState(false);
  const improved = session.retries.filter(retry => retry.improved === true).length;
  return <div className={styles.editor}>
    <textarea className={styles.field} rows={3} lang="en" value={text} onChange={event => setText(event.target.value)} aria-label="Исправленная расшифровка" disabled={saving} />
    <div className={styles.editorActions}>
      <button type="button" className="button small primary" disabled={saving || !text.trim() || text.trim() === original.trim()} onClick={() => setConfirm({ disputed: false })}>Сохранить и пересчитать</button>
      <button type="button" className="button small secondary" disabled={saving || !text.trim()} onClick={() => setConfirm({ disputed: true })}>Исключить как спорное</button>
      <button type="button" className="text-button muted" disabled={saving} onClick={onDone}>Отмена</button>
      {saving && <CircleNotchIcon size={18} className={styles.spin} />}
    </div>
    <EditConfirmDialog open={!!confirm} disputed={!!confirm?.disputed} retries={improved || session.retries.length} completed={session.status === 'completed'}
      onCancel={() => setConfirm(null)}
      onConfirm={async () => {
        const disputed = !!confirm?.disputed; setConfirm(null); setSaving(true);
        // The editor stays open until the server accepted the correction (audit C-09).
        const next = await lesson.sessionAction('edit', { turnId, text: text.trim(), disputed });
        setSaving(false);
        if (next) onDone();
      }} />
  </div>;
}

/** Review details as one surface with hairline-separated blocks (no card per block). */
function Aside({ session }: { session: Session }) {
  const { lesson, data } = useApp();
  const a = session.analysis!;
  const [editing, setEditing] = useState<string | null>(null);
  const busy = !!lesson.busy || lesson.voice.state === 'listening' || lesson.voice.state === 'transcribing';
  const caret = <CaretRightIcon size={14} weight="bold" className={styles.caret} />;
  return <aside className={`surface ${styles.aside}`} data-enter="" aria-label="Детали разбора">
    <section className={styles.asideBlock}><h3>Над чем работать дальше</h3><p>{a.nextFocus}</p><span className="caption">{shortDate(a.createdAt)}</span></section>
    {a.evidence.length > 0 && <details className={styles.asideBlock}><summary>Наблюдения по навыкам · {a.evidence.length}{caret}</summary>
      <ul className={styles.observations}>{a.evidence.map((item, index) => <li key={index}><strong>{skillLabel(item.skill)}</strong>
        <span className={styles.observation} data-result={item.result}>{item.result === 'success' ? 'Получилось' : item.result === 'partial' ? 'Частично' : item.result === 'difficulty' ? 'Есть трудность' : item.result === 'disputed' ? 'Спорно' : 'Не проверено'}</span>
        <p className="caption">{item.reason}</p></li>)}</ul></details>}
    <details className={styles.asideBlock}><summary>Ограничения оценки{caret}</summary>
      {a.limitations.map((value, index) => <p key={index} className="caption">{value}</p>)}
      <p className="caption">Произношение и акцент по тексту не оцениваются.</p>
      {!!a.dropped && <p className="caption">Неточных пунктов отброшено при проверке: {a.dropped}.</p>}
    </details>
    <details className={styles.asideBlock}><summary>{session.lesson.material ? 'Задание и ответы' : 'Исходный разговор'}{caret}</summary>
      {session.lesson.material && <LessonMaterial material={session.lesson.material} embedded />}
      <Turns turns={session.turns} note={turn => turn.disputed ? ' · исключено' : turn.transcriptEdited ? ' · исправлено' : ''} extra={turn => <>
        {turn.audioFile && <audio controls preload="none" src={mediaUrl('audio/' + encodeURIComponent(turn.audioFile))} />}
        {turn.role === 'user' && editing !== turn.id && <button type="button" className="text-button" disabled={busy || !!editing || data.state === null} onClick={() => setEditing(turn.id)}><PencilSimpleIcon size={15} />Исправить расшифровку</button>}
        {editing === turn.id && <TurnEditor session={session} turnId={turn.id} original={turn.text} onDone={() => setEditing(null)} />}
      </>} />
    </details>
  </aside>;
}

export function ReviewView() {
  const app = useApp();
  const lesson = app.lesson;
  const voice = lesson.voice;
  const s = lesson.session!;
  const a = s.analysis!;
  const audio = useLineAudio();
  const [finishIntent, setFinishIntent] = useState<FinishIntent | null>(null);
  const [optionalRetry, setOptionalRetry] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  useEffect(() => { if (lesson.glowRetryId) setCelebrate(value => value + 1); }, [lesson.glowRetryId]);
  const textActivity = s.lesson.activity === 'reading' || s.lesson.activity === 'writing';
  const hasImprovedRetry = s.retries.some(retry => retry.improved === true && !!retry.text.trim() && (retry.analysisVersion === undefined || retry.analysisVersion === a.version))
    && (!s.completion || (s.completion.canComplete && !s.completion.needsRetry));
  const completion = s.completion ?? { canComplete: !a.priorities.length || hasImprovedRetry, needsRetry: !!a.priorities.length && !hasImprovedRetry, reason: 'Попробуй выразить мысль заново или отложи попытку на потом.' };
  const retryAllowed = s.status === 'review' || (s.status === 'completed' && !!s.retryDeferred);
  const needsRetry = retryAllowed && completion.needsRetry;
  const showDock = retryAllowed && (needsRetry || optionalRetry);
  const audioReady = !!app.data.status?.audio.configured;
  const capturing = voice.state === 'listening' || voice.state === 'transcribing';
  // Any unsent attempt (or a reply left over from the conversation) would be lost by finishing; a pushback draft is not.
  const unsentDraft = lesson.draftFor(s.id, 'retry') ?? lesson.draftFor(s.id, 'message');
  const blockedReason = capturing ? 'Сначала закончи запись.' : voice.hasUnuploadedRecording ? 'Сначала распознай или удали запись.' : lesson.busy ? 'Подожди, идёт действие.' : null;
  const emotion: MascotEmotion = hasImprovedRetry || s.status === 'completed' ? 'proud' : a.priorities.length ? 'curious' : 'happy';
  const headline = hasImprovedRetry ? 'Вот, уже сильнее.' : s.retryDeferred ? 'Осталась одна попытка.' : !a.priorities.length ? 'Разбор готов.' : textActivity ? 'Сделаем твой ответ сильнее.' : 'Сделаем одну реплику сильнее.';
  const doComplete = (defer: boolean) => void lesson.sessionAction('complete', { ...(lesson.comfort ? { comfort: lesson.comfort } : {}), ...(defer ? { deferRetry: true } : {}) });
  // MOTION-PASS-0.5.2 §8.5: confirm only when an unsent draft would be lost; otherwise finish / park at once.
  const requestComplete = (intent: 'complete' | 'defer') => { if (unsentDraft?.text.trim()) setFinishIntent(intent); else doComplete(intent === 'defer'); };
  const patternTitle = (id?: string | null) => id ? app.data.state?.patterns?.find(pattern => pattern.id === id)?.title : undefined;
  // 0.5.5: a rehearsal of a call prep links back to the prep, where «Перед звонком помни» collects this review.
  const prepId = (s.lesson as LessonPlanV05).prepId ?? null;

  return <div className={styles.reviewLayout}>
    <FinishDialog intent={finishIntent} textActivity={textActivity}
      onCancel={() => setFinishIntent(null)}
      onDiscardAndConfirm={() => { const intent = finishIntent; setFinishIntent(null); lesson.discardDraft(); doComplete(intent === 'defer'); }} />
    <div className={styles.reviewMain}>
      {prepId && <div className={`surface flat ${styles.prepBanner}`} data-enter="" data-testid="review-prep">
        <PhoneCallIcon size={20} aria-hidden="true" />
        <span><strong>{PREP_COPY.rehearsalOf}</strong> · главное на звонок собрано в подготовке, сверху.</span>
        <button type="button" className="button small secondary" onClick={() => app.go('calls', { prepId })}>{PREP_COPY.backToPrep}</button>
      </div>}
      {s.status === 'completed' && <Outcome session={s} />}
      <section className={`surface ${styles.intro}`} data-enter="" aria-labelledby="review-title">
        {/* A completed lesson already has its outcome card with the mascot: no second headline or mascot (audit U-30). */}
        {s.status === 'completed' ? <h2 id="review-title" className={styles.blockTitle}>Разбор</h2> : <div className={styles.introHead}>
          <div className={styles.introMascot}><Companion emotion={emotion} celebrate={celebrate} celebrateEmotion="joy" confetti={false} status={hasImprovedRetry ? 'Улучшение подтверждено' : 'Разбор готов'} /></div>
          <h2 id="review-title" className="title-28">{headline}</h2>
        </div>}
        {a.outcome && a.outcome.achieved !== 'n/a' && <p className={styles.outcomeLine} data-achieved={a.outcome.achieved}>
          <span className={`chip ${a.outcome.achieved === 'yes' ? 'lime' : a.outcome.achieved === 'partly' ? 'violet' : 'warning'}`}>{OUTCOME_LABEL[a.outcome.achieved]}</span><span>{a.outcome.what}</span></p>}
        <p className={styles.summary}>{a.summary}</p>
        {a.strengths.length > 0 && <ul className={styles.strengths}>{a.strengths.map((value, index) => <li key={index}><CheckIcon size={16} weight="bold" />{value}</li>)}</ul>}
        <PatternHits analysis={a} />
      </section>
      <PhraseResults session={s} />

      {a.priorities.map((priority, index) => {
        const pattern = patternTitle(priority.patternId);
        return <section key={index} className={`surface ${styles.priority}`} data-enter="" aria-labelledby={`priority-${index}`}>
          <div className={styles.priorityHead}>
            <span className={styles.priorityNumber} aria-hidden="true">{index + 1}</span>
            <div className={styles.priorityTitle}><h3 id={`priority-${index}`}>{priority.title}</h3>
              <p className="caption">{priority.type === 'language' ? 'Английский' : 'Разговор'}{pattern ? ` · паттерн «${pattern}»` : ''}</p></div>
          </div>
          <blockquote lang="en" className={styles.quote}>{priority.quote}</blockquote>
          <p>{priority.explanation}</p>
          <details className={styles.example}><summary>Возможная формулировка<CaretRightIcon size={14} weight="bold" className={styles.caret} /></summary>
            <div className={styles.exampleBody}><p lang="en">{priority.example}</p>
              {audioReady && <button type="button" className="icon-button" onClick={() => void audio.play(`p${index}`, priority.example, message => lesson.setSessionError(message))} aria-label="Послушать формулировку">
                {audio.state.key === `p${index}` ? audio.state.status === 'loading' ? <CircleNotchIcon size={18} className={styles.spin} /> : <SquareIcon size={15} weight="fill" /> : <SpeakerHighIcon size={18} weight="fill" />}</button>}</div>
            <small>Один из вариантов. Свою попытку формулируй своими словами.</small></details>
          <p className={styles.nextTry}><TargetIcon size={18} /><span><strong>Твоя следующая попытка:</strong> {priority.retryInstruction}</span></p>
        </section>;
      })}

      {s.retries.map((retry, index) => {
        const id = retry.id ?? String(index);
        const improved = retry.improved === true;
        const pushbackOpen = improved && retry.pushback;
        return <section key={id} className={`surface ${styles.retry}`} data-improved={improved} data-glow={lesson.glowRetryId === id} data-enter="" aria-labelledby={`retry-${id}`}>
          <div className={styles.retryHead}>
            {improved ? <CheckCircleIcon size={20} weight="fill" /> : <ArrowsClockwiseIcon size={19} />}
            <h3 id={`retry-${id}`}>Попытка {index + 1}</h3>
            <span className="caption">{improved ? 'есть улучшение' : 'пока без улучшения'}</span>
          </div>
          <blockquote lang="en" className={styles.quote}>{retry.text}</blockquote>
          {retry.audioFile && <audio controls preload="none" src={mediaUrl('audio/' + encodeURIComponent(retry.audioFile))} />}
          <p className={styles.feedback}>{retry.feedback}</p>
          {pushbackOpen && <PushbackRound retry={retry} retryId={id} />}
        </section>;
      })}

      {showDock && <div className={styles.retryPrompt} data-enter="">
        <h3>Теперь твоя версия{needsRetry ? '' : <span> · по желанию</span>}</h3>
        <p className="caption">{textActivity ? 'Вырази мысль заново — сравню с исходной попыткой.' : 'Скажи важный момент своими словами — сравню с исходной попыткой.'}</p>
      </div>}
      <UnuploadedRecording />

      {s.status === 'review' && <section className={`surface ${styles.finish}`} data-enter="" aria-label="Завершение">
        <div className={styles.comfort} role="radiogroup" aria-label="Как ощущалось занятие: от 1 (сложно) до 5 (комфортно)">
          <span className={styles.comfortLabel} aria-hidden="true">Как ощущалось занятие?</span>
          <div className={styles.comfortScale}>
            <span className="caption" aria-hidden="true">сложно</span>
            {[1, 2, 3, 4, 5].map(value => <button key={value} type="button" role="radio" aria-checked={lesson.comfort === value} className={styles.comfortItem} onClick={() => lesson.setComfort(value)}>{value}</button>)}
            <span className="caption" aria-hidden="true">комфортно</span>
          </div>
        </div>
        {completion.canComplete && <div className={styles.finishActions}>
          <button type="button" className="button primary large" data-testid="request-complete" disabled={!!blockedReason} onClick={() => requestComplete('complete')}>{CTA.complete}<CheckIcon size={18} /></button>
          {blockedReason && <span className="disabled-reason">{blockedReason}</span>}
          {retryAllowed && !needsRetry && !optionalRetry && <button type="button" className="text-button" onClick={() => setOptionalRetry(true)}>Попробовать ещё раз (по желанию)</button>}
        </div>}
        {needsRetry && <div className={styles.finishActions}>
          <p className="caption">{completion.reason}</p>
          <button type="button" className="text-button muted" data-testid="request-defer" disabled={!!blockedReason} onClick={() => requestComplete('defer')}>{CTA.defer}</button>
        </div>}
      </section>}
      <AnalysisDetails analysis={a} />
      <SpeechTimingPanel session={s} />
      <p className="footnote" data-enter="">Произношение и акцент по тексту не оцениваются.</p>
      {showDock && <div className={styles.dockArea} data-enter="chrome">
        <Dock intent="retry" placeholder="My improved reply…" label="Твоя улучшенная попытка" sendLabel={CTA.retry}
          onSend={() => void lesson.sessionAction('retry', {}, document.querySelector('[data-testid="session-dock"]'))}
          rows={s.lesson.activity === 'writing' ? 6 : 1} showMic={audioReady && s.lesson.activity !== 'writing'}
          micBlockedReason={null} inputBlockedReason={null} />
      </div>}
    </div>
    <Aside session={s} />
  </div>;
}

export function ErrorBanner() {
  const app = useApp();
  const lesson = app.lesson;
  const s = lesson.session!;
  const [confirm, setConfirm] = useState(false);
  if (s.status !== 'error') return null;
  const retryCount = s.retries.length;
  return <div className="banner error" role="alert" data-enter="">
    <WarningCircleIcon size={18} weight="fill" />
    <span className="banner-copy">
      <strong>{s.analysis ? 'Пересчитать разбор не получилось' : 'Разбор не получился'}</strong>
      <span>{s.error || 'Ответы сохранены. Попробуй ещё раз.'}</span>
      <span className="banner-actions">
        <button type="button" className="button small primary" disabled={!!lesson.busy}
          onClick={() => s.analysis && retryCount > 0 ? setConfirm(true) : void lesson.sessionAction(s.analysis ? 'reanalyse' : 'finish')}>
          {lesson.busy ? <CircleNotchIcon size={15} className={styles.spin} /> : null}{CTA.reanalyse}</button>
      </span>
    </span>
    <EditConfirmDialog open={confirm} disputed={false} retries={retryCount} completed={false} reanalyse onCancel={() => setConfirm(false)}
      onConfirm={() => { setConfirm(false); void lesson.sessionAction('reanalyse'); }} />
  </div>;
}

export function ProcessingNote() {
  const { lesson } = useApp();
  const s = lesson.session!;
  if (!lesson.busy || s.status === 'active') return null;
  return <p className={`caption ${styles.processing}`} role="status"><CircleNotchIcon size={14} className={styles.spin} /> {lesson.busy}… <ElapsedTime startedAt={lesson.busySince} /></p>;
}
