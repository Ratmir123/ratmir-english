'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { CircleNotchIcon, MicrophoneIcon, PaperPlaneRightIcon, SquareIcon, XIcon } from '@phosphor-icons/react';
import { useApp } from '../app/app-context';
import type { DraftIntent } from '../app/use-drafts';
import { LiveCaptions } from '../live-captions';
import { RecordingEvidence } from './recording-panels';
import { usePushToTalk } from './use-push-to-talk';
import styles from './session.module.css';

/**
 * Big round mic that morphs into Stop. Its ring follows the live microphone level without React renders, drawn with
 * transform + opacity on its own layer behind the button (no box-shadow repaint per level step).
 */
export function MicButton({ contextKey, disabled, size = 'large', testId = 'record-toggle' }: { contextKey: string; disabled: boolean; size?: 'large' | 'small'; testId?: string }) {
  const { lesson } = useApp();
  const voice = lesson.voice;
  const ring = useRef<HTMLSpanElement>(null);
  const listening = voice.state === 'listening';
  const working = voice.state === 'transcribing' || (voice.state === 'thinking' && !lesson.busy);
  const state = listening ? 'listening' : working ? 'working' : 'idle';
  useEffect(() => {
    const element = ring.current;
    if (!element) return;
    if (!listening) { element.style.removeProperty('transform'); return; }
    const store = voice.meterStore;
    const diameter = size === 'large' ? 56 : 44;
    let frame = 0;
    // 3–17 px of ring around the button, as before, now as a scale of the ring layer.
    const paint = () => { frame = 0; element.style.transform = `scale(${(1 + (6 + store.getSnapshot() * 28) / diameter).toFixed(3)})`; };
    paint();
    const unsubscribe = store.subscribe(() => { if (!frame) frame = requestAnimationFrame(paint); });
    return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame); };
  }, [listening, voice.meterStore, size]);
  return <span className={styles.micWrap} data-size={size} data-state={state}>
    <span ref={ring} className={styles.micRing} aria-hidden="true" />
    <button type="button" className={styles.mic} data-size={size} data-state={state} data-testid={testId}
      disabled={!listening && disabled} onClick={() => void voice.record(contextKey)} aria-label={listening ? 'Закончить запись' : working ? 'Распознаю запись' : 'Говорить'}>
      {listening ? <SquareIcon size={size === 'large' ? 22 : 16} weight="fill" /> : working ? <CircleNotchIcon size={size === 'large' ? 24 : 18} className={styles.spin} /> : <MicrophoneIcon size={size === 'large' ? 26 : 18} weight="fill" />}
    </button>
  </span>;
}

function AutoTextarea({ value, onChange, disabled, placeholder, label, onSubmit, rows = 1, id }: {
  value: string; onChange: (value: string) => void; disabled: boolean; placeholder: string; label: string; onSubmit: () => void; rows?: number; id: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    const max = rows > 2 ? 320 : 180;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight + 2, max)}px`;
    element.style.overflowY = element.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [value, rows]);
  return <textarea ref={ref} id={id} className={styles.field} lang="en" rows={rows} aria-label={label} placeholder={placeholder} value={value} disabled={disabled}
    onChange={event => onChange(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSubmit(); } }} />;
}

/**
 * Sticky bottom glass dock (DESIGN-SYSTEM Session): mic, auto-growing field, send. One dock per screen;
 * push-to-talk (hold Space) drives its mic. Disabled actions always say why.
 */
export function Dock({ intent, retryId, placeholder, label, sendLabel, onSend, showMic, micBlockedReason, inputBlockedReason, rows = 1, footer, testId = 'session-dock' }: {
  intent: DraftIntent; retryId?: string; placeholder: string; label: string; sendLabel: string; onSend: () => void;
  showMic: boolean; micBlockedReason: string | null; inputBlockedReason: string | null; rows?: number; footer?: ReactNode; testId?: string;
}) {
  const app = useApp();
  const lesson = app.lesson;
  const voice = lesson.voice;
  const session = lesson.session!;
  const draft = lesson.draftFor(session.id, intent, retryId);
  const value = draft?.text ?? '';
  const contextKey = `${session.id}:${intent}${retryId ? ':' + retryId : ''}`;
  const listening = voice.state === 'listening';
  const pending = !!lesson.busy || !!session.processing || voice.state === 'thinking' || voice.state === 'transcribing';
  const capturing = listening || voice.state === 'transcribing';
  const sendReason = capturing ? 'Сначала закончи запись.' : voice.hasUnuploadedRecording ? 'Сначала распознай или удали запись.'
    : inputBlockedReason ?? (lesson.busy || session.processing ? 'Подожди, идёт ответ.' : null);
  const canSend = !sendReason && !pending && !!value.trim();
  const micDisabled = !!micBlockedReason || pending || voice.hasUnuploadedRecording || !!draft?.audioFile;
  usePushToTalk({ enabled: showMic && !micDisabled, state: voice.state, toggle: () => void voice.record(contextKey) });
  const submit = () => { if (canSend) { voice.stop(); onSend(); } };
  const desktop = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  return <div className={`glass ${styles.dock}`} data-testid={testId} data-listening={listening}>
    {/* Mounted with the dock: it opens at full height when this composer records and only its own view re-renders per word. */}
    {showMic && <LiveCaptions store={voice.transcriptStore} contextKey={contextKey} />}
    <RecordingEvidence intent={intent} retryId={retryId} />
    {lesson.sessionError && <div className={styles.dockError} role="alert"><span>{lesson.sessionError}</span>
      <button type="button" className="icon-button plain" style={{ width: 32, height: 32 }} onClick={() => lesson.setSessionError('')} aria-label="Скрыть ошибку"><XIcon size={14} /></button></div>}
    <div className={styles.dockRow}>
      {showMic && <MicButton contextKey={contextKey} disabled={micDisabled} />}
      <label className="visually-hidden" htmlFor={`dock-${session.id}-${intent}`}>{label}</label>
      <AutoTextarea id={`dock-${session.id}-${intent}`} value={value} rows={rows} label={label} placeholder={listening ? 'Говори — слова появятся выше…' : placeholder}
        disabled={capturing || pending || !!inputBlockedReason} onChange={text => lesson.changeDraft(intent, text, retryId)} onSubmit={submit} />
      <button type="button" className={`button primary ${styles.send}`} data-testid="send-draft" disabled={!canSend} onClick={submit} aria-label={sendLabel}>
        <span className={styles.sendText}>{sendLabel}</span><PaperPlaneRightIcon size={18} weight="fill" />
      </button>
    </div>
    <div className={styles.dockMeta}>
      {sendReason ? <span className="disabled-reason">{sendReason}</span>
        : showMic && micBlockedReason ? <span className="disabled-reason">{micBlockedReason}</span>
          : <span>{showMic && desktop ? 'Удерживай пробел — говори · ' : ''}{desktop ? 'Ctrl+Enter — отправить' : 'Черновик сохраняется'}</span>}
      {footer}
    </div>
  </div>;
}
