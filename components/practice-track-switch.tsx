'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { LearningTrackId } from '@/lib/types';
import { LEARNING_TRACKS } from '@/lib/training';
import styles from './practice-track-switch.module.css';

export function PracticeTrackSwitch({ value, onChange }: {
  value: LearningTrackId | 'all'; onChange: (value: LearningTrackId | 'all') => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  const [instant, setInstant] = useState(true);
  useLayoutEffect(() => {
    const parent = container.current; const surface = lens.current;
    if (!parent || !surface) return;
    const measure = () => {
      const selected = parent.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!selected) return;
      surface.style.width = `${selected.offsetWidth}px`;
      surface.style.height = `${selected.offsetHeight}px`;
      surface.style.transform = `translate3d(${selected.offsetLeft}px, ${selected.offsetTop}px, 0)`;
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(parent);
    return () => observer.disconnect();
  }, [value]);
  const options = [{ id: 'all' as const, title: 'Все' }, ...LEARNING_TRACKS];
  return <div ref={container} className={styles.switch} role="group" aria-label="Направление практики" data-instant={instant || undefined}>
    <span ref={lens} className={styles.lens} aria-hidden="true" />
    {options.map(option => <button type="button" key={option.id} aria-pressed={value === option.id}
      onClick={event => { setInstant(event.detail === 0); onChange(option.id); }}>
      {option.title}
    </button>)}
  </div>;
}
