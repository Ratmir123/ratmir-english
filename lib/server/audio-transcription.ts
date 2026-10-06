/** Audio evidence is learner speech, never a corrected writing exercise. */
export const VERBATIM_TRANSCRIPTION_PROMPT = 'This is an English learner speaking, sometimes switching to Russian. Transcribe exactly what is audible. Preserve um, uh, er, repetitions, false starts, unfinished sentences, self-corrections and grammatical mistakes. Do not improve grammar, rewrite, summarize or add missing words. Do not censor filler words. Unclear words must not be guessed.';
export const LIVE_TRANSCRIPTION_MODEL = 'gpt-live-transcribe';
export const FILE_TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const TRANSCRIPTION_MINUTE_USD = 0.0045;
export const LIVE_TRANSCRIPTION_MINUTE_USD = 0.017;
export const MAX_RECORDING_MINUTES = 8;
export function liveTranscriptionConfiguration() {
  return { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 },
    // 'minimal': the learner's own words should appear almost at once (MOTION-PASS-0.5.2 §5).
    transcription: { model: LIVE_TRANSCRIPTION_MODEL, languages: ['en', 'ru'], delay: 'minimal', prompt: VERBATIM_TRANSCRIPTION_PROMPT },
    turn_detection: null,
  } } };
}
