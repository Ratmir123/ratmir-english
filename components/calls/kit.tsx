'use client';

/** Small shared UI primitives for the W3 features (placement + calls). */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, PauseIcon, SpeakerHighIcon, XIcon } from '@phosphor-icons/react';
import { api, mediaUrl } from '@/lib/client/api';
import { EASE_OUT, MOTION_MS } from '../ui/motion';
import { useSheetPresence } from '../ui/sheet';
import type { Tone } from './format';
import kit from './kit.module.css';

export function cx(...names: (string | false | null | undefined)[]): string { return names.filter(Boolean).join(' '); }
export function toneClass(tone: Tone): string { return kit[`tone-${tone}`] ?? ''; }

export function Chip({ tone = 'neutral', children, title, icon }: { tone?: Tone; children: ReactNode; title?: string; icon?: ReactNode }) {
  return <span className={cx(kit.chip, toneClass(tone))} title={title}>{icon}{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return <span className={kit.spinner} role={label ? 'status' : undefined} aria-label={label} />;
}

/** Determinate (0–1) or indeterminate (null) progress ring. */
export function ProgressRing({ value, size = 40, stroke = 4, label, children }: { value: number | null; size?: number; stroke?: number; label?: string; children?: ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? 0.28 : Math.max(0, Math.min(1, value));
  return (
    <span style={{ position: 'relative', display: 'inline-grid', placeItems: 'center', width: size, height: size, flexShrink: 0 }}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(clamped * 100)}>
      <svg className={cx(kit.ring, value === null && kit.ringSpin)} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={kit.ringTrack} cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle className={kit.ringValue} cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {children ? <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</span> : null}
    </span>
  );
}

export function ProgressBar({ value, label, tone }: { value: number; label?: string; tone?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={kit.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className={kit.barFill} style={{ '--fill': percent / 100, background: tone } as CSSProperties} />
    </div>
  );
}

export interface SegmentOption<T extends string> { id: T; label: string; badge?: number | null }

/** Tablist with a lens that glides to the selected segment. */
export function Segmented<T extends string>({ value, options, onChange, label, block, idPrefix }: {
  value: T; options: readonly SegmentOption<T>[]; onChange: (next: T) => void; label: string; block?: boolean; idPrefix?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ x: number; width: number } | null>(null);
  const place = useCallback((animate: boolean) => {
    const root = list.current; const pill = lens.current;
    if (!root || !pill) return;
    const active = root.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active) { pill.style.opacity = '0'; return; }
    const x = active.offsetLeft; const width = active.offsetWidth;
    pill.style.opacity = '1';
    pill.style.width = `${width}px`;
    pill.style.transform = `translateX(${x}px)`;
    const before = previous.current; previous.current = { x, width };
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animate && before && before.x !== x && width > 0 && !reduced && typeof pill.animate === 'function') {
      // FLIP: the final width is already set; only transform animates (no layout work per frame).
      pill.animate([
        { transform: `translateX(${before.x}px) scaleX(${before.width / width})` },
        { transform: `translateX(${x}px) scaleX(1)` },
      ], { duration: MOTION_MS.spring, easing: EASE_OUT });
    }
  }, []);
  useLayoutEffect(() => { place(true); }, [value, options.length, place]);
  useEffect(() => {
    const root = list.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => place(false));
    observer.observe(root);
    return () => observer.disconnect();
  }, [place]);
  function onKeyDown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex(option => option.id === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange(options[next].id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  }
  return (
    <div ref={list} role="tablist" aria-label={label} className={cx(kit.segmented, block && kit.segmentedBlock)} onKeyDown={onKeyDown}>
      <span ref={lens} className={kit.lens} aria-hidden="true" />
      {options.map(option => (
        <button key={option.id} type="button" role="tab" id={idPrefix ? `${idPrefix}-tab-${option.id}` : undefined}
          aria-controls={idPrefix ? `${idPrefix}-panel-${option.id}` : undefined}
          aria-selected={option.id === value} tabIndex={option.id === value ? 0 : -1}
          className={kit.segment} onClick={() => onChange(option.id)}>
          {option.label}
          {option.badge ? <span className={kit.segmentBadge}>{option.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Native modal dialog (focus trap, Esc, top layer) styled as a sheet; opens soft and slow, closes faster (0.5.2). */
export function Sheet({ open, onClose, title, children, footer, labelledBy }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const rendered = useSheetPresence(ref, open);
  // The exit keeps the last open content on screen even when the caller has already cleared its data.
  const shown = useRef({ title, children, footer });
  if (open) shown.current = { title, children, footer };
  const view = shown.current;
  return (
    <dialog ref={ref} className={kit.sheet} aria-labelledby={labelledBy ?? titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === ref.current) onClose(); }}>
      {rendered ? (
        <>
          <div className={kit.sheetHead}>
            <h2 id={titleId}>{view.title}</h2>
            <button type="button" className={kit.iconBtn} onClick={onClose} aria-label="Закрыть"><XIcon size={18} weight="bold" /></button>
          </div>
          <div className={kit.sheetBody}>{view.children}</div>
          {view.footer ? <div className={kit.sheetFoot}>{view.footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

export function useInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const timer = setInterval(() => saved.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

/** Copies text; shows "Скопировано" for a moment. */
export function CopyButton({ text, label = 'Скопировать' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(timer);
  }, [state]);
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
      }
      setState('done');
    } catch { setState('error'); }
  }
  return (
    <button type="button" className={cx(kit.btn, kit.secondary, kit.small)} onClick={copy} aria-live="polite">
      {state === 'done' ? <CheckIcon size={16} weight="bold" /> : <CopyIcon size={16} weight="bold" />}
      {state === 'done' ? 'Скопировано' : state === 'error' ? 'Не вышло — выдели вручную' : label}
    </button>
  );
}

/* ───────── TTS for model lines (POST tts {text} → {file} → audio/<file>) ───────── */
const ttsFiles = new Map<string, string>();
let currentAudio: { audio: HTMLAudioElement; stop: () => void } | null = null;
export function stopTts() { currentAudio?.stop(); currentAudio = null; }

export const TTS_MAX_CHARS = 600;

/** ▶︎ button that speaks an English model line. Generated once per text, then cached for the session. */
export function TtsButton({ text, label = 'Послушать', compact }: { text: string; label?: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const mine = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { if (currentAudio && currentAudio.audio === mine.current) stopTts(); }, []);
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > TTS_MAX_CHARS) return null;
  async function toggle() {
    if (state === 'playing') { stopTts(); setState('idle'); return; }
    if (state === 'loading') return;
    stopTts();
    setState('loading');
    try {
      let file = ttsFiles.get(trimmed);
      if (!file) {
        const result = await api<{ file: string }>('tts', { text: trimmed });
        if (!result.file) throw new Error('no file');
        file = result.file; ttsFiles.set(trimmed, file);
      }
      const audio = new Audio(mediaUrl(`audio/${encodeURIComponent(file)}`));
      mine.current = audio;
      const stop = () => { audio.pause(); audio.onended = null; audio.onerror = null; setState('idle'); };
      currentAudio = { audio, stop };
      audio.onended = () => { if (currentAudio?.audio === audio) currentAudio = null; setState('idle'); };
      audio.onerror = () => { if (currentAudio?.audio === audio) currentAudio = null; setState('error'); };
      await audio.play();
      setState('playing');
    } catch { setState('error'); }
  }
  const text2 = state === 'playing' ? 'Стоп' : state === 'loading' ? 'Готовлю голос…' : state === 'error' ? 'Озвучка недоступна' : label;
  return (
    <button type="button" className={cx(compact ? kit.iconBtn : cx(kit.btn, kit.secondary, kit.small))} onClick={toggle}
      aria-label={compact ? text2 : undefined} title={state === 'error' ? 'Проверь голос в Профиле и попробуй ещё раз' : undefined}
      aria-pressed={state === 'playing'}>
      {state === 'loading' ? <Spinner /> : state === 'playing' ? <PauseIcon size={16} weight="fill" /> : <SpeakerHighIcon size={16} weight="fill" />}
      {compact ? null : text2}
    </button>
  );
}

export { kit };
