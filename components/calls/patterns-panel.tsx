'use client';

/**
 * «Мои паттерны»: weaknesses first by cost, one card per pattern with plain sections (history in words,
 * an inline confirmation question, attached drills as rows, description and quotes on demand), then strengths.
 */
import { useEffect, useState } from 'react';
import {
  ArrowUpRightIcon, CaretRightIcon, CheckCircleIcon, CheckIcon, EyeSlashIcon, LightbulbIcon, MinusCircleIcon, SealCheckIcon, XCircleIcon, type Icon,
} from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CommunicationPattern, PatternOutcome, PatternUpdateRequest, PersonalDrill } from '@/lib/calls/types';
import type { Mode } from '@/lib/types';
import { Chip, cx, kit, Spinner } from './kit';
import { COST_CATEGORY_LABEL, costRankLabel, formatClock, formatDay, OUTCOME_GLYPH, PATTERN_STATUS, plural, roundsLabel, sortDrills, sortPatterns } from './format';
import { DrillRow } from './drills-list';
import styles from './patterns.module.css';

const SOURCE_LABEL = { call: 'звонок', practice: 'тренировка', placement: 'тест' } as const;

/** Drawn outcome marks (no unicode glyphs): the shape carries the meaning, the colour only repeats it. */
export const OUTCOME_ICON: Record<PatternOutcome, Icon> = {
  repeated: XCircleIcon, new: XCircleIcon, avoided: CheckCircleIcon, improved: ArrowUpRightIcon, 'no-opportunity': MinusCircleIcon,
};

function upperFirst(text: string): string { return text ? text[0].toUpperCase() + text.slice(1) : text; }

/** Compact sequence of outcome marks (Today's «Над чем работаем»); each mark names its date, source and outcome. */
export function HistoryDots({ pattern, max = 10 }: { pattern: CommunicationPattern; max?: number }) {
  const items = pattern.history.slice(-max);
  if (!items.length) return null;
  return (
    <span className={styles.marks} role="img" aria-label={`История: ${items.map(item => `${formatDay(item.date) ?? ''} ${SOURCE_LABEL[item.source]} — ${OUTCOME_GLYPH[item.status].label}`).join('; ')}`}>
      {items.map((item, index) => {
        const Mark = OUTCOME_ICON[item.status];
        return (
          <span key={`${item.sourceId}-${index}`} className={styles.mark} data-tone={OUTCOME_GLYPH[item.status].tone}
            title={`${formatDay(item.date) ?? ''} · ${SOURCE_LABEL[item.source]} · ${OUTCOME_GLYPH[item.status].label}`}>
            <Mark size={18} weight={item.source === 'call' ? 'fill' : 'regular'} />
          </span>
        );
      })}
    </span>
  );
}

/** Totals in words: «В звонках: повторилось 1 раз · В тренировках: ещё не было». */
function Rounds({ pattern }: { pattern: CommunicationPattern }) {
  const rounds = roundsLabel(pattern);
  return <p className={styles.rounds}><span>{rounds.real}</span><span>{rounds.practice}</span></p>;
}

/** The latest outcomes as a readable list: mark, what happened, when and where. */
function History({ pattern, max = 4 }: { pattern: CommunicationPattern; max?: number }) {
  const items = pattern.history.slice(-max);
  const older = pattern.history.length - items.length;
  return (
    <div className={styles.block} role="group" aria-label="История">
      <Rounds pattern={pattern} />
      {items.length ? (
        <ol className={styles.historyList}>
          {items.map((item, index) => {
            const Mark = OUTCOME_ICON[item.status];
            return (
              <li key={`${item.sourceId}-${index}`}>
                <span className={styles.mark} data-tone={OUTCOME_GLYPH[item.status].tone} aria-hidden="true"><Mark size={18} weight="fill" /></span>
                <span className={styles.historyWhat}>{upperFirst(OUTCOME_GLYPH[item.status].label)}</span>
                <span className={styles.historyWhen}>{[formatDay(item.date), SOURCE_LABEL[item.source]].filter(Boolean).join(', ')}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {older > 0 ? <p className={styles.historyOlder}>и ещё {older} {plural(older, ['отметка', 'отметки', 'отметок'])} раньше</p> : null}
    </div>
  );
}

export function PatternsPanel({ patterns, drills, onStartDrill, compact, onChanged, onOpenAll }: {
  patterns: CommunicationPattern[]; drills: PersonalDrill[]; onStartDrill: (drillId: string, mode: Mode) => void; compact?: boolean; onChanged?: () => void;
  onOpenAll?: () => void;
}) {
  // Optimistic list: the server answers with the whole updated list; props catch up after onChanged().
  const [local, setLocal] = useState<CommunicationPattern[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setLocal(null); }, [patterns]);
  const list = local ?? patterns;
  const sorted = sortPatterns(list);

  async function update(pattern: CommunicationPattern, body: PatternUpdateRequest) {
    setBusy(pattern.id); setError(null);
    try {
      const result = await api<{ patterns: CommunicationPattern[] }>(`patterns/${encodeURIComponent(pattern.id)}`, body);
      setLocal(result.patterns);
      onChanged?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось сохранить.'); }
    finally { setBusy(null); }
  }

  if (compact) {
    const top = sorted.weaknesses.filter(pattern => pattern.status !== 'resolved').slice(0, 2);
    return (
      <section className={cx(kit.scope, kit.glass, styles.compactCard)} aria-label="Над чем работаем">
        <div className={styles.compactHead}>
          <h2>Над чем работаем</h2>
          {onOpenAll ? <button type="button" className={kit.linkBtn} onClick={onOpenAll}>Все паттерны<CaretRightIcon size={14} weight="bold" /></button> : null}
        </div>
        {top.length ? (
          <div className={styles.compactList}>
            {top.map(pattern => (
              <div key={pattern.id} className={styles.compactItem}>
                <div className={styles.compactTop}>
                  <strong>{pattern.title}</strong>
                  <Chip tone={PATTERN_STATUS[pattern.status].tone}>{PATTERN_STATUS[pattern.status].label}</Chip>
                </div>
                <HistoryDots pattern={pattern} max={8} />
                <Rounds pattern={pattern} />
              </div>
            ))}
          </div>
        ) : <p className={kit.muted} style={{ margin: 0, fontSize: 14 }}>Паттерны появятся после первого разобранного звонка.</p>}
      </section>
    );
  }

  return (
    <section className={cx(kit.scope, styles.panel)} aria-labelledby="patterns-title">
      <div className={styles.panelHead}>
        <h2 id="patterns-title">Мои паттерны</h2>
        <p>Что повторяется от звонка к звонку и сколько это стоит. Закрывается только реальными звонками — тренировки готовят к ним.</p>
      </div>
      {error ? <p className={styles.errorLine} role="alert">{error}</p> : null}
      {!sorted.weaknesses.length && !sorted.strengths.length ? (
        <div className={cx(kit.glass, styles.emptyCard)}>
          <p className={kit.muted} style={{ margin: 0 }}>Паттерны появятся после первого разобранного звонка: например, «называешь чужой гонорар» или «соглашаешься на первую цифру».</p>
        </div>
      ) : null}
      {sorted.weaknesses.map(pattern => (
        <PatternCard key={pattern.id} pattern={pattern} drills={drills.filter(drill => drill.patternIds.includes(pattern.id))}
          busy={busy === pattern.id} onUpdate={body => void update(pattern, body)} onStartDrill={onStartDrill} />
      ))}
      {sorted.strengths.length ? (
        <>
          <h3 className={styles.groupTitle}>Сильные стороны</h3>
          <ul className={cx(kit.glass, styles.strengths)}>
            {sorted.strengths.map(pattern => <li key={pattern.id}><SealCheckIcon size={18} weight="fill" aria-hidden="true" /><span><strong>{pattern.title}.</strong> {pattern.description}</span></li>)}
          </ul>
        </>
      ) : null}
      {sorted.dismissed.length ? (
        <details className={cx(kit.details, styles.dismissed)}>
          <summary><CaretRightIcon size={14} weight="bold" aria-hidden="true" />Скрытые паттерны ({sorted.dismissed.length})</summary>
          <ul className={styles.dismissedList}>
            {sorted.dismissed.map(pattern => (
              <li key={pattern.id} className={styles.dismissedItem}>
                <span>{pattern.title}</span>
                <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy === pattern.id} onClick={() => void update(pattern, { dismiss: false })}>Вернуть</button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function PatternCard({ pattern, drills, busy, onUpdate, onStartDrill }: {
  pattern: CommunicationPattern; drills: PersonalDrill[]; busy: boolean;
  onUpdate: (body: PatternUpdateRequest) => void; onStartDrill: (drillId: string, mode: Mode) => void;
}) {
  const status = PATTERN_STATUS[pattern.status];
  const openDrills = sortDrills(drills.filter(drill => drill.status !== 'done')).slice(0, 2);
  const cost = pattern.kind === 'weakness' ? costRankLabel(pattern.costRank) : null;
  const ask = pattern.status === 'watch' && !pattern.userConfirmed;
  const titleId = `pattern-${pattern.id}`;
  return (
    <article className={cx(kit.glass, styles.pattern)} aria-labelledby={titleId}>
      <header className={styles.patternHead}>
        <div className={styles.patternTitle}>
          <h3 id={titleId}>{pattern.title}</h3>
          <p className={styles.patternMeta}>
            {cost ? <span data-tone={cost.tone}>{cost.label}</span> : null}
            <span>{COST_CATEGORY_LABEL[pattern.category]}</span>
            {pattern.userConfirmed ? <span><CheckIcon size={13} weight="bold" aria-hidden="true" />подтверждено тобой</span> : null}
          </p>
        </div>
        <Chip tone={status.tone}>{status.label}</Chip>
      </header>

      <History pattern={pattern} />

      {ask ? (
        <div className={cx(styles.block, styles.ask)}>
          <p>{status.hint}</p>
          <div className={styles.actions}>
            <button type="button" className={cx(kit.btn, kit.secondary, kit.small)} disabled={busy} onClick={() => onUpdate({ confirm: true })}>
              {busy ? <Spinner /> : <CheckIcon size={14} weight="bold" />}Да, это про меня
            </button>
            <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy} onClick={() => onUpdate({ dismiss: true })}>Не про меня</button>
          </div>
        </div>
      ) : null}

      {openDrills.length ? (
        <ul className={styles.drillRows} aria-label="Тренировки против этого паттерна">
          {openDrills.map(drill => <li key={drill.id}><DrillRow drill={drill} onStartDrill={onStartDrill} labelled primary={false} /></li>)}
        </ul>
      ) : null}

      <details className={cx(kit.details, styles.expand)}>
        <summary><CaretRightIcon size={14} weight="bold" aria-hidden="true" />{pattern.evidence.length ? `Описание и цитаты (${Math.min(5, pattern.evidence.length)})` : 'Описание'}</summary>
        <div className={styles.expandBody}>
          {pattern.description ? <p className={styles.description}>{pattern.description}</p> : null}
          {pattern.evidence.length ? (
            <ul className={styles.evidence}>
              {pattern.evidence.slice(0, 5).map((item, evidenceIndex) => (
                <li key={evidenceIndex} className={styles.evidenceItem}>
                  <blockquote className={cx(kit.quote, kit.en)} lang="en">{item.quote}</blockquote>
                  <span className={styles.evidenceMeta}>
                    {[upperFirst(SOURCE_LABEL[item.source]), formatDay(item.date), item.at !== null ? formatClock(item.at) : null, OUTCOME_GLYPH[item.status].label].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {pattern.drillHint ? <p className={styles.hintLine}><LightbulbIcon size={16} weight="fill" aria-hidden="true" /><span><strong>Что тренировать:</strong> {pattern.drillHint}</span></p> : null}
          {pattern.userNote ? <p className={styles.description}><strong>Твоя заметка:</strong> {pattern.userNote}</p> : null}
          {!ask ? (
            <div className={styles.actions}>
              <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy} onClick={() => onUpdate({ dismiss: true })}>
                <EyeSlashIcon size={14} weight="bold" />Скрыть паттерн
              </button>
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}
