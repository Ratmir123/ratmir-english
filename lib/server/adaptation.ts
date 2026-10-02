import { createHash } from 'node:crypto';
import { SKILLS, type Evidence, type ReviewItem, type Session, type SkillId, type SkillState, type Turn } from '../types';
import { lessonActivity, lessonMaterialSignature, practiceResults } from '../progression';

const DAY = 86_400_000;
const knownSkills = new Set<string>(SKILLS.map((skill) => skill.id));

interface Observation {
  session: Session;
  evidence: Evidence;
  turn: Turn;
  time: number;
  supported: boolean;
  variant: string;
  procedure: string;
}

/** IDs and cosmetic labels are deliberately excluded: regenerating an ID is not a new task. */
export function lessonFingerprint(session: Session): string {
  return createHash('sha256').update(lessonMaterialSignature(session)).digest('hex');
}

function uniqueSessions(sessions: Session[]): Session[] {
  const result = new Map<string, Session>();
  for (const session of sessions) {
    const previous = result.get(session.id);
    if (!previous || Date.parse(session.updatedAt) >= Date.parse(previous.updatedAt)) result.set(session.id, session);
  }
  return [...result.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

function normalized(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function observations(sessions: Session[]): Observation[] {
  const results: Observation[] = [];
  for (const session of uniqueSessions(sessions)) {
    if (!session.analysis || !['review', 'completed'].includes(session.status)) continue;
    const variant = lessonFingerprint(session);
    const procedure = `${session.analysis.model}:${session.analysis.version}`;
    const seen = new Set<string>();
    for (const evidence of session.analysis.evidence) {
      if (!knownSkills.has(evidence.skill) || !evidence.opportunity || ['disputed', 'unobserved'].includes(evidence.result)) continue;
      // The present brain receives transcripts, not an independently validated acoustic assessment.
      if (evidence.skill === 'clarity') continue;
      const activity = lessonActivity(session).activity;
      if (activity === 'writing' && !['grammar', 'vocabulary', 'coherence'].includes(evidence.skill)) continue;
      if (activity === 'reading' && evidence.skill === 'listening') continue;
      const turnIndex = session.turns.findIndex((turn) => turn.id === evidence.turnId);
      const turn = session.turns[turnIndex];
      if (!turn || turn.role !== 'user' || turn.disputed || !normalized(evidence.quote)
        || !normalized(turn.text).includes(normalized(evidence.quote))) continue;
      if (evidence.skill === 'listening') {
        const previousAssistant = session.turns.slice(0, turnIndex).reverse().find((item) => item.role === 'assistant');
        if (!previousAssistant || previousAssistant.source !== 'audio' || previousAssistant.support > 0 || previousAssistant.disputed || turn.transcriptEdited) continue;
      }
      const time = Date.parse(turn.createdAt || session.createdAt);
      if (!Number.isFinite(time)) continue;
      const key = `${evidence.skill}:${evidence.turnId}:${evidence.result}:${evidence.supported}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ session, evidence, turn, time, variant, procedure, supported: evidence.supported || turn.support > 0 || !!turn.transcriptEdited });
    }
  }
  // Two opposite conclusions about the same fragment are an assessment dispute, not new evidence.
  const contradictory = new Set<string>();
  const fragmentResults = new Map<string, Set<string>>();
  for (const item of results) {
    const key = `${item.session.id}:${item.turn.id}:${item.evidence.skill}`;
    const values = fragmentResults.get(key) ?? new Set<string>();
    values.add(item.evidence.result);
    fragmentResults.set(key, values);
    if (values.has('success') && (values.has('partial') || values.has('difficulty'))) contradictory.add(key);
  }
  return results.filter((item) => !contradictory.has(`${item.session.id}:${item.turn.id}:${item.evidence.skill}`))
    .sort((a, b) => a.time - b.time || a.session.id.localeCompare(b.session.id));
}

function uniqueIndependentSuccesses(items: Observation[]): Observation[] {
  const variants = new Set<string>();
  const sessions = new Set<string>();
  return items.filter((item) => {
    if (item.evidence.result !== 'success' || item.supported || variants.has(item.variant) || sessions.has(item.session.id)) return false;
    variants.add(item.variant);
    sessions.add(item.session.id);
    return true;
  });
}

export function deriveSkillStates(sessions: Session[]): SkillState[] {
  const all = observations(sessions);
  return SKILLS.map(({ id }) => {
    const items = all.filter((item) => item.evidence.skill === id);
    const latest = items.at(-1);
    const current = items.filter((item) => item.procedure === latest?.procedure);
    const independent = uniqueIndependentSuccesses(current);
    const successful = current.filter((item) => item.evidence.result === 'success' && !item.supported);
    const supportedSuccess = current.some((item) => item.evidence.result === 'success' && item.supported);
    const unresolved = current.some((item) => {
      if (item.supported || !['partial', 'difficulty'].includes(item.evidence.result)) return false;
      if (!current.some((prior) => prior.time < item.time && prior.evidence.result === 'success')) return false;
      return !successful.some((later) => later.time > item.time && later.session.lesson.context === item.session.lesson.context
        && later.session.lesson.difficulty === item.session.lesson.difficulty);
    });
    const procedureChanged = !!latest && items.some((item) => item.procedure !== latest.procedure && item.evidence.result === 'success');
    const recheck = unresolved || (procedureChanged && independent.length < 2);
    let state: SkillState['state'] = independent.length >= 2 ? 'independent'
      : independent.length === 1 ? 'provisional' : supportedSuccess ? 'supported' : 'unknown';
    if (recheck) state = 'recheck';
    const transfer = !recheck && successful.some((work) => work.session.lesson.context === 'work'
      && successful.some((life) => life.session.lesson.context === 'life' && life.session.id !== work.session.id && life.variant !== work.variant));
    const retention = !recheck && successful.some((item) => {
      if (item.session.lesson.kind !== 'retention') return false;
      const before = current.filter((previous) => previous.time < item.time && previous.session.id !== item.session.id);
      const lastExposure = before.at(-1);
      const retryTimes = before.flatMap((previous) => previous.session.retries
        .filter((retry) => retry.text.trim())
        .map((retry) => Date.parse(retry.createdAt))
        .filter((time) => Number.isFinite(time) && time < item.time));
      const lastExposureTime = Math.max(lastExposure?.time ?? Number.NEGATIVE_INFINITY, ...retryTimes);
      return !!lastExposure && item.time - lastExposureTime >= 7 * DAY
        && before.some((previous) => previous.evidence.result === 'success' && !previous.supported);
    });
    return {
      id, state, independentSuccesses: independent.length, transfer, retention,
      lastChecked: latest ? new Date(latest.time).toISOString() : null,
      examples: items.filter((item) => item.evidence.result === 'success').slice(-3).map((item) => ({
        sessionId: item.session.id, quote: item.evidence.quote, reason: item.evidence.reason,
      })),
    };
  });
}

/** Practice points, not a language score; replaying the same scene cannot farm points. */
export function calculateXP(sessions: Session[]): number {
  return practiceResults(sessions).reduce((sum, result) => sum + result.xp, 0);
}

export function deriveReviews(sessions: Session[]): ReviewItem[] {
  const all = observations(sessions);
  const states = new Map(deriveSkillStates(sessions).map((state) => [state.id, state]));
  return SKILLS.flatMap(({ id }): ReviewItem[] => {
    const latest = all.filter((item) => item.evidence.skill === id).at(-1);
    if (!latest) return [];
    const state = states.get(id)!;
    const intervalDays = latest.supported || latest.evidence.result !== 'success' || state.state === 'recheck' ? 1
      : state.retention ? 14 : state.state === 'independent' ? 7 : 3;
    return [{
      id: `review:${id}`, skill: id as SkillId, focus: latest.evidence.reason,
      dueAt: new Date(latest.time + intervalDays * DAY).toISOString(), intervalDays,
      sourceSessionId: latest.session.id,
    }];
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}
