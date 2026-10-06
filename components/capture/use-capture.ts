'use client';

/*
 * «Запомнить» (planning/v05/PASS-0.5.3.md §1.6): one capture flow for the overlay window, the old framed quick window, the
 * in-app sheet and the field on top of «Мои фразы». Saving is optimistic: the card says «Запомнил!» at once while
 * POST /api/phrases runs; a failure brings the text back into the field with the reason. Sol enriches the phrase in the
 * background; GET /api/phrases/:id is polled every 1.5 s for up to 30 s. The clipboard is read only on «Вставить».
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PHRASE_TEXT_LIMIT, type CreatePhraseResponse, type PhraseOrigin, type SavedPhrase } from '@/lib/phrases/types';
import { captureText, insertText } from '@/lib/phrases/labels';
import type { DesktopStatus } from '../desktop-bridge';
import { request, statusOf } from '../app/api';

export const ENRICH_POLL_MS = 1500;
export const ENRICH_POLL_LIMIT_MS = 30_000;
/** Offline or a server failure (PASS-0.5.3 §1.6). */
export const SAVE_FAILED = 'Не получилось сохранить. Проверь связь.';
const GENERIC = 'Не удалось выполнить действие.';

export type CaptureSaved = {
  ticket: number;
  /** What he saved: on screen at once, before the server answers. */
  text: string;
  /** The server's copy; null until it answered. */
  phrase: SavedPhrase | null;
  /** The same text was already in the bank (`phrase` is that one). */
  duplicate: boolean;
  /** Sol is still at it after 30 s: the card stops waiting («Мои фразы» shows it later). */
  slow: boolean;
};

export type Capture = {
  text: string;
  setText: (value: string) => void;
  /** The last save (null while editing). */
  saved: CaptureSaved | null;
  /** Why the last save failed (the text is back in the field). */
  error: string;
  /** Clipboard notes. */
  notice: string;
  /** Grows with every save: the card flies the text chip into the companion and makes it hop. */
  serial: number;
  canSave: boolean;
  /** Starts the save; false when there is nothing to save. */
  save: () => boolean;
  /** «Ещё одну»: back to an empty field. */
  reset: () => void;
  /** «Вставить» at the caret; resolves with the new caret position (null when nothing was inserted). */
  paste: (selection?: { start: number; end: number } | null) => Promise<number | null>;
};

/** The server's own Russian answer (daily limit, validation, sign-in) says more; no connection or a failing server get the spec line. */
export function saveProblem(reason: unknown): string {
  const status = statusOf(reason);
  const message = reason instanceof Error ? reason.message : '';
  if (status !== undefined && status >= 400 && status < 500 && status !== 404 && message && message !== GENERIC) return message;
  return SAVE_FAILED;
}

/**
 * Follows one phrase until Sol is done: GET /api/phrases/:id every `everyMs` for up to `limitMs`. `onUpdate` gets every fresh
 * copy; `onGiveUp` runs when time is up and it is still pending. Returns the function that stops it.
 */
export function pollPhrase(id: string, onUpdate: (phrase: SavedPhrase) => void, options: {
  everyMs?: number; limitMs?: number; onGiveUp?: () => void; onEnd?: () => void;
} = {}): () => void {
  const { everyMs = ENRICH_POLL_MS, limitMs = ENRICH_POLL_LIMIT_MS } = options;
  const controller = new AbortController();
  const began = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const end = () => { if (stopped) return; stopped = true; options.onEnd?.(); };
  const tick = async () => {
    timer = null;
    if (stopped) return;
    try {
      const { phrase } = await request<{ phrase: SavedPhrase }>(`phrases/${encodeURIComponent(id)}`, undefined, 'GET', controller.signal);
      if (stopped) return;
      onUpdate(phrase);
      if (phrase.enrichment !== 'pending') { end(); return; }
    } catch (error) {
      if (stopped) return;
      if (statusOf(error) === 404) { end(); return; } // deleted meanwhile
    }
    if (Date.now() - began + everyMs > limitMs) { options.onGiveUp?.(); end(); return; }
    timer = setTimeout(() => void tick(), everyMs);
  };
  timer = setTimeout(() => void tick(), everyMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); controller.abort(); };
}

export function useCapture({ origin, onPhrase }: {
  /** Defaults to 'desktop' inside the Smooth Talk shell, 'web' in a browser. */
  origin?: PhraseOrigin;
  /** Every copy of a phrase this capture saved or followed (in-app: keeps «Мои фразы» in step). */
  onPhrase?: (phrase: SavedPhrase) => void;
} = {}): Capture {
  const [text, setTextState] = useState('');
  const [saved, setSaved] = useState<CaptureSaved | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [serial, setSerial] = useState(0);
  const textRef = useRef(text);
  textRef.current = text;
  const ticket = useRef(0);
  const pollers = useRef(new Map<string, () => void>());
  const options = useRef({ origin, onPhrase });
  options.current = { origin, onPhrase };

  useEffect(() => {
    const active = pollers.current;
    return () => { active.forEach(stop => stop()); active.clear(); };
  }, []);

  const follow = useCallback((phrase: SavedPhrase) => {
    if (phrase.enrichment !== 'pending' || pollers.current.has(phrase.id)) return;
    const stop = pollPhrase(phrase.id, fresh => {
      options.current.onPhrase?.(fresh);
      setSaved(current => current?.phrase?.id === fresh.id ? { ...current, phrase: fresh } : current);
    }, {
      onGiveUp: () => setSaved(current => current?.phrase?.id === phrase.id ? { ...current, slow: true } : current),
      onEnd: () => pollers.current.delete(phrase.id),
    });
    pollers.current.set(phrase.id, stop);
  }, []);

  const setText = useCallback((value: string) => {
    const next = value.slice(0, PHRASE_TEXT_LIMIT);
    textRef.current = next;
    setTextState(next);
    setError(''); setNotice('');
  }, []);

  const save = useCallback(() => {
    const value = captureText(textRef.current);
    if (!value) return false;
    const mine = ++ticket.current;
    // Cleared at once (a held Enter never saves twice); a failure puts it back.
    textRef.current = '';
    setTextState('');
    setError(''); setNotice('');
    setSaved({ ticket: mine, text: value, phrase: null, duplicate: false, slow: false });
    setSerial(current => current + 1);
    const origin = options.current.origin ?? (typeof window !== 'undefined' && window.ratmirDesktop ? 'desktop' : 'web');
    void (async () => {
      try {
        const result = await request<CreatePhraseResponse>('phrases', { text: value, origin }, 'POST');
        options.current.onPhrase?.(result.phrase);
        setSaved(current => current?.ticket === mine ? { ...current, phrase: result.phrase, duplicate: !!result.duplicate } : current);
        follow(result.phrase);
      } catch (reason) {
        // Unless he already started a new one, the text comes back into the field with the reason next to it.
        setSaved(current => current?.ticket === mine ? null : current);
        if (!textRef.current.trim()) { textRef.current = value; setTextState(value); }
        setError(saveProblem(reason));
      }
    })();
    return true;
  }, [follow]);

  const reset = useCallback(() => {
    ticket.current++;
    setSaved(null); setError(''); setNotice('');
  }, []);

  const paste = useCallback(async (selection?: { start: number; end: number } | null) => {
    setError(''); setNotice('');
    let raw = '';
    try { raw = window.ratmirDesktop ? await window.ratmirDesktop.readClipboard() : await navigator.clipboard.readText(); }
    catch { setNotice('Не получилось прочитать буфер. Вставь текст с помощью Ctrl+V.'); return null; }
    if (!raw?.trim()) { setNotice('Буфер пуст. Скопируй фразу или вставь её вручную.'); return null; }
    const next = insertText(textRef.current, raw, selection);
    textRef.current = next.text;
    setTextState(next.text);
    if (next.truncated) setNotice(`Вставил первые ${PHRASE_TEXT_LIMIT} знаков.`);
    return next.caret;
  }, []);

  const canSave = captureText(text) !== null;
  return useMemo(() => ({ text, setText, saved, error, notice, serial, canSave, save, reset, paste }),
    [text, setText, saved, error, notice, serial, canSave, save, reset, paste]);
}

// ── Desktop shell status (shortcut label, overlay style), asked once per page ──

let statusRequest: Promise<DesktopStatus | null> | null = null;
let statusValue: DesktopStatus | null | undefined;

/** null outside the Smooth Talk shell (or when it does not answer). */
export function loadDesktopStatus(): Promise<DesktopStatus | null> {
  if (typeof window === 'undefined' || !window.ratmirDesktop) return Promise.resolve(null);
  statusRequest ??= window.ratmirDesktop.getStatus()
    .then(value => (statusValue = value ?? null), () => (statusValue = null));
  return statusRequest;
}

/** The shell's status: undefined while asking, null in a browser. */
export function useDesktopStatus(): DesktopStatus | null | undefined {
  const [status, setStatus] = useState<DesktopStatus | null | undefined>(() => statusValue);
  useEffect(() => {
    let alive = true;
    void loadDesktopStatus().then(value => { if (alive) setStatus(value); });
    return () => { alive = false; };
  }, []);
  return status;
}
