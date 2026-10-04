'use client';

import { useEffect, useState } from 'react';

export function ElapsedTime({ startedAt, className }: { startedAt: number | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span className={`tabular ${className ?? ''}`} aria-label="Прошло времени">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}
