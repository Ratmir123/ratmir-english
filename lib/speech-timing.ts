import type { Session, SpeechTiming, TimingFeedback } from './types';

export const PAUSE_THRESHOLD_SECONDS = 0.6;
export const MAX_TIMING_SECONDS = 600;
const round = (value: number) => Math.round(value * 1000) / 1000;
const near = (left: number, right: number) => Math.abs(left - right) <= 0.004;
const AUDIO_ID = /^[a-f0-9-]+\.(webm|mp4|ogg|wav|mp3)$/;

/** VAD is probabilistic. Aggregate its classifications without guessing why somebody paused. */
export function timingFromActivityFrames(audioFile: string, frames: readonly boolean[], durationSeconds: number,
  frameSeconds = 0.02, signal: { clippedRatio?: number; rms?: number } = {}): SpeechTiming {
  if (!AUDIO_ID.test(audioFile) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_TIMING_SECONDS
    || !Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 0.03
    || frames.length !== Math.ceil(durationSeconds / frameSeconds)) throw new Error('Invalid voice activity timeline.');
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  for (let index = 0; index <= frames.length; index++) {
    if (index < frames.length && frames[index]) { if (start < 0) start = index * frameSeconds; }
    else if (start >= 0) {
      const end = Math.min(index * frameSeconds, durationSeconds);
      // A single click is not a useful speech interval. Never create speech from silence.
      if (end - start >= 0.12 - 1e-8) runs.push({ start, end });
      start = -1;
    }
  }
  const speech: typeof runs = [];
  for (const run of runs) {
    const previous = speech.at(-1);
    if (previous && run.start - previous.end < 0.2 - 1e-8) previous.end = run.end;
    else speech.push({ ...run });
  }
  const segments: SpeechTiming['segments'] = [];
  let cursor = 0;
  for (let index = 0; index < speech.length; index++) {
    const run = speech[index];
    if (run.start > cursor + 1e-8) segments.push({ startSeconds: round(cursor), endSeconds: round(run.start),
      kind: index === 0 ? 'leading-silence' : run.start - cursor >= PAUSE_THRESHOLD_SECONDS - 1e-8 ? 'pause' : 'gap' });
    segments.push({ startSeconds: round(run.start), endSeconds: round(run.end), kind: 'speech' });
    cursor = run.end;
  }
  if (cursor < durationSeconds - 1e-8) segments.push({ startSeconds: round(cursor), endSeconds: round(durationSeconds),
    kind: speech.length ? 'trailing-silence' : 'leading-silence' });
  const pauses = segments.filter(item => item.kind === 'pause');
  const detectedSpeechSeconds = round(speech.reduce((total, item) => total + item.end - item.start, 0));
  const speechSpanSeconds = speech.length ? round(speech.at(-1)!.end - speech[0].start) : 0;
  const limitations = ['Речь и паузы определены автоматически по исходной записи. Шум, музыка и тихая речь могут ошибочно попасть в разметку.',
    'Пауза не означает ошибку или неуверенность. По этой разметке нельзя оценить произношение, акцент или причину паузы.',
    'Детектор проверяет звук каждые 20 мс и объединяет очень короткие разрывы. Границы речи и пауз приблизительны.'];
  let quality: SpeechTiming['quality'] = !speech.length ? 'no-speech' : detectedSpeechSeconds < 3 || speechSpanSeconds < 5 ? 'limited' : 'usable';
  if (!speech.length) limitations.push('Детектор не нашёл достаточно речи. Это не оценка твоего английского.');
  else if (quality === 'limited') limitations.push('Короткая запись: темп и количество пауз пока трудно сравнивать.');
  if ((signal.clippedRatio ?? 0) > 0.01) { quality = speech.length ? 'limited' : 'no-speech'; limitations.push('Запись местами перегружена. Разметка речи может быть неточной.'); }
  if (speech.length && (signal.rms ?? 1) < 0.003) { quality = 'limited'; limitations.push('Запись очень тихая. Детектор мог пропустить часть речи.'); }
  return { version: 1, method: 'webrtc-vad', source: 'server-audio', audioFile, durationSeconds: round(durationSeconds),
    detectedSpeechSeconds, speechSpanSeconds,
    leadingSilenceSeconds: speech.length ? round(speech[0].start) : round(durationSeconds),
    trailingSilenceSeconds: speech.length ? round(durationSeconds - speech.at(-1)!.end) : 0,
    internalPauseSeconds: round(pauses.reduce((sum, item) => sum + item.endSeconds - item.startSeconds, 0)),
    longestPauseSeconds: round(Math.max(0, ...pauses.map(item => item.endSeconds - item.startSeconds))),
    internalPauseCount: pauses.length, pauseThresholdSeconds: PAUSE_THRESHOLD_SECONDS, segments, quality, limitations,
    recognizedWords: null, approximateWordsPerMinute: null, transcriptEdited: false };
}

/** Strict structural/source validation before metrics can enter coaching or comparisons. */
export function validSpeechTiming(value: unknown, audioFile: string | undefined): value is SpeechTiming {
  if (!value || typeof value !== 'object' || !audioFile || !AUDIO_ID.test(audioFile)) return false;
  const item = value as SpeechTiming;
  if (item.version !== 1 || item.method !== 'webrtc-vad' || item.source !== 'server-audio' || item.audioFile !== audioFile
    || !['usable', 'limited', 'no-speech'].includes(item.quality) || typeof item.transcriptEdited !== 'boolean'
    || !Array.isArray(item.limitations) || item.limitations.length > 8 || !item.limitations.every(text => typeof text === 'string' && text.length <= 500)
    || !Array.isArray(item.segments) || item.segments.length < 1 || item.segments.length > 2048
    || !near(item.pauseThresholdSeconds, PAUSE_THRESHOLD_SECONDS)) return false;
  const metrics = [item.durationSeconds, item.detectedSpeechSeconds, item.speechSpanSeconds, item.leadingSilenceSeconds,
    item.trailingSilenceSeconds, item.internalPauseSeconds, item.longestPauseSeconds, item.internalPauseCount];
  if (metrics.some(number => !Number.isFinite(number) || number < 0) || item.durationSeconds <= 0 || item.durationSeconds > MAX_TIMING_SECONDS
    || !Number.isInteger(item.internalPauseCount)) return false;
  let cursor = 0;
  const speech: SpeechTiming['segments'] = []; const pauses: SpeechTiming['segments'] = [];
  for (const segment of item.segments) {
    if (!segment || !['speech', 'pause', 'leading-silence', 'trailing-silence', 'gap'].includes(segment.kind)
      || !Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds) || segment.startSeconds < 0
      || segment.endSeconds <= segment.startSeconds || !near(segment.startSeconds, cursor)
      || segment.endSeconds > item.durationSeconds + 0.001) return false;
    if (segment.kind === 'speech') speech.push(segment);
    if (segment.kind === 'pause') { if (segment.endSeconds - segment.startSeconds < PAUSE_THRESHOLD_SECONDS - 0.002) return false; pauses.push(segment); }
    if (segment.kind === 'gap' && (segment.endSeconds - segment.startSeconds >= PAUSE_THRESHOLD_SECONDS + 0.002
      || !speech.length)) return false;
    if (segment.kind === 'leading-silence' && cursor !== 0) return false;
    if (segment.kind === 'trailing-silence' && !near(segment.endSeconds, item.durationSeconds)) return false;
    cursor = segment.endSeconds;
  }
  if (!near(cursor, item.durationSeconds)) return false;
  const first = speech[0]; const last = speech.at(-1);
  const speechTotal = speech.reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0);
  const pauseTotal = pauses.reduce((sum, segment) => sum + segment.endSeconds - segment.startSeconds, 0);
  if (pauses.some(segment => !first || segment.startSeconds <= first.startSeconds || segment.endSeconds >= last!.endSeconds)
    || !near(item.detectedSpeechSeconds, speechTotal) || !near(item.speechSpanSeconds, first ? last!.endSeconds - first.startSeconds : 0)
    || !near(item.leadingSilenceSeconds, first?.startSeconds ?? item.durationSeconds)
    || !near(item.trailingSilenceSeconds, last ? item.durationSeconds - last.endSeconds : 0)
    || !near(item.internalPauseSeconds, pauseTotal) || item.internalPauseCount !== pauses.length
    || !near(item.longestPauseSeconds, Math.max(0, ...pauses.map(segment => segment.endSeconds - segment.startSeconds)))
    || (item.quality === 'no-speech') !== !speech.length) return false;
  if (item.recognizedWords !== null && (!Number.isInteger(item.recognizedWords) || item.recognizedWords < 1 || item.recognizedWords > 7000)) return false;
  if (item.approximateWordsPerMinute !== null && (!Number.isFinite(item.approximateWordsPerMinute) || item.approximateWordsPerMinute < 0
    || item.recognizedWords === null || item.quality !== 'usable' || item.transcriptEdited
    || !near(item.approximateWordsPerMinute, round(item.recognizedWords * 60 / item.speechSpanSeconds)))) return false;
  if (item.transcriptEdited && (item.recognizedWords !== null || item.approximateWordsPerMinute !== null)) return false;
  return true;
}

/** ASR words/span is an approximate pace indicator, not articulation rate or a fluency score. */
export function timingForTranscript(timing: SpeechTiming, recognizedTranscript: string, submittedText: string): SpeechTiming {
  const transcriptEdited = recognizedTranscript.trim() !== submittedText.trim();
  const words = recognizedTranscript.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const usable = !transcriptEdited && timing.quality === 'usable' && words > 0 && timing.speechSpanSeconds >= 5;
  return { ...timing, transcriptEdited, recognizedWords: !transcriptEdited && words > 0 ? words : null,
    approximateWordsPerMinute: usable ? round(words * 60 / timing.speechSpanSeconds) : null,
    limitations: [...timing.limitations, ...(transcriptEdited ? ['Текст исправлен вручную. Темп по словам не рассчитывается; паузы относятся только к исходной записи.'] :
      ['Слова в минуту приблизительны: это число распознанных слов за отрезок от первой до последней обнаруженной речи, включая внутренние паузы. Распознавание может пропускать слова и повторы.'])] };
}

/** Numeric timing has its own evidence channel. It can never manufacture a textual quotation/skill grade. */
export function groundedTimingFeedback(session: Session): TimingFeedback[] {
  const gaps = session.turns.filter(turn => turn.role === 'user' && turn.source === 'audio' && !turn.disputed
    && validSpeechTiming(turn.speechTiming, turn.audioFile) && turn.speechTiming.quality === 'usable')
    .flatMap(turn => turn.speechTiming!.segments.filter(segment => segment.kind === 'pause' && segment.endSeconds - segment.startSeconds >= 1.5)
      .map(segment => ({ turnId: turn.id, ...segment, durationSeconds: round(segment.endSeconds - segment.startSeconds) })));
  return gaps.sort((left, right) => right.durationSeconds - left.durationSeconds).slice(0, 3).map(gap => ({
    turnId: gap.turnId, startSeconds: gap.startSeconds, endSeconds: gap.endSeconds, durationSeconds: gap.durationSeconds,
    observation: `В этой записи с ${gap.startSeconds.toFixed(1)} до ${gap.endSeconds.toFixed(1)} с детектор не обнаружил речь (${gap.durationSeconds.toFixed(1)} с). Это измеренная пауза, её причина пока неизвестна.`,
    practice: 'Для отдельной тренировки темпа выбери один ответ, заранее выдели три мысли и запиши его снова без заготовленного текста. Сравни паузы и полноту ответа. Ускорение полезно, только если смысл не теряется.',
  }));
}
