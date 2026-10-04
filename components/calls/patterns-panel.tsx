'use client';

/**
 * «Мои паттерны»: weaknesses first by cost, status chips, cross-call history dots
 * (● repeated ○ avoided · no opportunity ◐ improved), real vs practice rounds, evidence, confirm/dismiss, related drills.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { CaretRightIcon, CheckIcon, EyeSlashIcon, LightbulbIcon, SealCheckIcon, TargetIcon } from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CommunicationPattern, PatternUpdateRequest, PersonalDrill } from '@/lib/calls/types';
import type { Mode } from '@/lib/types';
import { Chip, cx, kit, Spinner } from './kit';
import { COST_CATEGORY_LABEL, formatClock, formatDay, OUTCOME_GLYPH, PATTERN_STATUS, roundsLabel, sortPatterns } from './format';
import { DrillsList } from './drills-list';
import styles from './patterns.module.css';

const SOURCE_LABEL = { call: 'звонок', practice: 'тренировка', placement: 'тест' } as const;

export function HistoryDots({ pattern, max = 10 }: { pattern: CommunicationPattern; max?: number }) {
  const items = pattern.history.slice(-max);
  if (!items.length) return null;
  return (
    <span className={styles.history} role="img" aria-label={`История: ${items.map(item => OUTCOME_GLYPH[item.status].label).join(', ')}`}>
      {items.map((item, index) => {
        const glyph = OUTCOME_GLYPH[item.status];
        return (
          <span key={`${item.sourceId}-${index}`} className={styles.dot} data-tone={glyph.tone} data-source={item.source}
            title={`${formatDay(item.date) ?? ''} · ${SOURCE_LABEL[item.source]} · ${glyph.label}`}>{glyph.glyph}</span>
        );
      })}
    </span>
  );
}

function Rounds({ pattern }: { pattern: CommunicationPattern }) {
  const rounds = roundsLabel(pattern);
  return (
    <span className={styles.rounds}>
      <span title="Был повод в реальном звонке: справился – повторилось">{rounds.real}</span>
      <span title="Тренировки: самостоятельные успехи – остальные попытки">{rounds.practice}</span>
    </span>
  );
}

export function PatternsPanel({ patterns, drills, onStartDrill, compact, onChanged }: {
  patterns: CommunicationPattern[]; drills: PersonalDrill[]; onStartDrill: (drillId: string, mode: Mode) => void; compact?: boolean; onChanged?: () => void;
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
        <h2>Над чем работаем</h2>
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
        <span className={styles.legend} aria-hidden="true">
          <span><b style={{ color: 'var(--k-error-ink)' }}>●</b> повторилось</span><span><b style={{ color: 'var(--k-lime-ink)' }}>○</b> был повод — справился</span>
          <span><b>·</b> не было повода</span><span><b style={{ color: 'var(--k-violet-ink)' }}>◐</b> частично лучше</span>
        </span>
      </div>
      {error ? <p className={styles.errorLine} role="alert">{error}</p> : null}
      {!sorted.weaknesses.length && !sorted.strengths.length ? (
        <div className={cx(kit.glass, styles.pattern)}>
          <p className={kit.muted} style={{ margin: 0 }}>Паттерны появятся после первого разобранного звонка: например, «называешь чужой гонорар» или «соглашаешься на первую цифру».</p>
        </div>
      ) : null}
      {sorted.weaknesses.map((pattern, index) => (
        <PatternCard key={pattern.id} pattern={pattern} index={index} drills={drills.filter(drill => drill.patternIds.includes(pattern.id))}
          busy={busy === pattern.id} onUpdate={body => void update(pattern, body)} onStartDrill={onStartDrill} />
      ))}
      {sorted.strengths.length ? (
        <>
          <h3 className={styles.groupTitle}>Сильные стороны</h3>
          <ul className={styles.strengths}>
            {sorted.strengths.map(pattern => <li key={pattern.id}><SealCheckIcon size={18} weight="fill" /><span><strong>{pattern.title}.</strong> {pattern.description}</span></li>)}
          </ul>
        </>
      ) : null}
      {sorted.dismissed.length ? (
        <details className={cx(kit.details, styles.dismissed)}>
          <summary>Скрытые ({sorted.dismissed.length})</summary>
          <div className={styles.dismissedList}>
            {sorted.dismissed.map(pattern => (
              <div key={pattern.id} className={styles.dismissedItem}>
                <span>{pattern.title}</span>
                <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy === pattern.id} onClick={() => void update(pattern, { dismiss: false })}>Вернуть</button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function PatternCard({ pattern, index, drills, busy, onUpdate, onStartDrill }: {
  pattern: CommunicationPattern; index: number; drills: PersonalDrill[]; busy: boolean;
  onUpdate: (body: PatternUpdateRequest) => void; onStartDrill: (drillId: string, mode: Mode) => void;
}) {
  const status = PATTERN_STATUS[pattern.status];
  const openDrills = drills.filter(drill => drill.status !== 'done');
  return (
    <article className={cx(kit.glass, styles.pattern, kit.rise)} style={{ ['--i' as string]: index } as CSSProperties}>
      <div className={styles.patternHead}>
        {pattern.kind === 'weakness' ? <span className={styles.costBadge} data-rank={pattern.costRank} title={`Цена: ${pattern.costRank} из 5 (1 — дороже всего)`}>{pattern.costRank}</span> : null}
        <div className={styles.patternTitle}>
          <strong>{pattern.title}</strong>
          <div className={styles.chips}>
            <Chip tone={status.tone}>{status.label}</Chip>
            <Chip>{COST_CATEGORY_LABEL[pattern.category]}</Chip>
            {pattern.userConfirmed ? <Chip tone="violet" icon={<CheckIcon size={12} weight="bold" />}>подтверждено</Chip> : null}
          </div>
        </div>
      </div>
      <HistoryDots pattern={pattern} />
      <Rounds pattern={pattern} />
      {pattern.status === 'watch' && !pattern.userConfirmed ? (
        <div className={styles.watchAsk}>
          {status.hint}
          <div className={styles.actions}>
            <button type="button" className={cx(kit.btn, kit.primary, kit.small)} disabled={busy} onClick={() => onUpdate({ confirm: true })}>
              {busy ? <Spinner /> : <CheckIcon size={14} weight="bold" />}Да, это про меня
            </button>
            <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy} onClick={() => onUpdate({ dismiss: true })}>Не про меня</button>
          </div>
        </div>
      ) : null}
      <details className={cx(kit.details, styles.expand)}>
        <summary><CaretRightIcon size={14} weight="bold" />Подробнее{pattern.evidence.length ? ` · цитаты: ${pattern.evidence.length}` : ''}</summary>
        <div className={styles.expandBody}>
          {pattern.description ? <p className={styles.description}>{pattern.description}</p> : null}
          {pattern.evidence.length ? (
            <div className={styles.evidence}>
              {pattern.evidence.slice(0, 5).map((item, evidenceIndex) => (
                <div key={evidenceIndex} className={styles.evidenceItem}>
                  <blockquote className={cx(kit.quote, kit.en)} lang="en">{item.quote}</blockquote>
                  <span className={styles.evidenceMeta}>
                    {SOURCE_LABEL[item.source]} · {formatDay(item.date)}{item.at !== null ? ` · ${formatClock(item.at)}` : ''} · {OUTCOME_GLYPH[item.status].label}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {pattern.drillHint ? <div className={styles.hintLine}><LightbulbIcon size={16} weight="fill" />{pattern.drillHint}</div> : null}
          {pattern.userNote ? <p className={styles.description}><strong>Твоя заметка:</strong> {pattern.userNote}</p> : null}
          {pattern.status !== 'watch' || pattern.userConfirmed ? (
            <div className={styles.actions}>
              <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy} onClick={() => onUpdate({ dismiss: true })}>
                <EyeSlashIcon size={14} weight="bold" />Скрыть паттерн
              </button>
            </div>
          ) : null}
        </div>
      </details>
      {openDrills.length ? (
        <>
          <span className={kit.eyebrow} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><TargetIcon size={14} weight="bold" />Тренировки</span>
          <DrillsList drills={openDrills} onStartDrill={onStartDrill} limit={2} />
        </>
      ) : null}
    </article>
  );
}
