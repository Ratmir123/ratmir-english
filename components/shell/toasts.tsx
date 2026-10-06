'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { MOTION_MS, prefersReducedMotion } from '../ui/motion';

export type ToastTone = 'error' | 'success' | 'info';
/** `life` (ms) overrides how long the toast stays — an undo window («Занятие убрано · Вернуть») must end with its action. */
export type ToastAction = { label: string; run: () => void; life?: number };
export type Toast = { id: number; tone: ToastTone; message: string; action?: ToastAction; leaving?: boolean };

/** Errors stay until closed or replaced; confirmations fade after a few seconds. Max three at once. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const current = useRef<Toast[]>([]);
  const sequence = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const commit = useCallback((next: Toast[]) => { current.current = next; setToasts(next); }, []);
  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id); if (timer) clearTimeout(timer); timers.current.delete(id);
  }, []);
  const remove = useCallback((id: number) => {
    clearTimer(id);
    commit(current.current.filter(toast => toast.id !== id));
  }, [clearTimer, commit]);
  /** Leaves with a short sink (MOTION-PASS-0.5.2: toast out 260 ms), then unmounts. */
  const dismiss = useCallback((id: number) => {
    clearTimer(id);
    if (!current.current.some(toast => toast.id === id)) return;
    if (prefersReducedMotion() || document.hidden) { remove(id); return; }
    commit(current.current.map(toast => toast.id === id ? { ...toast, leaving: true } : toast));
    timers.current.set(id, setTimeout(() => remove(id), MOTION_MS.toastOut));
  }, [clearTimer, commit, remove]);
  const push = useCallback((tone: ToastTone, message: string, action?: ToastAction) => {
    if (!message) return;
    const id = ++sequence.current;
    const previous = current.current;
    const next = [...previous.filter(toast => toast.message !== message), { id, tone, message, action }].slice(-3);
    for (const toast of previous) if (!next.includes(toast)) clearTimer(toast.id);
    commit(next);
    const life = action?.life ?? (tone === 'error' ? (action ? 20_000 : 12_000) : action ? 9000 : 5000);
    timers.current.set(id, setTimeout(() => dismiss(id), life));
  }, [clearTimer, commit, dismiss]);
  const clearErrors = useCallback(() => {
    for (const toast of current.current) if (toast.tone === 'error' && !toast.leaving) dismiss(toast.id);
  }, [dismiss]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  return { toasts, push, dismiss, clearErrors };
}

export function ToastRegion({ toasts, onDismiss, raised = false }: { toasts: Toast[]; onDismiss: (id: number) => void; raised?: boolean }) {
  return <div className="toast-region" data-raised={raised} aria-live="polite">
    {toasts.map(toast => <div key={toast.id} className="toast glass" data-tone={toast.tone} data-leaving={toast.leaving || undefined}
      role={toast.tone === 'error' ? 'alert' : 'status'} aria-hidden={toast.leaving || undefined}>
      {toast.tone === 'error' ? <WarningCircleIcon size={20} weight="fill" /> : toast.tone === 'success' ? <CheckCircleIcon size={20} weight="fill" /> : <InfoIcon size={20} weight="fill" />}
      <span>{toast.message}</span>
      {toast.action && <button type="button" className="button small primary" onClick={() => { toast.action?.run(); onDismiss(toast.id); }}>{toast.action.label}</button>}
      <button type="button" className="icon-button plain" style={{ width: 36, height: 36 }} onClick={() => onDismiss(toast.id)} aria-label="Закрыть сообщение"><XIcon size={16} /></button>
    </div>)}
  </div>;
}
