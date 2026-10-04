'use client';

/**
 * «Разбор» of a call, in the owner's debrief order (DESIGN-SYSTEM §3 Calls, audit-product §3.5).
 * Each section is one surface; entries inside are rows split by hairlines. Only a quote (sunken) and a better
 * line (lime) get a tinted well, and never inside another well (DESIGN-PASS-0.5.1).
 */
import { useState, type ReactNode } from 'react';
import {
  ArrowDownIcon, ArrowRightIcon, BrainIcon, CheckCircleIcon, CheckIcon, CircleHalfIcon, FlagIcon, HandshakeIcon, InfoIcon, LightbulbIcon,
  MinusCircleIcon, ScalesIcon, SealCheckIcon, ShieldWarningIcon, WarningIcon, XCircleIcon, XIcon,
} from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CallDetail, CallReview, CommunicationPattern, ProfileFact } from '@/lib/calls/types';
import { STRATEGY_MOVES, type StrategyMoveScore } from '@/lib/strategy-moves';
import { CopyButton, cx, kit, Spinner, TtsButton } from './kit';
import {
  CLARITY_LABEL, COST_CATEGORY_LABEL, dealView, FACT_KIND_LABEL, formatClock, formatMoney, IMPACT_LABEL, LANGUAGE_IMPACT_LABEL, OUTCOME_GLYPH,
  splitPlaceholders, toneInk,
} from './format';
import { OUTCOME_ICON } from './patterns-panel';
import styles from './review.module.css';

function At({ at, onSeek }: { at: number | null | undefined; onSeek?: (at: number) => void }) {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  if (!onSeek) return <span className={kit.time}>{formatClock(at)}</span>;
  return <button type="button" className={kit.time} onClick={() => onSeek(at)} aria-label={`Перейти к ${formatClock(at)} в расшифровке`}>{formatClock(at)}</button>;
}

function Quote({ quote, at, onSeek }: { quote: string | null | undefined; at?: number | null; onSeek?: (at: number) => void }) {
  if (!quote) return null;
  return (
    <div className={styles.quoteRow}>
      <blockquote className={cx(kit.quote, kit.en)} lang="en">{quote}</blockquote>
      <At at={at} onSeek={onSeek} />
    </div>
  );
}

/** The stronger English line: label, listen, the line itself. */
function Better({ label, text }: { label: string; text: string }) {
  return (
    <div className={styles.better}>
      <div className={styles.betterHead}><span>{label}</span><TtsButton text={text} compact label="Послушать" /></div>
      <p lang="en">{text}</p>
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={cx(kit.glass, styles.section)} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}><h3 id={`${id}-title`}>{title}</h3>{hint ? <small>{hint}</small> : null}</div>
      {children}
    </section>
  );
}

const MOVE_MARK = {
  2: { Icon: CheckCircleIcon, tone: 'lime', label: 'получилось' },
  1: { Icon: CircleHalfIcon, tone: 'violet', label: 'частично' },
  0: { Icon: XCircleIcon, tone: 'error', label: 'не получилось' },
  none: { Icon: MinusCircleIcon, tone: 'neutral', label: 'не было повода' },
} as const;

function MoveMark({ score }: { score: StrategyMoveScore['score'] }) {
  const mark = MOVE_MARK[score === null ? 'none' : score];
  return <span className={styles.mark} data-tone={mark.tone} aria-hidden="true"><mark.Icon size={20} weight="fill" /></span>;
}

export function CallReviewView({ detail, review, patterns, idPrefix, onSeek, onFactsChanged }: {
  detail: CallDetail; review: CallReview; patterns: CommunicationPattern[]; idPrefix: string;
  onSeek?: (at: number) => void; onFactsChanged: (facts: ProfileFact[]) => void;
}) {
  const deal = dealView(review);
  const patternTitle = (id: string | null) => (id ? patterns.find(pattern => pattern.id === id)?.title ?? null : null);
  const suggested = detail.facts.filter(fact => fact.status === 'suggested');
  const id = (name: string) => `${idPrefix}-${name}`;
  const metrics = detail.metrics;
  const toc: [string, string][] = [
    ['summary', 'Итог'], ...(review.timeline.length ? [['timeline', 'Ход звонка'] as [string, string]] : []),
    ...(review.wins.length ? [['wins', 'Сработало'] as [string, string]] : []), ...(review.costs.length ? [['costs', 'Стоило денег'] as [string, string]] : []),
    ...(review.agreedTerms.length || deal ? [['deal', 'Сделка'] as [string, string]] : []), ...(review.debatable.length ? [['debatable', 'Спорное'] as [string, string]] : []),
    ...(!review.fromMemory && (review.language.length || review.minorErrorsIgnored) ? [['language', 'Английский'] as [string, string]] : []),
    ...(review.followUp ? [['followup', 'Письмо'] as [string, string]] : []), ...(review.risks.length ? [['risks', 'Риски'] as [string, string]] : []),
    ...(review.patterns.length ? [['patterns', 'Паттерны'] as [string, string]] : []),
    ...(review.strategyMoves.length ? [['moves', 'Ходы'] as [string, string]] : []),
    ...(review.betterAnswers.length ? [['answers', 'Ответы'] as [string, string]] : []),
    ...(suggested.length ? [['facts', 'Факты'] as [string, string]] : []),
  ];

  return (
    <div className={styles.review}>
      <nav className={cx(kit.chrome, styles.toc)} aria-label="Разделы разбора">
        <div className={styles.tocScroll}>{toc.map(([key, label]) => <a key={key} href={`#${id(key)}`}>{label}</a>)}</div>
      </nav>

      {review.fromMemory ? (
        <div className={styles.banner}><BrainIcon size={18} aria-hidden="true" />По памяти: разбор только про стратегию — без цитат, английского и темпа речи.</div>
      ) : null}

      <Section id={id('summary')} title="Итог" hint={review.kind}>
        {/* The call header already shows the same outcome line right above the tabs. */}
        {review.outcome && review.outcome !== detail.outcome ? <p className={styles.lead}>{review.outcome}</p> : null}
        {review.summary ? <p className={styles.muted}>{review.summary}</p> : null}
        {review.nextStep ? (
          <div className={styles.nextStep}>
            <FlagIcon size={18} aria-hidden="true" />
            <p>
              <strong>Следующий шаг:</strong> {review.nextStep.who} — {review.nextStep.what}{review.nextStep.when ? `, ${review.nextStep.when}` : ''}.{' '}
              <span className={styles.toneText} data-tone={review.nextStep.explicit ? 'lime' : 'warning'}>
                {review.nextStep.explicit ? 'Договорились прямо.' : 'Не зафиксировано.'}
              </span>
            </p>
          </div>
        ) : null}
        {metrics && !review.fromMemory ? (
          <dl className={styles.metrics}>
            {metrics.myTalkShare !== null ? <div className={styles.metric}><dt>времени говорил ты</dt><dd>{Math.round(metrics.myTalkShare * 100)}%</dd></div> : null}
            {metrics.myWordsPerMinute !== null ? <div className={styles.metric}><dt>слов в минуту</dt><dd>{Math.round(metrics.myWordsPerMinute)}</dd></div> : null}
            {metrics.longestMonologueSeconds !== null ? <div className={styles.metric}><dt>самый длинный монолог</dt><dd>{formatClock(metrics.longestMonologueSeconds)}</dd></div> : null}
            {metrics.responseLatencyMedianSeconds !== null ? <div className={styles.metric}><dt>пауза до ответа (медиана)</dt><dd>{metrics.responseLatencyMedianSeconds.toFixed(1).replace('.', ',')} с</dd></div> : null}
            {metrics.fillersPerMinute !== null ? <div className={styles.metric}><dt>заполнителей в минуту</dt><dd>{metrics.fillersPerMinute.toFixed(1).replace('.', ',')}</dd></div> : null}
            <div className={styles.metric}><dt>твоих вопросов (для справки)</dt><dd>{metrics.myQuestions}</dd></div>
            {metrics.clarifyRequests ? <div className={styles.metric}><dt>раз переспросили тебя</dt><dd>{metrics.clarifyRequests}</dd></div> : null}
          </dl>
        ) : null}
      </Section>

      {review.timeline.length ? (
        <Section id={id('timeline')} title="Ход звонка">
          <ol className={styles.timeline}>
            {review.timeline.map((item, index) => (
              <li key={index}>
                <span className={styles.timeAt}>{item.at !== null ? <At at={item.at} onSeek={onSeek} /> : <span className={kit.time}>{index + 1}</span>}</span>
                <div><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}</div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {review.wins.length ? (
        <Section id={id('wins')} title="Что сработало">
          <ul className={styles.entries}>
            {review.wins.map((win, index) => (
              <li key={index} className={styles.entry}>
                <div className={styles.entryHead}><span className={styles.mark} data-tone="lime" aria-hidden="true"><SealCheckIcon size={20} weight="fill" /></span><h4>{win.title}</h4></div>
                {win.detail ? <p>{win.detail}</p> : null}
                <Quote quote={win.quote} at={win.at} onSeek={onSeek} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {review.costs.length ? (
        <Section id={id('costs')} title="Что стоило денег" hint="сначала самое дорогое">
          <ol className={styles.entries}>
            {[...review.costs].sort((a, b) => a.rank - b.rank).map((cost, index) => (
              <li key={index} className={styles.entry}>
                <div className={styles.entryHead}><span className={styles.rank} aria-hidden="true">{cost.rank}</span><h4>{cost.title}</h4></div>
                <p className={styles.entryMeta}>
                  <span className={styles.toneText} data-tone={IMPACT_LABEL[cost.impact].tone}>{IMPACT_LABEL[cost.impact].label}</span>
                  <span>{COST_CATEGORY_LABEL[cost.category]}</span>
                  {patternTitle(cost.patternId) ? <span>Паттерн «{patternTitle(cost.patternId)}»</span> : null}
                </p>
                {cost.detail ? <p>{cost.detail}</p> : null}
                <Quote quote={cost.quote} at={cost.at} onSeek={onSeek} />
                {cost.impactUsd !== null ? (
                  <p className={styles.impactMoney}>
                    Цена ошибки: <strong>≈&nbsp;{formatMoney(cost.impactUsd, 'USD')}</strong>{cost.impactBasis ? <span> · {cost.impactBasis}</span> : null}
                  </p>
                ) : null}
                {cost.better ? <Better label="Как сказать сильнее" text={cost.better} /> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {review.agreedTerms.length || deal ? (
        <Section id={id('deal')} title="Сделка">
          {review.agreedTerms.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.terms}>
                <thead><tr><th scope="col">Условие</th><th scope="col">Что прозвучало</th></tr></thead>
                <tbody>
                  {review.agreedTerms.map((term, index) => (
                    <tr key={index}>
                      <td>{term.term}</td>
                      <td>
                        <strong>{term.value}</strong>{' '}
                        <span className={styles.toneText} data-tone={CLARITY_LABEL[term.clarity].tone}>· {CLARITY_LABEL[term.clarity].label.toLowerCase()}</span>
                        {term.quote ? <span className={styles.termQuote}><q lang="en">{term.quote}</q> <At at={term.at} onSeek={onSeek} /></span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {deal ? (
            <>
              <p className={styles.formula}>
                <HandshakeIcon size={18} aria-hidden="true" /><strong>{deal.formula}</strong>
                {deal.floor ? <span className={styles.formulaFloor}>твой пол {deal.floor}</span> : null}
              </p>
              {deal.rows.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.dealTable}>
                    <caption className={kit.visuallyHidden}>Сколько выходит при разной базе</caption>
                    <thead><tr><th scope="col">База</th><th scope="col">Процент</th><th scope="col">Итого</th></tr></thead>
                    <tbody>
                      {deal.rows.map((row, index) => (
                        <tr key={index} data-below={deal.floor ? row.belowFloor : undefined}>
                          <td>{row.base}</td><td>{row.percentFee}</td>
                          <td>
                            <span className={styles.total}>
                              {row.total}
                              {deal.floor ? (row.belowFloor
                                ? <><ArrowDownIcon size={14} weight="bold" aria-hidden="true" /><span className={kit.visuallyHidden}>ниже пола</span></>
                                : <><CheckIcon size={14} weight="bold" aria-hidden="true" /><span className={kit.visuallyHidden}>не ниже пола</span></>) : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {deal.breakEvenNote ? <p className={styles.iconLine}><ScalesIcon size={16} aria-hidden="true" />{deal.breakEvenNote}</p> : null}
            </>
          ) : null}
        </Section>
      ) : null}

      {review.debatable.length ? (
        <Section id={id('debatable')} title="Спорные моменты">
          <ul className={styles.entries}>
            {review.debatable.map((item, index) => (
              <li key={index} className={styles.entry}>
                <div className={styles.entryHead}><span className={styles.mark} aria-hidden="true"><ScalesIcon size={20} /></span><h4>{item.title}</h4></div>
                <Quote quote={item.quote} at={item.at} onSeek={onSeek} />
                <div className={styles.sides}>
                  <div className={styles.side}><b data-tone="lime">За</b><p>{item.forSide}</p></div>
                  <div className={styles.side}><b data-tone="error">Против</b><p>{item.againstSide}</p></div>
                </div>
                <p className={styles.verdict}><LightbulbIcon size={16} weight="fill" aria-hidden="true" /><span><span className={kit.visuallyHidden}>Вывод: </span>{item.verdict}</span></p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!review.fromMemory && (review.language.length || review.minorErrorsIgnored) ? (
        <Section id={id('language')} title="Английский" hint="только то, что меняет смысл или звучит младше">
          {review.language.length ? (
            <ul className={styles.entries}>
              {review.language.map((item, index) => (
                <li key={index} className={cx(styles.entry, item.asrSuspect && styles.suspect)}>
                  <div className={styles.fix}>
                    <p>
                      <span className={styles.wrong} lang="en">{item.quote}</span>
                      <ArrowRightIcon size={14} weight="bold" aria-hidden="true" className={styles.fixArrow} /><span className={kit.visuallyHidden}> лучше так: </span>
                      <span className={styles.right} lang="en">{item.correction}</span>
                    </p>
                    <At at={item.at} onSeek={onSeek} />
                  </div>
                  <p className={styles.entryMeta}>
                    <span className={styles.toneText} data-tone={LANGUAGE_IMPACT_LABEL[item.impact].tone}>{LANGUAGE_IMPACT_LABEL[item.impact].label}</span>
                    {item.asrSuspect ? <span className={styles.toneText} data-tone="warning"><WarningIcon size={13} weight="bold" aria-hidden="true" />возможно, неверно расслышано</span> : null}
                  </p>
                  {item.why ? <p>{item.why}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {review.minorErrorsIgnored ? <p className={styles.muted}>Мелких оговорок не показываю: {review.minorErrorsIgnored}. Они не мешали понять тебя.</p> : null}
        </Section>
      ) : null}

      {review.followUp ? (
        <Section id={id('followup')} title="Сообщение после звонка" hint={review.followUp.channel === 'email' ? 'письмо' : 'сообщение'}>
          <div className={styles.letter}>
            {review.followUp.subject ? <span className={styles.letterSubject} lang="en">{review.followUp.subject}</span> : null}
            <p className={styles.letterText} lang="en">
              {splitPlaceholders(review.followUp.text).map((part, index) => part.placeholder
                ? <mark key={index} className={styles.placeholder} title="Заполни перед отправкой">{part.text}</mark>
                : <span key={index}>{part.text}</span>)}
            </p>
          </div>
          <div className={styles.letterFoot}>
            {review.followUp.text.includes('[[') ? <span>Выделенное заполни перед отправкой.</span> : <span />}
            <CopyButton text={(review.followUp.subject ? `${review.followUp.subject}\n\n` : '') + review.followUp.text} label="Скопировать текст" />
          </div>
          {review.followUp.notes.length ? <ul className={styles.bullets}>{review.followUp.notes.map((note, index) => <li key={index}><InfoIcon size={16} color="var(--k-violet-ink)" aria-hidden="true" />{note}</li>)}</ul> : null}
        </Section>
      ) : null}

      {review.risks.length ? (
        <Section id={id('risks')} title="Риски">
          <ul className={styles.bullets}>
            {review.risks.map((risk, index) => <li key={index}><ShieldWarningIcon size={16} weight="fill" color="var(--k-warning-ink)" aria-hidden="true" /><span><strong>{risk.title}.</strong> {risk.detail}</span></li>)}
          </ul>
        </Section>
      ) : null}

      {review.patterns.length ? (
        <Section id={id('patterns')} title="Паттерны" hint="что из твоих паттернов было в этом звонке">
          <ul className={styles.outcomes}>
            {review.patterns.map((item, index) => {
              const glyph = OUTCOME_GLYPH[item.status];
              const Mark = OUTCOME_ICON[item.status];
              return (
                <li key={index} className={styles.outcomeRow}>
                  <span className={styles.mark} data-tone={glyph.tone} aria-hidden="true"><Mark size={20} weight="fill" /></span>
                  <div>
                    <strong>{patternTitle(item.patternId) ?? item.patternId}</strong>
                    <small>{glyph.label[0].toUpperCase() + glyph.label.slice(1)}</small>
                    {item.evidence ? <q lang="en">{item.evidence}</q> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {review.strategyMoves.length ? (
        <Section id={id('moves')} title="Ходы разговора" hint="стратегия, не английский">
          <ul className={styles.moves}>
            {STRATEGY_MOVES.map(move => {
              const score = review.strategyMoves.find(item => item.id === move.id);
              const value = score ? score.score : null;
              return (
                <li key={move.id} className={styles.outcomeRow} data-idle={value === null || undefined}>
                  <MoveMark score={value} />
                  <div>
                    <strong>{move.title}</strong>
                    <small>{value === 2 ? move.good : value === 0 ? move.bad : value === 1 ? 'Частично' : 'Не было повода'}</small>
                    {score?.quote ? <q lang="en">{score.quote}</q> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {review.betterAnswers.length ? (
        <Section id={id('answers')} title="Готовые ответы на будущее" hint="произнеси вслух">
          <ul className={styles.entries}>
            {review.betterAnswers.map((item, index) => (
              <li key={index} className={styles.entry}>
                <h4 className={styles.situation}>{item.situation}</h4>
                {item.trigger ? <Quote quote={item.trigger} at={item.at} onSeek={onSeek} /> : null}
                <Better label="Твой ответ" text={item.answer} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {suggested.length ? <SuggestedFacts facts={suggested} id={id('facts')} onChanged={onFactsChanged} /> : null}

      {review.limitations.length || review.dropped ? (
        <ul className={styles.footnote}>
          {review.limitations.map((item, index) => <li key={index}>* {item}</li>)}
          {review.dropped ? <li>* Не прошли проверку цитат и убраны из разбора: {review.dropped}.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function SuggestedFacts({ facts, id, onChanged }: { facts: ProfileFact[]; id: string; onChanged: (facts: ProfileFact[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(fact: ProfileFact, decision: 'accept' | 'reject') {
    setBusy(fact.id); setError(null);
    try {
      const result = await api<{ profileFacts: ProfileFact[] }>('facts', { factId: fact.id, decision });
      onChanged(result.profileFacts);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось сохранить.'); }
    finally { setBusy(null); }
  }
  return (
    <Section id={id} title="Что запомнить о тебе" hint="принятое попадёт в твой плейбук">
      <p className={styles.muted}>Эти факты помогут собеседнику и тренеру: ставки, кейсы, цифры. Принимай только то, что правда.</p>
      <ul className={styles.entries}>
        {facts.map(fact => (
          <li key={fact.id} className={cx(styles.entry, styles.fact)}>
            <div className={styles.factCopy}>
              <p className={styles.factText}>{fact.text}</p>
              <p className={styles.entryMeta}>
                <span>{FACT_KIND_LABEL[fact.kind]}</span>
                {fact.quote ? <span lang="en">«{fact.quote}»</span> : null}
              </p>
            </div>
            <div className={styles.factActions}>
              <button type="button" className={cx(kit.btn, kit.primary, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'accept')}
                aria-label={`Верно: ${fact.text}`}>
                {busy === fact.id ? <Spinner /> : <CheckIcon size={14} weight="bold" />}Верно
              </button>
              <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'reject')}
                aria-label={`Неверно: ${fact.text}`}>
                <XIcon size={14} weight="bold" />Нет
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className={styles.muted} role="alert" style={{ color: toneInk('error') }}>{error}</p> : null}
    </Section>
  );
}
