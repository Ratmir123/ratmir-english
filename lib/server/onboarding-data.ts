import { createHash } from 'node:crypto';
import { BASELINE_STEPS, deriveOnboardingSteps, ONBOARDING_VERSION, RUSSIAN_CONTROL_PROMPT, selectedBaselineSessions } from '../onboarding';
import type { BaselineReport, OnboardingState, Profile, Session } from '../types';

export interface OnboardingRecord {
  version: 1; introCompletedAt: string | null; russianControl: string | null;
  reportCache?: { fingerprint: string; report: BaselineReport };
}
export function emptyOnboardingRecord(): OnboardingRecord {
  return { version: ONBOARDING_VERSION, introCompletedAt: null, russianControl: null };
}
export function baselineReportFingerprint(record: OnboardingRecord, sessions: Session[], profile: Profile): string {
  return createHash('sha256').update(JSON.stringify({ version: ONBOARDING_VERSION,
    introCompletedAt: record.introCompletedAt, russianControl: record.russianControl,
    profile: { name: profile.name, goals: profile.goals, interests: profile.interests,
      professionalContext: profile.professionalContext, relocation: profile.relocation, feedback: profile.feedback },
    sessions: selectedBaselineSessions(sessions).map(session => ({ id: session.id, baseline: session.baseline,
      lesson: session.lesson, mode: session.mode, turns: session.turns.map(({ id, role, text, source, support, disputed,
        originalTranscript, transcriptEdited }) => ({ id, role, text, source, support, disputed, originalTranscript, transcriptEdited })),
      analysis: session.analysis })),
  })).digest('hex');
}
export function presentOnboarding(record: OnboardingRecord, sessions: Session[], profile: Profile): OnboardingState {
  const steps = deriveOnboardingSteps(sessions);
  const completedStages = steps.filter(step => step.status === 'ready').length;
  const status = !record.introCompletedAt || !record.russianControl ? 'intro'
    : completedStages === BASELINE_STEPS.length ? 'ready' : 'baseline';
  return { version: ONBOARDING_VERSION, status, introCompletedAt: record.introCompletedAt,
    russianPrompt: RUSSIAN_CONTROL_PROMPT, russianControl: record.russianControl, completedStages, steps,
    report: status === 'ready' && record.reportCache?.fingerprint === baselineReportFingerprint(record, sessions, profile)
      ? record.reportCache.report : null };
}
