import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { audioConfigured, getAudio, synthesizeSpeech } from '../audio';
import { decodeRecordedAudio, recordedSubmission } from '../speech-timing';
import type { SpeechTiming } from '../../types';

/** Server-derived provenance of a spoken answer (ASR original, edit flag, measured VAD timing). */
export interface RecordedIntegrity { originalTranscript?: string; transcriptEdited?: boolean; speechTiming?: SpeechTiming }

/**
 * Side-effecting dependencies of the placement flow. Production uses the real audio stack; tests replace any member
 * with configurePlacementRuntime() so no provider, recording directory or clock is touched.
 */
export interface PlacementRuntime {
  now(): number;
  /** Seed for the attempt's deterministic selection RNG. */
  seed(): number;
  audioConfigured(): boolean;
  synthesizeSpeech(text: string, options: { voice: string; instructions: string }): Promise<Uint8Array>;
  /** Throws ApiError 404 when the learner recording does not exist. */
  checkRecording(audioFile: string): void;
  recordedSubmission(audioFile: string, text: string, originalTranscript: string | undefined): RecordedIntegrity;
  /** Duration of a synthesized clip (pace acceptance); null when it cannot be measured (no ffmpeg). */
  clipSeconds(path: string): Promise<number | null>;
  /** Mix mono mp3 turns starting at the given offsets into one mp3 (dialogues); false when ffmpeg is unavailable. */
  mixClips(inputs: readonly string[], offsetsSeconds: readonly number[], output: string): Promise<boolean>;
  /** Synthesize the current clip in the background as soon as a listening or roleplay task appears. */
  prefetchAudio: boolean;
  /** Start the scoring job right after the last answer (the worker tick also picks it up). */
  kickScoring: boolean;
}

const defaults: PlacementRuntime = {
  now: () => Date.now(),
  seed: () => randomInt(0, 2 ** 31 - 1),
  audioConfigured: () => audioConfigured(),
  synthesizeSpeech: (text, options) => synthesizeSpeech(text, options),
  checkRecording: file => { getAudio(file); },
  recordedSubmission: (audioFile, text, originalTranscript) => {
    const { support: ignored, ...integrity } = recordedSubmission(audioFile, text, originalTranscript);
    void ignored;
    return integrity;
  },
  clipSeconds: async path => {
    try { return (await decodeRecordedAudio(path, 'mp3')).length / 32000; } catch { return null; }
  },
  mixClips: (inputs, offsets, output) => mixWithFfmpeg(inputs, offsets, output),
  prefetchAudio: true,
  kickScoring: true,
};

/** Fixed arguments and server-generated local paths only: no shell, no network protocols. */
function mixWithFfmpeg(inputs: readonly string[], offsets: readonly number[], output: string): Promise<boolean> {
  if (!inputs.length || inputs.length !== offsets.length || inputs.length > 24) return Promise.resolve(false);
  const delays = inputs.map((_, index) => `[${index}:a]aresample=24000,aformat=channel_layouts=mono,adelay=${Math.max(0, Math.round(offsets[index] * 1000))}[a${index}]`);
  const graph = `${delays.join(';')};${inputs.map((_, index) => `[a${index}]`).join('')}amix=inputs=${inputs.length}:normalize=0:dropout_transition=0[out]`;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...inputs.flatMap(input => ['-protocol_whitelist', 'file,pipe', '-f', 'mp3', '-i', input]), '-filter_complex', graph, '-map', '[out]',
    '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', output];
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    // ffmpeg is an OS runtime dependency installed by Docker, not a file to trace/bundle from this project.
    const child = spawn(/* turbopackIgnore: true */ process.env.TRAINING_FFMPEG_PATH || 'ffmpeg', args,
      { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { child.kill(); finish(false); }, 30_000);
    child.stderr?.on('data', () => {});
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0 && existsSync(output) && statSync(output).size > 0));
  });
}

const globals = globalThis as typeof globalThis & { trainingPlacementRuntime?: Partial<PlacementRuntime> };

export function placementRuntime(): PlacementRuntime { return { ...defaults, ...(globals.trainingPlacementRuntime ?? {}) }; }

/** Test hook: override members (merged), or pass null to restore production behaviour. */
export function configurePlacementRuntime(overrides: Partial<PlacementRuntime> | null): void {
  globals.trainingPlacementRuntime = overrides ? { ...(globals.trainingPlacementRuntime ?? {}), ...overrides } : undefined;
}
