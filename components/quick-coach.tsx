'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardText, BookOpen, X } from '@phosphor-icons/react';
import type { DesktopStatus } from './desktop-bridge';
import type { QuickCoachResult as QuickCoachExplanation, QuickCoachRetryResult as QuickCoachAssessment } from '@/lib/server/quick-coach';
import styles from './quick-coach.module.css';

async function coachRequest<T>(path: string, payload: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось получить разбор. Попробуй ещё раз.');
  return result;
}

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
  useEffect(() => {
    if (!explanation && window.ratmirDesktop) sourceInput.current?.focus({ preventScroll: true });
  }, [explanation]);
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
      setSource(text.slice(0, 6000));
      setExplanation(null); setAssessment(null); setAnswer('');
    } catch { setError('Не получилось прочитать буфер. Вставь текст с помощью Ctrl+V.'); }
  }

  async function explain() {
    if (operation.current || !source.trim()) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy('Разбираю фразу…'); setError(''); setAssessment(null);
    try { setExplanation(await coachRequest<QuickCoachExplanation>('quick-coach', { source: source.trim(), question: question.trim() }, controller.signal)); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Разбор не получился.'); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(''); } }
  }

  async function check() {
    if (operation.current || !explanation || !answer.trim()) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy('Проверяю твою попытку…'); setError('');
    try { setAssessment(await coachRequest<QuickCoachAssessment>('quick-coach/retry', { source: source.trim(), exercise: explanation.practice, userAnswer: answer.trim() }, controller.signal)); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Проверка не получилась.'); }
    finally { if (operation.current === controller) { operation.current = null; setBusy(''); } }
  }

  async function openTraining() {
    if (window.ratmirDesktop) await window.ratmirDesktop.openTraining();
    else onDismiss();
  }

  async function close() {
    if (window.ratmirDesktop) await window.ratmirDesktop.hideQuick();
    else onDismiss();
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><span className={styles.eyebrow}>RATMIR ENGLISH</span><h1>Разобрать сейчас</h1></div><button type="button" className={styles.close} onClick={() => void close()} aria-label="Закрыть быстрый разбор"><X size={20} /></button></header>
    <p className={styles.intro}>Фраза из видео, статьи или переписки. Пойми её и попробуй сам.</p>
    {desktop && <p className={styles.shortcut}>{desktop.shortcutRegistered ? `${desktop.shortcut} · вызов из любого окна` : 'Горячая клавиша занята. Быстрый разбор доступен через трей.'}</p>}
    <section className={styles.source}>
      <div className={styles.labelRow}><label htmlFor="quick-source">Что встретилось?</label><button type="button" onClick={() => void paste()} disabled={!!busy}><ClipboardText size={16} />Вставить</button></div>
      <textarea ref={sourceInput} id="quick-source" lang="en" maxLength={6000} rows={4} placeholder="Paste an English phrase or a short passage…" value={source} disabled={!!busy || !!explanation} onChange={event => setSource(event.target.value)} />
      {!explanation && <><label className={styles.questionLabel} htmlFor="quick-question">Что хочется понять? <span>Необязательно</span></label><input id="quick-question" maxLength={500} placeholder="Например: почему здесь would?" value={question} disabled={!!busy} onChange={event => setQuestion(event.target.value)} /><button type="button" className={styles.primary} disabled={!!busy || !source.trim()} onClick={() => void explain()}>{busy || 'Разобрать с Sol'}<ArrowRight size={18} /></button></>}
      {explanation && <button className={styles.textButton} disabled={!!busy} onClick={() => { setExplanation(null); setAssessment(null); setAnswer(''); setError(''); }}>Изменить текст</button>}
    </section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {explanation && <>
      <section className={styles.result} aria-label="Объяснение"><span className={styles.eyebrow}>{explanation.focus}</span><h2>{explanation.meaning}</h2><p>{explanation.explanation}</p><div className={styles.examples}>{explanation.examples.map((example, index) => <div key={index}><p lang="en">{example.english}</p><span>{example.russian}</span></div>)}</div>{explanation.limitations.length > 0 && <details><summary>Контекст и ограничения</summary>{explanation.limitations.map((item, index) => <p key={index}>{item}</p>)}</details>}</section>
      <section className={styles.practice}><span className={styles.practiceLabel}><BookOpen size={17} />Твоя короткая попытка</span><p>{explanation.practice.instruction}</p><textarea aria-label="Твоя попытка по-английски" lang="en" rows={3} maxLength={2000} value={answer} disabled={!!busy} placeholder="Your own sentence…" onChange={event => { setAnswer(event.target.value); setAssessment(null); }} /><button type="button" className={styles.primary} disabled={!!busy || !answer.trim()} onClick={() => void check()}>{busy || 'Проверить попытку'}<ArrowRight size={18} /></button>{assessment && <div className={styles.feedback} aria-live="polite"><strong>{assessment.success ? <><Check size={17} />Получилось в этой попытке</> : 'Попробуем точнее'}</strong><p>{assessment.feedback}</p><p lang="en">{assessment.correctedExample}</p><small>Эта попытка с опорой не подтверждает самостоятельное владение.</small></div>}</section>
    </>}
    <footer className={styles.footer}><button type="button" className={styles.textButton} onClick={() => void openTraining()}>Открыть полный тренинг <ArrowRight size={15} /></button><p>Sol по подписке · запрос только после нажатия. Разбор фразы пока не добавляет XP и не сохраняется в историю.</p></footer>
  </main>;
}
