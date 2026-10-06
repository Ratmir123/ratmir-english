'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { ArrowRightIcon, CheckIcon, LockSimpleIcon } from '@phosphor-icons/react';
import type { AppState, ProgressionState } from '@/lib/types';
import { achievementArt, achievementTarget, EXPERIENCE_BANDS, experienceBand, rewardArtUrl, type AchievementTarget } from '@/lib/achievement-targets';
import { shortDate } from '../app/labels';
import { MEDAL, medalEdges, useMedal3D, useReducedMotion } from './medal-3d';
import { RollingNumber } from './rolling-number';
import { insideShell, isShellCovered, subscribeShellCover } from './shell-cover';
import styles from './rewards.module.css';

/** Rows of the achievements grid that rise in with `.reveal` (PASS-0.5.3 §5.3); the rest are simply there. */
const REVEAL_ROWS = 8;

/**
 * Decorations sleep outside the viewport, in a hidden window and with reduced motion. `seen` (no re-render) tells the
 * turn loop whether the medal is known to be offscreen.
 */
function useRewardMotion<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const seen = useRef({ known: false, visible: false });
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') { setMoving(false); return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMoving(seen.current.visible && !document.hidden && !preference.matches);
    const observer = new IntersectionObserver(([entry]) => { seen.current = { known: true, visible: entry.isIntersecting }; update(); });
    observer.observe(element);
    document.addEventListener('visibilitychange', update); preference.addEventListener('change', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); preference.removeEventListener('change', update); };
  }, [enabled]);
  return { ref, moving, seen };
}

/**
 * Whether the launch or placement layer covers the shell this element sits in (PASS-0.5.3 §5): then its CSS is paused
 * (rewards.module.css) and it never starts a turn. A sheet in the top layer (the rank-up) is above any cover.
 */
function useShellCover(ref: RefObject<HTMLElement | null>) {
  const covered = useSyncExternalStore(subscribeShellCover, isShellCovered, () => false);
  const [inShell, setInShell] = useState(false);
  useLayoutEffect(() => { const element = ref.current; setInShell(insideShell(element) && !element?.closest('dialog')); }, [ref]);
  return { inShell, covered: covered && inShell };
}

const rankKind = (art: string) => art.replace('rank-', '');

export function rankProgress(value: Pick<ProgressionState, 'xp' | 'level'>) {
  const band = experienceBand(value.level);
  const next = EXPERIENCE_BANDS.find(item => item.from > value.level) ?? null;
  const floor = (band.from - 1) * 100;
  const nextXP = next ? (next.from - 1) * 100 : null;
  return { band, next, floor, nextXP, ratio: nextXP === null ? 1 : Math.min(1, Math.max(0, (value.xp - floor) / Math.max(1, nextXP - floor))), toNext: nextXP === null ? 0 : Math.max(0, nextXP - value.xp) };
}

/**
 * Rank art as a physical medal (DESIGN-PASS-0.5.1): stacked silhouettes give it a rim, light and foil
 * move against the turn, drag spins it, a tap turns it once slowly, `drop` is the rank-up entrance, and a visible idle
 * hero medal (≥ 64 px) turns once by itself now and then (PASS-0.5.3 §8). Below 48 px it stays flat art with a float
 * and a glint. `aura` breathes the rank colour behind it; `ring` circles a small medal in it. Decorative unless
 * `interactive`.
 */
export function RankMedal({ level, size = 96, animated = true, interactive = false, drop = false, label, aura = false, ring = false, showcase = true }: {
  level: number; size?: number; animated?: boolean; interactive?: boolean; drop?: boolean; label?: string; aura?: boolean; ring?: boolean; showcase?: boolean;
}) {
  const reduced = useReducedMotion();
  const band = experienceBand(level);
  const kind = rankKind(band.art);
  const lit = size >= MEDAL.solidMin;
  const responsive = lit && (animated || interactive || drop);
  const solid = responsive && !reduced;
  const { ref, moving, seen } = useRewardMotion<HTMLSpanElement>(animated || solid);
  const shell = useShellCover(ref);
  const [pressed, setPressed] = useState(false);
  const [nested, setNested] = useState(false);
  const sheen = useRef<HTMLElement>(null);
  const light = useRef<HTMLElement>(null);
  const count = kind === 'gold' ? 10 : kind === 'rose' ? 6 : kind === 'sky' ? 3 : kind === 'mint' ? 2 : 4;
  const gestures = solid && !nested;
  const holo = lit && (kind === 'violet' || kind === 'rose' || kind === 'gold');
  // A small medal that moves keeps a 2D glint (the sidebar chip).
  const glints = lit || animated;
  const src = rewardArtUrl(band.art, size);
  const { depth, layers } = medalEdges(size);
  const glint = useCallback((delay = 0) => {
    if (reduced) { light.current?.animate?.([{ opacity: 1 }, { opacity: 1, filter: 'brightness(1.6)' }, { opacity: 1 }], { duration: 700, delay }); return; }
    sheen.current?.animate?.([{ transform: 'translateX(0) rotate(24deg)' }, { transform: 'translateX(770%) rotate(24deg)' }],
      { duration: 820, delay, easing: 'cubic-bezier(.45, 0, .55, 1)' });
  }, [reduced]);
  // Inside a row button or link the host owns clicks and drags; the medal only tilts and sways.
  useLayoutEffect(() => { setNested(!!ref.current?.parentElement?.closest('button, a[href], [role="button"], [role="link"], label, summary')); }, [ref]);
  const sleeping = () => (seen.current.known && !seen.current.visible) || document.hidden || (shell.inShell && isShellCovered());
  const medal = useMedal3D(ref, { size, solid, responsive, nested, entrance: drop, sleeping, onPress: setPressed, onGlint: glint,
    showcase: showcase && animated && moving && !shell.covered && size >= MEDAL.showcaseMin });
  const release = () => setPressed(false);
  const art = <><span className={styles.rankFloor}><i /></span><span className={styles.rankFeedback}>
    <span className={styles.rankFloat}>
      {lit && <span className={styles.rankAtmosphere}>{Array.from({ length: count }, (_, index) => <i key={index} style={{ '--i': index, '--angle': `${360 * index / count - 90}deg` } as CSSProperties} />)}</span>}
      <span className={styles.rankBody}><span className={styles.rankSway}>
        {solid && <>
          <i className={styles.rankBack} />
          {layers.map(layer => <i key={layer.z} className={styles.rankEdge} style={{ '--z': `${layer.z.toFixed(2)}px`, '--mix': `${(layer.mix * 100).toFixed(1)}%` } as CSSProperties} />)}
          <i className={styles.rankSide} />
          <i className={styles.rankEdgeGlint} />
        </>}
        <span className={styles.rankFace}>
          <img className={styles.rankArt} src={src} width={size} height={size} alt="" draggable={false} decoding="async" />
          {lit && <span ref={light} className={styles.rankLight}><i /></span>}
          {holo && <span className={styles.rankHolo}><i /></span>}
          {glints && <span className={styles.rankSheen}><i ref={sheen} /></span>}
        </span>
      </span></span>
    </span>
  </span></>;
  return <span ref={ref} className={styles.rankEmblem} data-rank={kind} data-moving={animated && moving} data-pressed={pressed} data-drop={drop}
    data-lit={lit} data-solid={solid} data-gestures={gestures} data-holo={holo}
    style={{ width: size, height: size, '--rank-art': `url('${src}')`, '--rank-radius': `${size * .32}px`, '--medal-size': `${size}px`,
      '--medal-scale': Math.min(1, size / 96).toFixed(3), '--depth': `${depth.toFixed(2)}px` } as CSSProperties}
    onPointerDown={medal.onPointerDown} onPointerMove={medal.onPointerMove} onPointerUp={event => { release(); medal.onPointerUp(event); }}
    onPointerCancel={event => { release(); medal.onPointerCancel(event); }} onPointerLeave={() => { release(); medal.onPointerLeave(); }} onClick={medal.onClick}>
    {aura && <span className={styles.rankAura} aria-hidden="true" />}
    {ring && <span className={styles.rankRing} aria-hidden="true" />}
    {interactive
      ? <button type="button" className={styles.rankTouch} aria-label={label ?? `Ранг «${band.title}»`}
        onPointerDown={() => setPressed(true)} onBlur={release}>{art}</button>
      : <span className={styles.rankStatic} aria-hidden="true">{art}</span>}
  </span>;
}

/** A rank's title in its colour (≥ 4.5:1 on cards in both themes). */
export function RankName({ level, className }: { level: number; className?: string }) {
  const band = experienceBand(level);
  return <span className={`${styles.tone} ${styles.rankName}${className ? ' ' + className : ''}`} data-rank={rankKind(band.art)}>{band.title}</span>;
}

export function AchievementMedal({ id, size = 56, motion = 'still', locked = false, flip = false }: { id: string; size?: number; motion?: 'earned' | 'goal' | 'still'; locked?: boolean; flip?: boolean }) {
  const { ref, moving } = useRewardMotion<HTMLSpanElement>(motion !== 'still');
  return <span ref={ref} className={styles.achievementEmblem} data-reward-motion={motion} data-moving={moving} data-locked={locked} data-flip={flip} aria-hidden="true" style={{ width: size, height: size }}>
    <span className={styles.achievementFloor} /><span className={styles.achievementFeedback}><img className={styles.achievementArt} src={achievementArt(id, size)} width={size} height={size} alt="" draggable={false} decoding="async" /></span>
  </span>;
}

/**
 * XP towards the next rank in the rank's colours: the fill grows by scaleX, a soft light crosses it now and then
 * (transform only, asleep offscreen, hidden, covered or with reduced motion). The label reads «до «Ритм» — 120 XP»,
 * at the top «Высший ранг»; `bare` leaves only the bar, `slim` makes it 6 px. Spans only: it may sit inside a button.
 */
export function RankXp({ value, bare = false, slim = false, shimmer = true }: { value: Pick<ProgressionState, 'xp' | 'level'>; bare?: boolean; slim?: boolean; shimmer?: boolean }) {
  const progress = rankProgress(value);
  const { ref, moving } = useRewardMotion<HTMLSpanElement>(shimmer);
  return <span ref={ref} className={`${styles.tone} ${styles.rankXp}`} data-rank={rankKind(progress.band.art)} data-moving={shimmer && moving} data-slim={slim || undefined}>
    <span className={styles.rankXpTrack} role="progressbar" aria-label={progress.next ? `Опыт до ранга «${progress.next.title}»` : 'Высший ранг открыт'}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)} style={{ '--value': progress.ratio } as CSSProperties}>
      <span className={styles.rankXpFill} />
      {shimmer && <span className={styles.rankXpShine} aria-hidden="true"><i /></span>}
    </span>
    {!bare && <span className={styles.rankXpLabel}>{progress.next ? `до «${progress.next.title}» — ${progress.toNext.toLocaleString('ru-RU')} XP` : 'Высший ранг'}</span>}
  </span>;
}

/** XP towards the next rank. `data-xp-target` is where celebration capsules fly to. */
export function XpBar({ value, compact = false, target = false }: { value: Pick<ProgressionState, 'xp' | 'level'>; compact?: boolean; target?: boolean }) {
  return <div className={styles.xp} {...(target ? { 'data-xp-target': true } : {})}>
    {!compact && <div className={styles.xpTop}><span className={styles.xpValue}><RollingNumber value={value.xp} /><small>XP</small></span><span className="caption">Уровень опыта {value.level}</span></div>}
    <RankXp value={value} />
  </div>;
}

/** Six ranks; the current one is bigger, turns and breathes its colour; ranks still ahead are muted. */
export function RankLadder({ value }: { value: Pick<ProgressionState, 'xp' | 'level'> }) {
  const current = experienceBand(value.level);
  const next = EXPERIENCE_BANDS.find(band => band.from > value.level);
  return <ol className={styles.ladder} aria-label="Шесть рангов опыта" data-testid="rank-ladder">{EXPERIENCE_BANDS.map(band => {
    const minimumXP = (band.from - 1) * 100;
    const isCurrent = band.art === current.art;
    const unlocked = value.level >= band.from;
    return <li key={band.art} className={styles.tone} data-rank={rankKind(band.art)} data-current={isCurrent} data-unlocked={unlocked}>
      <span className={styles.ladderMedal}><RankMedal level={band.from} size={isCurrent ? 84 : 64} animated={isCurrent} aura={isCurrent} /></span>
      <div className={styles.ladderCopy}><strong>{band.title}</strong><span>Уровень {band.from} · от {minimumXP} XP</span>
        <small>{isCurrent ? `Твой ранг · ${value.xp} XP` : band.art === next?.art ? `Следующий · ещё ${Math.max(0, minimumXP - value.xp)} XP` : unlocked ? 'Открыт' : 'Впереди'}</small></div>
      <span className={styles.ladderStatus} aria-hidden="true">{unlocked ? <CheckIcon size={16} weight="bold" /> : <LockSimpleIcon size={15} />}</span>
    </li>;
  })}</ol>;
}

/** The arrow rides on the last word, so a wrapped label never leaves it alone on a line. */
function TargetLabel({ label }: { label: string }) {
  const cut = label.lastIndexOf(' ');
  return <>{cut > 0 ? label.slice(0, cut + 1) : ''}<span className={styles.targetTail}>{label.slice(cut + 1)}<ArrowRightIcon size={15} aria-hidden="true" /></span></>;
}

/**
 * Counters never exceed their target (DESIGN-SYSTEM §3 Progress); an unlocked rubric reads «Открыто».
 * Only the first eight cards rise in (`.reveal`); place the grid outside any `[data-enter]` block.
 */
export function Achievements({ value, state, onTarget, limit }: { value: ProgressionState; state: AppState; onTarget: (target: AchievementTarget) => void; limit?: number }) {
  const ratio = (current: number, target: number) => Math.min(1, Math.max(0, target > 0 ? current / target : 0));
  const unlocked = value.achievements.filter(item => item.unlocked).sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''));
  const upcoming = value.achievements.filter(item => !item.unlocked).sort((a, b) => ratio(b.current, b.target) - ratio(a.current, a.target));
  const ordered = [...upcoming, ...unlocked].slice(0, limit ?? Infinity);
  return <div className={styles.achievements} data-testid="achievements">{ordered.map((item, index) => {
    const shown = Math.min(item.current, item.target);
    const target = item.unlocked ? null : achievementTarget(item.id, state);
    const reveal = index < REVEAL_ROWS;
    return <article key={item.id} className={`surface flat ${styles.achievement}${reveal ? ' reveal' : ''}`} style={reveal ? { '--i': index } as CSSProperties : undefined} data-unlocked={item.unlocked}>
      <AchievementMedal id={item.id} motion={item.unlocked ? 'earned' : index === 0 ? 'goal' : 'still'} locked={!item.unlocked} />
      <div className={styles.achievementCopy}><strong>{item.title}</strong>
        <small>{item.unlocked ? `Открыто${item.unlockedAt ? ' · ' + shortDate(item.unlockedAt) : ''}` : `${shown} из ${item.target}`}</small></div>
      <div className={styles.achievementDetail}>
        <p>{item.description}</p>
        {!item.unlocked && <div className="progress-track" role="progressbar" aria-label={item.title} aria-valuemin={0} aria-valuemax={item.target} aria-valuenow={shown} style={{ '--value': ratio(shown, item.target) } as CSSProperties}><span /></div>}
        {target?.available && <button type="button" className={`text-button ${styles.targetLink}`} onClick={() => onTarget(target)} title={target.reason}>
          <TargetLabel label={target.label} /></button>}
      </div>
    </article>;
  })}</div>;
}
