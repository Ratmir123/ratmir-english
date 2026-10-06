'use client';

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { MOTION_MS } from './motion';

export type SegmentOption<T extends string> = { id: T; label: string; disabled?: boolean; badge?: number | null };

/**
 * Glass segmented control with a sliding liquid lens. `kind="radio"` for a choice (mode switch),
 * `kind="tabs"` for sections; arrow keys move the selection (audit C-24: real radio/tab semantics).
 */
export function Segmented<T extends string>({ value, options, onChange, label, block = false, kind = 'radio', controls }: {
  value: T; options: SegmentOption<T>[]; onChange: (value: T) => void; label: string; block?: boolean; kind?: 'radio' | 'tabs';
  /** For tabs: id prefix of the controlled panels (`${controls}-${option.id}`). */
  controls?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [lens, setLens] = useState<{ x: number; w: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const previous = useRef(value);
  const measure = useCallback(() => {
    const selected = root.current?.querySelector<HTMLButtonElement>(`button[data-value="${CSS.escape(value)}"]`);
    if (selected) setLens({ x: selected.offsetLeft, w: selected.offsetWidth });
  }, [value]);
  useLayoutEffect(() => {
    measure();
    if (previous.current !== value) { previous.current = value; setMoving(true); const timer = setTimeout(() => setMoving(false), MOTION_MS.spring + 40); return () => clearTimeout(timer); }
  }, [measure, value]);
  useLayoutEffect(() => {
    const element = root.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  const enabled = options.filter(option => !option.disabled);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || !enabled.length) return;
    event.preventDefault();
    const index = enabled.findIndex(option => option.id === value);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
    onChange(enabled[next].id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`button[data-value="${CSS.escape(enabled[next].id)}"]`)?.focus());
  };
  const tabs = kind === 'tabs';
  return <div ref={root} className={`segmented${block ? ' block' : ''}`} role={tabs ? 'tablist' : 'radiogroup'} aria-label={label} onKeyDown={onKeyDown}>
    <span className="lens" aria-hidden="true" data-moving={moving}
      style={lens ? { '--lens-x': `${lens.x}px`, '--lens-w': `${lens.w}px` } as CSSProperties : { opacity: 0 }} />
    {options.map(option => {
      const selected = option.id === value;
      return <button key={option.id} type="button" data-value={option.id} disabled={option.disabled}
        role={tabs ? 'tab' : 'radio'} {...(tabs ? { 'aria-selected': selected, 'aria-controls': controls ? `${controls}-${option.id}` : undefined, id: controls ? `${controls}-tab-${option.id}` : undefined } : { 'aria-checked': selected })}
        tabIndex={selected ? 0 : -1} onClick={() => { if (!selected) onChange(option.id); }}>
        {option.label}{option.badge ? <span className="chip lime" style={{ marginLeft: 6, minHeight: 20, padding: '0 7px' }}>{option.badge}</span> : null}
      </button>;
    })}
  </div>;
}
