'use client';

/*
 * The capture card «Запомнить» (planning/v05/PASS-0.5.3.md §1.6), one component for every place it lives:
 * - pet: the bubble of the PC chubrik that lives on the screen (0.5.4, pet-stage.tsx) — the chubrik is the stage's own, so the
 *   card has none and flies saved text into the one it is given (`companion`);
 * - overlay: the floating bubble above the chubrik in the 0.5.3 shell's transparent window (capture-overlay.tsx);
 * - panel: the same card on an opaque page (older desktop shells' framed quick window, a plain browser);
 * - sheet: inside the in-app sheet (`CaptureSheet` below) — the sheet is the surface, so no bubble of its own;
 * - inline: the field on top of «Мои фразы» — no companion; saved phrases show up in the list underneath.
 * Enter saves, Shift+Enter starts a new line; Esc belongs to the owner (overlay window, dialog). With `listen` the card also
 * offers «Послушать» (PASS-0.5.4 §1.4) and shows its recording, transcript and explanation (listen-view.tsx).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ArrowRightIcon, ClipboardTextIcon, EarIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { PHRASE_TEXT_LIMIT, type SavedPhrase } from '@/lib/phrases/types';
import { enrichmentProblem, headlineIsEnglish, phraseHeadline, shortcutHint, upsertPhrase } from '@/lib/phrases/labels';
import { useApp } from '../app/app-context';
import { Companion, type MascotEmotion, type MascotHandle } from '../shell/companion';
import { prefersReducedMotion } from '../ui/motion';
import { useSheetPresence } from '../ui/sheet';
import { useCapture, useDesktopStatus, type Capture, type CaptureSaved } from './use-capture';
import { LISTEN_COPY, useListen, type Listen } from './use-listen';
import { ListenView } from './listen-view';
import styles from './capture-card.module.css';

export type CaptureVariant = 'pet' | 'overlay' | 'panel' | 'sheet' | 'inline';

const MASCOT_SIZE: Record<Exclude<CaptureVariant, 'inline' | 'pet'>, number> = { overlay: 112, panel: 112, sheet: 92 };
const PLACEHOLDER = 'Фраза из видео или «как сказать …»';

type Point = { x: number; y: number };
/** The saved text on its way into the companion; `from` in viewport coordinates. */
type Flight = { key: number; text: string; from: Point };

/** curious idle, listening while he types, thinking while it saves and Sol works, happy when done (wink: already saved). */
export function captureEmotion(capture: Capture): MascotEmotion {
  const saved = capture.saved;
  if (!saved) return capture.error ? 'sad' : capture.text.trim() ? 'listening' : 'curious';
  const phrase = saved.phrase;
  if (!phrase) return 'thinking';
  if (saved.duplicate) return 'wink';
  if (phrase.enrichment === 'pending') return saved.slow ? 'happy' : 'thinking';
  return phrase.enrichment === 'failed' ? 'curious' : 'happy';
}

/** One line for screen readers about what just happened. */
function announcement(capture: Capture, inline: boolean): string {
  const saved = capture.saved;
  if (capture.notice) return capture.notice;
  if (!saved) return '';
  if (saved.duplicate) return 'Эта фраза уже в копилке';
  const phrase = saved.phrase;
  if (inline || !phrase) return 'Запомнил! Повторим в разговорах';
  if (phrase.enrichment === 'ready' && phrase.phrase) return `Готово: ${phrase.phrase}${phrase.meaning ? ` — ${phrase.meaning}` : ''}`;
  if (phrase.enrichment === 'failed') return enrichmentProblem(phrase);
  return saved.slow ? 'Разбор появится в «Моих фразах»' : 'Запомнил! Повторим в разговорах. Разбираю…';
}

const firstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? text.trim();

/** What Sol found (or is still looking for). */
function Found({ saved }: { saved: CaptureSaved }) {
  const phrase = saved.phrase;
  if (!phrase || (phrase.enrichment === 'pending' && !saved.slow)) {
    return <div className={styles.found} data-state="working">
      <p className={styles.savedText}>{phrase ? phraseHeadline(phrase) : saved.text}</p>
      <p className={styles.working}><span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>Разбираю…</p>
    </div>;
  }
  if (phrase.enrichment === 'pending') {
    return <div className={styles.found} data-state="later">
      <p className={styles.savedText}>{phraseHeadline(phrase)}</p>
      <p className="caption">Разбор появится в «Моих фразах».</p>
    </div>;
  }
  if (phrase.enrichment === 'failed' || !phrase.phrase?.trim()) {
    return <div className={styles.found} data-state="failed">
      <p className={styles.phrase} lang={headlineIsEnglish(phrase) ? 'en' : undefined}>{phraseHeadline(phrase)}</p>
      <p className="caption">{phrase.note?.trim() || 'Разбор не получился. Повторить его можно в «Моих фразах».'}</p>
    </div>;
  }
  return <div className={styles.found} data-state="ready">
    <p className={styles.phrase} lang="en">{phrase.phrase.trim()}</p>
    {phrase.meaning && <p className={styles.meaning}>{phrase.meaning}</p>}
    {phrase.example && <p className={styles.example} lang="en">{phrase.example}</p>}
    {phrase.exampleRu && <p className={styles.translation}>{phrase.exampleRu}</p>}
  </div>;
}

export function CaptureCard({ capture, variant, hint, listen, companion: external, onOpenPhrases, onClose, onDuplicate, fieldRef, headingId: givenHeadingId, className }: {
  capture: Capture;
  variant: CaptureVariant;
  /** «Послушать» (PASS-0.5.4 §1.4): offered on the form; its states replace the card's content while it is busy or done. */
  listen?: Listen | null;
  /** 'pet': the stage's own chubrik (the saved text flies into it, it hops). */
  companion?: { box: RefObject<HTMLElement | null>; handle: RefObject<MascotHandle | null> };
  /** The PC shortcut line (`shortcutHint`). */
  hint?: string | null;
  /** «Мои фразы» after a save. */
  onOpenPhrases?: () => void;
  /** × on the bubble (overlay, panel). */
  onClose?: () => void;
  /** Inline field: the text was already saved (the list can open that phrase). */
  onDuplicate?: (phrase: SavedPhrase) => void;
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  headingId?: string;
  className?: string;
}) {
  const ownHeadingId = useId();
  const headingId = givenHeadingId ?? ownHeadingId;
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const mascotBox = useRef<HTMLDivElement>(null);
  const mascot = useRef<MascotHandle>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const again = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const inline = variant === 'inline';
  const companion = !inline && variant !== 'pet';
  const bubble = variant === 'overlay' || variant === 'panel' || variant === 'pet';
  const greet = () => (mascot.current ?? external?.handle.current)?.greet();
  const saved = capture.saved;
  const showSaved = !inline && !!saved;
  const setField = useCallback((node: HTMLTextAreaElement | null) => {
    field.current = node;
    if (fieldRef) fieldRef.current = node;
  }, [fieldRef]);

  const submit = () => {
    if (!capture.canSave) return;
    const from = field.current?.getBoundingClientRect();
    const text = firstLine(capture.text);
    if (!capture.save() || (!companion && !external)) return;
    // The text chip flies from where the text was into the companion, which hops when it lands; reduced motion: just the
    // happy face. Viewport coordinates: the card itself moves when its content switches (bottom-anchored overlay, a
    // re-centred sheet), so the target is measured after the switch.
    if (from && from.width > 0 && !prefersReducedMotion()) {
      setFlight({ key: Date.now(), text, from: { x: from.left + Math.min(from.width / 2, 150), y: from.top + Math.min(from.height / 2, 34) } });
    } else greet();
  };

  useLayoutEffect(() => {
    const element = chip.current;
    const target = (mascotBox.current ?? external?.box.current)?.getBoundingClientRect();
    if (!flight || !element) return;
    if (!target || !target.width) { setFlight(null); greet(); return; }
    const { from } = flight;
    const to = { x: target.left + target.width / 2, y: target.top + target.height * 0.46 };
    const mid = { x: from.x + (to.x - from.x) * 0.55, y: Math.min(from.y, to.y) - 26 };
    const at = (point: Point, scale: number) => `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) scale(${scale})`;
    const animation = element.animate([
      { transform: at(from, 0.96), opacity: 0 },
      { transform: at(from, 1), opacity: 1, offset: 0.14 },
      { transform: at(mid, 0.78), opacity: 1, offset: 0.58 },
      { transform: at(to, 0.22), opacity: 0 },
    ], { duration: 640, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'both' });
    const hop = window.setTimeout(greet, 430);
    animation.onfinish = () => setFlight(current => current === flight ? null : current);
    return () => { window.clearTimeout(hop); animation.cancel(); };
  }, [flight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard flow: after a save the focus lands on «Ещё одну» (Enter again = the next phrase); a failed save returns it to
  // the field, where the text is back.
  const savedTicket = showSaved ? saved?.ticket : undefined;
  useEffect(() => {
    if (savedTicket === undefined) return;
    const active = document.activeElement;
    if (!active || active === document.body || root.current?.contains(active)) again.current?.focus({ preventScroll: true });
  }, [savedTicket]);
  const error = capture.error;
  useEffect(() => {
    if (!error) return;
    const active = document.activeElement;
    if (!active || active === document.body || root.current?.contains(active)) field.current?.focus({ preventScroll: true });
  }, [error]);

  const duplicate = inline && saved?.duplicate && saved.phrase ? saved.phrase : null;
  useEffect(() => { if (duplicate) onDuplicate?.(duplicate); }, [duplicate?.id, saved?.ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  const another = () => {
    capture.reset();
    requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
  };
  const paste = async () => {
    const element = field.current;
    const selection = element ? { start: element.selectionStart, end: element.selectionEnd } : null;
    const caret = await capture.paste(selection);
    if (caret === null || !element) return;
    requestAnimationFrame(() => { element.focus({ preventScroll: true }); element.setSelectionRange(caret, caret); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const inlineStatus = inline && saved && !capture.text ? (saved.duplicate ? 'Эта фраза уже в копилке' : 'Запомнил! Повторим в разговорах') : '';
  const listening = !!listen && listen.phase !== 'idle';
  const content = listening && listen
    ? <ListenView listen={listen} headingId={headingId} onOpenPhrases={onOpenPhrases} />
    : showSaved && saved
    ? <div className={styles.result} data-testid="capture-saved">
      <div className={styles.resultHead}>
        <h2 id={headingId} className={styles.title}>{saved.duplicate ? 'Эта фраза уже в копилке' : 'Запомнил!'}</h2>
        {!saved.duplicate && <p className={styles.sub}>Повторим в разговорах</p>}
      </div>
      <Found saved={saved} />
      <div className={styles.after}>
        <button ref={again} type="button" className="button secondary small" onClick={another} data-testid="capture-again">
          <PlusIcon size={16} aria-hidden="true" />Ещё одну</button>
        {onOpenPhrases && <button type="button" className="text-button" onClick={onOpenPhrases} data-testid="capture-open-phrases">
          Мои фразы<ArrowRightIcon size={15} aria-hidden="true" /></button>}
      </div>
    </div>
    : <div className={styles.form}>
      <h2 id={headingId} className={inline ? 'visually-hidden' : styles.title}>Что запомним?</h2>
      <textarea ref={setField} className={styles.field} rows={inline ? 2 : 3} maxLength={PHRASE_TEXT_LIMIT} placeholder={PLACEHOLDER}
        aria-labelledby={headingId} aria-describedby={hint && !inline ? hintId : undefined} aria-invalid={!!capture.error || undefined}
        value={capture.text} onChange={event => capture.setText(event.target.value)} onKeyDown={onKeyDown}
        autoComplete="off" enterKeyHint="done" data-testid="capture-field" />
      <div className={styles.actions}>
        <button type="button" className="button small secondary" onClick={() => void paste()} data-testid="capture-paste">
          <ClipboardTextIcon size={16} aria-hidden="true" />Вставить</button>
        {listen && <button type="button" className="button small secondary" onClick={() => void listen.start()} title={LISTEN_COPY[listen.source].hint}
          data-testid="listen-start"><EarIcon size={16} aria-hidden="true" />{LISTEN_COPY[listen.source].action}</button>}
        <button type="button" className={`button primary ${inline ? 'small' : ''} ${styles.save}`} onClick={submit} disabled={!capture.canSave}
          data-testid="capture-save">Запомнить</button>
      </div>
      {capture.error && <p className={styles.error} role="alert">{capture.error}</p>}
      {(capture.notice || inlineStatus) && <p className={styles.notice} aria-hidden="true" data-tone={inlineStatus && !capture.notice ? 'done' : undefined}>
        {capture.notice || inlineStatus}</p>}
      {hint && !inline && <p className="footnote" id={hintId}>{hint}</p>}
    </div>;

  return <div ref={root} className={`${styles.card} ${className ?? ''}`} data-variant={variant} data-view={listening ? 'listen' : showSaved ? 'saved' : 'editing'}>
    {companion && <div ref={mascotBox} className={styles.mascot} data-part="mascot">
      <Companion state={listen?.phase === 'recording' ? 'listening' : 'idle'} micLevelStore={listen?.phase === 'recording' ? listen.levelStore : undefined}
        emotion={listening && listen?.phase !== 'recording' ? listenEmotion(listen!) : captureEmotion(capture)}
        size={MASCOT_SIZE[variant as Exclude<CaptureVariant, 'inline' | 'pet'>]} handleRef={mascot} decorative exclusive={false} />
    </div>}
    <div className={styles.bubbleWrap} data-part="bubble">
      <div className={styles.bubble}>
        {bubble && onClose && <button type="button" className={`icon-button plain ${styles.close}`} onClick={onClose} aria-label="Закрыть">
          <XIcon size={18} aria-hidden="true" /></button>}
        {content}
      </div>
      {bubble && <span className={styles.tail} aria-hidden="true" />}
    </div>
    <p className="visually-hidden" role="status" aria-live="polite">{listening ? '' : announcement(capture, inline)}</p>
    {flight && <span key={flight.key} ref={chip} className={styles.flight} aria-hidden="true">{flight.text}</span>}
  </div>;
}

/** The companion while «Послушать» works: listening (by its state), thinking, happy with a result, sad on a failure. */
export function listenEmotion(listen: Listen): MascotEmotion | undefined {
  if (listen.phase === 'uploading' || listen.phase === 'analyzing' || listen.phase === 'starting') return 'thinking';
  if (listen.phase === 'ready') return listen.clip?.phrases.some(item => !item.duplicate) ? 'happy' : 'curious';
  if (listen.phase === 'failed') return 'sad';
  return undefined;
}

/**
 * «Запомнить» inside the app (Practice «Мои фразы», the web without the desktop shell): the card in a sheet. Saved phrases go
 * straight into the app state, so «Мои фразы» shows them (and their enrichment) at once.
 */
export function CaptureSheet({ open, onClose, onOpenPhrases }: { open: boolean; onClose: () => void; onOpenPhrases: () => void }) {
  const app = useApp();
  const setState = app.data.setState;
  const status = useDesktopStatus();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const headingId = useId();
  const rendered = useSheetPresence(dialog, open);
  const capture = useCapture({ onPhrase: phrase => setState(previous => previous ? { ...previous, phrases: upsertPhrase(previous.phrases, phrase) } : previous) });
  // «Послушать»: the computer's sound inside a 0.5.4 shell, the microphone in a plain browser; older shells offer none.
  const listenSource = status?.systemAudio ? 'system' : 'microphone';
  const listen = useListen({ source: listenSource, origin: status ? 'desktop' : 'web',
    onPhrase: phrase => setState(previous => previous ? { ...previous, phrases: upsertPhrase(previous.phrases, phrase) } : previous),
    onRemoved: id => setState(previous => previous ? { ...previous, phrases: (previous.phrases ?? []).filter(phrase => phrase.id !== id) } : previous) });
  const listenAvailable = status === null || !!status?.systemAudio;
  const reset = useRef(capture);
  reset.current = capture;
  const listenRef = useRef(listen);
  listenRef.current = listen;
  // Closing the sheet never keeps recording; a clip already sent still lands in «Мои фразы».
  useEffect(() => { if (!open && (listenRef.current.phase === 'recording' || listenRef.current.phase === 'starting')) listenRef.current.cancel(); }, [open]);
  // Every opening starts with an empty field, unless an unsaved text (or one whose save failed) is waiting.
  useEffect(() => {
    if (!open) return;
    if (reset.current.saved) reset.current.reset();
    const frame = requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return <dialog ref={dialog} className={`sheet ${styles.sheet}`} aria-labelledby={headingId} data-testid="capture-sheet"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    {rendered && <div className="sheet-body">
      <button type="button" className="icon-button plain sheet-close" onClick={onClose} aria-label="Закрыть"><XIcon size={20} /></button>
      <CaptureCard variant="sheet" capture={capture} headingId={headingId} fieldRef={field} hint={shortcutHint(status)} onOpenPhrases={onOpenPhrases}
        listen={listenAvailable ? listen : null} />
    </div>}
  </dialog>;
}
