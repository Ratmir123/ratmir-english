'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, BrainStatus, Session, SubscriptionUsage } from '@/lib/types';
import type { CallSummary } from '@/lib/calls/types';
import type { PlacementView } from '@/lib/placement/types';
import { messageOf, request, statusOf } from './api';
import { processingCalls } from './today-plan';

export type ServerStatus = {
  app?: { name: string; version: string; channel?: string };
  brain: BrainStatus; hosting?: 'local' | 'server'; audio: { configured: boolean; model: string };
};
type Options = {
  /** The open session polls itself (use-session-controller); background polling skips it. */
  openSessionId: () => string | null;
  /** analysing → review/error for any session (in-app toast, desktop notification). */
  onSessionSettled?: (session: Session) => void;
  /** A call left processing (ready / needs-speaker / error). */
  onCallSettled?: (call: CallSummary) => void;
};
const POLL_MS = 3000;
const FOCUS_REFRESH_MS = 10_000;
const CALL_BUSY: CallSummary['status'][] = ['awaiting-upload', 'queued', 'processing', 'analysing'];

/** State, status and limits with freshness: focus/visibility refresh and background polls (audit U-09, C-05, C-13). */
export function useAppData(options: Options) {
  const [state, setStateValue] = useState<AppState | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [loadError, setLoadError] = useState('');
  const sequence = useRef(0);
  const applied = useRef(0);
  const lastRefresh = useRef(0);
  const usageRequest = useRef<Promise<void> | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;

  const settle = useCallback((previous: AppState | null, next: AppState) => {
    if (!previous) return;
    const before = new Map(previous.sessions.map(session => [session.id, session.status]));
    for (const session of next.sessions) {
      if (before.get(session.id) === 'analysing' && session.status !== 'analysing') callbacks.current.onSessionSettled?.(session);
    }
    const calls = new Map((previous.calls ?? []).map(call => [call.id, call.status]));
    for (const call of next.calls ?? []) {
      const was = calls.get(call.id);
      if (was && CALL_BUSY.includes(was) && !CALL_BUSY.includes(call.status)) callbacks.current.onCallSettled?.(call);
    }
  }, []);

  const setState = useCallback((update: AppState | ((previous: AppState | null) => AppState | null)) => {
    const next = typeof update === 'function' ? update(stateRef.current) : update;
    stateRef.current = next; setStateValue(next);
  }, []);

  const refresh = useCallback(async (): Promise<AppState | null> => {
    const ticket = ++sequence.current;
    try {
      const next = await request<AppState>('state');
      // A slow older response never overwrites a newer one (audit C-05).
      if (ticket < applied.current) return stateRef.current;
      applied.current = ticket; lastRefresh.current = Date.now();
      const previous = stateRef.current;
      stateRef.current = next; setStateValue(next);
      setNeedLogin(false); setLoadError('');
      settle(previous, next);
      return next;
    } catch (error) {
      if (statusOf(error) === 401) setNeedLogin(true);
      else setLoadError(messageOf(error, 'Не удалось загрузить данные.'));
      return null;
    }
  }, [settle]);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await request<ServerStatus>('status')); setStatusFailed(false); }
    catch (error) { if (statusOf(error) === 401) setNeedLogin(true); else setStatusFailed(true); }
  }, []);

  const refreshUsage = useCallback((force = false) => {
    if (usageRequest.current) return usageRequest.current;
    setUsageLoading(true);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 45_000);
    const work = (async () => {
      try { setUsage(await request<SubscriptionUsage>('usage' + (force ? '?refresh=1' : ''), undefined, 'GET', controller.signal)); }
      catch (error) {
        if (statusOf(error) === 401) { setUsage(null); setNeedLogin(true); }
        else setUsage(previous => previous
          ? { ...previous, stale: true, error: 'Не удалось обновить лимиты. Последние данные сохранены.' }
          : { source: 'codex', scope: 'unknown', available: false, checkedAt: null, stale: true, windows: [], plan: null, error: 'Лимиты временно недоступны. Попробуй обновить.' });
      } finally { clearTimeout(deadline); usageRequest.current = null; setUsageLoading(false); }
    })();
    usageRequest.current = work;
    return work;
  }, []);

  useEffect(() => { void refresh(); void refreshStatus(); }, [refresh, refreshStatus]);

  // Freshness: the desktop window lives for days in the tray and the phone shares the same history.
  useEffect(() => {
    const update = (initial = false) => {
      if (document.visibilityState !== 'visible') return;
      // The mount effect above already loaded the state; only later focus/visibility changes refetch it.
      if (!initial && Date.now() - lastRefresh.current >= FOCUS_REFRESH_MS) void refresh();
      void refreshUsage();
    };
    update(true);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshUsage(); }, 60_000);
    const onFocus = () => update();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh, refreshUsage]);

  // Background polls while something is being prepared elsewhere (3 s, paused while hidden).
  const analysing = state?.sessions.filter(session => session.status === 'analysing' || !!session.processing).map(session => session.id) ?? [];
  const callsBusy = state ? processingCalls(state).length > 0 : false;
  const placementScoring = state?.placement?.status === 'scoring';
  const pollKey = `${analysing.join(',')}|${callsBusy}|${placementScoring}`;
  useEffect(() => {
    const [sessionsPart, callsPart, placementPart] = pollKey.split('|');
    const sessionIds = sessionsPart ? sessionsPart.split(',') : [];
    const watchCalls = callsPart === 'true';
    const watchPlacement = placementPart === 'true';
    if (!sessionIds.length && !watchCalls && !watchPlacement) return;
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const began = Date.now();
    // 3 s while something is fresh; a job stuck for minutes is checked every 15 s instead of hammering the server.
    const schedule = () => { if (!disposed) timer = setTimeout(() => void tick(), Date.now() - began > 5 * 60_000 ? 15_000 : POLL_MS); };
    const tick = async () => {
      if (disposed) return;
      if (running || document.hidden) { schedule(); return; }
      running = true;
      try {
        let changed = false;
        for (const id of sessionIds) {
          if (id === callbacks.current.openSessionId()) continue;
          const value = await request<Session>(`sessions/${id}`);
          if (value.status !== 'analysing' && !value.processing) changed = true;
        }
        if (watchCalls) {
          const { calls } = await request<{ calls: CallSummary[] }>('calls');
          const previous = stateRef.current?.calls ?? [];
          if (calls.some(call => !CALL_BUSY.includes(call.status) && CALL_BUSY.includes(previous.find(item => item.id === call.id)?.status ?? 'ready'))) changed = true;
          else if (!disposed) setState(current => current ? { ...current, calls } : current);
        }
        if (watchPlacement) {
          const view = await request<PlacementView>('placement');
          if (view.status !== 'scoring') changed = true;
          else if (!disposed) setState(current => current ? { ...current, placement: view } : current);
        }
        if (changed && !disposed) await refresh();
      } catch { /* The next tick retries quietly; explicit actions report their own errors. */ }
      finally { running = false; schedule(); }
    };
    schedule();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [pollKey, refresh, setState]);

  return { state, setState, stateRef, status, statusFailed, usage, usageLoading, needLogin, setNeedLogin, loadError, refresh, refreshStatus, refreshUsage };
}
export type AppData = ReturnType<typeof useAppData>;
