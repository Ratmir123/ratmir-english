'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { XIcon } from '@phosphor-icons/react';

/** Glass sheet on a native <dialog>: Esc / backdrop close, focus trap and inert page for free. */
export function Sheet({ open, onClose, title, eyebrow, children, actions, className, dismissible = true, testId }: {
  open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children?: ReactNode; actions?: ReactNode;
  className?: string; dismissible?: boolean; testId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current; if (!element) return;
    if (open && !element.open && element.isConnected) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => () => { if (dialog.current?.open) dialog.current.close(); }, []);
  return <dialog ref={dialog} className={`sheet ${className ?? ''}`} aria-labelledby={titleId} data-testid={testId}
    onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
    onClick={event => { if (dismissible && event.target === event.currentTarget) onClose(); }}>
    {open && <div className="sheet-body">
      {dismissible && <button type="button" className="icon-button plain sheet-close" onClick={onClose} aria-label="Закрыть"><XIcon size={20} /></button>}
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2 id={titleId} style={{ paddingRight: dismissible ? 40 : 0 }}>{title}</h2>
      {children}
      {actions && <div className="sheet-actions">{actions}</div>}
    </div>}
  </dialog>;
}
