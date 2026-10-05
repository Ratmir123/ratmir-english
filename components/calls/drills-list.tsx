'use client';

/**
 * Personal drills from calls, patterns and the placement result: one surface, one row per drill
 * (title, why, the line to replay, a meta line, one start action). Also rendered by Practice («Для тебя»).
 * The start mode follows Today's rule: pressure tier 2–3 runs as a call, tier 1 with supports.
 */
import {
  ArrowRightIcon, CardsIcon, ChatsCircleIcon, CheckCircleIcon, CurrencyDollarIcon, EnvelopeSimpleIcon, FlagIcon, LightningIcon,
  MegaphoneIcon, QuestionIcon, RepeatIcon, TranslateIcon, type Icon,
} from '@phosphor-icons/react';
import type { DrillType, PersonalDrill } from '@/lib/calls/types';
import type { Mode } from '@/lib/types';
import { MODE_LABEL } from '../app/labels';
import { cx, kit, TtsButton } from './kit';
import { DRILL_TYPE_LABEL, dueLabel, formatClock, plural, sortDrills } from './format';
import styles from './patterns.module.css';

export const DRILL_ICON: Record<DrillType, Icon> = {
  replay: RepeatIcon, pitch: MegaphoneIcon, price: CurrencyDollarIcon, questions: QuestionIcon, closing: FlagIcon, language: TranslateIcon,
  story: ChatsCircleIcon, followup: EnvelopeSimpleIcon, rapidfire: LightningIcon, cards: CardsIcon,
};

/** Same default as Today's drill card: harder drills run as a real call, easier ones with supports. */
export function drillMode(drill: Pick<PersonalDrill, 'tier'>): Mode { return drill.tier >= 2 ? 'call' : 'learning'; }

function Tier({ tier }: { tier: 1 | 2 | 3 }) {
  return (
    <span className={styles.tier} aria-label={`Давление ${tier} из 3`}>
      <span aria-hidden="true">Давление</span>
      <span className={styles.tierBars} aria-hidden="true">{[1, 2, 3].map(level => <i key={level} data-on={level <= tier} />)}</span>
    </span>
  );
}

/** One drill as a row (no card of its own): hosts put it inside their surface. `labelled` names it as a drill
 *  in the meta line where the surrounding card is about something else (a pattern). */
export function DrillRow({ drill, onStartDrill, labelled, primary = true }: {
  drill: PersonalDrill; onStartDrill: (drillId: string, mode: Mode) => void; labelled?: boolean; primary?: boolean;
}) {
  const due = dueLabel(drill.dueAt);
  const done = drill.status === 'done';
  const mode = drillMode(drill);
  const moment = drill.source.type === 'call' && drill.source.at !== null ? `момент ${formatClock(drill.source.at)}` : null;
  return (
    <div className={styles.drill} data-status={drill.status}>
      <div className={styles.drillMain}>
        <strong className={styles.drillTitle}>{drill.title}</strong>
        {drill.why ? <p className={styles.drillWhy}>{drill.why}</p> : null}
        {drill.seedLine ? (
          <div className={styles.seed}>
            <blockquote className={cx(kit.quote, kit.en)} lang="en">{drill.seedLine}</blockquote>
            <TtsButton text={drill.seedLine} compact label="Послушать реплику" />
          </div>
        ) : null}
        <p className={styles.drillMeta}>
          {done ? <span className={styles.drillState} data-tone="lime"><CheckCircleIcon size={14} weight="fill" aria-hidden="true" />Готово</span>
            : drill.status === 'started' ? <span className={styles.drillState} data-tone="violet">Начата</span>
              : <span className={styles.drillState} data-tone={due.due ? 'lime' : undefined} data-dot={due.due || undefined}>{due.label}</span>}
          <span>{labelled ? `Тренировка: ${DRILL_TYPE_LABEL[drill.type].toLowerCase()}` : DRILL_TYPE_LABEL[drill.type]}{moment ? `, ${moment}` : ''}</span>
          <Tier tier={drill.tier} />
          {done ? null : <span>Режим: {MODE_LABEL[mode].toLowerCase()}</span>}
          {drill.attempts ? <span className="tabular">{drill.attempts} {plural(drill.attempts, ['попытка', 'попытки', 'попыток'])}</span> : null}
        </p>
      </div>
      <button type="button" className={cx(kit.btn, done || !primary ? kit.secondary : kit.primary, kit.small, styles.drillStart)} onClick={() => onStartDrill(drill.id, mode)}
        aria-label={`${done ? 'Ещё раз' : drill.status === 'started' ? 'Продолжить' : 'Начать'}: ${drill.title}`}>
        {done ? 'Ещё раз' : drill.status === 'started' ? 'Продолжить' : 'Начать'}<ArrowRightIcon size={14} weight="bold" />
      </button>
    </div>
  );
}

export function DrillsList({ drills, onStartDrill, limit }: { drills: PersonalDrill[]; onStartDrill: (drillId: string, mode: Mode) => void; limit?: number }) {
  const sorted = sortDrills(drills);
  const visible = limit ? sorted.slice(0, limit) : sorted;
  if (!visible.length) {
    return <p className={cx(kit.scope, kit.muted)} style={{ margin: 0, fontSize: 14 }}>Тренировок пока нет — они появятся из разборов звонков и теста уровня.</p>;
  }
  return (
    <ul className={cx(kit.scope, kit.glass, styles.drills)} aria-label="Тренировки">
      {/* One filled button per list: the drill to do first; the rest are the same action, quieter. */}
      {visible.map((drill, index) => <li key={drill.id}><DrillRow drill={drill} onStartDrill={onStartDrill} primary={index === 0} /></li>)}
    </ul>
  );
}
