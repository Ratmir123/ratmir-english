'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** One private draft per session; the intent tells which composer owns it (audit C-07). */
export type DraftIntent = 'message' | 'retry' | 'pushback';
export type SessionDraft = { text: string; intent: DraftIntent; id: string; audioFile?: string; originalTranscript?: string; retryId?: string };
export const DRAFT_STORAGE = 'ratmir:session-drafts:v1';
const INTENTS: DraftIntent[] = ['message', 'retry', 'pushback'];

export function validDrafts(stored: unknown): Record<string, SessionDraft> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([id, draft]) => {
    const value = draft as Partial<SessionDraft> | null;
    return /^[\da-f-]{36}$/i.test(id) && !!value && typeof value.text === 'string' && value.text.length <= 7000
      && typeof value.id === 'string' && INTENTS.includes(value.intent as DraftIntent)
      && (value.audioFile === undefined || typeof value.audioFile === 'string')
      && (value.originalTranscript === undefined || typeof value.originalTranscript === 'string')
      && (value.retryId === undefined || typeof value.retryId === 'string');
  })) as Record<string, SessionDraft>;
}

export function useDrafts() {
  const [drafts, setDrafts] = useState<Record<string, SessionDraft>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    try {
      const valid = validDrafts(JSON.parse(localStorage.getItem(DRAFT_STORAGE) || '{}'));
      draftsRef.current = valid; setDrafts(valid);
    } catch { /* A private draft is optional when browser storage is unavailable. */ }
  }, []);
  const save = useCallback((sessionId: string, value: SessionDraft | null) => {
    const next = { ...draftsRef.current };
    if (value) next[sessionId] = value; else delete next[sessionId];
    draftsRef.current = next; setDrafts(next);
    try { localStorage.setItem(DRAFT_STORAGE, JSON.stringify(next)); } catch { /* Keep the in-memory draft. */ }
  }, []);
  const clearAll = useCallback(() => {
    draftsRef.current = {}; setDrafts({});
    try { localStorage.removeItem(DRAFT_STORAGE); } catch { /* In-memory drafts are still cleared. */ }
  }, []);
  return useMemo(() => ({ drafts, draftsRef, save, clearAll }), [drafts, save, clearAll]);
}
