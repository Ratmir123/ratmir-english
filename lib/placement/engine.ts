/**
 * Placement engine v2 — pure, deterministic functions (no I/O, no server imports, injectable RNG).
 * Implements planning/v05/audit-product.md §2.4 (discrete Bayesian levels, information-gain routing,
 * stopping rules and guards), §2.5 (stimulus groups, plays), §2.6 (speaking ladder) and the item choice rules.
 * Aggregation of rated skills lives in ./scoring.ts.
 */
import { CEFR_VALUE, cefrFromScore, type CEFRLevel, type Confidence, type PlacementItem,
  type PlacementRoleplayScript, type PlacementSpeakingPrompt } from './types';

/** Five level hypotheses (index 0–4): A1 means "below A2", C1 means "C1 or above". */
export const LEVEL_HYPOTHESES: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
/** Weakly informative prior centred on B1. The SAME prior starts every section: posteriors never mix across sections. */
export const PLACEMENT_PRIOR: readonly number[] = [0.08, 0.22, 0.30, 0.25, 0.15];
export const START_LEVEL_INDEX = 2; // B1: first stimulus of every objective section
export const SECOND_QUESTION_WEIGHT = 0.7;
export const SECOND_PLAY_CORRECT_WEIGHT = 0.5;
export const RANGE_MASS = 0.8;
/** Items seen in a past attempt within this window are not served while unseen alternatives exist. */
export const CONTAMINATION_DAYS = 90;
/**
 * Highest item level used by the adaptive loop: C1 (index 4). The model's top hypothesis is "C1 or above", so a C2
 * item cannot move a band upward, and scoring it as a C1 item would pull genuine C1 learners down. C2 items stay in the
 * bank (ceiling material for later versions and drills) but are never served by the placement test.
 */
export const ADAPTIVE_MAX_LEVEL_INDEX = 4;
const DAY_MS = 86_400_000;

export type ObjectiveSection = 'listening' | 'reading' | 'language';
export type ObjectiveSkill = 'listening' | 'reading' | 'grammar' | 'vocabulary';
export type Posterior = number[];

export interface SectionRule {
  questionsPerStimulus: 1 | 2; minQuestions: number; maxQuestions: number;
  /** Stop once the (pooled, for language) posterior's largest level probability reaches this value. */
  stopAt: number; timeCapMs: number;
}
export const SECTION_RULES: Record<ObjectiveSection, SectionRule> = {
  listening: { questionsPerStimulus: 2, minQuestions: 6, maxQuestions: 12, stopAt: 0.75, timeCapMs: 7 * 60_000 },
  reading: { questionsPerStimulus: 2, minQuestions: 4, maxQuestions: 8, stopAt: 0.80, timeCapMs: 5 * 60_000 },
  language: { questionsPerStimulus: 1, minQuestions: 12, maxQuestions: 18, stopAt: 0.80, timeCapMs: 5 * 60_000 },
};

/** Item/hypothesis index on one scale: A1 0, A2 1, B1 2, B2 3, C1 4, C2 5 (C2 items are ceiling checks only). */
export function levelIndex(level: CEFRLevel): number { return CEFR_VALUE[level] - 1; }

/** Audit §2.4 likelihood table, with a guessing floor of 1/options. "At level L" ≈ 75% correct on level-L items. */
export function pCorrect(hypothesis: number, itemLevel: number, options = 4): number {
  const d = hypothesis - itemLevel;
  const floor = 1 / Math.max(2, options);
  return d >= 2 ? 0.97 : d === 1 ? 0.92 : d === 0 ? 0.75 : d === -1 ? Math.max(floor, 0.40) : floor;
}

export function normalise(values: readonly number[]): Posterior {
  const sum = values.reduce((total, value) => total + value, 0);
  return sum > 0 && Number.isFinite(sum) ? values.map(value => value / sum) : [...PLACEMENT_PRIOR];
}

/** Bayesian update with a tempered likelihood (weight < 1 for dependent or replayed evidence). */
export function updatePosterior(posterior: readonly number[], itemLevel: number, correct: boolean, weight = 1, options = 4): Posterior {
  return normalise(posterior.map((p, h) => {
    const likelihood = correct ? pCorrect(h, itemLevel, options) : 1 - pCorrect(h, itemLevel, options);
    return p * Math.pow(likelihood, weight);
  }));
}

export function entropy(posterior: readonly number[]): number {
  return -posterior.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
}

/** Expected reduction of posterior entropy from one answer to an item of this level. */
export function informationGain(posterior: readonly number[], itemLevel: number, options = 4): number {
  const correct = posterior.reduce((sum, p, h) => sum + p * pCorrect(h, itemLevel, options), 0);
  return entropy(posterior) - (correct * entropy(updatePosterior(posterior, itemLevel, true, 1, options))
    + (1 - correct) * entropy(updatePosterior(posterior, itemLevel, false, 1, options)));
}

/** Next level = argmax information gain − 0.001 × items already used at that level. Ties prefer the lower level. */
export function chooseLevel(posterior: readonly number[], availableLevels: Iterable<number>, usedByLevel: ReadonlyMap<number, number> = new Map()): number | null {
  let best: number | null = null; let bestValue = -Infinity;
  for (const level of [...new Set(availableLevels)].sort((a, b) => a - b)) {
    const value = informationGain(posterior, level) - 0.001 * (usedByLevel.get(level) ?? 0);
    if (value > bestValue + 1e-12) { best = level; bestValue = value; }
  }
  return best;
}

/** One answered objective question, as the engine sees it. */
export interface ObjectiveEvidence {
  skill: ObjectiveSkill; level: number; correct: boolean; options: number;
  /** 2 for the second question on the same clip/passage (weight 0.7). */
  position: 1 | 2;
  /** Plays used for this question (listening). A correct answer after a second play has weight 0.5. */
  plays?: number;
}

export function evidenceWeight(evidence: Pick<ObjectiveEvidence, 'position' | 'correct' | 'plays'>): number {
  return (evidence.position === 2 ? SECOND_QUESTION_WEIGHT : 1)
    * (evidence.correct && (evidence.plays ?? 1) >= 2 ? SECOND_PLAY_CORRECT_WEIGHT : 1);
}

export function posteriorFrom(evidence: readonly ObjectiveEvidence[]): Posterior {
  return evidence.reduce<Posterior>((posterior, item) =>
    updatePosterior(posterior, item.level, item.correct, evidenceWeight(item), item.options), [...PLACEMENT_PRIOR]);
}

export function argmax(values: readonly number[]): number {
  let best = 0;
  values.forEach((value, index) => { if (value > values[best]) best = index; });
  return best;
}

/** Guards before a confident stop: a C1+ estimate needs ≥ 3 C1 items, an A1/A2 estimate needs ≥ 3 A2 items. */
export function guardsSatisfied(posterior: readonly number[], answeredLevels: readonly number[]): boolean {
  const map = argmax(posterior);
  if (map >= 4 && answeredLevels.filter(level => level >= 4).length < 3) return false;
  if (map <= 1 && answeredLevels.filter(level => level === 1).length < 3) return false;
  return true;
}

export type StopReason = 'confident' | 'max-questions' | 'time-cap' | 'exhausted';
/** Decide at a stimulus boundary whether the section ends. */
export function stopReason(rule: SectionRule, posterior: readonly number[], answeredLevels: readonly number[], elapsedMs = 0): StopReason | null {
  const answered = answeredLevels.length;
  if (answered >= rule.maxQuestions) return 'max-questions';
  if (answered > 0 && elapsedMs >= rule.timeCapMs) return 'time-cap';
  if (answered >= rule.minQuestions && Math.max(...posterior) >= rule.stopAt && guardsSatisfied(posterior, answeredLevels)) return 'confident';
  return null;
}

export interface PosteriorSummary {
  score: number; level: CEFRLevel; label: string; map: CEFRLevel; maxProbability: number;
  range: { from: CEFRLevel; to: CEFRLevel }; confidence: Confidence;
}
/** Smallest contiguous band range holding ≥ 80% of the posterior (largest mass wins ties). */
export function credibleRange(posterior: readonly number[], mass = RANGE_MASS): { from: number; to: number } {
  for (let width = 1; width <= posterior.length; width++) {
    let best: { from: number; to: number; sum: number } | null = null;
    for (let from = 0; from + width <= posterior.length; from++) {
      const sum = posterior.slice(from, from + width).reduce((total, p) => total + p, 0);
      if (sum >= mass - 1e-9 && (!best || sum > best.sum + 1e-12)) best = { from, to: from + width - 1, sum };
    }
    if (best) return { from: best.from, to: best.to };
  }
  return { from: 0, to: posterior.length - 1 };
}

/** score = posterior mean on the 1–5 scale → cefrFromScore; confidence per audit §2.4. */
export function summarisePosterior(posterior: readonly number[], answered: number, minQuestions: number): PosteriorSummary {
  const score = posterior.reduce((sum, p, h) => sum + p * (h + 1), 0);
  const { level, label } = cefrFromScore(score);
  const range = credibleRange(posterior);
  const width = range.to - range.from + 1;
  const maxProbability = Math.max(...posterior);
  const confidence: Confidence = maxProbability >= 0.8 && width === 1 && answered >= minQuestions ? 'high'
    : maxProbability >= 0.6 || width === 2 ? 'medium' : 'low';
  return { score: Math.round(score * 1000) / 1000, level, label, map: LEVEL_HYPOTHESES[argmax(posterior)], maxProbability,
    range: { from: LEVEL_HYPOTHESES[range.from], to: LEVEL_HYPOTHESES[range.to] }, confidence };
}

/** Deterministic PRNG for seeded selection and simulations. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash for stable, non-cryptographic choices (voices, seeds). */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Listening: two plays at A2–B1, one at B2+. */
export function maxPlaysFor(level: CEFRLevel): number { return levelIndex(level) <= 2 ? 2 : 1; }

export interface Exposure { count: number; lastShownAt: number }

/** Items sharing a groupId form one stimulus (clip or passage); others are their own stimulus. */
export function stimulusKey(item: Pick<PlacementItem, 'id' | 'groupId'>): string { return item.groupId ? 'g:' + item.groupId : 'i:' + item.id; }

export interface StimulusChoiceContext {
  section: ObjectiveSection;
  /** Routing posterior: the section's own (pooled for language). */
  posterior: readonly number[];
  /** True for the first stimulus of the section: start at B1 regardless of the posterior. */
  first: boolean;
  usedByLevel: ReadonlyMap<number, number>;
  /** Items already shown in this attempt (answered, current or voided). */
  usedItemIds: ReadonlySet<string>;
  exposure: ReadonlyMap<string, Exposure>;
  now: number;
  /** Language alternates grammar and vocabulary. */
  preferredSkill?: 'grammar' | 'vocabulary';
  /** Work/life alternation within the section. */
  lastContext?: 'work' | 'life' | null;
  tagUsage: ReadonlyMap<string, number>;
  /** Questions still allowed in the section (max − answered). */
  remainingQuestions: number;
  /** Restrict to this level when possible (parallel replacement of an interrupted clip). */
  requiredLevel?: number;
  rng: () => number;
}

export interface StimulusChoice { level: number; items: PlacementItem[]; reusedExposure: boolean }

function recentlyExposed(ids: readonly string[], exposure: ReadonlyMap<string, Exposure>, now: number): boolean {
  return ids.some(id => { const seen = exposure.get(id); return !!seen && now - seen.lastShownAt < CONTAMINATION_DAYS * DAY_MS; });
}

/**
 * Choose the next stimulus. Level by information gain (B1 first); then an unexposed item at that level,
 * rotating tags, alternating work/life context and (language) grammar/vocabulary. Items seen in a past attempt within
 * 90 days are used only when no unseen stimulus remains in the section.
 */
export function chooseStimulus(bank: readonly PlacementItem[], context: StimulusChoiceContext): StimulusChoice | null {
  if (context.remainingQuestions <= 0) return null;
  const groups = new Map<string, PlacementItem[]>();
  for (const item of bank) {
    if (item.section !== context.section || levelIndex(item.level) > ADAPTIVE_MAX_LEVEL_INDEX) continue;
    const key = stimulusKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  let candidates = [...groups.values()].filter(items => items.every(item => !context.usedItemIds.has(item.id)));
  if (context.preferredSkill) {
    const preferred = candidates.filter(items => items[0].skill === context.preferredSkill);
    if (preferred.length) candidates = preferred;
  }
  if (!candidates.length) return null;
  const fresh = candidates.filter(items => !recentlyExposed(items.map(item => item.id), context.exposure, context.now));
  const reusedExposure = !fresh.length;
  if (fresh.length) candidates = fresh;
  const levelOf = (items: PlacementItem[]) => levelIndex(items[0].level);
  const levels = new Set(candidates.map(levelOf));
  let level: number | null = null;
  if (context.requiredLevel !== undefined && levels.has(context.requiredLevel)) level = context.requiredLevel;
  else if (context.first && levels.has(START_LEVEL_INDEX)) level = START_LEVEL_INDEX;
  else level = chooseLevel(context.posterior, levels, context.usedByLevel);
  if (level === null) return null;
  const atLevel = candidates.filter(items => levelOf(items) === level);
  const scored = atLevel.map(items => {
    const tags = [...new Set(items.flatMap(item => item.tags ?? []))];
    const tagLoad = tags.reduce((sum, tag) => sum + (context.tagUsage.get(tag) ?? 0), 0);
    const itemContext = items[0].context;
    const contextPenalty = context.lastContext && itemContext && itemContext === context.lastContext ? 1 : 0;
    const exposures = items.reduce((sum, item) => sum + (context.exposure.get(item.id)?.count ?? 0), 0);
    const lastSeen = Math.max(0, ...items.map(item => context.exposure.get(item.id)?.lastShownAt ?? 0));
    return { items, key: [exposures, tagLoad, contextPenalty, lastSeen], random: context.rng() };
  });
  scored.sort((left, right) => {
    for (let index = 0; index < left.key.length; index++) {
      if (left.key[index] !== right.key[index]) return left.key[index] - right.key[index];
    }
    return left.random - right.random;
  });
  const chosen = scored[0].items;
  const ordered = chosen.length > 1 ? [...chosen].sort((left, right) => bankOrder(bank, left) - bankOrder(bank, right)) : chosen;
  const perStimulus = SECTION_RULES[context.section].questionsPerStimulus;
  return { level, items: ordered.slice(0, Math.max(1, Math.min(perStimulus, context.remainingQuestions))), reusedExposure };
}

function bankOrder(bank: readonly PlacementItem[], item: PlacementItem): number { return bank.indexOf(item); }

// ---------------------------------------------------------------------------------------------------------------------
// Speaking ladder (audit §2.6) and roleplay rotation.

/** s0 = round-down(mean(listening MAP, language MAP)) − 1, clamped to [A2, B1]. MAPs are hypothesis indexes. */
export function speakingStartLevel(listeningMap: number | null, languageMap: number | null): 'A2' | 'B1' {
  const maps = [listeningMap, languageMap].filter((value): value is number => value !== null && Number.isFinite(value));
  if (!maps.length) return 'A2';
  const s0 = Math.floor(maps.reduce((sum, value) => sum + value, 0) / maps.length) - 1;
  return s0 >= 2 ? 'B1' : 'A2';
}

export type SpeakingRole = 'R0' | 'P1' | 'P2' | 'F2' | 'P3';
export interface SpeakingStep { role: SpeakingRole; prompt: PlacementSpeakingPrompt; level: CEFRLevel }

function levelAt(index: number): CEFRLevel { return (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const)[Math.max(0, Math.min(5, index))]; }

/** Prefer prompts unseen for 90 days, then fewest exposures, then the oldest exposure, then seeded random. */
function pickPrompt(prompts: readonly PlacementSpeakingPrompt[], exposure: ReadonlyMap<string, Exposure>, now: number, rng: () => number): PlacementSpeakingPrompt | null {
  if (!prompts.length) return null;
  const ranked = prompts.map(prompt => {
    const seen = exposure.get(prompt.id);
    const recent = seen && now - seen.lastShownAt < CONTAMINATION_DAYS * DAY_MS ? 1 : 0;
    return { prompt, key: [recent, seen?.count ?? 0, seen?.lastShownAt ?? 0], random: rng() };
  });
  ranked.sort((left, right) => {
    for (let index = 0; index < left.key.length; index++) if (left.key[index] !== right.key[index]) return left.key[index] - right.key[index];
    return left.random - right.random;
  });
  return ranked[0].prompt;
}

/**
 * Speaking tasks: optional read-aloud warm-up R0, P1 at s0, P2 at s0+1, F2 = P2's unprepared follow-up (when the bank
 * gives one), P3 at s0+2 (ceiling probe). A missing level falls back to the nearest unused level.
 */
export function planSpeaking(prompts: readonly PlacementSpeakingPrompt[], startLevel: 'A2' | 'B1', options: {
  exposure: ReadonlyMap<string, Exposure>; now: number; rng: () => number; exclude?: ReadonlySet<string>;
}): SpeakingStep[] {
  const exclude = options.exclude ?? new Set<string>();
  const tasks = prompts.filter(prompt => (prompt.kind ?? 'task') === 'task' && !exclude.has(prompt.id));
  const steps: SpeakingStep[] = [];
  const readAloud = pickPrompt(prompts.filter(prompt => prompt.kind === 'read-aloud' && !exclude.has(prompt.id)), options.exposure, options.now, options.rng);
  if (readAloud) steps.push({ role: 'R0', prompt: readAloud, level: readAloud.level });
  const used = new Set<string>();
  const s0 = levelIndex(startLevel);
  (['P1', 'P2', 'P3'] as const).forEach((role, offset) => {
    const target = s0 + offset;
    const available = tasks.filter(prompt => !used.has(prompt.id));
    if (!available.length) return;
    const distance = (prompt: PlacementSpeakingPrompt) => Math.abs(levelIndex(prompt.level) - target);
    const nearest = Math.min(...available.map(distance));
    // Ties between a lower and a higher fallback prefer the lower level.
    const nearestLevels = [...new Set(available.filter(prompt => distance(prompt) === nearest).map(prompt => levelIndex(prompt.level)))].sort((a, b) => a - b);
    const prompt = pickPrompt(available.filter(item => levelIndex(item.level) === nearestLevels[0]), options.exposure, options.now, options.rng);
    if (!prompt) return;
    used.add(prompt.id);
    steps.push({ role, prompt, level: levelAt(levelIndex(prompt.level)) });
    if (role === 'P2' && prompt.followUp?.prompt.trim()) steps.push({ role: 'F2', prompt, level: prompt.level });
  });
  return steps;
}

/** A parallel prompt (same level, not yet used in this attempt) for an interrupted speaking task. */
export function parallelPrompt(prompts: readonly PlacementSpeakingPrompt[], current: PlacementSpeakingPrompt, options: {
  usedIds: ReadonlySet<string>; exposure: ReadonlyMap<string, Exposure>; now: number; rng: () => number; needsFollowUp: boolean;
}): PlacementSpeakingPrompt | null {
  return pickPrompt(prompts.filter(prompt => (prompt.kind ?? 'task') === (current.kind ?? 'task') && prompt.level === current.level
    && prompt.id !== current.id && !options.usedIds.has(prompt.id) && (!options.needsFollowUp || !!prompt.followUp?.prompt.trim())),
  options.exposure, options.now, options.rng);
}

/** Rotate scripts across attempts: fewest exposures, then the oldest exposure, then bank order. */
export function chooseRoleplayScript(scripts: readonly PlacementRoleplayScript[], exposure: ReadonlyMap<string, Exposure>): PlacementRoleplayScript | null {
  const usable = scripts.filter(script => script.lines.length > 0);
  if (!usable.length) return null;
  return [...usable].sort((left, right) => {
    const a = exposure.get(left.id); const b = exposure.get(right.id);
    return (a?.count ?? 0) - (b?.count ?? 0) || (a?.lastShownAt ?? 0) - (b?.lastShownAt ?? 0) || usable.indexOf(left) - usable.indexOf(right);
  })[0];
}
