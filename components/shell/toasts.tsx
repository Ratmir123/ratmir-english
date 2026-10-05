'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';

export type ToastTone = 'error' | 'success' | 'info';
export type ToastAction = { label: string; run: () => void };
export type Toast = { id: number; tone: ToastTone; message: string; action?: ToastAction };

/** Errors stay until closed or replaced; confirmations fade after a few seconds. Max three at once. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sequence = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id); if (timer) clearTimeout(timer); timers.current.delete(id);
    setToasts(previous => previous.filter(toast => toast.id !== id));
  }, []);
  const push = useCallback((tone: ToastTone, message: string, action?: ToastAction) => {
    if (!message) return;
    const id = ++sequence.current;
    setToasts(previous => [...previous.filter(toast => toast.message !== message), { id, tone, message, action }].slice(-3));
    const life = tone === 'error' ? (action ? 20_000 : 12_000) : action ? 9000 : 5000;
    timers.current.set(id, setTimeout(() => dismiss(id), life));
  }, [dismiss]);
  const clearErrors = useCallback(() => setToasts(previous => previous.filter(toast => toast.tone !== 'error')), []);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  return { toasts, push, dismiss, clearErrors };
}

export function ToastRegion({ toasts, onDismiss, raised = false }: { toasts: Toast[]; onDismiss: (id: number) => void; raised?: boolean }) {
  return <div className="toast-region" data-raised={raised} aria-live="polite">
    {toasts.map(toast => <div key={toast.id} className="toast glass" data-tone={toast.tone} role={toast.tone === 'error' ? 'alert' : 'status'}>
      {toast.tone === 'error' ? <WarningCircleIcon size={20} weight="fill" /> : toast.tone === 'success' ? <CheckCircleIcon size={20} weight="fill" /> : <InfoIcon size={20} weight="fill" />}
      <span>{toast.message}</span>
      {toast.action && <button type="button" className="button small primary" onClick={() => { toast.action?.run(); onDismiss(toast.id); }}>{toast.action.label}</button>}
      <button type="button" className="icon-button plain" style={{ width: 36, height: 36 }} onClick={() => onDismiss(toast.id)} aria-label="Закрыть сообщение"><XIcon size={16} /></button>
    </div>)}
  </div>;
}
