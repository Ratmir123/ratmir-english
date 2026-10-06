'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { MOTION_MS, prefersReducedMotion } from './motion';

/**
 * Opens and closes a native <dialog> for `open`, keeping its content rendered through the exit (MOTION-PASS-0.5.2 §1:
 * open 560 ms, close 300 ms). The dialog itself closes at once — the page is usable immediately — while CSS
 * (`overlay`/`display` with allow-discrete) keeps it painted in the top layer for the fade. Returns whether the
 * content should be rendered.
 */
export function useSheetPresence(dialog: RefObject<HTMLDialogElement | null>, open: boolean): boolean {
  const [rendered, setRendered] = useState(open);
  if (open && !rendered) setRendered(true);
  // Layout effect: the dialog opens or starts closing in the same frame as the state change, never a frame late.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (open) {
      if (element && !element.open && element.isConnected) {
        try { element.showModal(); } catch { element.setAttribute('open', ''); }
      }
      return;
    }
    if (element?.open) element.close();
    const timer = window.setTimeout(() => setRendered(false), prefersReducedMotion() || document.hidden ? 0 : MOTION_MS.sheetOut);
    return () => window.clearTimeout(timer);
  }, [dialog, open]);
  return open || rendered;
}

/**
 * Glass sheet on a native <dialog>: Esc / backdrop close, focus trap and inert page for free.
 * Context (section, time, step) goes in `subtitle`, a plain line under the title; there is no kicker above it.
 * `eyebrow` is the old name of the same prop and renders identically.
 */
export function Sheet({ open, onClose, title, subtitle, eyebrow, children, actions, className, dismissible = true, testId }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; children?: ReactNode; actions?: ReactNode;
  className?: string; dismissible?: boolean; testId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const rendered = useSheetPresence(dialog, open);
  // While it fades out, the sheet keeps showing what it showed when it was open (callers often clear their data first).
  const shown = useRef({ title, sub: subtitle ?? eyebrow, children, actions, dismissible });
  if (open) shown.current = { title, sub: subtitle ?? eyebrow, children, actions, dismissible };
  const view = shown.current;
  useEffect(() => () => { if (dialog.current?.open) dialog.current.close(); }, []);
  return <dialog ref={dialog} className={`sheet ${className ?? ''}`} aria-labelledby={titleId} data-testid={testId}
    onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
    onClick={event => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
    {rendered && <div className="sheet-body">
      {view.dismissible && <button type="button" className="icon-button plain sheet-close" onClick={onClose} aria-label="Закрыть"><XIcon size={20} /></button>}
      <div style={{ display: 'grid', gap: 4, minWidth: 0, paddingRight: view.dismissible ? 40 : 0 }}>
        <h2 id={titleId} style={{ textWrap: 'balance' }}>{view.title}</h2>
        {view.sub && <p className="caption">{view.sub}</p>}
      </div>
      {view.children}
      {view.actions && <div className="sheet-actions">{view.actions}</div>}
    </div>}
  </dialog>;
}
