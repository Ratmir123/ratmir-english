'use client';

/**
 * Placement result (audit-product §2.9): shape first, every band with its range, confidence and basis,
 * skipped sections «не измерено», never percentages. Also the compact level card for Today / Progress.
 */
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowClockwiseIcon, ArrowRightIcon, CaretDownIcon, ChatsCircleIcon, CheckIcon, CircleHalfIcon, GaugeIcon, HourglassIcon, MinusIcon, PlayIcon,
  SealCheckIcon, WarningIcon, XIcon,
} from '@phosphor-icons/react';
import type { PlacementResult, PlacementView } from '@/lib/placement/types';
import { cx, kit, ProgressBar, Spinner, TtsButton } from '../calls/kit';
import { LANGUAGE_IMPACT_LABEL } from '../calls/format';
import {
  badgeFill, CONFIDENCE_LABEL, CRITERIA, dayLabel, moveRows, NOT_MEASURED, REVIEW_SECTION_TITLE, retakeNote, SKILL_ORDER, SKILL_TITLE,
  skillRows, skillSpread, sparkline, speakingBrake, timingFigures,
} from './result-model';
import { PromptText } from './choice-task';
import { FeatureMascot } from './placement-mascot';
import { progressModel, remainingLabel } from './flow-model';
import styles from './result.module.css';

const CEFR_AXIS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function safeId(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, ''); }

/** CEFR badge that fills with liquid from the bottom; the label inverts colour at the liquid line. */
export function LevelBadge({ label, score, caption }: { label: string; score: number; caption?: string }) {
  const id = safeId(useId());
  const fill = badgeFill(score);
  const wave = 'M0 10 Q 20 0 40 10 T 80 10 T 120 10 T 160 10 T 200 10 T 240 10 T 280 10 T 320 10 V 220 H 0 Z';
  const text = (className: string) => <text x="80" y="82" className={cx(styles.badgeText, className)}>{label}</text>;
  return (
    <div className={styles.badgeCol}>
      <div className={styles.badge} style={{ ['--fill' as string]: fill } as CSSProperties} role="img" aria-label={`Общий ориентир ${label}`}>
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <defs>
            <clipPath id={`${id}-shape`}><rect x="4" y="4" width="152" height="152" rx="52" /></clipPath>
            {/* The label turns dark where the liquid is (a mask may contain animated groups; a clipPath may not). */}
            <mask id={`${id}-liquid`} maskUnits="userSpaceOnUse" x="0" y="0" width="160" height="160">
              <g className={styles.level}><path className={styles.wave} d={wave} fill="#fff" /></g>
            </mask>
          </defs>
          <g clipPath={`url(#${id}-shape)`}>
            <rect className={styles.badgeBase} x="0" y="0" width="160" height="160" />
            <g className={cx(styles.level, styles.levelBack)}><path className={cx(styles.wave, styles.waveBack)} d={wave} /></g>
            <g className={styles.level}><path className={cx(styles.wave, styles.liquid)} d={wave} /></g>
            <g className={styles.badgeLabelGroup}>
              {text(styles.badgeTextBase)}
              <g mask={`url(#${id}-liquid)`}>{text(styles.badgeTextLiquid)}</g>
            </g>
          </g>
          <rect className={styles.badgeRim} x="4" y="4" width="152" height="152" rx="52" />
        </svg>
      </div>
      {caption ? <span className={styles.badgeCaption}>{caption}</span> : null}
    </div>
  );
}

function celebrateOnce(result: PlacementResult): boolean {
  if (typeof window === 'undefined') return false;
  const fresh = Date.now() - new Date(result.completedAt).getTime() < 30 * 60_000;
  if (!fresh) return false;
  const key = `smooth-talk:placement-celebrated:${result.attemptId}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch { /* storage blocked: celebrate anyway */ }
  return true;
}

const MOVE_ICON = { 2: CheckIcon, 1: CircleHalfIcon, 0: XIcon } as const;

/** Next step after a result: the retake button and its note depend on where a retake stands. */
function retakeAction(view: PlacementView): { label: string; note: string } {
  if (view.status === 'in-progress') return { label: 'Продолжить пересдачу', note: 'Пересдача уже идёт — продолжи её, когда будет время.' };
  if (view.status === 'scoring') return { label: 'Открыть пересдачу', note: 'Считаю результат пересдачи — он появится здесь сам.' };
  if (view.status === 'error') return { label: 'Повторить подсчёт', note: 'Результат пересдачи не посчитался. Ответы сохранены.' };
  return { label: 'Пересдать', note: retakeNote(view).text ?? 'Повторный тест — с новыми заданиями.' };
}

/**
 * Full result, one place per question: the hero says what the level is and why, «Что дальше» says what to do,
 * then the evidence. `aside` (Progress: the experience rank) sits beside the hero when there is room;
 * without it the mascot celebrates in the hero (the flow right after the test).
 */
export function PlacementResultView({ view, onRetake, onStartPractice, aside }: {
  view: PlacementView; onRetake: () => void; onStartPractice: () => void; aside?: ReactNode;
}) {
  const result = view.result;
  const [celebrate, setCelebrate] = useState(0);
  useEffect(() => {
    if (!result || !celebrateOnce(result)) return;
    const timer = setTimeout(() => setCelebrate(1), 900);
    return () => clearTimeout(timer);
  }, [result]);
  const rows = useMemo(() => (result ? skillRows(result) : []), [result]);
  if (!result) {
    return (
      <section className={cx(kit.scope, styles.result)}>
        <div className={cx(kit.glass, styles.card)}><p className={kit.muted} style={{ margin: 0 }}>Результата пока нет — он появится после теста уровня.</p></div>
      </section>
    );
  }
  const spread = skillSpread(result);
  const moves = moveRows(result);
  const figures = timingFigures(result.speaking.timing);
  const brake = speakingBrake(result);
  const retake = retakeAction(view);
  const points = sparkline(view.history);
  const speakingMeasured = CRITERIA.some(item => result.speaking[item.id] !== null);
  const errors = result.speaking.errors.filter(error => error.impact !== 'minor').slice(0, 5);
  const reviewGroups = (['listening', 'reading', 'language'] as const)
    .map(section => ({ section, items: result.review.filter(item => item.section === section) }))
    .filter(group => group.items.length);
  const meta = [dayLabel(result.completedAt), `медиана навыков, уверенность ${CONFIDENCE_LABEL[result.overall.confidence]}`, 'ориентир, не сертификат', `тест ${result.procedureVersion}`]
    .filter(Boolean).join(' · ');

  return (
    <section className={cx(kit.scope, styles.result)} aria-label="Результат теста уровня">
      <div className={styles.top} data-aside={!!aside}>
        <header className={cx(kit.glass, styles.hero, kit.rise)}>
          <LevelBadge label={result.overall.label} score={result.overall.score} caption="общий ориентир" />
          <div className={styles.heroText}>
            <h2 className={styles.headline}>{result.headline}</h2>
            {result.overall.summary ? <p className={styles.summary}>{result.overall.summary}</p> : null}
            <p className={styles.heroMeta}>{meta}</p>
            {spread && spread.gap >= 0.5 ? <p className={styles.heroMeta}>Разброс: от {spread.low} до {spread.high}.</p> : null}
            {result.partnerLevel ? <p className={styles.partner}><ChatsCircleIcon size={17} weight="bold" aria-hidden="true" />Собеседники в практике заговорят на {result.partnerLevel}.</p> : null}
          </div>
          {aside ? null : (
            <div className={styles.heroMascot}><FeatureMascot size={72} emotion="proud" celebrate={celebrate} celebrateEmotion="excited" label="Гордится тобой" /></div>
          )}
        </header>
        {aside}
      </div>

      <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-next">
        <div className={styles.cardHead}><h2 id="placement-next">{result.priorities.length ? 'Что быстрее всего поднимет уровень' : 'Что дальше'}</h2></div>
        {result.priorities.length ? (
          <ol className={styles.priorities}>
            {result.priorities.slice(0, 3).map((priority, index) => (
              <li key={index} className={styles.priority}>
                <span className={styles.priorityNumber} aria-hidden="true">{index + 1}</span>
                <div className={styles.priorityCopy}>
                  <h3>{priority.title}</h3>
                  <p>{priority.why}</p>
                  <p className={styles.action}>{priority.action}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        <div className={styles.nextActions}>
          <button type="button" className={cx(kit.btn, kit.primary)} onClick={onStartPractice}>Начать практику<ArrowRightIcon size={18} weight="bold" /></button>
          <button type="button" className={cx(kit.btn, kit.secondary)} onClick={onRetake}>
            {view.status === 'scoring' ? <Spinner /> : <ArrowClockwiseIcon size={18} weight="bold" />}{retake.label}
          </button>
          <p className={styles.retakeNote}>{retake.note}</p>
        </div>
      </section>

      <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-skills">
        <div className={styles.cardHead}><h2 id="placement-skills">Навыки по тесту</h2><small>полоса — диапазон, где уровень почти наверняка</small></div>
        <div className={styles.skills}>
          {rows.map((row, index) => {
            const basis = row.measured ? `диапазон ${row.range} · уверенность ${row.confidence} · ${row.basis}`
              : row.basis && row.basis.toLowerCase() !== NOT_MEASURED ? row.basis : '';
            return (
              <div key={row.id} className={styles.skill}>
                <span className={styles.skillName}>{row.title}</span>
                <span className={cx(styles.skillLabel, !row.measured && styles.skillLabelMuted)}>{row.label}</span>
                <div className={styles.axis} aria-hidden="true" style={{ ['--i' as string]: index } as CSSProperties}>
                  {row.measured ? (
                    <>
                      <span className={styles.axisTrack} />
                      <span className={styles.axisRange} style={{ left: `${row.rangeStart * 100}%`, width: `${(row.rangeEnd - row.rangeStart) * 100}%` }} />
                      {row.marker !== null ? <span className={styles.axisMarker} style={{ left: `${row.marker * 100}%` }} /> : null}
                    </>
                  ) : <span className={styles.axisEmpty} />}
                  <span className={styles.axisTicks}>{CEFR_AXIS.map(level => <span key={level}>{level}</span>)}</span>
                </div>
                {basis || row.note ? (
                  <div className={styles.skillMeta}>
                    {basis ? <span>{basis}</span> : null}
                    {row.note ? <span className={styles.skillNote}>{row.note}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className={styles.grid2}>
        <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-speaking">
          <div className={styles.cardHead}><h2 id="placement-speaking">Речь</h2>{!speakingMeasured ? <small>{NOT_MEASURED}</small> : null}</div>
          {speakingMeasured ? (
            <div className={styles.criteria}>
              {CRITERIA.map(item => (
                <div key={item.id} className={cx(styles.criterion, brake === item.id && styles.criterionBrake)}>
                  <span>{item.title}</span>
                  <strong>{result.speaking.labels[item.id] ?? result.speaking[item.id] ?? '—'}</strong>
                  {brake === item.id ? <em>главный тормоз</em> : null}
                </div>
              ))}
            </div>
          ) : <p className={styles.plain}>Голосовой раздел пропущен — речь оценим в следующей попытке.</p>}
          {figures.length ? (
            <dl className={styles.figures}>
              {figures.map(figure => <div key={figure.id} className={styles.figure}><dt>{figure.label}</dt><dd>{figure.value}</dd></div>)}
            </dl>
          ) : null}
          {result.speaking.notes.length ? <ul className={styles.bullets}>{result.speaking.notes.map((item, index) => <li key={index}><GaugeIcon size={16} weight="bold" />{item}</li>)}</ul> : null}
          {result.speaking.examples.slice(0, 3).map((example, index) => (
            <div key={index} className={styles.example}>
              <blockquote className={cx(kit.quote, kit.en)} lang="en">{example.quote}</blockquote>
              <p className={styles.comment}>{example.comment}</p>
              {example.better ? <div className={styles.better}><p lang="en">{example.better}</p><TtsButton text={example.better} compact label="Послушать вариант" /></div> : null}
            </div>
          ))}
          {errors.length ? (
            <ul className={styles.corrections}>
              {errors.map((error, index) => (
                <li key={index} className={styles.correction}>
                  <span className={styles.wrong} lang="en">{error.quote}</span>
                  <ArrowRightIcon size={14} weight="bold" aria-hidden="true" />
                  <span className={styles.right} lang="en">{error.correction}</span>
                  <span className={styles.impact} data-impact={error.impact}>{LANGUAGE_IMPACT_LABEL[error.impact].label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-moves">
          <div className={styles.cardHead}>
            <h2 id="placement-moves">Ходы разговора</h2>
            <small>{moves.withOpportunity ? `${moves.strong} из ${moves.withOpportunity} с поводом` : 'сцена не дала повода'}</small>
          </div>
          <p className={styles.plain}>Это не уровень английского, а стратегия: что ты делал в рабочей сцене.</p>
          {moves.withOpportunity ? (
            <ul className={styles.moves}>
              {moves.rows.map(row => {
                const MoveIcon = row.score === null ? MinusIcon : MOVE_ICON[row.score];
                return (
                  <li key={row.id} className={styles.move}>
                    <span className={styles.glyph} data-score={row.score === null ? 'na' : row.score} role="img"
                      aria-label={row.score === 2 ? 'получилось' : row.score === 1 ? 'частично' : row.score === 0 ? 'не получилось' : 'не было повода'}>
                      <MoveIcon size={15} weight="bold" aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{row.title}</strong>
                      <small>{row.meaning}</small>
                      {row.quote ? <q lang="en">{row.quote}</q> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            // Eight identical «Не было повода» rows say nothing: one line naming what the next attempt will look at.
            <p className={styles.movesEmpty}>В следующей попытке посмотрим: {moves.rows.map(row => row.title.toLowerCase()).join(', ')}.</p>
          )}
        </section>
      </div>

      {result.languageTargets.length || result.communication.strengths.length || result.communication.risks.length || result.communication.observations.length ? (
        <div className={styles.grid2}>
          {result.languageTargets.length ? (
            <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-targets">
              <div className={styles.cardHead}><h2 id="placement-targets">Английский: цели</h2><small>сначала базовые вещи</small></div>
              <ul className={styles.targets}>
                {result.languageTargets.map((target, index) => (
                  <li key={index}>
                    <strong>{target.title}</strong>
                    {target.quote ? (
                      <span className={styles.correction}>
                        <span className={styles.wrong} lang="en">{target.quote}</span>
                        {target.correction ? <><ArrowRightIcon size={14} weight="bold" aria-hidden="true" /><span className={styles.right} lang="en">{target.correction}</span></> : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.communication.strengths.length || result.communication.risks.length || result.communication.observations.length ? (
            <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-communication">
              <div className={styles.cardHead}><h2 id="placement-communication">Общение</h2></div>
              {result.communication.strengths.length ? <ul className={styles.bullets}>{result.communication.strengths.map((item, index) => <li key={index}><SealCheckIcon size={16} weight="fill" color="var(--k-lime-ink)" />{item}</li>)}</ul> : null}
              {result.communication.risks.length ? <ul className={styles.bullets}>{result.communication.risks.map((item, index) => <li key={index}><WarningIcon size={16} weight="fill" color="var(--k-warning-ink)" />{item}</li>)}</ul> : null}
              {result.communication.observations.map((item, index) => (
                <div key={index} className={styles.example}>
                  <strong className={styles.exampleTitle}>{item.title}</strong>
                  <p className={styles.comment}>{item.detail}</p>
                  {item.quote ? <blockquote className={cx(kit.quote, kit.en)} lang="en">{item.quote}</blockquote> : null}
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {points.length ? (
        <section className={cx(kit.glass, styles.card)} aria-labelledby="placement-history">
          <div className={styles.cardHead}><h2 id="placement-history">Как менялся уровень</h2><small>сравниваем только изменения больше погрешности</small></div>
          <Sparkline points={points} />
        </section>
      ) : null}

      {reviewGroups.length ? (
        <details className={cx(kit.glass, kit.details, styles.review)}>
          <summary>
            <span className={styles.reviewTitle}>Разбор заданий
              <small>{reviewGroups.map(group => `${REVIEW_SECTION_TITLE[group.section]}: ${group.items.filter(item => item.correct).length} из ${group.items.length}`).join(' · ')}</small>
            </span>
            <CaretDownIcon size={20} weight="bold" aria-hidden="true" />
          </summary>
          <div className={styles.reviewBody}>
            {reviewGroups.map(group => (
              <div key={group.section} className={styles.reviewGroup}>
                <h3>{REVIEW_SECTION_TITLE[group.section]} · {group.items.filter(item => item.correct).length} из {group.items.length}</h3>
                {group.items.map(item => (
                  <article key={item.itemId} className={styles.item}>
                    <p className={cx(styles.itemPrompt, kit.en)} lang="en"><PromptText prompt={item.prompt} filled={item.options[item.answer] ?? null} /></p>
                    <ul className={styles.itemOptions}>
                      {item.options.map((option, index) => (
                        <li key={index} data-key={index === item.answer} data-chosen={index === item.chosen} lang="en">
                          {index === item.answer ? <CheckIcon size={14} weight="bold" /> : index === item.chosen ? <XIcon size={14} weight="bold" /> : <span style={{ width: 14 }} />}
                          {option}
                          {index === item.chosen ? <small lang="ru">твой ответ</small> : index === item.answer ? <small lang="ru">верно</small> : null}
                        </li>
                      ))}
                    </ul>
                    {item.explanation ? <p className={styles.explanation}>{item.explanation}</p> : null}
                    {item.passage ? (
                      <details className={cx(kit.details, styles.script)}>
                        <summary>{item.section === 'listening' ? 'Текст записи' : 'Текст'}</summary>
                        <p lang="en">{item.passage}</p>
                      </details>
                    ) : null}
                  </article>
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {result.limitations.length ? <ul className={styles.limitations} aria-label="Ограничения оценки">{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
    </section>
  );
}

function Sparkline({ points }: { points: ReturnType<typeof sparkline> }) {
  const width = 600; const height = 110; const pad = 12;
  const xy = points.map(point => [pad + point.x * (width - pad * 2), pad + point.y * (height - pad * 2)] as const);
  const line = xy.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${height} L${xy[0][0].toFixed(1)} ${height} Z`;
  return (
    <div>
      <div className={styles.sparkBox} role="img" aria-label={`История: ${points.map(point => `${point.label}${point.date ? ` (${point.date})` : ''}`).join(', ')}`}>
        <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <path className={styles.sparkArea} d={area} />
          <path className={styles.sparkLine} d={line} />
        </svg>
        {/* Dots as HTML so they stay round while the line stretches with the width. */}
        {xy.map(([x, y], index) => <span key={index} className={styles.sparkDot} style={{ left: `${(x / width) * 100}%`, top: `${(y / height) * 100}%` }} />)}
      </div>
      <div className={styles.sparkLabels}>
        {points.map((point, index) => <span key={index}><strong>{point.label}</strong>{point.date}</span>)}
      </div>
    </div>
  );
}

/** Compact card for Today / Progress. `embedded` drops its own surface when a parent card already provides one. */
export function PlacementLevelCard({ view, onOpen, onStart, embedded = false }: { view: PlacementView; onOpen: () => void; onStart: () => void; embedded?: boolean }) {
  const surface = embedded ? styles.levelEmbedded : cx(kit.glass, styles.levelCard);
  const result = view.result;
  const progress = progressModel(view);
  const inProgress = view.status === 'in-progress';

  if (!result) {
    const scoring = view.status === 'scoring';
    const failed = view.status === 'error';
    return (
      <section className={cx(kit.scope, surface)} aria-label="Тест уровня">
        <div className={styles.levelTop}>
          <span className={styles.levelIcon} aria-hidden="true">{scoring ? <HourglassIcon size={26} weight="bold" /> : <GaugeIcon size={26} weight="bold" />}</span>
          <div className={styles.levelTitle}>
            <strong>{scoring ? 'Считаю результат' : failed ? 'Результат не посчитался' : inProgress ? 'Тест уровня · продолжим' : 'Тест уровня ~25 мин'}</strong>
            <span>
              {scoring ? 'Обычно до двух минут — результат появится сам.'
                : failed ? 'Ответы сохранены, подсчёт можно повторить.'
                  : inProgress ? `Осталось ${remainingLabel(view.remainingMinutes)}. Прогресс сохранён.`
                    : 'Узнаем твой настоящий уровень. Можно в два подхода по ≈ 12 минут.'}
            </span>
          </div>
        </div>
        {inProgress ? <ProgressBar value={progress.fraction} label="Пройдено теста" /> : null}
        <div className={styles.levelActions}>
          {scoring ? <span className={cx(kit.muted)} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}><Spinner />Считаю…</span> : null}
          {scoring || failed
            ? <button type="button" className={cx(kit.btn, failed ? kit.primary : kit.secondary)} onClick={onOpen}>{failed ? 'Открыть' : 'Подробнее'}</button>
            : <button type="button" className={cx(kit.btn, kit.primary)} onClick={onStart}>{inProgress ? 'Продолжить тест' : 'Начать тест'}<ArrowRightIcon size={18} weight="bold" /></button>}
        </div>
      </section>
    );
  }

  const rows = skillRows(result);
  return (
    <section className={cx(kit.scope, surface)} aria-label="Уровень по тесту">
      <div className={styles.levelTop}>
        <span className={styles.levelBig}>{result.overall.label}</span>
        <div className={styles.levelTitle}>
          <strong>Общий ориентир</strong>
          <span>уверенность {CONFIDENCE_LABEL[result.overall.confidence]} · {dayLabel(result.completedAt)}</span>
        </div>
      </div>
      <ul className={styles.skillGrid} aria-label="Навыки">
        {SKILL_ORDER.map((id, index) => {
          const row = rows.find(item => item.id === id)!;
          const fill = row.marker === null ? 0 : Math.max(0.06, row.marker);
          return (
            <li key={id} aria-label={`${SKILL_TITLE[id]}: ${row.measured ? row.label : 'не измерено'}`}>
              <span className={styles.skillName}>{SHORT_SKILL[id]}</span>
              <strong data-empty={!row.measured}>{row.measured ? row.label : 'нет'}</strong>
              <span className={styles.skillTrack} data-empty={!row.measured} aria-hidden="true">
                {row.measured ? <span style={{ ['--fill' as string]: fill, ['--i' as string]: index } as CSSProperties} /> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={styles.levelHeadline}>{result.headline}</p>
      {view.status === 'scoring' ? <p className={styles.levelHeadline} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Spinner />Пересдача: считаю новый результат…</p> : null}
      {view.status === 'error' ? <p className={styles.levelHeadline} style={{ color: 'var(--k-error-ink)' }}>Пересдача: результат не посчитался — ответы сохранены.</p> : null}
      <div className={styles.levelActions}>
        {inProgress || view.status === 'error'
          ? <button type="button" className={cx(kit.btn, kit.primary)} onClick={onStart}>
            {inProgress ? <><PlayIcon size={16} weight="fill" />Продолжить пересдачу</> : 'Повторить подсчёт'}
          </button>
          : null}
        <button type="button" className={cx(kit.btn, inProgress || view.status === 'error' ? kit.quiet : kit.secondary)} onClick={onOpen}>Подробнее<ArrowRightIcon size={16} weight="bold" /></button>
      </div>
    </section>
  );
}

const SHORT_SKILL: Record<(typeof SKILL_ORDER)[number], string> = {
  listening: 'Слух', reading: 'Чтение', grammar: 'Грамматика', vocabulary: 'Слова', speaking: 'Речь', interaction: 'Разговор',
};
