import { randomUUID } from 'node:crypto';
import type { CallReview, CallSegment, DealModel, PatternOutcome } from '../../calls/types';
import { STRATEGY_MOVES } from '../../strategy-moves';
import { canonicalPatternId, catalogPattern, isLanguageTag, type PatternDefinition } from './catalog';
import type { FactInput, PatternHit, StoredDrill } from './repository';
import { DRILL_TYPES, judgeSchema, mapSchema, type JudgeOutput, type MapOutput, type ReviewMode } from './review-prompt';
import { QuoteIndex, TextQuoteIndex, clip, hasCyrillic, mostlyLatin, normaliseText, slugify } from './text';

/**
 * Server-side checks of Sol's call review (CONTRACT §2): every quote is grounded in the transcript (or in the debrief
 * text), invalid items are DROPPED and counted in review.dropped instead of failing the whole review, and money maths
 * (deal table, break-even) is computed here, never by the model. Only structural problems and a review with more than
 * half of its quotes invented are rejected (the caller regenerates once).
 */
export interface ReviewEnv {
  mode: ReviewMode;
  segments: CallSegment[];
  meIds: ReadonlySet<string>;
  needsAttribution: boolean;
  sourceText: string | null;
  /** Stored pattern ids plus the generic catalog: ids Sol may reference. */
  knownPatterns: ReadonlySet<string>;
  /** Patterns that keep existing regardless of this call (events in other calls). */
  persistentPatterns: ReadonlySet<string>;
  /** Patterns given to Sol as ACTIVE_PATTERNS: each gets a status (no-opportunity when omitted). */
  activePatternIds: string[];
  existingFacts: ReadonlySet<string>;
  context: 'work' | 'life' | 'relocation';
}

export interface SanitisedMap {
  kind: string; outcome: string; summary: string;
  timeline: CallReview['timeline']; agreedTerms: CallReview['agreedTerms']; nextStep: CallReview['nextStep'];
  dealModel: DealModel | null; followUp: CallReview['followUp']; risks: CallReview['risks']; facts: FactInput[];
}
export type DrillDraft = Omit<StoredDrill, 'id' | 'source' | 'createdAt' | 'linkedSessions'> & { seedAt: number | null };
export interface SanitisedJudge {
  wins: CallReview['wins']; costs: CallReview['costs']; debatable: CallReview['debatable']; language: CallReview['language'];
  minorErrorsIgnored: number; betterAnswers: CallReview['betterAnswers']; hits: PatternHit[]; newPatterns: PatternDefinition[];
  strategyMoves: CallReview['strategyMoves']; drills: DrillDraft[]; limitations: string[];
}
export interface Stats { dropped: number; checked: number; invalid: number }
type Side = 'me' | 'other' | 'any';
interface Grounded { ok: boolean; quote: string | null; at: number | null; segmentId: string | null; asrSuspect: boolean }

const NONE: Grounded = { ok: true, quote: null, at: null, segmentId: null, asrSuspect: false };
const round2 = (value: number) => Math.round(value * 100) / 100;
const side = (value: 'me' | 'other' | null | undefined): Side => value ?? 'any';
const text = (value: string | null | undefined, max: number) => clip(value ?? '', max);

interface Grounder {
  quote(quote: string | null | undefined, side: Side, at: number | null | undefined): Grounded;
  time(at: number | null | undefined): number | null;
  seed(line: string, at: number | null | undefined): { ok: boolean; at: number | null };
}

function grounder(env: ReviewEnv, segments: CallSegment[], meIds: ReadonlySet<string>): Grounder {
  if (env.mode === 'transcript') {
    const index = new QuoteIndex(segments, meIds);
    return {
      quote(quote, where, at) {
        if (!quote?.trim()) return NONE;
        const found = index.locate(quote, where, at);
        return found ? { ok: true, quote: clip(quote, 500), at: found.start, segmentId: found.segmentId, asrSuspect: found.viaTextOnly }
          : { ok: false, quote: null, at: null, segmentId: null, asrSuspect: false };
      },
      time: at => index.snap(at),
      seed(line, at) {
        const exact = index.locate(line, 'other', at);
        if (exact) return { ok: true, at: exact.start };
        const lenient = index.coverage(line, 'other');
        return lenient.coverage >= 0.6 ? { ok: true, at: lenient.start } : { ok: false, at: null };
      },
    };
  }
  if (env.mode === 'debrief') {
    const source = new TextQuoteIndex(env.sourceText ?? '');
    return {
      quote(quote, _where, at) {
        if (!quote?.trim()) return NONE;
        return source.contains(quote) ? { ok: true, quote: clip(quote, 500), at: source.time(at), segmentId: null, asrSuspect: false }
          : { ok: false, quote: null, at: null, segmentId: null, asrSuspect: false };
      },
      time: at => source.time(at),
      seed: () => ({ ok: true, at: null }),
    };
  }
  // A recollection has no exact words: quotes are removed, the observations themselves stay.
  return {
    quote: () => NONE,
    time: () => null,
    seed: () => ({ ok: true, at: null }),
  };
}

// ---------- speaker attribution for unlabeled transcripts ----------

export function applyAttribution(segments: CallSegment[], attribution: MapOutput['speakerAttribution']): { ok: true; segments: CallSegment[] } | { ok: false; error: string } {
  if (!attribution) return { ok: false, error: 'speakerAttribution is required: the transcript has no speaker labels.' };
  const ids = new Set(segments.map(segment => segment.id));
  const learner = new Set(attribution.learnerSegmentIds.filter(id => ids.has(id)));
  const mixed = new Map(attribution.mixed.filter(entry => ids.has(entry.segmentId) && entry.parts.length >= 1).map(entry => [entry.segmentId, entry.parts]));
  const result: CallSegment[] = [];
  let mine = 0;
  for (const segment of segments) {
    const parts = mixed.get(segment.id)?.filter(part => part.text.trim());
    const rebuilt = parts && parts.length >= 2 && normaliseText(parts.map(part => part.text).join(' ')) === normaliseText(segment.text);
    if (parts && rebuilt) {
      const total = parts.reduce((sum, part) => sum + part.text.length, 0) || 1;
      let offset = 0;
      for (const part of parts) {
        const timed = segment.start !== null && segment.end !== null;
        const start = timed ? segment.start! + (segment.end! - segment.start!) * offset / total : segment.start;
        offset += part.text.length;
        const end = timed ? segment.start! + (segment.end! - segment.start!) * offset / total : segment.end;
        result.push({ ...segment, speaker: part.speaker, start: start === null ? null : round2(start), end: end === null ? null : round2(end), text: part.text.trim() });
        if (part.speaker === 'me') mine++;
      }
      continue;
    }
    let speaker: 'me' | 'other' = learner.has(segment.id) ? 'me' : 'other';
    if (parts?.length) {
      // Parts that do not rebuild the line: attribute it to whoever said most of it.
      const count = (who: 'me' | 'other') => parts.filter(part => part.speaker === who).reduce((sum, part) => sum + part.text.length, 0);
      speaker = count('me') > count('other') ? 'me' : 'other';
    }
    result.push({ ...segment, speaker });
    if (speaker === 'me') mine++;
  }
  if (!mine) return { ok: false, error: 'No line was attributed to the learner; list his lines in speakerAttribution.' };
  return { ok: true, segments: result.map((segment, index) => ({ ...segment, id: `s${index}` })) };
}

// ---------- pass A ----------

export function sanitiseMap(raw: unknown, env: ReviewEnv):
  { ok: true; map: SanitisedMap; segments: CallSegment[]; meIds: ReadonlySet<string>; stats: Stats } | { ok: false; error: string } {
  const parsed = mapSchema(false).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'The output does not match the JSON schema.' };
  const output = parsed.data as MapOutput;
  let segments = env.segments;
  let meIds = env.meIds;
  if (env.needsAttribution) {
    const applied = applyAttribution(env.segments, output.speakerAttribution);
    if (!applied.ok) return applied;
    segments = applied.segments;
    meIds = new Set(['me']);
  }
  if (!output.outcome.trim() || !output.summary.trim()) return { ok: false, error: 'outcome and summary must not be empty.' };
  const ground = grounder(env, segments, meIds);
  const stats: Stats = { dropped: 0, checked: 0, invalid: 0 };
  const check = (quote: string | null | undefined, where: Side, at: number | null | undefined) => {
    if (!quote?.trim()) return NONE;
    stats.checked++;
    const result = ground.quote(quote, where, at);
    if (!result.ok) { stats.invalid++; stats.dropped++; }
    return result;
  };

  const timeline = output.timeline.filter(item => item.title.trim()).slice(0, 14)
    .map(item => ({ at: ground.time(item.at), title: text(item.title, 140), detail: text(item.detail, 600) }));
  const agreedTerms = output.agreedTerms.filter(item => item.term.trim() && item.value.trim()).slice(0, 16).map(item => {
    const grounded = check(item.quote, side(item.quoteSpeaker), item.at);
    return { term: text(item.term, 120), value: text(item.value, 300), quote: grounded.ok ? grounded.quote : null,
      at: grounded.ok ? grounded.at : null, clarity: item.clarity };
  });
  const nextStep = output.nextStep && output.nextStep.who.trim() && output.nextStep.what.trim()
    ? { who: text(output.nextStep.who, 120), what: text(output.nextStep.what, 400), when: output.nextStep.when?.trim() ? text(output.nextStep.when, 120) : null,
      explicit: output.nextStep.explicit } : null;
  const deal = output.dealModel;
  const scenarios = deal ? [...new Set(deal.scenarios.filter(value => Number.isFinite(value) && value >= 0).map(round2))].sort((left, right) => left - right).slice(0, 6) : [];
  const dealModel: DealModel | null = deal && Number.isFinite(deal.fixedFee) && deal.fixedFee >= 0
    && (deal.percent === null || (Number.isFinite(deal.percent) && deal.percent > 0 && deal.percent <= 100))
    && (deal.floor === null || (Number.isFinite(deal.floor) && deal.floor >= 0))
    ? { currency: deal.currency, fixedFee: round2(deal.fixedFee), percent: deal.percent === null ? null : round2(deal.percent),
      base: deal.base?.trim() ? text(deal.base, 200) : null, floor: deal.floor === null ? null : round2(deal.floor), scenarios } : null;
  const followUp = output.followUp && output.followUp.text.trim() && mostlyLatin(output.followUp.text)
    ? { channel: output.followUp.channel, subject: output.followUp.channel === 'email' && output.followUp.subject?.trim() ? text(output.followUp.subject, 160) : null,
      text: output.followUp.text.trim().slice(0, 2500), notes: output.followUp.notes.map(note => text(note, 300)).filter(Boolean).slice(0, 4) } : null;
  const risks = output.risks.filter(item => item.title.trim()).slice(0, 8).map(item => ({ title: text(item.title, 140), detail: text(item.detail, 700) }));
  const seen = new Set(env.existingFacts);
  const facts: FactInput[] = [];
  for (const fact of output.profileFacts) {
    const value = text(fact.text, 240);
    const key = normaliseText(value);
    if (!value || !hasCyrillic(value) || seen.has(key) || facts.length >= 12) continue;
    seen.add(key);
    const grounded = check(fact.quote, 'any', fact.at);
    facts.push({ kind: fact.kind, text: value, quote: grounded.ok ? grounded.quote : null, at: grounded.ok ? grounded.at : null });
  }
  return { ok: true, segments, meIds, stats, map: { kind: text(output.kind, 80) || 'Созвон', outcome: text(output.outcome, 700), summary: text(output.summary, 1400),
    timeline, agreedTerms, nextStep, dealModel, followUp, risks, facts } };
}

// ---------- pass B ----------

export function sanitiseJudge(raw: unknown, env: ReviewEnv, segments: CallSegment[], meIds: ReadonlySet<string>):
  { ok: true; judge: SanitisedJudge; stats: Stats } | { ok: false; error: string } {
  const parsed = judgeSchema(false).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'The output does not match the JSON schema.' };
  const output = parsed.data as JudgeOutput;
  const ground = grounder(env, segments, meIds);
  const stats: Stats = { dropped: 0, checked: 0, invalid: 0 };
  const check = (quote: string | null | undefined, where: Side, at: number | null | undefined) => {
    if (!quote?.trim()) return NONE;
    stats.checked++;
    const result = ground.quote(quote, where, at);
    if (!result.ok) { stats.invalid++; stats.dropped++; }
    return result;
  };

  const declared = new Map<string, PatternDefinition>();
  for (const item of output.newPatterns.slice(0, 3)) {
    const id = canonicalPatternId(item.id);
    if (!id || env.knownPatterns.has(id) || !item.title.trim()) continue;
    const contexts = [...new Set(item.contexts)].filter(value => ['work', 'life', 'relocation'].includes(value));
    declared.set(id, { id, title: text(item.title, 100), kind: item.kind, category: item.category, description: text(item.description, 500),
      drillHint: text(item.drillHint, 300), costRank: Math.min(5, Math.max(1, Math.round(item.costRank))) as PatternDefinition['costRank'],
      contexts: contexts.length ? contexts : [env.context] });
  }
  const known = (id: string | null): id is string => !!id && (env.knownPatterns.has(id) || declared.has(id));

  const wins: CallReview['wins'] = [];
  for (const item of output.wins) {
    if (!item.title.trim() || wins.length >= 8) continue;
    const grounded = check(item.quote, side(item.quoteSpeaker), item.at);
    if (!grounded.ok) continue;
    wins.push({ title: text(item.title, 140), detail: text(item.detail, 700), quote: grounded.quote, at: grounded.at });
  }

  const costs: CallReview['costs'] = [];
  for (const item of [...output.costs].sort((left, right) => left.rank - right.rank)) {
    if (!item.title.trim() || costs.length >= 7) continue;
    const grounded = check(item.quote, side(item.quoteSpeaker), item.at);
    if (!grounded.ok) continue;
    const patternId = canonicalPatternId(item.patternId);
    const impact = item.impactUsd !== null && Number.isFinite(item.impactUsd) && item.impactUsd >= 0 && item.impactBasis?.trim();
    costs.push({ rank: costs.length + 1, title: text(item.title, 160), detail: text(item.detail, 1200), quote: grounded.quote, at: grounded.at,
      segmentId: grounded.segmentId, category: item.category, impact: item.impact, patternId: known(patternId) ? patternId : null,
      impactUsd: impact ? round2(item.impactUsd!) : null, impactBasis: impact ? text(item.impactBasis, 400) : null, better: text(item.better, 700) });
  }

  const debatable: CallReview['debatable'] = [];
  for (const item of output.debatable) {
    if (!item.title.trim() || debatable.length >= 5) continue;
    const grounded = check(item.quote, side(item.quoteSpeaker), item.at);
    if (!grounded.ok) continue;
    debatable.push({ title: text(item.title, 160), quote: grounded.quote, at: grounded.at, forSide: text(item.forSide, 600),
      againstSide: text(item.againstSide, 600), verdict: text(item.verdict, 600) });
  }

  const language: CallReview['language'] = [];
  let minor = 0;
  for (const item of env.mode === 'memory' ? [] : output.language) {
    const grounded = check(item.quote, 'me', item.at);
    if (!grounded.ok || !grounded.quote) continue;
    if (!item.correction.trim() || normaliseText(item.correction) === normaliseText(item.quote)) { stats.dropped++; continue; }
    if (item.impact === 'minor') { minor++; continue; }
    if (language.length >= 8) { minor++; continue; }
    const tag = canonicalPatternId(item.tag) ?? (slugify(item.tag) || 'other');
    language.push({ quote: grounded.quote, correction: text(item.correction, 300), why: text(item.why, 400), at: grounded.at, tag,
      impact: item.impact, asrSuspect: item.asrSuspect || grounded.asrSuspect });
  }
  if (env.mode === 'memory' && output.language.length) stats.dropped += output.language.length;
  const minorErrorsIgnored = env.mode === 'memory' ? 0 : Math.min(500, Math.max(0, Math.round(output.minorErrorsIgnored))) + minor;

  const betterAnswers: CallReview['betterAnswers'] = [];
  for (const item of output.betterAnswers) {
    if (!item.answer.trim() || betterAnswers.length >= 7) continue;
    const grounded = check(item.trigger, 'other', item.at);
    betterAnswers.push({ situation: text(item.situation, 300), answer: text(item.answer, 900),
      trigger: grounded.ok ? grounded.quote : null, at: grounded.ok ? grounded.at : null });
  }

  const hits: PatternHit[] = [];
  const seen = new Set<string>();
  for (const item of output.patterns) {
    const id = canonicalPatternId(item.patternId);
    if (!id || seen.has(id)) continue;
    if (!known(id)) { stats.dropped++; continue; }
    const note = item.note?.trim() ? text(item.note, 400) : null;
    if (item.status === 'no-opportunity') { hits.push({ patternId: id, status: item.status, quote: null, at: null, note }); seen.add(id); continue; }
    const grounded = check(item.quote, 'me', item.at);
    if (!grounded.ok) continue;
    if (env.mode === 'transcript' && item.status === 'new' && !grounded.quote) { stats.dropped++; continue; }
    hits.push({ patternId: id, status: item.status, quote: grounded.quote, at: grounded.at, note });
    seen.add(id);
  }
  for (const id of [...declared.keys()]) {
    if (!hits.some(hit => hit.patternId === id && (hit.status === 'new' || hit.status === 'repeated' || hit.status === 'improved'))) declared.delete(id);
  }
  for (let index = hits.length - 1; index >= 0; index--) {
    const id = hits[index].patternId;
    if (!env.knownPatterns.has(id) && !declared.has(id)) hits.splice(index, 1);
  }
  for (const id of env.activePatternIds) {
    if (!seen.has(id)) { hits.push({ patternId: id, status: 'no-opportunity', quote: null, at: null, note: null }); seen.add(id); }
  }

  const byMove = new Map(output.strategyMoves.map(item => [item.id, item]));
  const strategyMoves: CallReview['strategyMoves'] = STRATEGY_MOVES.map(move => {
    const item = byMove.get(move.id);
    const score = item && (item.score === 0 || item.score === 1 || item.score === 2) ? item.score : null;
    if (score === null) return { id: move.id, score: null, quote: null, at: null };
    if (env.mode === 'memory') return { id: move.id, score, quote: null, at: null };
    const grounded = check(item!.quote, 'me', item!.at);
    return grounded.ok ? { id: move.id, score, quote: grounded.quote, at: grounded.at } : { id: move.id, score: null, quote: null, at: null };
  });

  const drills: DrillDraft[] = [];
  for (const item of output.drills) {
    if (drills.length >= 6 || !DRILL_TYPES.includes(item.type) || !item.title.trim() || !item.goal.trim()) continue;
    const patternIds = [...new Set(item.patternIds.map(canonicalPatternId).filter(known))].slice(0, 3);
    let seedLine = item.seedLine?.trim() ? text(item.seedLine, 600) : null;
    let seedAt: number | null = null;
    if (seedLine) {
      const seed = ground.seed(seedLine, item.seedAt);
      if (seed.ok) seedAt = seed.at;
      else if (item.type === 'replay') { stats.dropped++; continue; }
      else { seedLine = null; stats.dropped++; }
    }
    const criteria = item.successCriteria.map(value => text(value, 240)).filter(Boolean).slice(0, 4);
    drills.push({ type: item.type, title: text(item.title, 120), why: text(item.why, 500), goal: text(item.goal, 300), seedLine, seedAt,
      counterpartRole: item.counterpartRole?.trim() ? text(item.counterpartRole, 200) : null,
      context: (['work', 'life', 'relocation'] as const).includes(item.context) ? item.context : env.context, patternIds,
      tier: Math.min(3, Math.max(1, Math.round(item.tier))) as 1 | 2 | 3, successCriteria: criteria.length ? criteria : [text(item.goal, 240)],
      pushback: item.pushback.map(value => text(value, 300)).filter(value => value && mostlyLatin(value)).slice(0, 3),
      mustInclude: item.mustInclude.map(value => text(value, 120)).filter(Boolean).slice(0, 8),
      mustAvoid: item.mustAvoid.map(value => text(value, 120)).filter(Boolean).slice(0, 8) });
  }

  return { ok: true, stats, judge: { wins, costs, debatable, language, minorErrorsIgnored, betterAnswers, hits, newPatterns: [...declared.values()],
    strategyMoves, drills, limitations: output.limitations.map(value => text(value, 400)).filter(Boolean).slice(0, 4) } };
}

/** Regenerate once when more than half of the checked quotes were invented (a sign of hallucination). */
export function mostlyInvented(stats: Stats): boolean { return stats.checked >= 4 && stats.invalid / stats.checked > 0.5; }

// ---------- server maths and assembly ----------

export function computeDeal(model: DealModel | null): Pick<CallReview, 'dealTable' | 'breakEven'> {
  if (!model) return { dealTable: null, breakEven: null };
  const rate = model.percent !== null && model.percent > 0 ? model.percent / 100 : null;
  const breakEven = rate !== null && model.floor !== null && model.floor > model.fixedFee ? round2((model.floor - model.fixedFee) / rate) : null;
  if (rate === null) return { dealTable: null, breakEven };
  const bases = [...model.scenarios];
  if (breakEven !== null && !bases.some(base => Math.abs(base - breakEven) <= breakEven * 0.005)) bases.push(breakEven);
  const table = [...new Set(bases.map(round2))].sort((left, right) => left - right).slice(0, 8)
    .map(base => ({ base, percentFee: round2(base * rate), total: round2(model.fixedFee + base * rate) }));
  return { dealTable: table, breakEven };
}

function cardsDrill(language: CallReview['language'], context: ReviewEnv['context'], patterns: ReadonlySet<string>): DrillDraft | null {
  const items = language.filter(item => !item.asrSuspect && item.impact !== 'minor').slice(0, 8);
  if (!items.length) return null;
  return { type: 'cards', title: 'Карточки: ошибки из звонка', why: `В звонке прозвучало: ${items.slice(0, 3).map(item => `«${item.quote}»`).join(', ')}.`,
    goal: 'Сказать правильную форму и сразу использовать её в новой фразе на другую тему.', seedLine: null, seedAt: null, counterpartRole: null, context,
    patternIds: [...new Set(items.map(item => item.tag).filter(tag => patterns.has(tag)))].slice(0, 3), tier: 1,
    successCriteria: ['Говоришь исправленную форму без подсказки', 'Используешь её в новой фразе на другую тему'], pushback: [],
    mustInclude: items.map(item => item.correction).slice(0, 8), mustAvoid: items.map(item => item.quote).slice(0, 8) };
}

function followUpDrill(map: SanitisedMap, context: ReviewEnv['context'], patterns: ReadonlySet<string>): DrillDraft | null {
  const open = map.agreedTerms.filter(term => term.clarity !== 'explicit');
  if (!map.agreedTerms.length || (!open.length && map.nextStep?.explicit)) return null;
  return { type: 'followup', title: 'Письмо после звонка', why: open.length ? `Не зафиксированы: ${open.slice(0, 4).map(term => term.term).join(', ')}.`
    : 'Договорённости нужно закрепить письменно.', goal: 'Письмо до 120 слов фиксирует все условия с цифрами и открытые вопросы.',
    seedLine: null, seedAt: null, counterpartRole: null, context, patternIds: ['terms-vague', 'recap-drops-addon'].filter(id => patterns.has(id)), tier: 1,
    successCriteria: ['Все договорённости названы с цифрами', 'Открытые вопросы сформулированы как предложение или вопрос', 'Дружелюбный деловой тон, не длиннее 120 слов'],
    pushback: [], mustInclude: map.agreedTerms.map(term => term.value).slice(0, 8), mustAvoid: [] };
}

export interface AssembledReview {
  review: CallReview;
  hits: PatternHit[];
  /** Definitions to create when missing: newly declared patterns and catalog patterns seen for the first time. */
  definitions: PatternDefinition[];
  facts: FactInput[];
  drills: StoredDrill[];
}

export function assembleReview(input: { env: ReviewEnv; map: SanitisedMap; judge: SanitisedJudge; dropped: number; callId: string; version: number;
  model: string; serverLimitations: string[]; now?: number }): AssembledReview {
  const { env, map, judge } = input;
  const now = input.now ?? Date.now();
  const hits = [...judge.hits];
  // Language errors with a known language tag become pattern evidence (never from suspected recognition errors).
  for (const item of judge.language) {
    if (item.asrSuspect || item.impact === 'minor' || hits.some(hit => hit.patternId === item.tag)) continue;
    if (!isLanguageTag(item.tag) && !env.knownPatterns.has(item.tag)) continue;
    const status: PatternOutcome = env.persistentPatterns.has(item.tag) ? 'repeated' : 'new';
    hits.push({ patternId: item.tag, status, quote: item.quote, at: item.at, note: item.correction });
  }
  const shown = new Set(hits.filter(hit => hit.status !== 'no-opportunity').map(hit => hit.patternId));
  const available = new Set([...env.persistentPatterns, ...shown]);
  const declared = new Map(judge.newPatterns.map(item => [item.id, item]));
  const definitions = [...shown].map(id => declared.get(id) ?? catalogPattern(id)).filter((item): item is PatternDefinition => !!item);

  const drafts = judge.drills.map(drill => ({ ...drill, patternIds: drill.patternIds.filter(id => available.has(id)) }))
    .filter(drill => drill.patternIds.length || ['followup', 'cards', 'rapidfire'].includes(drill.type));
  let dropped = input.dropped + (judge.drills.length - drafts.length);
  if (!drafts.some(drill => drill.type === 'cards' || drill.type === 'language') && drafts.length < 6 && env.mode !== 'memory') {
    const cards = cardsDrill(judge.language, env.context, available);
    if (cards) drafts.push(cards);
  }
  if (!drafts.some(drill => drill.type === 'followup') && drafts.length < 6) {
    const followUp = followUpDrill(map, env.context, available);
    if (followUp) drafts.push(followUp);
  }
  const createdAt = new Date(now).toISOString();
  const drills: StoredDrill[] = drafts.slice(0, 6).map(({ seedAt, ...drill }, index) => ({ ...drill, id: randomUUID(),
    source: { type: 'call', callId: input.callId, at: seedAt }, createdAt: new Date(now + index).toISOString(), linkedSessions: [] }));
  if (drafts.length > 6) dropped += drafts.length - 6;

  const limitations = [...new Set([...input.serverLimitations, ...judge.limitations])].slice(0, 8);
  // Cost items link only to patterns that exist after this review is published.
  const costs = judge.costs.map(cost => ({ ...cost, patternId: cost.patternId && available.has(cost.patternId) ? cost.patternId : null }));
  const review: CallReview = {
    version: input.version, model: input.model, createdAt, fromMemory: env.mode === 'memory',
    kind: map.kind, outcome: map.outcome, summary: map.summary, timeline: map.timeline,
    agreedTerms: map.agreedTerms, nextStep: map.nextStep, dealModel: map.dealModel, ...computeDeal(map.dealModel),
    wins: judge.wins, costs, debatable: judge.debatable, language: judge.language, minorErrorsIgnored: judge.minorErrorsIgnored,
    betterAnswers: judge.betterAnswers, followUp: map.followUp, risks: map.risks,
    patterns: hits.map(hit => ({ patternId: hit.patternId, status: hit.status, evidence: hit.quote ?? hit.note ?? '' })),
    strategyMoves: judge.strategyMoves, limitations, dropped,
  };
  return { review, hits, definitions, facts: map.facts, drills };
}
