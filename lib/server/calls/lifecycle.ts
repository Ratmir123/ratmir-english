import type { CommunicationPattern, PatternOutcome, PersonalDrill } from '../../calls/types';
import type { Session } from '../../types';
import type { StoredDrill, StoredPattern } from './repository';

/**
 * Pure derivations (no I/O): pattern lifecycle, practice evidence and the drill schedule.
 *
 * Pattern lifecycle (binding, CONTRACT §2):
 * - a pattern starts at 'watch'; it becomes 'active' when the learner confirms it or it occurs in a second source;
 * - active → improving when avoided in 2 of the last 3 real opportunities, or after 2 independent practice successes
 *   including 1 in call mode (counted since the last real repeat);
 * - improving → resolved after 3 consecutive real avoidances; any real repeat → active; 'no-opportunity' changes nothing;
 * - practice alone never resolves; recollections ("memory" calls) count as reported repeats but not as real opportunities.
 * Strengths go watch → active only.
 */
export interface PatternEvent {
  source: 'call' | 'practice' | 'placement';
  sourceId: string;
  date: string;
  status: PatternOutcome;
  quote: string | null;
  at: number | null;
  memory: boolean;
  independent: boolean;
  callMode: boolean;
}
export interface PracticeSummary { events: PatternEvent[]; attempts: Set<string>; lastAt: string | null }

const DAY_MS = 86_400_000;
export const DRILL_INTERVAL_DAYS = [2, 5, 12] as const;
const STATUS_ORDER: Record<CommunicationPattern['status'], number> = { active: 0, watch: 1, improving: 2, resolved: 3 };

function sourceOrder(source: PatternEvent['source']): number { return source === 'call' ? 0 : source === 'placement' ? 1 : 2; }

export function derivePattern(stored: StoredPattern, events: PatternEvent[], practice?: PracticeSummary): CommunicationPattern {
  return deriveLifecycle(stored, events, practice).pattern;
}

/** The derived pattern plus when it first reached 'improving' or 'resolved' (null if never). */
export function deriveLifecycle(stored: StoredPattern, events: PatternEvent[], practice?: PracticeSummary): { pattern: CommunicationPattern; improvedAt: string | null } {
  const ordered = [...events, ...(practice?.events ?? [])].sort((left, right) =>
    left.date.localeCompare(right.date) || sourceOrder(left.source) - sourceOrder(right.source) || left.sourceId.localeCompare(right.sourceId));
  // The first real occurrence reads 'new'; any later one reads 'repeated', whatever order the calls were imported in.
  let occurred = false;
  const history = ordered.map(event => {
    let status = event.status;
    if (event.source !== 'practice') {
      if (status === 'new' && occurred) status = 'repeated';
      else if (status === 'repeated' && !occurred) status = 'new';
      if (status === 'new' || status === 'repeated') occurred = true;
    } else if (status === 'new') status = 'repeated';
    return { ...event, status };
  });

  const strength = stored.kind === 'strength';
  let status: CommunicationPattern['status'] = 'watch';
  const sources = new Set<string>();
  const window: ('repeated' | 'avoided' | 'improved')[] = [];
  let independent = 0;
  let callMode = 0;
  let improvedAt: string | null = null;
  for (const event of history) {
    if (event.status === 'no-opportunity') continue;
    const occurrence = event.status === 'new' || event.status === 'repeated';
    if (event.source === 'practice') {
      if (occurrence) { sources.add(`practice:${event.sourceId}`); if (status === 'watch' && sources.size >= 2) status = 'active'; }
      if (event.status === 'avoided' && event.independent) { independent++; if (event.callMode) callMode++; }
      if (!strength && status === 'active' && independent >= 2 && callMode >= 1) { status = 'improving'; improvedAt ??= event.date; }
      continue;
    }
    if (occurrence) {
      sources.add(`call:${event.sourceId}`);
      if (status === 'watch' && (sources.size >= 2 || stored.userConfirmed)) status = 'active';
      else if (!strength && (status === 'improving' || status === 'resolved')) status = 'active';
      independent = 0; callMode = 0;
    }
    if (event.source === 'call' && !event.memory) {
      window.push(event.status === 'avoided' ? 'avoided' : event.status === 'improved' ? 'improved' : 'repeated');
      if (window.length > 3) window.shift();
      // Only a fresh avoidance moves the pattern forward; a repeat has just sent it back to active.
      if (!strength && event.status === 'avoided') {
        const avoided = window.filter(item => item === 'avoided').length;
        if (status === 'active' && avoided >= 2) { status = 'improving'; improvedAt ??= event.date; }
        else if (status === 'improving' && window.length === 3 && avoided === 3) { status = 'resolved'; improvedAt ??= event.date; }
      }
    }
  }
  if (status === 'watch' && stored.userConfirmed) status = 'active';

  const calls = history.filter(event => event.source !== 'practice');
  const real = calls.filter(event => event.source === 'call' && !event.memory && event.status !== 'no-opportunity');
  const seen = calls.filter(event => event.status === 'new' || event.status === 'repeated' || event.status === 'improved');
  const firstSeenAt = seen[0]?.date ?? calls[0]?.date ?? ordered[0]?.date ?? stored.createdAt;
  const lastSeenAt = seen.at(-1)?.date ?? firstSeenAt;
  const practiceHistory = history.filter(event => event.source === 'practice').slice(-20);
  const visible = [...calls, ...practiceHistory].sort((left, right) => left.date.localeCompare(right.date));
  const evidence = history.filter(event => event.quote && event.status !== 'no-opportunity').reverse().slice(0, 5)
    .map(event => ({ source: event.source, sourceId: event.sourceId, quote: event.quote!, at: event.at, date: event.date, status: event.status }));
  return { improvedAt, pattern: {
    id: stored.id, title: stored.title, kind: stored.kind, category: stored.category, description: stored.description,
    status, costRank: stored.costRank, contexts: stored.contexts,
    occurrences: calls.filter(event => event.status === 'new' || event.status === 'repeated').length,
    firstSeenAt, lastSeenAt,
    real: { opportunities: real.length, avoided: real.filter(event => event.status === 'avoided').length,
      repeated: real.filter(event => event.status === 'new' || event.status === 'repeated').length },
    practice: { attempts: practice?.attempts.size ?? 0,
      independentSuccesses: history.filter(event => event.source === 'practice' && event.status === 'avoided' && event.independent).length,
      lastAt: practice?.lastAt ?? null },
    history: visible.map(event => ({ source: event.source, sourceId: event.sourceId, date: event.date, status: event.status })),
    evidence, drillHint: stored.drillHint, userConfirmed: stored.userConfirmed, dismissed: stored.dismissed, userNote: stored.userNote,
  } };
}

export function sortPatterns(patterns: CommunicationPattern[]): CommunicationPattern[] {
  return [...patterns].sort((left, right) => Number(left.dismissed) - Number(right.dismissed)
    || Number(left.kind === 'strength') - Number(right.kind === 'strength')
    || STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    || left.costRank - right.costRank
    || right.occurrences - left.occurrences
    || right.lastSeenAt.localeCompare(left.lastSeenAt)
    || left.id.localeCompare(right.id));
}

// ---------- practice evidence ----------

const OUTCOMES: PatternOutcome[] = ['repeated', 'avoided', 'no-opportunity', 'improved', 'new'];

/** Optional `analysis.patternHits` written by the lesson evaluator (S4); read defensively. */
export function sessionPatternHits(session: Session): { patternId: string; outcome: PatternOutcome; turnId: string | null; quote: string | null }[] {
  const raw = (session.analysis as unknown as { patternHits?: unknown } | null)?.patternHits;
  if (!Array.isArray(raw)) return [];
  const hits: { patternId: string; outcome: PatternOutcome; turnId: string | null; quote: string | null }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (typeof value.patternId !== 'string' || !OUTCOMES.includes(value.outcome as PatternOutcome)) continue;
    hits.push({ patternId: value.patternId, outcome: value.outcome as PatternOutcome,
      turnId: typeof value.turnId === 'string' ? value.turnId : null, quote: typeof value.quote === 'string' ? value.quote : null });
  }
  return hits;
}

export function completedAt(session: Session): string { return session.completedAt ?? session.updatedAt; }

/** Unsupported first attempt that achieved the task (no hints/visible text, no edited transcript, no material difficulty). */
export function independentSuccess(session: Session): boolean {
  if (session.status !== 'completed' || !session.analysis) return false;
  const userTurns = session.turns.filter(turn => turn.role === 'user');
  if (!userTurns.length || userTurns.some(turn => turn.support > 0 || turn.transcriptEdited || turn.disputed)) return false;
  const evidence = session.analysis.evidence ?? [];
  return evidence.some(item => item.result === 'success' && !item.supported)
    && !evidence.some(item => item.result === 'difficulty' && item.opportunity);
}

function turnUnsupported(session: Session, turnId: string | null): boolean {
  const turns = session.turns.filter(turn => turn.role === 'user' && (!turnId || turn.id === turnId));
  return turns.length > 0 && turns.every(turn => turn.support === 0 && !turn.transcriptEdited && !turn.disputed);
}

/** Practice evidence per pattern from completed sessions: evaluator pattern hits first, linked drill outcomes otherwise. */
export function practiceByPattern(sessions: Session[], drills: StoredDrill[]): Map<string, PracticeSummary> {
  const byPattern = new Map<string, PracticeSummary>();
  const entry = (id: string) => {
    let value = byPattern.get(id);
    if (!value) { value = { events: [], attempts: new Set(), lastAt: null }; byPattern.set(id, value); }
    return value;
  };
  const drillsBySession = new Map<string, StoredDrill[]>();
  for (const drill of drills) for (const sessionId of drill.linkedSessions) drillsBySession.set(sessionId, [...(drillsBySession.get(sessionId) ?? []), drill]);
  for (const session of sessions) {
    if (session.status !== 'completed' || !session.analysis) continue;
    const date = completedAt(session);
    const hits = sessionPatternHits(session).filter(hit => hit.outcome !== 'no-opportunity');
    const touched = new Set<string>();
    for (const hit of hits) {
      const value = entry(hit.patternId);
      value.events.push({ source: 'practice', sourceId: session.id, date, status: hit.outcome, quote: hit.quote, at: null, memory: false,
        independent: hit.outcome === 'avoided' && turnUnsupported(session, hit.turnId), callMode: session.mode === 'call' });
      touched.add(hit.patternId);
    }
    for (const drill of drillsBySession.get(session.id) ?? []) {
      for (const patternId of drill.patternIds) {
        const value = entry(patternId);
        value.attempts.add(session.id);
        if (!value.lastAt || date > value.lastAt) value.lastAt = date;
        if (touched.has(patternId)) continue;
        // Without evaluator hits a drill counts only as success evidence; a non-success is just an attempt.
        if (independentSuccess(session)) {
          value.events.push({ source: 'practice', sourceId: session.id, date, status: 'avoided', quote: null, at: null, memory: false,
            independent: true, callMode: session.mode === 'call' });
        } else if (session.retries.some(retry => retry.improved)) {
          value.events.push({ source: 'practice', sourceId: session.id, date, status: 'improved', quote: null, at: null, memory: false,
            independent: false, callMode: session.mode === 'call' });
        }
      }
    }
    for (const patternId of touched) {
      const value = entry(patternId);
      value.attempts.add(session.id);
      if (!value.lastAt || date > value.lastAt) value.lastAt = date;
    }
  }
  return byPattern;
}

// ---------- drills ----------

function addDays(iso: string, days: number): string { return new Date(Date.parse(iso) + days * DAY_MS).toISOString(); }

/** Status from the latest linked session; schedule today, +2, +5, +12 days after each attempt until 2 independent successes. */
export function presentDrill(stored: StoredDrill, sessions: Map<string, Session>): PersonalDrill {
  const { linkedSessions, ...drill } = stored;
  const linked = linkedSessions.map(id => sessions.get(id)).filter((session): session is Session => !!session);
  const latest = linked.at(-1) ?? null;
  const completed = linked.filter(session => session.status === 'completed').sort((left, right) => completedAt(left).localeCompare(completedAt(right)));
  const attempts = completed.length;
  const successes = completed.filter(independentSuccess).length;
  const last = completed.at(-1);
  const dueAt = successes >= 2 ? null : !last ? stored.createdAt
    : addDays(completedAt(last), DRILL_INTERVAL_DAYS[Math.min(attempts, DRILL_INTERVAL_DAYS.length) - 1]);
  const status: PersonalDrill['status'] = !latest ? 'new' : latest.status === 'completed' ? 'done' : 'started';
  return { ...drill, status, sessionId: latest?.id ?? null, completedAt: status === 'done' && latest ? completedAt(latest) : null, attempts, dueAt };
}

/** Due drills first (oldest due first), then the rest newest first. */
export function sortDrills(drills: PersonalDrill[], now = Date.now()): PersonalDrill[] {
  const due = (drill: PersonalDrill) => drill.dueAt !== null && Date.parse(drill.dueAt) <= now;
  return [...drills].sort((left, right) => Number(due(right)) - Number(due(left))
    || (due(left) && due(right) ? left.dueAt!.localeCompare(right.dueAt!) : right.createdAt.localeCompare(left.createdAt))
    || left.id.localeCompare(right.id));
}
