'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ArrowRightIcon, CheckIcon, LockSimpleIcon } from '@phosphor-icons/react';
import type { AppState, ProgressionState } from '@/lib/types';
import { achievementArt, achievementTarget, EXPERIENCE_BANDS, experienceBand, type AchievementTarget } from '@/lib/achievement-targets';
import { shortDate } from '../app/labels';
import { RollingNumber } from './rolling-number';
import styles from './rewards.module.css';

/** Decorations sleep outside the viewport, in a hidden window and with reduced motion. */
function useRewardMotion(enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') { setMoving(false); return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => setMoving(visible && !document.hidden && !preference.matches);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', update); preference.addEventListener('change', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); preference.removeEventListener('change', update); };
  }, [enabled]);
  return { ref, moving };
}

export function rankProgress(value: Pick<ProgressionState, 'xp' | 'level'>) {
  const band = experienceBand(value.level);
  const next = EXPERIENCE_BANDS.find(item => item.from > value.level) ?? null;
  const floor = (band.from - 1) * 100;
  const nextXP = next ? (next.from - 1) * 100 : null;
  return { band, next, floor, nextXP, ratio: nextXP === null ? 1 : Math.min(1, Math.max(0, (value.xp - floor) / Math.max(1, nextXP - floor))), toNext: nextXP === null ? 0 : Math.max(0, nextXP - value.xp) };
}

/** Existing 3D rank art: ambient float, press squash and a pointer-tilt parallax. Decorative unless `interactive`. */
export function RankMedal({ level, size = 96, animated = true, interactive = false, drop = false, label }: {
  level: number; size?: number; animated?: boolean; interactive?: boolean; drop?: boolean; label?: string;
}) {
  const { ref, moving } = useRewardMotion(animated);
  const [pressed, setPressed] = useState(false);
  const band = experienceBand(level);
  const kind = band.art.replace('rank-', '');
  const count = kind === 'gold' ? 10 : kind === 'rose' ? 6 : kind === 'sky' ? 3 : kind === 'mint' ? 2 : 4;
  const tilt = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - .5, y = (event.clientY - box.top) / box.height - .5;
    ref.current.style.setProperty('--tilt-y', `${(x * 18).toFixed(1)}deg`);
    ref.current.style.setProperty('--tilt-x', `${(-y * 18).toFixed(1)}deg`);
  };
  const untilt = () => { ref.current?.style.setProperty('--tilt-x', '0deg'); ref.current?.style.setProperty('--tilt-y', '0deg'); setPressed(false); };
  const art = <><span className={styles.rankFloor} /><span className={styles.rankFeedback}>
    <span className={styles.rankFloat}>
      <span className={styles.rankAtmosphere}>{Array.from({ length: count }, (_, index) => <i key={index} style={{ '--i': index, '--angle': `${360 * index / count - 90}deg` } as CSSProperties} />)}</span>
      <img className={styles.rankArt} src={`/rewards-v041/${band.art}.png`} width={size} height={size} alt="" draggable={false} />
      <span className={styles.rankSheen}><i /></span>
    </span>
  </span></>;
  return <span ref={ref} className={styles.rankEmblem} data-rank={kind} data-moving={animated && moving} data-pressed={pressed} data-drop={drop}
    style={{ width: size, height: size, '--rank-art': `url('/rewards-v041/${band.art}.png')`, '--rank-radius': `${size * .32}px` } as CSSProperties}
    onPointerMove={tilt} onPointerLeave={untilt}>
    {interactive
      ? <button type="button" className={styles.rankTouch} aria-label={label ?? `Ранг «${band.title}»`}
        onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerCancel={untilt} onBlur={untilt}>{art}</button>
      : <span className={styles.rankStatic} aria-hidden="true">{art}</span>}
  </span>;
}

export function AchievementMedal({ id, size = 56, motion = 'still', locked = false, flip = false }: { id: string; size?: number; motion?: 'earned' | 'goal' | 'still'; locked?: boolean; flip?: boolean }) {
  const { ref, moving } = useRewardMotion(motion !== 'still');
  return <span ref={ref} className={styles.achievementEmblem} data-reward-motion={motion} data-moving={moving} data-locked={locked} data-flip={flip} aria-hidden="true" style={{ width: size, height: size }}>
    <span className={styles.achievementFloor} /><span className={styles.achievementFeedback}><img className={styles.achievementArt} src={achievementArt(id)} width={size} height={size} alt="" draggable={false} /></span>
  </span>;
}

/** XP towards the next rank. `data-xp-target` is where celebration capsules fly to. */
export function XpBar({ value, compact = false, target = false }: { value: Pick<ProgressionState, 'xp' | 'level'>; compact?: boolean; target?: boolean }) {
  const progress = rankProgress(value);
  return <div className={styles.xp} {...(target ? { 'data-xp-target': true } : {})}>
    {!compact && <div className={styles.xpTop}><span className={styles.xpValue}><RollingNumber value={value.xp} /><small>XP</small></span><span className="caption">Уровень опыта {value.level}</span></div>}
    <div className="progress-track lime" role="progressbar" aria-label={progress.next ? `Опыт до ранга «${progress.next.title}»` : 'Все ранги открыты'}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)} style={{ '--value': progress.ratio } as CSSProperties}><span /></div>
    <div className={styles.xpLabels}><span>{progress.next ? `До «${progress.next.title}» ещё ${progress.toNext} XP` : 'Все шесть рангов открыты'}</span>{compact && <span><RollingNumber value={value.xp} /> XP</span>}</div>
  </div>;
}

export function RankLadder({ value }: { value: Pick<ProgressionState, 'xp' | 'level'> }) {
  const current = experienceBand(value.level);
  const next = EXPERIENCE_BANDS.find(band => band.from > value.level);
  return <ol className={styles.ladder} aria-label="Шесть рангов опыта" data-testid="rank-ladder">{EXPERIENCE_BANDS.map(band => {
    const minimumXP = (band.from - 1) * 100;
    const isCurrent = band.art === current.art;
    const unlocked = value.level >= band.from;
    return <li key={band.art} data-current={isCurrent} data-unlocked={unlocked}>
      <RankMedal level={band.from} size={64} animated={isCurrent} />
      <div className={styles.ladderCopy}><strong>{band.title}</strong><span>Уровень {band.from} · от {minimumXP} XP</span>
        <small>{isCurrent ? `Твой ранг · ${value.xp} XP` : band.art === next?.art ? `Следующий · ещё ${Math.max(0, minimumXP - value.xp)} XP` : unlocked ? 'Открыт' : 'Впереди'}</small></div>
      <span className={styles.ladderStatus} aria-hidden="true">{unlocked ? <CheckIcon size={16} weight="bold" /> : <LockSimpleIcon size={15} />}</span>
    </li>;
  })}</ol>;
}

/** Counters never exceed their target (DESIGN-SYSTEM §3 Progress); an unlocked rubric reads «Открыто». */
export function Achievements({ value, state, onTarget, limit }: { value: ProgressionState; state: AppState; onTarget: (target: AchievementTarget) => void; limit?: number }) {
  const ratio = (current: number, target: number) => Math.min(1, Math.max(0, target > 0 ? current / target : 0));
  const unlocked = value.achievements.filter(item => item.unlocked).sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''));
  const upcoming = value.achievements.filter(item => !item.unlocked).sort((a, b) => ratio(b.current, b.target) - ratio(a.current, a.target));
  const ordered = [...upcoming, ...unlocked].slice(0, limit ?? Infinity);
  return <div className={styles.achievements} data-testid="achievements">{ordered.map((item, index) => {
    const shown = Math.min(item.current, item.target);
    const target = item.unlocked ? null : achievementTarget(item.id, state);
    return <article key={item.id} className={`glass flat ${styles.achievement} reveal`} style={{ '--i': index } as CSSProperties} data-unlocked={item.unlocked}>
      <AchievementMedal id={item.id} motion={item.unlocked ? 'earned' : index === 0 ? 'goal' : 'still'} locked={!item.unlocked} />
      <div className={styles.achievementCopy}><strong>{item.title}</strong>
        <small>{item.unlocked ? `Открыто${item.unlockedAt ? ' · ' + shortDate(item.unlockedAt) : ''}` : `${shown} из ${item.target}`}</small></div>
      <div className={styles.achievementDetail}>
        <p>{item.description}</p>
        {!item.unlocked && <div className="progress-track" role="progressbar" aria-label={item.title} aria-valuemin={0} aria-valuemax={item.target} aria-valuenow={shown} style={{ '--value': ratio(shown, item.target) } as CSSProperties}><span /></div>}
        {target?.available && <button type="button" className="text-button" onClick={() => onTarget(target)} title={target.reason}>{target.label}<ArrowRightIcon size={15} /></button>}
      </div>
    </article>;
  })}</div>;
}
