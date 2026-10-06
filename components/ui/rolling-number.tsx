'use client';

import { useEffect, useRef, useState } from 'react';
import { easeOutExpo, MOTION_MS } from './motion';

/** Numbers roll to their new value (the 900 ms fill, expo-out like the bars); instant with reduced motion or a hidden page. */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef(0);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    if (typeof window === 'undefined' || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return; }
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / MOTION_MS.fill);
      const eased = easeOutExpo(t);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);
  return <span className={`tabular ${className ?? ''}`}>{shown}</span>;
}
