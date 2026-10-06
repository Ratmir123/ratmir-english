'use client';

/**
 * Personal drills from calls, patterns and the placement result as rows (title, why, the line to replay, a meta line, the
 * start actions); hosts put them inside their own surface. One start behaviour everywhere (MOTION-PASS-0.5.2 §8.6, the rule
 * of Practice «Для тебя»): the button starts the default mode — pressure tier 2–3 «Как на созвоне», tier 1 «С опорами» —
 * and a small text action beside it starts the other one. One order everywhere: today-plan `drillOrder`, done ones last.
 */
import {
  ArrowRightIcon, CardsIcon, ChatsCircleIcon, CheckCircleIcon, CurrencyDollarIcon, EnvelopeSimpleIcon, FlagIcon, LightningIcon,
  MegaphoneIcon, QuestionIcon, RepeatIcon, TranslateIcon, type Icon,
} from '@phosphor-icons/react';
import type { DrillType, PersonalDrill } from '@/lib/calls/types';
import type { Mode } from '@/lib/types';
import { MODE_LABEL } from '../app/labels';
import { sortDrillRows } from '../app/today-plan';
import { drillTile } from '../practice/for-you-model';
import { cx, kit, TtsButton } from './kit';
import { DRILL_TYPE_LABEL, dueLabel, formatClock, plural } from './format';
import styles from './patterns.module.css';

export const DRILL_ICON: Record<DrillType, Icon> = {
  replay: RepeatIcon, pitch: MegaphoneIcon, price: CurrencyDollarIcon, questions: QuestionIcon, closing: FlagIcon, language: TranslateIcon,
  story: ChatsCircleIcon, followup: EnvelopeSimpleIcon, rapidfire: LightningIcon, cards: CardsIcon,
};

const lower = (mode: Mode) => MODE_LABEL[mode].toLowerCase();

/** The start rule of Practice (for-you-model `drillTile`): the default mode and the other one (none for a written follow-up). */
export function drillModes(drill: PersonalDrill): { mode: Mode; other: Mode | null } {
  const { mode, other } = drillTile(drill, 15); // the daily budget only sets the tile's minutes
  return { mode, other };
}

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
  const { mode, other } = drillModes(drill);
  const verb = done ? 'Ещё раз' : drill.status === 'started' ? 'Продолжить' : 'Начать';
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
          {/* As on the Practice tile: the mode the button starts, «Текст» for a written follow-up. */}
          <span>{other ? MODE_LABEL[mode] : 'Текст'}</span>
          {drill.attempts ? <span className="tabular">{drill.attempts} {plural(drill.attempts, ['попытка', 'попытки', 'попыток'])}</span> : null}
        </p>
      </div>
      <div className={styles.drillActions}>
        <button type="button" className={cx(kit.btn, done || !primary ? kit.secondary : kit.primary, kit.small)} onClick={() => onStartDrill(drill.id, mode)}
          aria-label={`${verb} ${lower(mode)}: ${drill.title}`}>
          {verb}<ArrowRightIcon size={14} weight="bold" />
        </button>
        {other ? (
          <button type="button" className={styles.drillAlt} onClick={() => onStartDrill(drill.id, other)} aria-label={`${verb} ${lower(other)}: ${drill.title}`}>
            или {lower(other)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The drills of one call (one call date for all, so the shared order needs no call list). */
export function DrillsList({ drills, onStartDrill }: { drills: PersonalDrill[]; onStartDrill: (drillId: string, mode: Mode) => void }) {
  const sorted = sortDrillRows(drills);
  if (!sorted.length) {
    return <p className={cx(kit.scope, kit.muted)} style={{ margin: 0, fontSize: 14 }}>Тренировок пока нет — они появятся из разборов звонков и теста уровня.</p>;
  }
  return (
    <ul className={cx(kit.scope, kit.glass, styles.drills)} aria-label="Тренировки">
      {/* One filled button per list: the drill to do first; the rest are the same action, quieter. */}
      {sorted.map((drill, index) => <li key={drill.id}><DrillRow drill={drill} onStartDrill={onStartDrill} primary={index === 0} /></li>)}
    </ul>
  );
}
