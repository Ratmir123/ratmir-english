'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, CheckIcon, ClipboardTextIcon, LightningIcon, XIcon } from '@phosphor-icons/react';
import { APP_NAME } from '@/lib/app-info';
import type { DesktopStatus } from './desktop-bridge';
import type { QuickCoachResult as QuickCoachExplanation, QuickCoachRetryResult as QuickCoachAssessment } from '@/lib/server/quick-coach';
import { isAbort, messageOf, request } from './app/api';
import styles from './quick-coach.module.css';

/** «Быстрый разбор» (Ctrl+Alt+E): a phrase from anywhere → meaning → own attempt. Never touches lesson history. */
export function QuickCoach({ onDismiss }: { onDismiss: () => void }) {
  const [source, setSource] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [explanation, setExplanation] = useState<QuickCoachExplanation | null>(null);
  const [assessment, setAssessment] = useState<QuickCoachAssessment | null>(null);
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  const sourceInput = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (!explanation && window.ratmirDesktop) sourceInput.current?.focus({ preventScroll: true }); }, [explanation]);
  useEffect(() => {
    let mounted = true;
    void window.ratmirDesktop?.getStatus().then(status => { if (mounted) setDesktop(status); }).catch(() => undefined);
    return () => { mounted = false; operation.current?.abort(); };
  }, []);

  async function paste() {
    setError('');
    try {
      const text = window.ratmirDesktop ? await window.ratmirDesktop.readClipboard() : await navigator.clipboard.readText();
      if (!text.trim()) { setError('Буфер пуст. Скопируй фразу или вставь её вручную.'); return; }
      setSource(text.slice(0, 6000)); setExplanation(null); setAssessment(null); setAnswer('');
    } catch { setError('Не получилось прочитать буфер. Вставь текст с помощью Ctrl+V.'); }
  }
  async function run<T>(label: string, path: string, payload: unknown, apply: (value: T) => void) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(label); setError('');
    try { apply(await request<T>(path, payload, 'POST', controller.signal)); }
    catch (reason) { if (!isAbort(reason)) setError(messageOf(reason, 'Разбор не получился. Попробуй ещё раз.')); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(''); } }
  }
  const explain = () => { if (source.trim()) void run<QuickCoachExplanation>('Разбираю фразу…', 'quick-coach', { source: source.trim(), question: question.trim() }, value => { setAssessment(null); setExplanation(value); }); };
  const check = () => { if (explanation && answer.trim()) void run<QuickCoachAssessment>('Проверяю попытку…', 'quick-coach/retry', { source: source.trim(), exercise: explanation.practice, userAnswer: answer.trim() }, setAssessment); };
  // Desktop: the main process returns to the training window when the coach was opened from it (audit U-06).
  async function close() { if (window.ratmirDesktop) await window.ratmirDesktop.hideQuick().catch(() => undefined); else onDismiss(); }
  async function openTraining() { if (window.ratmirDesktop) await window.ratmirDesktop.openTraining().catch(() => undefined); else onDismiss(); }

  return <main className={styles.page}>
    <header className={styles.header}>
      <h1><LightningIcon size={24} weight="fill" aria-hidden="true" />Быстрый разбор</h1>
      <button type="button" className="icon-button" onClick={() => void close()} aria-label="Закрыть быстрый разбор"><XIcon size={20} /></button>
    </header>
    <p className="muted">Фраза из видео, статьи или переписки: пойми её и попробуй сам.</p>
    {desktop && <p className="footnote">{desktop.shortcutRegistered ? `${desktop.shortcut} — вызов из любого окна` : 'Горячая клавиша занята. Быстрый разбор доступен из значка в трее.'}</p>}
    <section className={`surface ${styles.card}`}>
      <div className={styles.labelRow}><label htmlFor="quick-source">Что встретилось?</label>
        <button type="button" className="button small secondary" onClick={() => void paste()} disabled={!!busy}><ClipboardTextIcon size={15} />Вставить</button></div>
      <textarea ref={sourceInput} id="quick-source" lang="en" maxLength={6000} rows={4} placeholder="Paste an English phrase or a short passage…" value={source} disabled={!!busy || !!explanation} onChange={event => setSource(event.target.value)} />
      {!explanation && <>
        <label htmlFor="quick-question">Что хочется понять? <span className="footnote">необязательно</span></label>
        <input id="quick-question" maxLength={500} placeholder="Например: почему здесь would?" value={question} disabled={!!busy} onChange={event => setQuestion(event.target.value)} />
        <button type="button" className="button primary large block" disabled={!!busy || !source.trim()} onClick={explain}>{busy || 'Разобрать'}<ArrowRightIcon size={18} /></button>
      </>}
      {explanation && <button type="button" className="text-button muted" disabled={!!busy} onClick={() => { setExplanation(null); setAssessment(null); setAnswer(''); setError(''); }}>Изменить текст</button>}
    </section>
    {error && <p className="banner error" role="alert">{error}</p>}
    {explanation && <>
      <section className={`surface ${styles.card}`} aria-label="Объяснение">
        <div className={styles.resultHead}><h2>{explanation.meaning}</h2>{explanation.focus && <p className="caption">{explanation.focus}</p>}</div><p className={styles.explanation}>{explanation.explanation}</p>
        <div className={styles.examples}>{explanation.examples.map((example, index) => <div key={index}><p lang="en">{example.english}</p><span className="caption">{example.russian}</span></div>)}</div>
        {explanation.limitations.length > 0 && <details><summary>Контекст и ограничения</summary>{explanation.limitations.map((item, index) => <p key={index} className="caption">{item}</p>)}</details>}
      </section>
      <section className={`surface ${styles.card}`}>
        <strong>Твоя короткая попытка</strong><p className="muted">{explanation.practice.instruction}</p>
        <textarea aria-label="Твоя попытка по-английски" lang="en" rows={3} maxLength={2000} value={answer} disabled={!!busy} placeholder="Your own sentence…" onChange={event => { setAnswer(event.target.value); setAssessment(null); }} />
        <button type="button" className="button primary large block" disabled={!!busy || !answer.trim()} onClick={check}>{busy || 'Проверить попытку'}<ArrowRightIcon size={18} /></button>
        {assessment && <div className={styles.feedback} aria-live="polite"><strong>{assessment.success ? <><CheckIcon size={17} weight="bold" />Получилось в этой попытке</> : 'Попробуем точнее'}</strong>
          <p>{assessment.feedback}</p><p lang="en" className={styles.better}>{assessment.correctedExample}</p>
          <small className="caption">Попытка с опорой не подтверждает самостоятельное владение.</small></div>}
      </section>
    </>}
    <footer className={styles.footer}>
      <button type="button" className="text-button" onClick={() => void openTraining()}>Открыть {APP_NAME}<ArrowRightIcon size={15} /></button>
      <p className="footnote">Sol по подписке, запрос только по нажатию. Разбор фразы не попадает в историю и не даёт опыт.</p>
    </footer>
  </main>;
}
