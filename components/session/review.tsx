'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRightIcon, CheckIcon, CircleNotchIcon, PencilSimpleIcon, SpeakerHighIcon, SquareIcon, TargetIcon } from '@phosphor-icons/react';
import type { Analysis, Session } from '@/lib/types';
import { STRATEGY_MOVES } from '@/lib/strategy-moves';
import { mediaUrl } from '@/lib/client/api';
import { practiceResult } from '@/lib/progression';
import { useApp } from '../app/app-context';
import { request, messageOf } from '../app/api';
import { CTA, shortDate, skillLabel } from '../app/labels';
import { Companion, type MascotEmotion } from '../shell/companion';
import { SpeechTimingPanel } from '../speech-timing';
import { ElapsedTime } from '../ui/elapsed';
import { Dock } from './dock';
import { EditConfirmDialog, FinishDialog, type FinishIntent } from './dialogs';
import { LessonMaterial } from './conversation';
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
  return <div className={styles.hits} aria-label="Паттерны в этом занятии">{hits.map((hit, index) => <span key={index} className={`chip ${hit.outcome === 'repeated' ? 'warning' : 'lime'}`} title={hit.quote}>
    {HIT_LABEL[hit.outcome]}: {title(hit.patternId)}</span>)}</div>;
}

/** v0.5 analysis extras: strategy moves (lib/strategy-moves labels), language errors that matter, debatable moments. */
function AnalysisDetails({ analysis }: { analysis: Analysis }) {
  const moves = (analysis.strategyMoves ?? []).filter(move => move.score !== null);
  const errors = (analysis.languageErrors ?? []).filter(error => error.impact !== 'minor');
  const debatable = (analysis.debatable ?? []).slice(0, 2);
  return <>
    {moves.length > 0 && <section className={`card solid ${styles.details}`} aria-labelledby="review-moves">
      <h3 id="review-moves">Ходы разговора</h3>
      <ul className={styles.moves}>{moves.map(move => {
        const meta = STRATEGY_MOVES.find(item => item.id === move.id);
        const score = move.score ?? 0;
        return <li key={move.id} data-score={score}>
          <span className={styles.moveMark} aria-hidden="true">{score >= 2 ? '✓' : score === 1 ? '◐' : '✕'}</span>
          <span className={styles.moveCopy}><strong>{meta?.title ?? move.id}</strong><small>{score >= 2 ? meta?.good : score === 1 ? 'Частично' : meta?.bad}</small>
            {move.quote && <q lang="en">{move.quote}</q>}</span>
          <span className="visually-hidden">{score >= 2 ? 'получилось' : score === 1 ? 'частично' : 'не получилось'}</span>
        </li>;
      })}</ul>
    </section>}
    {(errors.length > 0 || !!analysis.minorErrorsIgnored) && <section className={`card solid ${styles.details}`} aria-labelledby="review-language">
      <h3 id="review-language">Английский</h3>
      {errors.length > 0 && <ul className={styles.errors}>{errors.map((error, index) => <li key={index}>
        <span className={styles.errorPair}><s lang="en">{error.quote}</s><span aria-hidden="true">→</span><strong lang="en">{error.correction}</strong></span>
        <span className={`chip ${error.impact === 'meaning' ? 'warning' : 'violet'}`}>{IMPACT_LABEL[error.impact]}</span>
      </li>)}</ul>}
      {!!analysis.minorErrorsIgnored && <p className="caption">Мелких неточностей не трогаем: {analysis.minorErrorsIgnored}. Они не мешают смыслу.</p>}
    </section>}
    {debatable.length > 0 && <section className={`card solid ${styles.details}`} aria-labelledby="review-debatable">
      <h3 id="review-debatable">Спорные моменты</h3>
      {debatable.map((item, index) => <div key={index} className={styles.debatable}>
        <strong>{item.title}</strong>{item.quote && <blockquote lang="en" className={styles.quote}>{item.quote}</blockquote>}
        <p><span className="chip lime">За</span> {item.forSide}</p><p><span className="chip warning">Против</span> {item.againstSide}</p>
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
  return <section className={`glass ${styles.waiting}`} aria-labelledby="analysis-title">
    <div className={styles.waitingMascot}><Companion state="thinking" status="Готовлю разбор" /></div>
    <h2 id="analysis-title">Разбираю твою попытку</h2>
    <p aria-live="polite" className="muted">{text}</p>
    <ElapsedTime startedAt={Number.isFinite(started) ? started : null} className="caption" />
    {!textActivity && lastPartner && <div className={`glass flat ${styles.recall}`}>
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
  return <section className={`glass ${styles.outcome}`} data-testid="session-outcome" aria-labelledby={`outcome-${session.id}`}>
    <div className={styles.outcomeMascot}><Companion emotion={fresh ? 'love' : 'proud'} celebrate={celebrate} celebrateEmotion="love" status="Занятие сохранено" /></div>
    <div className={styles.outcomeCopy}>
      <span className="eyebrow">{session.retryDeferred ? 'Сохранено на потом' : 'Занятие завершено'}</span>
      <h2 id={`outcome-${session.id}`}>{session.retryDeferred ? 'Новую попытку сделаешь позже.' : result?.improvedRetry ? 'Твоя мысль стала сильнее.' : 'Ещё одна практика за плечами.'}</h2>
      {result && <div className={styles.outcomeFacts}>
        <span className="chip lime">+{result.xp} XP</span>
        <span className="chip glassy">Навыков с наблюдениями: {Math.min(result.quality.observedTargets, result.quality.targetCount)} из {result.quality.targetCount}</span>
        {result.quality.independentSuccesses > 0 && <span className="chip glassy">Самостоятельно: {result.quality.independentSuccesses}</span>}
      </div>}
      <div className={styles.outcomeActions}>
        <button type="button" className="button primary" onClick={() => app.go('practice')}>Выбрать следующую практику<ArrowRightIcon size={17} /></button>
        <button type="button" className="text-button muted" onClick={() => app.go('today')}>На сегодня всё</button>
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

function Aside({ session }: { session: Session }) {
  const { lesson, data } = useApp();
  const a = session.analysis!;
  const [editing, setEditing] = useState<string | null>(null);
  const busy = !!lesson.busy || lesson.voice.state === 'listening' || lesson.voice.state === 'transcribing';
  return <aside className={styles.aside} aria-label="Детали разбора">
    <section className={`card solid ${styles.asideCard}`}><h3>Следующий шаг</h3><p>{a.nextFocus}</p><span className="caption">{shortDate(a.createdAt)}</span></section>
    {a.evidence.length > 0 && <details className={`card solid ${styles.asideCard}`}><summary>Наблюдения по навыкам · {a.evidence.length}</summary>
      <ul className={styles.observations}>{a.evidence.map((item, index) => <li key={index}><strong>{skillLabel(item.skill)}</strong>
        <span className={`chip ${item.result === 'success' ? 'lime' : item.result === 'difficulty' ? 'warning' : ''}`}>{item.result === 'success' ? 'Получилось' : item.result === 'partial' ? 'Частично' : item.result === 'difficulty' ? 'Есть трудность' : item.result === 'disputed' ? 'Спорно' : 'Не проверено'}</span>
        <p className="caption">{item.reason}</p></li>)}</ul></details>}
    <details className={`card solid ${styles.asideCard}`}><summary>Ограничения оценки</summary>
      {a.limitations.map((value, index) => <p key={index} className="caption">{value}</p>)}
      <p className="caption">Произношение и акцент по тексту не оцениваются.</p>
      {!!a.dropped && <p className="caption">Неточных пунктов отброшено при проверке: {a.dropped}.</p>}
    </details>
    <details className={`card solid ${styles.asideCard}`}><summary>{session.lesson.material ? 'Задание и ответы' : 'Исходный разговор'}</summary>
      {session.lesson.material && <LessonMaterial material={session.lesson.material} />}
      <ol className={styles.turns}>{session.turns.map(turn => <li key={turn.id} data-role={turn.role}>
        <span className="eyebrow">{turn.role === 'user' ? 'Ты' : 'Собеседник'}{turn.disputed ? ' · исключено' : turn.transcriptEdited ? ' · исправлено' : ''}</span>
        <p lang="en">{turn.text}</p>
        {turn.audioFile && <audio controls preload="none" src={mediaUrl('audio/' + encodeURIComponent(turn.audioFile))} />}
        {turn.role === 'user' && editing !== turn.id && <button type="button" className="text-button" disabled={busy || !!editing || data.state === null} onClick={() => setEditing(turn.id)}><PencilSimpleIcon size={15} />Исправить расшифровку</button>}
        {editing === turn.id && <TurnEditor session={session} turnId={turn.id} original={turn.text} onDone={() => setEditing(null)} />}
      </li>)}</ol>
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
  const retryDraft = lesson.draftFor(s.id, 'retry');
  const blockedReason = capturing ? 'Сначала закончи запись.' : voice.hasUnuploadedRecording ? 'Сначала распознай или удали запись.' : lesson.busy ? 'Подожди, идёт действие.' : null;
  const emotion: MascotEmotion = hasImprovedRetry || s.status === 'completed' ? 'proud' : a.priorities.length ? 'curious' : 'happy';
  const headline = hasImprovedRetry ? 'Вот, уже сильнее.' : s.retryDeferred ? 'Осталась одна попытка.' : !a.priorities.length ? 'Разбор готов.' : textActivity ? 'Сделаем твой ответ сильнее.' : 'Сделаем одну реплику сильнее.';
  const doComplete = (defer: boolean) => void lesson.sessionAction('complete', { ...(lesson.comfort ? { comfort: lesson.comfort } : {}), ...(defer ? { deferRetry: true } : {}) });

  return <div className={styles.reviewLayout}>
    <FinishDialog intent={finishIntent} textActivity={textActivity} hasDraft={!!retryDraft?.text.trim()}
      onCancel={() => setFinishIntent(null)}
      onConfirm={() => { const intent = finishIntent; setFinishIntent(null); doComplete(intent === 'defer'); }}
      onSendAndFinish={() => setFinishIntent(null)}
      onDiscardAndConfirm={() => { const intent = finishIntent; setFinishIntent(null); lesson.discardDraft(); doComplete(intent === 'defer'); }} />
    <div className={styles.reviewMain}>
      {s.status === 'completed' && <Outcome session={s} />}
      <section className={`glass ${styles.intro}`} aria-labelledby="review-title">
        {/* A completed lesson already has its outcome card with the mascot: no second headline or mascot (audit U-30). */}
        {s.status === 'completed' ? <h2 id="review-title" className="eyebrow">Разбор</h2> : <div className={styles.introHead}>
          <div className={styles.introMascot}><Companion emotion={emotion} celebrate={celebrate} celebrateEmotion="joy" confetti={false} status={hasImprovedRetry ? 'Улучшение подтверждено' : 'Разбор готов'} /></div>
          <div><span className="eyebrow">{s.retryDeferred ? 'Попытка на потом' : hasImprovedRetry ? 'Есть улучшение' : 'Твой разбор'}</span><h2 id="review-title" className="title-28">{headline}</h2></div>
        </div>}
        {a.outcome && a.outcome.achieved !== 'n/a' && <div className={styles.outcomeLine} data-achieved={a.outcome.achieved}>
          <span className={`chip ${a.outcome.achieved === 'yes' ? 'lime' : a.outcome.achieved === 'partly' ? 'violet' : 'warning'}`}>{OUTCOME_LABEL[a.outcome.achieved]}</span><span>{a.outcome.what}</span></div>}
        <p className={styles.summary}>{a.summary}</p>
        {a.strengths.length > 0 && <ul className={styles.strengths}>{a.strengths.map((value, index) => <li key={index}><CheckIcon size={16} weight="bold" />{value}</li>)}</ul>}
        <PatternHits analysis={a} />
      </section>

      {a.priorities.map((priority, index) => <section key={index} className={`card solid reveal ${styles.priority}`} style={{ '--i': index } as CSSProperties}>
        <div className={styles.priorityHead}><span className={styles.priorityNumber}>{index + 1}</span><span className="chip violet">{priority.type === 'language' ? 'Английский' : 'Разговор'}</span>
          {priority.patternId && app.data.state?.patterns?.find(pattern => pattern.id === priority.patternId) && <span className="chip lime">Паттерн: {app.data.state.patterns.find(pattern => pattern.id === priority.patternId)!.title}</span>}</div>
        <h3>{priority.title}</h3>
        <blockquote lang="en" className={styles.quote}>{priority.quote}</blockquote>
        <p>{priority.explanation}</p>
        <details className={styles.example}><summary>Возможная формулировка</summary>
          <div className={styles.exampleBody}><p lang="en">{priority.example}</p>
            {audioReady && <button type="button" className="icon-button" onClick={() => void audio.play(`p${index}`, priority.example, message => lesson.setSessionError(message))} aria-label="Послушать формулировку">
              {audio.state.key === `p${index}` ? audio.state.status === 'loading' ? <CircleNotchIcon size={18} className={styles.spin} /> : <SquareIcon size={15} weight="fill" /> : <SpeakerHighIcon size={18} weight="fill" />}</button>}</div>
          <small>Один из вариантов. Свою попытку формулируй своими словами.</small></details>
        <div className={styles.nextTry}><TargetIcon size={17} /><span><strong>Твоя следующая попытка:</strong> {priority.retryInstruction}</span></div>
      </section>)}

      {s.retries.map((retry, index) => {
        const id = retry.id ?? String(index);
        const pushbackOpen = retry.improved === true && retry.pushback;
        return <section key={id} className={`card solid ${styles.retry}`} data-improved={retry.improved === true} data-glow={lesson.glowRetryId === id}>
          <span className="eyebrow">Попытка {index + 1} · {retry.improved === true ? 'есть улучшение' : 'продолжаем'}</span>
          <blockquote lang="en" className={styles.quote}>{retry.text}</blockquote>
          {retry.audioFile && <audio controls preload="none" src={mediaUrl('audio/' + encodeURIComponent(retry.audioFile))} />}
          <p className={styles.feedback}>{retry.feedback}</p>
          {pushbackOpen && <PushbackRound retry={retry} retryId={id} />}
        </section>;
      })}

      {showDock && <section className={`glass flat ${styles.retryPrompt}`}>
        <span className="eyebrow">{needsRetry ? 'Следующий шаг' : 'По желанию'}</span>
        <h3>Теперь твоя версия</h3>
        <p className="caption">{textActivity ? 'Вырази мысль заново — сравню с исходной попыткой.' : 'Скажи важный момент своими словами — сравню с исходной попыткой.'}</p>
      </section>}
      <UnuploadedRecording />

      {s.status === 'review' && <section className={`glass flat ${styles.finish}`} aria-label="Завершение">
        <div className={styles.comfort} role="radiogroup" aria-label="Как ощущалось занятие: от 1 (сложно) до 5 (комфортно)">
          <span className="caption">Как ощущалось?</span>
          {[1, 2, 3, 4, 5].map(value => <button key={value} type="button" role="radio" aria-checked={lesson.comfort === value} className={styles.comfortItem} onClick={() => lesson.setComfort(value)}>{value}</button>)}
          <span className="caption">сложно → комфортно</span>
        </div>
        {completion.canComplete && <div className={styles.finishActions}>
          <button type="button" className="button primary large" data-testid="request-complete" disabled={!!blockedReason} onClick={() => setFinishIntent('complete')}>{CTA.complete}<CheckIcon size={18} /></button>
          {blockedReason && <span className="disabled-reason">{blockedReason}</span>}
          {retryAllowed && !needsRetry && !optionalRetry && <button type="button" className="text-button" onClick={() => setOptionalRetry(true)}>Попробовать ещё раз (по желанию)</button>}
        </div>}
        {needsRetry && <div className={styles.finishActions}>
          <p className="caption">{completion.reason}</p>
          <button type="button" className="text-button muted" data-testid="request-defer" disabled={!!blockedReason} onClick={() => setFinishIntent('defer')}>{CTA.defer} — вернусь к попытке позже</button>
        </div>}
      </section>}
      <AnalysisDetails analysis={a} />
      <SpeechTimingPanel session={s} />
      <p className="footnote">Произношение и акцент по тексту не оцениваются.</p>
      {showDock && <div className={styles.dockArea}>
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
  return <div className="banner error" role="alert">
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
  return <p className="caption" role="status"><CircleNotchIcon size={14} className={styles.spin} /> {lesson.busy}… <ElapsedTime startedAt={lesson.busySince} /></p>;
}
