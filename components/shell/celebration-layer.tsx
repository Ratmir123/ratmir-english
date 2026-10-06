'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, SparkleIcon } from '@phosphor-icons/react';
import { fireConfetti } from '../mascot/confetti';
import type { Celebration } from '../app/celebrations';
import { AchievementMedal, RankMedal, RankName } from '../ui/rewards';
import { MOTION_MS } from '../ui/motion';
import { Sheet } from '../ui/sheet';
import { Companion } from './companion';
import styles from './celebration.module.css';

const reduced = () => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** «+20 XP» capsule flies from the action to the XP bar (sidebar rank chip), then the target bumps. */
function XpFlyout({ item, origin, onDone: done }: { item: Extract<Celebration, { kind: 'xp' }>; origin: DOMRect | null; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    const onDone = () => doneRef.current();
    const element = ref.current;
    if (!element) { onDone(); return; }
    const box = element.getBoundingClientRect();
    const startX = origin ? origin.left + origin.width / 2 : window.innerWidth / 2;
    const startY = origin ? origin.top : window.innerHeight * 0.7;
    const target = [...document.querySelectorAll<HTMLElement>('[data-xp-target]')].find(node => node.getClientRects().length > 0 && node.offsetParent !== null);
    const end = target?.getBoundingClientRect();
    const dx = (end ? end.left + end.width / 2 : startX) - startX;
    const dy = (end ? end.top + end.height / 2 : startY - 140) - startY;
    const x0 = startX - box.width / 2, y0 = startY - box.height / 2;
    if (reduced() || !element.animate) {
      element.style.transform = `translate(${x0}px, ${y0 - 40}px)`;
      const timer = setTimeout(onDone, 1400);
      return () => clearTimeout(timer);
    }
    const animation = element.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 54}px) scale(1.12)`, opacity: 1, offset: 0.28 },
      { transform: `translate(${x0}px, ${y0 - 60}px) scale(1)`, opacity: 1, offset: 0.48 },
      { transform: `translate(${x0 + dx}px, ${y0 + dy}px) scale(.55)`, opacity: end ? 0.9 : 0 },
    ], { duration: 1500, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
    animation.onfinish = () => {
      target?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: MOTION_MS.bouncy, easing: 'cubic-bezier(.34,1.56,.64,1)' } /* a reward: overshoot allowed */);
      onDone();
    };
    return () => animation.cancel();
  }, [item.id, origin]);
  return <div ref={ref} className={styles.xp} role="status" aria-live="polite">
    <SparkleIcon size={16} weight="fill" aria-hidden="true" />+{item.amount} XP{item.levelUp && <span className={styles.level}>уровень {item.level}</span>}
  </div>;
}

function AchievementToast({ item, onDone, onOpen }: { item: Extract<Celebration, { kind: 'achievement' }>; onDone: () => void; onOpen: () => void }) {
  const medal = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const burst = setTimeout(() => { if (medal.current) fireConfetti(medal.current, { count: 60, power: 520 }); }, 420);
    const timer = setTimeout(() => doneRef.current(), 5200);
    return () => { clearTimeout(burst); clearTimeout(timer); };
  }, [item.id]);
  return <div className={`glass ${styles.achievement}`} role="status" data-testid="achievement-unlock">
    <div ref={medal} className={styles.achievementMedal}><AchievementMedal id={item.achievementId} size={64} motion="earned" flip /></div>
    <div className={styles.achievementCopy}><span className="eyebrow">Новая награда</span><strong>{item.title}</strong><small>{item.description}</small></div>
    <button type="button" className="button small secondary" onClick={() => { onOpen(); onDone(); }}>Смотреть<ArrowRightIcon size={14} /></button>
  </div>;
}

function RankSheet({ item, onDone }: { item: Extract<Celebration, { kind: 'rank' }>; onDone: () => void }) {
  const [celebrate] = useState(1);
  useEffect(() => { const timer = setTimeout(() => fireConfetti(null, { count: 120 }), 380); return () => clearTimeout(timer); }, [item.id]);
  // The medal drops in and makes two slow turns onto its face (PASS-0.5.3 §8), breathing its colour; the title wears it too.
  return <Sheet open onClose={onDone} title={<>Новый ранг — «<RankName level={item.level} />»</>} eyebrow="Ранг опыта" className={styles.rankSheet} testId="rank-up"
    actions={<button type="button" className="button primary large block" onClick={onDone} autoFocus>Забрать</button>}>
    <div className={styles.rankStage}>
      <RankMedal level={item.level} size={168} drop aura />
      <div className={styles.rankMascot}><Companion emotion="love" celebrate={celebrate} celebrateEmotion="excited" confetti={false} interactive={false} status="Празднует новый ранг" exclusive={false} /></div>
    </div>
    <p className="muted">Уровень опыта {item.level}. Ранги отмечают твою практику — уровень английского показывает тест.</p>
  </Sheet>;
}

export function CelebrationLayer({ queue, origin, onDone, onOpenRewards }: { queue: Celebration[]; origin: DOMRect | null; onDone: (id: string) => void; onOpenRewards: () => void }) {
  const current = queue[0];
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (current?.kind !== 'improved') return;
    fireConfetti(origin ? { x: origin.left + origin.width / 2, y: origin.top + 20 } : null, { count: 60, power: 560 });
    const timer = setTimeout(() => doneRef.current(current.id), 300);
    return () => clearTimeout(timer);
  }, [current, origin]);
  if (!current) return null;
  const done = () => doneRef.current(current.id);
  if (current.kind === 'xp') return <XpFlyout key={current.id} item={current} origin={origin} onDone={done} />;
  if (current.kind === 'achievement') return <AchievementToast key={current.id} item={current} onDone={done} onOpen={onOpenRewards} />;
  if (current.kind === 'rank') return <RankSheet key={current.id} item={current} onDone={done} />;
  return null;
}
