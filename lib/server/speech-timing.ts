import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_TIMING_SECONDS, timingFromActivityFrames, timingForTranscript, validSpeechTiming } from '../speech-timing';
import type { SpeechTiming, Support } from '../types';
import { transcriptIntegrity } from './transcript-integrity';

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320;
const MAX_OUTPUT_BYTES = SAMPLE_RATE * 2 * (MAX_TIMING_SECONDS + 1);
const audioDir = process.env.TRAINING_DATA_DIR ? resolve(process.env.TRAINING_DATA_DIR, 'audio') : resolve(process.cwd(), '.data/audio');
const validFile = (file: string) => file === basename(file) && /^[a-f0-9-]+\.(webm|mp4|ogg|wav|mp3)$/.test(file);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
interface StoredTiming { version: 1; audioHash: string; timing?: SpeechTiming; transcript: string; transcriptSource: 'file' | 'live' }

/** Only fixed demuxers and a server-generated local filename are used; there is no shell or network protocol. */
export function decodeRecordedAudio(path: string, extension: string): Promise<Buffer> {
  const format = ({ wav: 'wav', webm: 'matroska', mp4: 'mov', ogg: 'ogg', mp3: 'mp3' } as Record<string, string>)[extension];
  if (!format) return Promise.reject(new Error('Unsupported recording container.'));
  return new Promise((resolvePromise, reject) => {
    // ffmpeg is an OS runtime dependency installed by Docker, not a file to trace/bundle from this project.
    const decoder = spawn(/* turbopackIgnore: true */ process.env.TRAINING_FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-f', format,
      ...(format === 'mov' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []),
      '-probesize', '1048576', '-analyzeduration', '5000000', '-i', path, '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-t', String(MAX_TIMING_SECONDS + 1), '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
    { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false; let size = 0; const chunks: Buffer[] = [];
    const timer = setTimeout(() => { decoder.kill(); finish(new Error('Recording decoder timed out.')); }, 15000);
    function finish(error?: Error) {
      if (done) return; done = true; clearTimeout(timer);
      if (error) reject(error); else resolvePromise(Buffer.concat(chunks, size));
    }
    // Discard codec diagnostics: recorded contents and local paths never enter application errors/logs.
    decoder.stderr?.on('data', () => {});
    decoder.stdout?.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) { decoder.kill(); finish(new Error('Recording is too long.')); return; }
      if (!done) chunks.push(chunk);
    });
    decoder.on('error', () => finish(new Error('Recording decoder is unavailable.')));
    decoder.on('close', code => {
      if (code !== 0 || size < SAMPLE_RATE * 2 * 0.25 || size % 2 !== 0 || size > SAMPLE_RATE * 2 * MAX_TIMING_SECONDS)
        finish(new Error('Recording could not be decoded within the allowed duration.'));
      else finish();
    });
  });
}

let fvadPromise: ReturnType<typeof import('@echogarden/fvad-wasm')['default']> | undefined;
/** The small offline WebRTC classifier processes 20 ms frames. No recording leaves the server. */
export async function classifyRecordedPCM(pcm: Uint8Array, audioFile: string): Promise<SpeechTiming> {
  if (pcm.byteLength % 2 || pcm.byteLength < SAMPLE_RATE * 2 * 0.25 || pcm.byteLength > SAMPLE_RATE * 2 * MAX_TIMING_SECONDS)
    throw new Error('Invalid PCM recording.');
  fvadPromise ??= import('@echogarden/fvad-wasm').then(module => module.default({ print: () => {}, printErr: () => {} }));
  const vad = await fvadPromise;
  const instance = vad._fvad_new(); const pointer = vad._malloc(FRAME_SAMPLES * 2);
  if (!instance || !pointer) { if (instance) vad._fvad_free(instance); if (pointer) vad._free(pointer); throw new Error('Voice detector unavailable.'); }
  const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frameCount = Math.ceil(pcm.byteLength / 2 / FRAME_SAMPLES); const frames: boolean[] = [];
  let sum = 0; let clipped = 0;
  try {
    // Moderate setting avoids treating each breath/quiet consonant as an interruption. It is still an estimate.
    if (vad._fvad_set_mode(instance, 1) !== 0 || vad._fvad_set_sample_rate(instance, SAMPLE_RATE) !== 0) throw new Error('Voice detector configuration failed.');
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const buffer = vad.HEAP16.subarray(pointer / 2, pointer / 2 + FRAME_SAMPLES); buffer.fill(0);
      const offset = frameIndex * FRAME_SAMPLES;
      for (let index = 0; index < FRAME_SAMPLES && (offset + index) * 2 < pcm.byteLength; index++) {
        const value = samples.getInt16((offset + index) * 2, true); buffer[index] = value;
        sum += (value / 32768) ** 2; if (Math.abs(value) >= 32700) clipped++;
      }
      const result = vad._fvad_process(instance, pointer, FRAME_SAMPLES);
      if (result < 0) throw new Error('Voice detector frame failed.'); frames.push(result === 1);
    }
  } finally { vad._free(pointer); vad._fvad_free(instance); }
  const sampleCount = pcm.byteLength / 2;
  return timingFromActivityFrames(audioFile, frames, sampleCount / SAMPLE_RATE, 0.02,
    { rms: Math.sqrt(sum / sampleCount), clippedRatio: clipped / sampleCount });
}

const timingGlobals = globalThis as typeof globalThis & { trainingTimingWorkers?: number };
/** Optional metrics must never block a usable transcript. Concurrent decoding is bounded on the small VPS. */
export async function measureSavedRecording(audioFile: string, transcript: string, transcriptSource: 'file' | 'live', recordingDirectory = audioDir): Promise<SpeechTiming | undefined> {
  if (!validFile(audioFile) || transcript.length > 7000 || (timingGlobals.trainingTimingWorkers ?? 0) >= 2) return undefined;
  const path = join(recordingDirectory, audioFile);
  if (!existsSync(path) || statSync(path).size > 25 * 1024 * 1024) return undefined;
  timingGlobals.trainingTimingWorkers = (timingGlobals.trainingTimingWorkers ?? 0) + 1;
  try {
    const audioHash = hash(readFileSync(path));
    const pcm = await decodeRecordedAudio(path, audioFile.split('.').at(-1)!);
    const timing = await classifyRecordedPCM(pcm, audioFile);
    if (!validSpeechTiming(timing, audioFile)) return undefined;
    const stored: StoredTiming = { version: 1, audioHash, timing, transcript, transcriptSource };
    writeFileSync(join(recordingDirectory, audioFile + '.timing.json'), JSON.stringify(stored), { mode: 0o600 });
    return timingForTranscript(timing, transcript, transcript);
  } catch { return undefined; }
  finally { timingGlobals.trainingTimingWorkers = Math.max(0, (timingGlobals.trainingTimingWorkers ?? 1) - 1); }
}

function readSavedTiming(audioFile: string, recordingDirectory = audioDir): StoredTiming | undefined {
  if (!validFile(audioFile)) return undefined;
  try {
    const path = join(recordingDirectory, audioFile); const sidecar = join(recordingDirectory, audioFile + '.timing.json');
    if (!existsSync(path) || !existsSync(sidecar) || statSync(sidecar).size > 250000 || statSync(path).size > 25 * 1024 * 1024) return undefined;
    const stored = JSON.parse(readFileSync(sidecar, 'utf8')) as StoredTiming;
    if (stored.version !== 1 || !['file', 'live'].includes(stored.transcriptSource) || typeof stored.transcript !== 'string'
      || stored.transcript.length > 7000 || typeof stored.audioHash !== 'string' || stored.audioHash !== hash(readFileSync(path))
      || (stored.timing !== undefined && (!validSpeechTiming(stored.timing, audioFile)
        || stored.timing.recognizedWords !== null || stored.timing.approximateWordsPerMinute !== null))) return undefined;
    return stored;
  } catch { return undefined; }
}

function submissionTiming(stored: StoredTiming, text: string): SpeechTiming | undefined {
  if (!stored.timing) return undefined;
  const timing = timingForTranscript(stored.timing, stored.transcript, text);
  if (stored.transcriptSource === 'live') timing.limitations.push('Счёт слов использует живые субтитры, переданные приложением. Сервер измеряет паузы по звуку, но не проверяет каждое распознанное слово.');
  return timing;
}

/** Submission metadata is derived from server audio/ASR, never accepted from a client-supplied metrics object. */
export function recordedSubmission(audioFile: string, text: string, clientOriginal: string | undefined, support: Support = 0, recordingDirectory = audioDir): {
  originalTranscript?: string; transcriptEdited?: boolean; support: Support; speechTiming?: SpeechTiming;
} {
  const stored = readSavedTiming(audioFile, recordingDirectory);
  const integrity = transcriptIntegrity(text, stored?.transcript ?? clientOriginal, 'audio', support);
  return { ...integrity, ...(stored?.timing ? { speechTiming: submissionTiming(stored, text) } : {}) };
}

/** Attach the recognizer result after concurrent offline measurement has finished. */
export function bindRecordingTranscript(audioFile: string, transcript: string, transcriptSource: 'file' | 'live', recordingDirectory = audioDir): SpeechTiming | undefined {
  if (transcript.length > 7000) return undefined;
  if (!validFile(audioFile)) return undefined;
  try {
    const path = join(recordingDirectory, audioFile);
    if (!existsSync(path) || statSync(path).size > 25 * 1024 * 1024) return undefined;
    // ASR provenance remains protected even when optional decoding/VAD was unavailable.
    const stored: StoredTiming = readSavedTiming(audioFile, recordingDirectory) ?? { version: 1, audioHash: hash(readFileSync(path)), transcript: '', transcriptSource };
    stored.transcript = transcript; stored.transcriptSource = transcriptSource;
    writeFileSync(join(recordingDirectory, audioFile + '.timing.json'), JSON.stringify(stored), { mode: 0o600 });
    return submissionTiming(stored, transcript);
  } catch { return undefined; }
}

export function deleteRecordingTiming(audioFile: string, recordingDirectory = audioDir) {
  if (!validFile(audioFile)) return;
  const path = join(recordingDirectory, audioFile + '.timing.json');
  if (existsSync(path)) unlinkSync(path);
}

/** For explicit source corrections: retain the measured timeline, invalidate any word-based spoken pace claim. */
export function correctedRecordingTiming(audioFile: string, text: string, recordingDirectory = audioDir): SpeechTiming | undefined {
  const stored = readSavedTiming(audioFile, recordingDirectory);
  return stored ? submissionTiming(stored, text) : undefined;
}
