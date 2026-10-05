import type { DatabaseSync } from 'node:sqlite';
import type { PlacementView } from '../../placement/types';
import { clearPlacementTables, readActiveAttempt, readAllAttempts, readCompletedAttempts } from './attempts';
import { placementBank } from './bank-source';
import { SECTION_ORDER } from './model';
import { answeredObjective, answeredSpoken } from './records';
import { placementRuntime } from './runtime';
import { buildPlacementView } from './view';

function audioAvailable(): boolean {
  try { return placementRuntime().audioConfigured(); } catch { return false; }
}

/** Cheap read (no model calls, no network): runs inside getAppState()'s transaction. */
export function presentPlacement(db: DatabaseSync): PlacementView {
  return buildPlacementView({ active: readActiveAttempt(db), completed: readCompletedAttempts(db), bank: placementBank(), audioAvailable: audioAvailable() });
}

/** Called inside deleteAllTraining()'s transaction: remove every placement attempt, exposure row and scoring job. */
export function clearPlacement(db: DatabaseSync): void { clearPlacementTables(db); }

export interface PlacementProgressionInputs {
  sections: { attemptId: string; section: string; completedAt: string }[];
  results: { attemptId: string; completedAt: string }[];
}

/** Cheap progression inputs (no network): one entry per completed, answered (never skipped) section of any attempt and
 * one per completed result, oldest first. Discarded attempts and a redone stale first sitting no longer count. */
export function placementProgressionInputs(db: DatabaseSync): PlacementProgressionInputs {
  const attempts = readAllAttempts(db);
  const sections = attempts.flatMap(attempt => SECTION_ORDER.flatMap(section => {
    const record = attempt.sections[section];
    const answered = section === 'speaking' || section === 'interaction' ? answeredSpoken(attempt, section).length
      : answeredObjective(attempt, item => item.section === section).length;
    return record.status === 'completed' && record.completedAt && answered > 0
      ? [{ attemptId: attempt.id, section, completedAt: record.completedAt }] : [];
  })).sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  const results = attempts.filter(attempt => attempt.status === 'completed' && attempt.result && attempt.completedAt)
    .map(attempt => ({ attemptId: attempt.id, completedAt: attempt.completedAt! }))
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  return { sections, results };
}

/** Learner voice recordings from placement speaking tasks and roleplay turns (audio file names in .data/audio):
 * unedited answers first, newest first within each group. The calls pipeline uses one as a known-speaker reference;
 * callers must still check the file exists (audio retention may have removed it). */
export function placementVoiceSamples(db: DatabaseSync): string[] {
  const records = readAllAttempts(db).flatMap(attempt => attempt.spoken)
    .filter(record => record.audioFile && record.answeredAt && !record.voided);
  records.sort((left, right) => Number(left.transcriptEdited) - Number(right.transcriptEdited)
    || Date.parse(right.answeredAt!) - Date.parse(left.answeredAt!));
  return [...new Set(records.map(record => record.audioFile!))];
}
