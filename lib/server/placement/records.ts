import { levelIndex, type ObjectiveEvidence } from '../../placement/engine';
import { countWords, speechTimingMetrics, type TimingMetrics } from '../../placement/scoring';
import { bankItem, type PlacementBank } from './bank-source';
import { MIN_SPEECH_SECONDS, MIN_SPEECH_WORDS, type AttemptRecord, type ObjectiveRecord, type SpokenRecord } from './model';

export function answeredObjective(attempt: AttemptRecord, filter: (record: ObjectiveRecord) => boolean = () => true): ObjectiveRecord[] {
  return attempt.objective.filter(record => !!record.answeredAt && !record.voided && record.correct !== null && filter(record));
}

export function answeredSpoken(attempt: AttemptRecord, section: 'speaking' | 'interaction'): SpokenRecord[] {
  return attempt.spoken.filter(record => record.section === section && !!record.answeredAt && !record.voided && !!record.text);
}

export function toEvidence(record: ObjectiveRecord, bank: PlacementBank): ObjectiveEvidence {
  return { skill: record.skill, level: levelIndex(record.level), correct: !!record.correct,
    options: bankItem(bank, record.itemId)?.options.length ?? 4, position: record.position, plays: record.plays ?? undefined };
}

/** The verbatim recogniser output (fillers kept); the submitted text when no original exists. */
export function verbatimText(record: SpokenRecord): string { return record.originalTranscript ?? record.text ?? ''; }

/** A rated speaking task needs at least 15 s of detected speech (≈ 25 words when VAD timing is unavailable). */
export function insufficientSpeech(record: SpokenRecord): boolean {
  const timing = record.speechTiming;
  if (timing && timing.quality !== 'no-speech') return timing.detectedSpeechSeconds < MIN_SPEECH_SECONDS;
  return countWords(verbatimText(record)) < MIN_SPEECH_WORDS;
}

export function recordMetrics(record: SpokenRecord): TimingMetrics | null {
  return speechTimingMetrics(record.speechTiming, verbatimText(record), { autoStart: record.section === 'speaking' && record.role !== 'R0' });
}
