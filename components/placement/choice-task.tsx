'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowRightIcon, ArrowsClockwiseIcon, BookOpenIcon, CheckIcon, HeadphonesIcon, PlayIcon, TextAaIcon } from '@phosphor-icons/react';
import { mediaUrl } from '@/lib/client/api';
import type { PlacementTask } from '@/lib/placement/types';
import { cx, kit, Spinner } from '../calls/kit';
import { optionIndexFromKey, promptParts } from './flow-model';
import { playMetered, type MeteredPlayback } from './use-task-recorder';
import styles from './placement.module.css';

type ChoiceTask = Extract<PlacementTask, { kind: 'choice' }>;

const SECTION_ICON = { listening: HeadphonesIcon, reading: BookOpenIcon, language: TextAaIcon } as const;

export function PromptText({ prompt, filled }: { prompt: string; filled?: string | null }) {
  return (
    <>
      {promptParts(prompt).map((part, index) => part.gap
        ? <span key={index} className={cx(styles.gap, filled && styles.gapFilled)} aria-label={filled ? `пропуск: ${filled}` : 'пропуск'}>{filled || ' '}</span>
        : <span key={index}>{part.text}</span>)}
    </>
  );
}

/** Listening clip: plays count only when a play reaches the end; a failed play can be repeated and is not counted. */
function ClipPlayer({ url, maxPlays, plays, onPlayed, onUnavailable }: { url: string; maxPlays: number; plays: number; onPlayed: () => void; onUnavailable: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const playback = useRef<MeteredPlayback | null>(null);
  const ring = useRef<SVGCircleElement>(null);
  const radius = 38; const length = 2 * Math.PI * radius;
  useEffect(() => () => { playback.current?.stop(); playback.current = null; }, []);
  const exhausted = plays >= maxPlays;
  function setProgress(fraction: number) { if (ring.current) ring.current.style.strokeDashoffset = String(length * (1 - fraction)); }
  function play() {
    if (exhausted || state === 'playing' || state === 'loading') return;
    setState('loading'); setProgress(0);
    const current = playMetered(mediaUrl(url), undefined, fraction => { if (fraction > 0) setState('playing'); setProgress(fraction); });
    playback.current = current;
    current.audio.onplaying = () => setState('playing');
    current.done.then(result => {
      if (playback.current !== current) return;
      playback.current = null;
      if (result === 'ended') { onPlayed(); setState('idle'); }
      else setState('idle');
      setProgress(0);
    }).catch(() => {
      if (playback.current !== current) return;
      playback.current = null; setState('error'); setProgress(0); onUnavailable();
    });
  }
  const left = Math.max(0, maxPlays - plays);
  const title = state === 'playing' ? 'Слушай…' : state === 'loading' ? 'Загружаю запись…' : state === 'error' ? 'Запись не загрузилась'
    : exhausted ? 'Прослушивания закончились' : plays === 0 ? 'Включи запись' : 'Можно послушать ещё раз';
  const caption = state === 'error' ? 'Попробуй ещё раз — неудачная попытка не считается. Если не выходит, ответь по тому, что понял.'
    : exhausted ? 'Отвечай по тому, что услышал — как в живом разговоре.'
      : `Осталось ${left} из ${maxPlays}. Вопрос уже на экране — читай его до прослушивания.`;
  return (
    <div className={cx(kit.glass, styles.player)}>
      <button type="button" className={styles.playButton} onClick={play} disabled={exhausted || state === 'playing' || state === 'loading'} data-state={state}
        aria-label={state === 'error' ? 'Повторить загрузку записи' : plays === 0 ? 'Слушать запись' : 'Слушать ещё раз'}>
        <svg className={styles.playRing} viewBox="0 0 84 84" aria-hidden="true">
          <circle className={styles.track} cx="42" cy="42" r={radius} />
          <circle ref={ring} className={styles.value} cx="42" cy="42" r={radius} strokeDasharray={length} strokeDashoffset={length} transform="rotate(-90 42 42)" />
        </svg>
        {state === 'loading' ? <Spinner /> : state === 'error' ? <ArrowsClockwiseIcon size={26} weight="bold" /> : state === 'playing' ? <HeadphonesIcon size={28} weight="fill" /> : <PlayIcon size={28} weight="fill" />}
      </button>
      <div className={styles.playerText} aria-live="polite">
        <strong>{title}
          <span className={styles.playsDots} aria-label={`Прослушано ${plays} из ${maxPlays}`}>
            {Array.from({ length: maxPlays }, (_, index) => <i key={index} data-used={index < plays} />)}
          </span>
        </strong>
        <span>{caption}</span>
      </div>
    </div>
  );
}

export function ChoiceTaskView({ task, busy, onAnswer }: {
  task: ChoiceTask; busy: boolean; onAnswer: (choice: number, plays: number | undefined, elapsedMs: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [plays, setPlays] = useState(0);
  const [audioFailed, setAudioFailed] = useState(false);
  const shownAt = useRef(typeof performance === 'undefined' ? 0 : performance.now());
  const group = useRef<HTMLDivElement>(null);
  const listening = task.section === 'listening' && !!task.audio;
  const needsListening = listening && plays === 0 && !audioFailed;
  const canAnswer = selected !== null && !busy && !needsListening;
  const Icon = SECTION_ICON[task.section];

  const submit = useCallback((choice: number | null) => {
    if (choice === null || busy || needsListening) return;
    onAnswer(choice, listening ? plays : undefined, Math.round(performance.now() - shownAt.current));
  }, [busy, needsListening, onAnswer, listening, plays]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      const index = optionIndexFromKey(event.key, task.options.length);
      if (index !== null) { event.preventDefault(); setSelected(index); return; }
      if (event.key !== 'Enter') return;
      const option = target?.closest<HTMLElement>('[data-option]');
      if (option) { event.preventDefault(); const value = Number(option.dataset.option); setSelected(value); submit(value); return; }
      if (target && /^(BUTTON|A|SUMMARY)$/.test(target.tagName)) return;
      event.preventDefault(); submit(selected);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task.options.length, submit, selected]);

  function onArrow(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const next = ((selected ?? (step > 0 ? -1 : 0)) + step + task.options.length) % task.options.length;
    setSelected(next);
    group.current?.querySelector<HTMLElement>(`[data-option="${next}"]`)?.focus();
  }

  const instruction = <p className={styles.instruction}><Icon size={18} weight="bold" aria-hidden="true" />{task.instruction}</p>;
  const question = (
    <>
      {listening ? null : instruction}
      <p className={cx(styles.prompt, kit.en)} lang="en" id={`prompt-${task.id}`}>
        <PromptText prompt={task.prompt} filled={selected !== null ? task.options[selected] : null} />
      </p>
      <div ref={group} role="radiogroup" aria-labelledby={`prompt-${task.id}`} className={styles.options} onKeyDown={onArrow}>
        {task.options.map((option, index) => (
          <button key={index} type="button" role="radio" aria-checked={selected === index} data-option={index} lang="en"
            tabIndex={selected === null ? (index === 0 ? 0 : -1) : selected === index ? 0 : -1}
            className={cx(styles.option, kit.rise)} style={{ ['--i' as string]: index }}
            onClick={() => setSelected(index)}>
            <span className={styles.key} aria-hidden="true">{index + 1}</span>
            <span>{option}</span>
            <span className={styles.check} aria-hidden="true"><CheckIcon size={14} weight="bold" /></span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className={styles.task}>
      {task.section === 'reading' && task.passage ? (
        <div className={styles.readingGrid}>
          <article className={cx(kit.solid, styles.passage, kit.en)} lang="en" aria-label="Текст для чтения">
            {task.passage.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </article>
          <div className={styles.readingAside}>{question}</div>
        </div>
      ) : (
        <>
          {listening ? instruction : null}
          {listening && task.audio ? (
            <ClipPlayer url={task.audio.url} maxPlays={Math.max(1, task.audio.maxPlays)} plays={plays}
              onPlayed={() => setPlays(value => value + 1)} onUnavailable={() => setAudioFailed(true)} />
          ) : null}
          {question}
        </>
      )}
      <div className={cx(kit.glass, styles.answerBar)}>
        <span className={styles.hint}>
          {needsListening ? 'Сначала послушай запись' : <><span className={styles.kbd}>1</span>–<span className={styles.kbd}>{Math.min(9, task.options.length)}</span> выбрать · <span className={styles.kbd}>Enter</span> ответить</>}
        </span>
        <button type="button" className={cx(kit.btn, kit.primary)} disabled={!canAnswer} onClick={() => submit(selected)}>
          {busy ? <Spinner /> : null}
          Ответить
          {busy ? null : <ArrowRightIcon size={18} weight="bold" />}
        </button>
      </div>
    </div>
  );
}
