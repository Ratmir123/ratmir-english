'use client';

/** «Разбор» of a call, in the owner's debrief order (DESIGN-SYSTEM §3 Calls, audit-product §3.5). */
import { useState, type ReactNode } from 'react';
import {
  ArrowRightIcon, BrainIcon, CheckIcon, FlagIcon, HandshakeIcon, InfoIcon, LightbulbIcon, ScalesIcon, SealCheckIcon, ShieldWarningIcon, WarningIcon, XIcon,
} from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { CallDetail, CallReview, CommunicationPattern, ProfileFact } from '@/lib/calls/types';
import { STRATEGY_MOVES, type StrategyMoveScore } from '@/lib/strategy-moves';
import { Chip, CopyButton, cx, kit, TtsButton } from './kit';
import {
  CLARITY_LABEL, COST_CATEGORY_LABEL, dealView, FACT_KIND_LABEL, formatClock, formatMoney, IMPACT_LABEL, LANGUAGE_IMPACT_LABEL, OUTCOME_GLYPH,
  splitPlaceholders, toneInk,
} from './format';
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

function Section({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={cx(kit.solid, styles.section)} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}><h3 id={`${id}-title`}>{title}</h3>{hint ? <small>{hint}</small> : null}</div>
      {children}
    </section>
  );
}

function MoveGlyph({ score }: { score: StrategyMoveScore['score'] }) {
  const glyph = score === 2 ? '✓' : score === 1 ? '½' : score === 0 ? '✗' : '—';
  const tone = score === 2 ? 'lime' : score === 1 ? 'violet' : score === 0 ? 'error' : 'neutral';
  return <span className={cx(styles.outcomeGlyph, kit[`tone-${tone}`])} aria-hidden="true">{glyph}</span>;
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
    ...(!review.fromMemory && review.language.length ? [['language', 'Английский'] as [string, string]] : []),
    ...(review.followUp ? [['followup', 'Письмо'] as [string, string]] : []), ...(review.risks.length ? [['risks', 'Риски'] as [string, string]] : []),
    ...(review.patterns.length ? [['patterns', 'Паттерны'] as [string, string]] : []),
  ];

  return (
    <div className={styles.review}>
      <nav className={styles.toc} aria-label="Разделы разбора">
        {toc.map(([key, label]) => <a key={key} href={`#${id(key)}`}>{label}</a>)}
      </nav>

      {review.fromMemory ? (
        <div className={styles.banner}><BrainIcon size={18} weight="bold" />По памяти: разбор только про стратегию — без цитат, английского и темпа речи.</div>
      ) : null}

      <Section id={id('summary')} title="Итог" hint={review.kind}>
        <p className={styles.lead}><strong>{review.outcome}</strong></p>
        {review.summary ? <p className={styles.muted}>{review.summary}</p> : null}
        {review.nextStep ? (
          <div className={styles.nextStep}>
            <FlagIcon size={18} weight="bold" />
            <p>
              <strong>Следующий шаг:</strong> {review.nextStep.who} — {review.nextStep.what}{review.nextStep.when ? `, ${review.nextStep.when}` : ''}.{' '}
              {review.nextStep.explicit ? <Chip tone="lime">договорились прямо</Chip> : <Chip tone="warning">не зафиксировано</Chip>}
            </p>
          </div>
        ) : null}
        {metrics && !review.fromMemory ? (
          <div className={styles.metrics}>
            {metrics.myTalkShare !== null ? <div className={styles.metric}><strong>{Math.round(metrics.myTalkShare * 100)}%</strong><span>времени говорил ты</span></div> : null}
            {metrics.myWordsPerMinute !== null ? <div className={styles.metric}><strong>{Math.round(metrics.myWordsPerMinute)}</strong><span>слов в минуту</span></div> : null}
            {metrics.longestMonologueSeconds !== null ? <div className={styles.metric}><strong>{formatClock(metrics.longestMonologueSeconds)}</strong><span>самый длинный монолог</span></div> : null}
            {metrics.responseLatencyMedianSeconds !== null ? <div className={styles.metric}><strong>{metrics.responseLatencyMedianSeconds.toFixed(1).replace('.', ',')} с</strong><span>до ответа (медиана)</span></div> : null}
            {metrics.fillersPerMinute !== null ? <div className={styles.metric}><strong>{metrics.fillersPerMinute.toFixed(1).replace('.', ',')}</strong><span>заполнителей в минуту</span></div> : null}
            <div className={styles.metric}><strong>{metrics.myQuestions}</strong><span>твоих вопросов (для справки)</span></div>
            {metrics.clarifyRequests ? <div className={styles.metric}><strong>{metrics.clarifyRequests}</strong><span>раз переспросили тебя</span></div> : null}
          </div>
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
          <div className={styles.entries}>
            {review.wins.map((win, index) => (
              <div key={index} className={cx(styles.entry, styles.win)}>
                <div className={styles.entryHead}><SealCheckIcon size={20} weight="fill" color="var(--k-lime-ink)" /><strong>{win.title}</strong></div>
                {win.detail ? <p>{win.detail}</p> : null}
                <Quote quote={win.quote} at={win.at} onSeek={onSeek} />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {review.costs.length ? (
        <Section id={id('costs')} title="Что стоило денег" hint="по порядку цены">
          <div className={styles.entries}>
            {[...review.costs].sort((a, b) => a.rank - b.rank).map((cost, index) => (
              <article key={index} className={styles.entry}>
                <div className={styles.entryHead}>
                  <span className={styles.rank}>{cost.rank}</span>
                  <strong>{cost.title}</strong>
                </div>
                <div className={styles.entryChips}>
                  <Chip tone={IMPACT_LABEL[cost.impact].tone}>{IMPACT_LABEL[cost.impact].label}</Chip>
                  <Chip>{COST_CATEGORY_LABEL[cost.category]}</Chip>
                  {patternTitle(cost.patternId) ? <Chip tone="violet">{patternTitle(cost.patternId)}</Chip> : null}
                </div>
                {cost.detail ? <p>{cost.detail}</p> : null}
                <Quote quote={cost.quote} at={cost.at} onSeek={onSeek} />
                {cost.impactUsd !== null ? (
                  <div className={styles.impactMoney}>
                    <strong>≈ {formatMoney(cost.impactUsd, 'USD')}</strong>
                    {cost.impactBasis ? <span>{cost.impactBasis}</span> : null}
                  </div>
                ) : null}
                {cost.better ? (
                  <div className={styles.better}>
                    <div className={styles.betterHead}><span>Как сказать сильнее</span><TtsButton text={cost.better} compact label="Послушать" /></div>
                    <p lang="en">{cost.better}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
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
                        <strong>{term.value}</strong> <Chip tone={CLARITY_LABEL[term.clarity].tone}>{CLARITY_LABEL[term.clarity].label}</Chip>
                        {term.quote ? <small lang="en">«{term.quote}» {term.at !== null ? formatClock(term.at) : ''}</small> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {deal ? (
            <>
              <div className={styles.formula}><HandshakeIcon size={18} weight="bold" />{deal.formula}{deal.floor ? <Chip tone="violet">твой пол {deal.floor}</Chip> : null}</div>
              {deal.rows.length ? (
                <div className={styles.tableWrap}>
                  <table className={styles.dealTable}>
                    <thead><tr><th scope="col">База</th><th scope="col">Процент</th><th scope="col">Итого</th></tr></thead>
                    <tbody>
                      {deal.rows.map((row, index) => (
                        <tr key={index} data-below={deal.floor ? row.belowFloor : undefined}>
                          <td>{row.base}</td><td>{row.percentFee}</td><td>{row.total}{deal.floor ? (row.belowFloor ? ' ↓' : ' ✓') : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {deal.breakEvenNote ? <p className={styles.muted}><ScalesIcon size={16} weight="bold" style={{ display: 'inline-block', verticalAlign: -3, marginRight: 6 }} />{deal.breakEvenNote}</p> : null}
            </>
          ) : null}
        </Section>
      ) : null}

      {review.debatable.length ? (
        <Section id={id('debatable')} title="Спорные моменты">
          <div className={styles.entries}>
            {review.debatable.map((item, index) => (
              <article key={index} className={styles.entry}>
                <div className={styles.entryHead}><ScalesIcon size={20} weight="bold" /><strong>{item.title}</strong></div>
                <Quote quote={item.quote} at={item.at} onSeek={onSeek} />
                <div className={styles.sides}>
                  <div className={cx(styles.side, styles.sideFor)}><b>За</b>{item.forSide}</div>
                  <div className={cx(styles.side, styles.sideAgainst)}><b>Против</b>{item.againstSide}</div>
                </div>
                <p className={styles.verdict}><LightbulbIcon size={16} weight="fill" />{item.verdict}</p>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      {!review.fromMemory && (review.language.length || review.minorErrorsIgnored) ? (
        <Section id={id('language')} title="Английский" hint="только то, что меняет смысл или звучит младше">
          <div className={styles.entries}>
            {review.language.map((item, index) => (
              <div key={index} className={cx(styles.entry, item.asrSuspect && styles.suspect)}>
                <div className={styles.fix}>
                  <span className={styles.wrong} lang="en">{item.quote}</span>
                  <ArrowRightIcon size={14} weight="bold" aria-hidden="true" />
                  <span className={styles.right} lang="en">{item.correction}</span>
                  <At at={item.at} onSeek={onSeek} />
                </div>
                <div className={styles.entryChips}>
                  <Chip tone={LANGUAGE_IMPACT_LABEL[item.impact].tone}>{LANGUAGE_IMPACT_LABEL[item.impact].label}</Chip>
                  {item.asrSuspect ? <Chip tone="warning" icon={<WarningIcon size={12} weight="bold" />}>возможно, неверно расслышано</Chip> : null}
                </div>
                {item.why ? <p>{item.why}</p> : null}
              </div>
            ))}
          </div>
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
          <div className={kit.muted} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>Жёлтое — заполни перед отправкой.</span>
            <CopyButton text={(review.followUp.subject ? `${review.followUp.subject}\n\n` : '') + review.followUp.text} label="Скопировать текст" />
          </div>
          {review.followUp.notes.length ? <ul className={styles.bullets}>{review.followUp.notes.map((note, index) => <li key={index}><InfoIcon size={16} weight="bold" color="var(--k-violet-ink)" />{note}</li>)}</ul> : null}
        </Section>
      ) : null}

      {review.risks.length ? (
        <Section id={id('risks')} title="Риски">
          <ul className={styles.bullets}>
            {review.risks.map((risk, index) => <li key={index}><ShieldWarningIcon size={16} weight="fill" color="var(--k-warning-ink)" /><span><strong>{risk.title}.</strong> {risk.detail}</span></li>)}
          </ul>
        </Section>
      ) : null}

      {review.patterns.length ? (
        <Section id={id('patterns')} title="Паттерны" hint="● повторилось ○ справился · не было повода ◐ лучше">
          <div>
            {review.patterns.map((item, index) => {
              const glyph = OUTCOME_GLYPH[item.status];
              return (
                <div key={index} className={styles.outcomeRow}>
                  <span className={cx(styles.outcomeGlyph, kit[`tone-${glyph.tone}`])} aria-hidden="true">{glyph.glyph}</span>
                  <div>
                    <strong>{patternTitle(item.patternId) ?? item.patternId}</strong>
                    <small>{glyph.label}</small>
                    {item.evidence ? <q lang="en">{item.evidence}</q> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {review.strategyMoves.length ? (
        <Section id={id('moves')} title="Ходы разговора" hint="стратегия, не английский">
          <div className={styles.moves}>
            {STRATEGY_MOVES.map(move => {
              const score = review.strategyMoves.find(item => item.id === move.id);
              const value = score ? score.score : null;
              return (
                <div key={move.id} className={styles.outcomeRow} style={{ borderTop: 0 }}>
                  <MoveGlyph score={value} />
                  <div>
                    <strong>{move.title}</strong>
                    <small>{value === 2 ? move.good : value === 0 ? move.bad : value === 1 ? 'Частично' : 'Не было повода'}</small>
                    {score?.quote ? <q lang="en">{score.quote}</q> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {review.betterAnswers.length ? (
        <Section id={id('answers')} title="Готовые ответы на будущее" hint="произнеси вслух">
          <div className={styles.entries}>
            {review.betterAnswers.map((item, index) => (
              <div key={index} className={styles.entry}>
                <strong style={{ fontSize: 14.5 }}>{item.situation}</strong>
                {item.trigger ? <Quote quote={item.trigger} at={item.at} onSeek={onSeek} /> : null}
                <div className={styles.better}>
                  <div className={styles.betterHead}><span>Твой ответ</span><TtsButton text={item.answer} compact label="Послушать" /></div>
                  <p lang="en">{item.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {suggested.length ? <SuggestedFacts facts={suggested} idPrefix={idPrefix} onChanged={onFactsChanged} /> : null}

      {review.limitations.length || review.dropped ? (
        <ul className={styles.footnote}>
          {review.limitations.map((item, index) => <li key={index}>* {item}</li>)}
          {review.dropped ? <li>* Не прошли проверку цитат и убраны из разбора: {review.dropped}.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function SuggestedFacts({ facts, idPrefix, onChanged }: { facts: ProfileFact[]; idPrefix: string; onChanged: (facts: ProfileFact[]) => void }) {
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
    <Section id={`${idPrefix}-facts`} title="Что запомнить о тебе" hint="принятое попадёт в твой плейбук">
      <p className={styles.muted}>Эти факты помогут собеседнику и тренеру: ставки, кейсы, цифры. Принимай только то, что правда.</p>
      <div className={styles.entries}>
        {facts.map(fact => (
          <div key={fact.id} className={styles.fact}>
            <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
              <Chip tone="violet">{FACT_KIND_LABEL[fact.kind]}</Chip>
              <p>{fact.text}</p>
              {fact.quote ? <small className={kit.faint} lang="en">«{fact.quote}»</small> : null}
            </div>
            <div className={styles.factActions}>
              <button type="button" className={cx(kit.btn, kit.primary, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'accept')}><CheckIcon size={14} weight="bold" />Верно</button>
              <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'reject')}><XIcon size={14} weight="bold" />Нет</button>
            </div>
          </div>
        ))}
      </div>
      {error ? <p className={styles.muted} role="alert" style={{ color: toneInk('error') }}>{error}</p> : null}
    </Section>
  );
}
