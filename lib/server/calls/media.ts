import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { CallStepError } from './errors';

/**
 * ffprobe / ffmpeg for call audio. No shell: argument arrays only, server-generated file paths, fixed demuxer and
 * protocol whitelists, bounded output and timeouts. Codec diagnostics are never surfaced (they can contain paths).
 */
export interface ProcessResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; failedToStart: boolean }
export type ProcessRunner = (command: string, args: string[], options: { timeoutMs: number; maxOutputBytes?: number }) => Promise<ProcessResult>;
export interface Silence { start: number; end: number }
export interface ChunkPlan { index: number; start: number; end: number }

export const MAX_CHUNK_SECONDS = 600;
export const CHUNK_WINDOW_SECONDS = 45;
export const MAX_CALL_SECONDS = 4 * 3600;
/** Demuxers allowed for uploads and learner recordings (mov covers mp4/m4a/mov; matroska covers mkv/webm). */
const INPUT_FORMATS = 'mov,mp4,m4a,matroska,webm,mp3,wav,ogg,flac,aac';
const SAMPLE_RATE = '16000';

export const spawnRunner: ProcessRunner = (command, args, { timeoutMs, maxOutputBytes = 16 * 1024 * 1024 }) => new Promise(resolve => {
  let child: ReturnType<typeof spawn>;
  try {
    // ffmpeg is an OS runtime dependency (Docker image, owner's PC), never a traced project file.
    child = spawn(/* turbopackIgnore: true */ command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    resolve({ code: null, stdout: '', stderr: '', timedOut: false, failedToStart: true });
    return;
  }
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let outSize = 0;
  let errSize = 0;
  let done = false;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  child.stdout?.on('data', (chunk: Buffer) => { if (outSize < maxOutputBytes) { out.push(chunk); outSize += chunk.length; } });
  child.stderr?.on('data', (chunk: Buffer) => { if (errSize < maxOutputBytes) { err.push(chunk); errSize += chunk.length; } });
  const finish = (code: number | null, failedToStart: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, failedToStart });
  };
  child.on('error', () => finish(null, true));
  child.on('close', code => finish(code, false));
});

export function ffmpegBinary(): string { return process.env.TRAINING_FFMPEG_PATH || 'ffmpeg'; }
export function ffprobeBinary(): string {
  if (process.env.TRAINING_FFPROBE_PATH) return process.env.TRAINING_FFPROBE_PATH;
  const ffmpeg = process.env.TRAINING_FFMPEG_PATH;
  if (ffmpeg && isAbsolute(ffmpeg)) return join(dirname(ffmpeg), basename(ffmpeg).replace(/ffmpeg/i, 'ffprobe'));
  return 'ffprobe';
}

function seconds(value: number): string { return (Math.round(value * 1000) / 1000).toFixed(3); }

function ensureOk(result: ProcessResult, failure: string): void {
  if (result.failedToStart) throw new CallStepError('На сервере не найден ffmpeg, без него запись не обработать.', false);
  if (result.timedOut) throw new CallStepError('Обработка звука заняла слишком много времени. Попробуй файл покороче.', false);
  if (result.code !== 0) throw new CallStepError(failure, false);
}

/** Parse ffmpeg silencedetect output into closed silence intervals. */
export function parseSilences(stderr: string, durationSeconds: number): Silence[] {
  const silences: Silence[] = [];
  let pending: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (start) { pending = Math.max(0, Number(start[1])); continue; }
    const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (end && pending !== null) {
      const value = Number(end[1]);
      if (Number.isFinite(value) && value > pending) silences.push({ start: pending, end: value });
      pending = null;
    }
  }
  if (pending !== null && durationSeconds > pending) silences.push({ start: pending, end: durationSeconds });
  return silences;
}

/**
 * Chunks of at most `max` seconds. Each cut is placed at the silence whose midpoint is nearest to the nominal boundary
 * (max − window after the chunk start), searching ±window around it so no chunk exceeds `max`; without a silence there,
 * the chunk is cut hard at `max`.
 */
export function planChunks(durationSeconds: number, silences: Silence[], max = MAX_CHUNK_SECONDS, window = CHUNK_WINDOW_SECONDS): ChunkPlan[] {
  const chunks: ChunkPlan[] = [];
  let start = 0;
  const midpoints = silences.map(silence => (silence.start + silence.end) / 2).filter(Number.isFinite).sort((left, right) => left - right);
  while (durationSeconds - start > max) {
    const nominal = start + max - window;
    let best: number | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const midpoint of midpoints) {
      if (midpoint <= nominal - window || midpoint >= start + max || midpoint <= start + 1) continue;
      const gap = Math.abs(midpoint - nominal);
      if (gap < distance) { distance = gap; best = midpoint; }
    }
    const cut = Math.round((best ?? start + max) * 1000) / 1000;
    chunks.push({ index: chunks.length, start, end: cut });
    start = cut;
  }
  chunks.push({ index: chunks.length, start, end: Math.round(durationSeconds * 1000) / 1000 });
  return chunks;
}

/** Duration of a PCM WAV file from its header (null when it is not a readable WAV). */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16 && offset + 20 <= bytes.byteLength) byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      const available = Math.min(size, bytes.byteLength - offset - 8);
      return byteRate > 0 ? available / byteRate : null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export interface MediaTools {
  probe(path: string): Promise<{ durationSeconds: number; audioStreams: number }>;
  /** Mono 16 kHz MP3 48 kbps; several audio streams (e.g. microphone + system audio) are mixed. */
  normalise(input: string, output: string, audioStreams: number, durationSeconds: number): Promise<void>;
  silences(path: string, durationSeconds: number): Promise<Silence[]>;
  cut(input: string, start: number, duration: number, output: string, format: 'mp3' | 'wav'): Promise<void>;
  /** Speech-only WAV (silences removed) of at most maxSeconds from a practice recording; returns its duration. */
  speechSample(input: string, output: string, maxSeconds: number): Promise<number>;
}

export function createMediaTools(runner: ProcessRunner = spawnRunner): MediaTools {
  const base = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file'];
  return {
    async probe(path) {
      const result = await runner(ffprobeBinary(), ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', INPUT_FORMATS,
        '-print_format', 'json', '-show_entries', 'format=duration:stream=codec_type,duration', path], { timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 });
      ensureOk(result, 'Не удалось прочитать файл: формат не распознан или файл повреждён.');
      let parsed: { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] };
      try { parsed = JSON.parse(result.stdout); } catch { throw new CallStepError('Не удалось прочитать файл: формат не распознан или файл повреждён.', false); }
      const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
      const audio = streams.filter(stream => stream.codec_type === 'audio');
      const durations = [Number(parsed.format?.duration), ...audio.map(stream => Number(stream.duration))].filter(value => Number.isFinite(value) && value > 0);
      return { durationSeconds: durations.length ? Math.max(...durations) : 0, audioStreams: audio.length };
    },
    async normalise(input, output, audioStreams, durationSeconds) {
      const count = Math.min(Math.max(audioStreams, 1), 8);
      const mix = count > 1
        ? ['-filter_complex', `${Array.from({ length: count }, (_, index) => `[0:a:${index}]`).join('')}amix=inputs=${count}:duration=longest:dropout_transition=0[mix]`, '-map', '[mix]']
        : ['-map', '0:a:0'];
      const result = await runner(ffmpegBinary(), [...base, '-format_whitelist', INPUT_FORMATS, '-i', input, ...mix, '-vn', '-sn', '-dn',
        '-map_metadata', '-1', '-ac', '1', '-ar', SAMPLE_RATE, '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', output],
      { timeoutMs: Math.min(2 * 3600_000, 120_000 + durationSeconds * 300), maxOutputBytes: 256 * 1024 });
      ensureOk(result, 'Не удалось извлечь звук из файла. Проверь, что запись открывается в плеере.');
    },
    async silences(path, durationSeconds) {
      const result = await runner(ffmpegBinary(), ['-hide_banner', '-nostdin', '-loglevel', 'info', '-protocol_whitelist', 'file', '-i', path,
        '-af', 'silencedetect=n=-35dB:d=0.35', '-f', 'null', '-'], { timeoutMs: Math.min(3600_000, 60_000 + durationSeconds * 200) });
      ensureOk(result, 'Не удалось найти паузы в записи.');
      return parseSilences(result.stderr, durationSeconds);
    },
    async cut(input, start, duration, output, format) {
      const codec = format === 'wav' ? ['-c:a', 'pcm_s16le', '-f', 'wav'] : ['-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3'];
      const result = await runner(ffmpegBinary(), [...base, '-ss', seconds(start), '-i', input, '-t', seconds(duration), '-map', '0:a:0',
        '-map_metadata', '-1', '-ac', '1', '-ar', SAMPLE_RATE, ...codec, output], { timeoutMs: 120_000, maxOutputBytes: 256 * 1024 });
      ensureOk(result, 'Не удалось нарезать запись на части.');
    },
    async speechSample(input, output, maxSeconds) {
      const result = await runner(ffmpegBinary(), [...base, '-format_whitelist', INPUT_FORMATS, '-i', input, '-map', '0:a:0',
        '-af', 'silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB:stop_periods=-1:stop_duration=0.6:stop_threshold=-45dB',
        '-t', seconds(maxSeconds), '-map_metadata', '-1', '-ac', '1', '-ar', SAMPLE_RATE, '-c:a', 'pcm_s16le', '-f', 'wav', output],
      { timeoutMs: 60_000, maxOutputBytes: 256 * 1024 });
      ensureOk(result, 'Не удалось подготовить образец голоса.');
      return wavDurationSeconds(readFileSync(output)) ?? 0;
    },
  };
}
