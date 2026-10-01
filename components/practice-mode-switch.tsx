'use client';

import { useState, type MouseEvent } from 'react';
import type { Mode } from '@/lib/types';
import styles from './practice-mode-switch.module.css';

export interface PracticeModeSwitchProps {
  mode: Mode;
  setMode: (mode: Mode) => void;
}

export function PracticeModeSwitch({ mode, setMode }: PracticeModeSwitchProps) {
  const [instant, setInstant] = useState(true);

  function select(nextMode: Mode, event: MouseEvent<HTMLButtonElement>) {
    // Native keyboard and assistive-technology clicks carry no pointer detail.
    setInstant(event.detail === 0);
    setMode(nextMode);
  }

  return <div className={`mode-switch ${styles.switch}`} role="group" aria-label="Режим практики"
    data-mode={mode} data-instant={instant ? 'true' : undefined}>
    <span className={styles.selection} aria-hidden="true" />
    <button type="button" aria-pressed={mode === 'learning'} onClick={event => select('learning', event)}>
      <span>Учебный</span>
    </button>
    <button type="button" aria-pressed={mode === 'call'} onClick={event => select('call', event)}>
      <span>Созвон</span>
    </button>
  </div>;
}
