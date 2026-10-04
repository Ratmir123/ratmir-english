import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '../../types';
import type { CallSummary, CommunicationPattern, FactKind, PatternOutcome, PersonalDrill, ProfileFact } from '../../calls/types';
import type { StrategyMoveScore } from '../../strategy-moves';
import { connection } from '../db';
import { type CallRecord, type StoredDrill, linkSession, listCallRecords, readDrill, readDrills, readFacts, readPatternDefinitions,
  readPatternEvents, removeAllCallFiles } from './repository';
import { type PatternEvent, deriveLifecycle, practiceByPattern, presentDrill, sortDrills, sortPatterns } from './lifecycle';

/**
 * Cheap readers used inside getAppState() (no network, no model calls) plus the hooks the rest of the app uses:
 * drills for POST /api/sessions { drillId }, the learner's PLAYBOOK and ACTIVE_PATTERNS for the coach prompts.
 */

function sessionsById(db: DatabaseSync, ids: string[]): Map<string, Session> {
  const unique = [...new Set(ids)];
  const map = new Map<string, Session>();
  for (let index = 0; index < unique.length; index += 200) {
    const slice = unique.slice(index, index + 200);
    const rows = db.prepare(`SELECT data FROM sessions WHERE id IN (${slice.map(() => '?').join(',')})`).all(...slice) as { data: string }[];
    for (const row of rows) { const session = JSON.parse(row.data) as Session; map.set(session.id, session); }
  }
  return map;
}

function completedSessions(db: DatabaseSync): Session[] {
  return (db.prepare(`SELECT data FROM sessions WHERE status='completed'`).all() as { data: string }[]).map(row => JSON.parse(row.data) as Session);
}

function linkedIds(drills: StoredDrill[]): string[] { return drills.flatMap(drill => drill.linkedSessions); }

export function summarise(record: CallRecord, drills: PersonalDrill[]): CallSummary {
  return {
    id: record.id, title: record.title, counterpart: record.counterpart, context: record.context, occurredAt: record.occurredAt,
    createdAt: record.createdAt, updatedAt: record.updatedAt, source: record.source, status: record.status, progress: record.progress,
    durationSeconds: record.durationSeconds, outcome: record.review?.outcome ?? null, topCost: record.review?.costs[0]?.title ?? null,
    drillsTotal: drills.length, drillsDone: drills.filter(drill => drill.status === 'done').length,
    uploadedBytes: record.upload ? record.upload.received : null, error: record.error,
  };
}

export function presentDrills(db: DatabaseSync, stored: StoredDrill[], sessions?: Session[]): PersonalDrill[] {
  const map = sessions ? new Map(sessions.map(session => [session.id, session])) : sessionsById(db, linkedIds(stored));
  return stored.map(drill => presentDrill(drill, map));
}

export function listCallSummaries(db: DatabaseSync): CallSummary[] {
  const drills = presentDrills(db, readDrills(db));
  const byCall = new Map<string, PersonalDrill[]>();
  for (const drill of drills) {
    if (drill.source.type !== 'call') continue;
    byCall.set(drill.source.callId, [...(byCall.get(drill.source.callId) ?? []), drill]);
  }
  return listCallRecords(db).map(record => summarise(record, byCall.get(record.id) ?? []));
}

/** Every stored pattern that still has call events, with its code-derived lifecycle. */
function lifecycles(db: DatabaseSync, sessions?: Session[]) {
  const definitions = readPatternDefinitions(db);
  if (!definitions.length) return [];
  const events = new Map<string, PatternEvent[]>();
  for (const row of readPatternEvents(db)) {
    const event: PatternEvent = { source: 'call', sourceId: row.callId, date: row.date, status: row.status, quote: row.quote, at: row.at,
      memory: row.memory, independent: false, callMode: false };
    events.set(row.patternId, [...(events.get(row.patternId) ?? []), event]);
  }
  const practice = practiceByPattern((sessions ?? completedSessions(db)).filter(session => session.status === 'completed'), readDrills(db));
  return definitions.filter(definition => events.has(definition.id))
    .map(definition => deriveLifecycle(definition, events.get(definition.id) ?? [], practice.get(definition.id)));
}

/** Patterns with code-derived status from real-call events and practice evidence. */
export function listPatterns(db: DatabaseSync, sessions?: Session[]): CommunicationPattern[] {
  return sortPatterns(lifecycles(db, sessions).map(item => item.pattern));
}

export interface CallProgressionInputs {
  calls: { callId: string; reviewedAt: string; moves?: StrategyMoveScore[]; patterns?: { patternId: string; status: PatternOutcome }[] }[];
  patternImprovements: { patternId: string; at: string }[];
}

/**
 * Inputs for progression extras (cheap, no network): every call with a review (first review time, strategy moves and
 * per-call pattern outcomes; recollections carry no pattern outcomes) and when each pattern first reached improving/resolved.
 */
export function callProgressionInputs(db: DatabaseSync, sessions?: Session[]): CallProgressionInputs {
  const calls = listCallRecords(db).filter(record => record.review).map(record => ({
    callId: record.id, reviewedAt: record.firstReviewedAt ?? record.review!.createdAt, moves: record.review!.strategyMoves,
    ...(record.source === 'memory' ? {} : { patterns: record.review!.patterns.map(({ patternId, status }) => ({ patternId, status })) }),
  })).sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt) || left.callId.localeCompare(right.callId));
  const patternImprovements = lifecycles(db, sessions)
    .filter(item => item.improvedAt !== null && !item.pattern.dismissed && item.pattern.kind === 'weakness')
    .map(item => ({ patternId: item.pattern.id, at: item.improvedAt! }))
    .sort((left, right) => left.at.localeCompare(right.at));
  return { calls, patternImprovements };
}

/** Drill status is derived from the linked practice session (new / started / done); due drills first. */
export function listDrills(db: DatabaseSync, sessions: Session[]): PersonalDrill[] {
  return sortDrills(presentDrills(db, readDrills(db), sessions));
}

/** Suggested and accepted facts, newest first (rejected ones stay hidden but keep blocking duplicates). */
export function listProfileFacts(db: DatabaseSync): ProfileFact[] {
  return readFacts(db, { statuses: ['suggested', 'accepted'] });
}

/** Called inside deleteAllTraining()'s transaction: remove calls, their files, patterns, drills and unaccepted facts. */
export function clearCalls(db: DatabaseSync): void {
  db.exec(`DELETE FROM pattern_events; DELETE FROM communication_patterns; DELETE FROM personal_drills; DELETE FROM call_jobs;
    DELETE FROM profile_facts WHERE status <> 'accepted'; DELETE FROM calls;`);
  removeAllCallFiles();
}

/** Look up one drill for POST /api/sessions { drillId }. */
export function getDrill(id: string): PersonalDrill | null {
  const { db } = connection();
  const stored = readDrill(db, id);
  return stored ? presentDrills(db, [stored])[0] : null;
}

/** Remember which practice session was started from a drill (status is derived from that session later). */
export function linkDrillSession(drillId: string, sessionId: string): void {
  linkSession(connection().db, drillId, sessionId);
}

const FACT_ORDER: FactKind[] = ['rate', 'floor', 'confidential', 'case', 'metric', 'positioning', 'relocation', 'preference', 'counterpart', 'other'];
const FACT_LABELS: Record<FactKind, string> = {
  rate: 'Ставка', floor: 'Пол цены', confidential: 'Конфиденциально', case: 'Кейс', metric: 'Цифра', positioning: 'Правило самоподачи',
  relocation: 'Переезд', preference: 'Предпочтение', counterpart: 'Клиент', other: 'Факт',
};

/** The learner-confirmed PLAYBOOK (accepted facts) grouped by kind, bounded for prompts. */
export function playbookForPrompt(db: DatabaseSync): { kind: FactKind; text: string }[] {
  const accepted = readFacts(db, { statuses: ['accepted'] }).reverse();
  return accepted.sort((left, right) => FACT_ORDER.indexOf(left.kind) - FACT_ORDER.indexOf(right.kind))
    .slice(0, 40).map(fact => ({ kind: fact.kind, text: fact.text.slice(0, 240) }));
}

/** Accepted facts as short labelled lines, e.g. «Ставка: агентства €600/день». */
export function acceptedFactsForPrompt(db: DatabaseSync): string[] {
  return playbookForPrompt(db).map(fact => `${FACT_LABELS[fact.kind]}: ${fact.text}`);
}

export interface ActivePatternForPrompt {
  id: string; title: string; kind: CommunicationPattern['kind']; category: CommunicationPattern['category'];
  status: CommunicationPattern['status']; costRank: CommunicationPattern['costRank']; contexts: CommunicationPattern['contexts'];
  drillHint: string; lastQuote: string | null; lastSeenAt: string;
}

/** Non-dismissed patterns still in play (watch / active / improving), most expensive first, for coach prompts. */
export function activePatternsForPrompt(db: DatabaseSync, limit = 8, sessions?: Session[]): ActivePatternForPrompt[] {
  return listPatterns(db, sessions)
    .filter(pattern => !pattern.dismissed && pattern.status !== 'resolved')
    .sort((left, right) => Number(left.kind === 'strength') - Number(right.kind === 'strength') || left.costRank - right.costRank
      || right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, limit)
    .map(pattern => ({ id: pattern.id, title: pattern.title, kind: pattern.kind, category: pattern.category, status: pattern.status,
      costRank: pattern.costRank, contexts: pattern.contexts, drillHint: pattern.drillHint,
      lastQuote: pattern.evidence.find(item => item.source === 'call')?.quote ?? null, lastSeenAt: pattern.lastSeenAt }));
}
