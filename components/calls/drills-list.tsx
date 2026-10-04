'use client';

/** Personal drills from calls, patterns and the placement result. «Начать» opens a call-mode session. */
import { useState, type CSSProperties } from 'react';
import {
  ArrowRightIcon, CardsIcon, ChatsCircleIcon, CheckCircleIcon, CheckIcon, CurrencyDollarIcon, EnvelopeSimpleIcon, FlagIcon, LightningIcon,
  MegaphoneIcon, QuestionIcon, RepeatIcon, TranslateIcon, type Icon,
} from '@phosphor-icons/react';
import type { DrillType, PersonalDrill } from '@/lib/calls/types';
import type { Mode } from '@/lib/types';
import { Chip, cx, kit, TtsButton } from './kit';
import { DRILL_TYPE_LABEL, dueLabel, formatClock, sortDrills } from './format';
import styles from './patterns.module.css';

export const DRILL_ICON: Record<DrillType, Icon> = {
  replay: RepeatIcon, pitch: MegaphoneIcon, price: CurrencyDollarIcon, questions: QuestionIcon, closing: FlagIcon, language: TranslateIcon,
  story: ChatsCircleIcon, followup: EnvelopeSimpleIcon, rapidfire: LightningIcon, cards: CardsIcon,
};

function Tier({ tier }: { tier: 1 | 2 | 3 }) {
  return (
    <span className={styles.tier} title={`Давление ${tier} из 3`} aria-label={`Давление ${tier} из 3`}>
      {[1, 2, 3].map(level => <i key={level} data-on={level <= tier} />)}
    </span>
  );
}

export function DrillsList({ drills, onStartDrill, limit }: { drills: PersonalDrill[]; onStartDrill: (drillId: string, mode: Mode) => void; limit?: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = sortDrills(drills);
  const visible = limit ? sorted.slice(0, limit) : sorted;
  if (!visible.length) {
    return <p className={cx(kit.scope, kit.muted)} style={{ margin: 0, fontSize: 14 }}>Тренировок пока нет — они появятся из разборов звонков и теста уровня.</p>;
  }
  return (
    <ul className={cx(kit.scope, styles.drills)} aria-label="Тренировки">
      {visible.map((drill, index) => {
        const DrillIcon = DRILL_ICON[drill.type] ?? RepeatIcon;
        const due = dueLabel(drill.dueAt);
        const done = drill.status === 'done';
        const open = expanded === drill.id;
        return (
          <li key={drill.id} className={cx(kit.glass, styles.drill, kit.rise)} data-status={drill.status} data-due={due.due && !done}
            style={{ ['--i' as string]: index } as CSSProperties}>
            <div className={styles.drillHead}>
              <span className={styles.drillIcon} aria-hidden="true">{done ? <CheckCircleIcon size={20} weight="fill" /> : <DrillIcon size={20} weight="bold" />}</span>
              <div className={styles.drillTitle}>
                <strong>{drill.title}</strong>
                <span>{DRILL_TYPE_LABEL[drill.type]}{drill.source.type === 'call' && drill.source.at !== null ? ` · момент ${formatClock(drill.source.at)}` : ''}</span>
              </div>
              <Tier tier={drill.tier} />
            </div>
            {drill.why ? <p className={styles.drillWhy}>{drill.why}</p> : null}
            {drill.seedLine ? (
              <div className={styles.seed}>
                <blockquote className={cx(kit.quote, kit.en)} lang="en">{drill.seedLine}</blockquote>
                <TtsButton text={drill.seedLine} compact label="Послушать реплику" />
              </div>
            ) : null}
            {open ? (
              <>
                {drill.goal ? <p className={styles.drillWhy}><strong>Цель:</strong> {drill.goal}</p> : null}
                {drill.successCriteria.length ? (
                  <ul className={styles.criteria} aria-label="Что засчитаем">
                    {drill.successCriteria.map((item, criterion) => <li key={criterion}><CheckIcon size={14} weight="bold" />{item}</li>)}
                  </ul>
                ) : null}
              </>
            ) : null}
            <div className={styles.drillFoot}>
              <div className={styles.drillMeta}>
                {done ? <Chip tone="lime">Готово</Chip> : drill.status === 'started' ? <Chip tone="violet">Начата</Chip> : <Chip tone={due.due ? 'lime' : 'neutral'}>{due.label}</Chip>}
                {drill.attempts ? <span>попыток: {drill.attempts}</span> : null}
                {drill.goal || drill.successCriteria.length ? (
                  <button type="button" className={kit.linkBtn} aria-expanded={open} onClick={() => setExpanded(open ? null : drill.id)}>
                    {open ? 'Скрыть критерии' : 'Что засчитаем'}
                  </button>
                ) : null}
              </div>
              <div className={styles.drillActions}>
                {done ? null : <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} onClick={() => onStartDrill(drill.id, 'learning')}>С подсказками</button>}
                <button type="button" className={cx(kit.btn, done ? kit.secondary : kit.primary, kit.small)} onClick={() => onStartDrill(drill.id, 'call')}>
                  {done ? 'Ещё раз' : drill.status === 'started' ? 'Продолжить' : 'Начать'}<ArrowRightIcon size={14} weight="bold" />
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
