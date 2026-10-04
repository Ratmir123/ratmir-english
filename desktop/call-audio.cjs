'use strict';

// Local audio extraction for large call recordings (Smooth Talk 0.5).
// The renderer hands over a path that Electron resolved from a user-picked File;
// the main process validates it, finds the system ffmpeg (never bundled, never a
// shell) and returns a compact mono MP3 the client uploads instead of a 2–20 GB video.

const { spawn } = require('node:child_process');
const { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { basename, extname, isAbsolute, join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const MAX_CALL_MEDIA_BYTES = 20 * 1024 ** 3; // 20 GB
const FFMPEG_TIMEOUT_MS = 20 * 60_000;
const WHERE_TIMEOUT_MS = 5000;
const MAX_STDERR_CHARS = 64 * 1024;
// Contract list (lib/calls/types.ts CALL_AUDIO_EXTENSIONS) plus common containers ffmpeg reads.
const CALL_MEDIA_EXTENSIONS = Object.freeze([
  'mp3', 'm4a', 'mp4', 'mov', 'wav', 'webm', 'ogg', 'oga', 'opus', 'aac', 'flac', 'mkv',
  'm4v', 'avi', 'wma', 'aif', 'aiff', '3gp', 'amr', 'caf', 'mpg', 'mpeg',
]);

function failure(reason, message) { return { ok: false, reason, message }; }

/** Absolute, regular (non-link) file, ≤ 20 GB, known audio/video extension. */
function validateCallMediaPath(value, fs = { lstatSync }) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 32_767 || /[\x00-\x1f]/u.test(value)) {
    return failure('unsupported', 'Не удалось открыть файл с диска. Загружу его целиком.');
  }
  // Device namespaces (\\.\, \\?\) are never call recordings.
  if (/^\\\\[.?]\\/u.test(value) || !isAbsolute(value)) return failure('unsupported', 'Не удалось открыть файл с диска. Загружу его целиком.');
  const extension = extname(value).slice(1).toLowerCase();
  if (!CALL_MEDIA_EXTENSIONS.includes(extension)) return failure('unsupported', 'Этот формат не похож на аудио или видео созвона.');
  let stat;
  try { stat = fs.lstatSync(value); } catch { return failure('unsupported', 'Файл не найден. Выбери его ещё раз.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) return failure('unsupported', 'Нужен обычный файл с записью, а не ярлык или папка.');
  if (!(stat.size > 0)) return failure('unsupported', 'Файл пустой.');
  if (stat.size > MAX_CALL_MEDIA_BYTES) return failure('unsupported', 'Файл больше 20 ГБ. Обрежь запись до самого созвона.');
  return { ok: true, path: resolve(value), bytes: stat.size };
}

function isRegularExe(candidate, fs) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate) || !/\.exe$/iu.test(candidate) || /[\x00-\x1f]/u.test(candidate)) return false;
  try { const stat = fs.lstatSync(candidate); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}

function runWhere(spawnFunction, whereExe, timeoutMs = WHERE_TIMEOUT_MS) {
  return new Promise((done) => {
    let output = '';
    let settled = false;
    let child;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); done(value); };
    const timer = setTimeout(() => { try { child?.kill(); } catch { } finish([]); }, timeoutMs);
    try {
      // `$PATH:` limits the search to PATH (where.exe would otherwise look in the working directory first).
      child = spawnFunction(whereExe, ['$PATH:ffmpeg.exe'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { finish([]); return; }
    child.stdout?.on('data', (chunk) => { output = (output + chunk.toString()).slice(0, 8192); });
    child.once('error', () => finish([]));
    child.once('exit', (code) => finish(code === 0 ? output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean) : []));
  });
}

/** PATH first (where.exe), then the WinGet Gyan.FFmpeg package folder, then the WinGet Links shim. */
async function findFfmpeg(options = {}) {
  const env = options.env || process.env;
  const fs = options.fs || { lstatSync, readdirSync };
  const spawnFunction = options.spawn || spawn;
  const systemRoot = typeof env.SystemRoot === 'string' && isAbsolute(env.SystemRoot) ? env.SystemRoot : 'C:\\Windows';
  for (const line of await runWhere(spawnFunction, join(systemRoot, 'System32', 'where.exe'), options.whereTimeoutMs)) {
    if (isRegularExe(line, fs)) return line;
  }
  const local = typeof env.LOCALAPPDATA === 'string' && isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : null;
  if (!local) return null;
  const packages = join(local, 'Microsoft', 'WinGet', 'Packages');
  const list = (directory) => { try { return fs.readdirSync(directory); } catch { return []; } };
  const newestFirst = (names) => [...names].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const vendor of newestFirst(list(packages).filter((name) => /^Gyan\.FFmpeg/iu.test(name)))) {
    for (const build of newestFirst(list(join(packages, vendor)).filter((name) => /^ffmpeg-/iu.test(name)))) {
      const candidate = join(packages, vendor, build, 'bin', 'ffmpeg.exe');
      if (isRegularExe(candidate, fs)) return candidate;
    }
  }
  // The Links entry is usually a symlink shim; accept it only as a regular file.
  const link = join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe');
  return isRegularExe(link, fs) ? link : null;
}

function ffmpegArguments(input, output) {
  return ['-hide_banner', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', output];
}

/** Input duration from ffmpeg's banner: "Duration: 01:02:03.45". */
function parseDuration(stderr) {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/u.exec(typeof stderr === 'string' ? stderr : '');
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 100) / 100 : null;
}

function outputName(input) {
  const base = basename(input, extname(input)).replace(/[\x00-\x1f<>:"/\\|?*]+/gu, ' ').trim().slice(0, 120) || 'call';
  return base + '.mp3';
}

/**
 * Runs ffmpeg without a shell. `track(child)` registers the process so the caller can kill it
 * when the requesting window goes away; it returns an untrack function.
 */
function convertCallAudio(input, options) {
  const spawnFunction = options.spawn || spawn;
  const fs = options.files || { mkdtempSync, readFileSync, rmSync };
  const timeoutMs = options.timeoutMs ?? FFMPEG_TIMEOUT_MS;
  let directory;
  try { directory = fs.mkdtempSync(join(options.tempRoot || tmpdir(), 'smooth-talk-call-')); }
  catch { return Promise.resolve(failure('failed', 'Не удалось подготовить временную папку для аудио.')); }
  const output = join(directory, 'call.mp3');
  const cleanup = () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch { } };
  return new Promise((done) => {
    let stderr = '';
    let settled = false;
    let child;
    let untrack = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      untrack();
      if (!value.ok) cleanup();
      done(value);
    };
    const timer = setTimeout(() => { try { child?.kill(); } catch { } finish(failure('failed', 'Извлечение звука заняло больше 20 минут и остановлено.')); }, timeoutMs);
    try {
      child = spawnFunction(options.ffmpeg, ffmpegArguments(input, output), { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch { finish(failure('unavailable', 'Не удалось запустить ffmpeg. Загружу файл целиком.')); return; }
    untrack = typeof options.track === 'function' ? (options.track(child) || (() => {})) : () => {};
    child.stderr?.on('data', (chunk) => { if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString(); });
    child.once('error', () => finish(failure('unavailable', 'Не удалось запустить ffmpeg. Загружу файл целиком.')));
    child.once('exit', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        finish(failure('failed', signal ? 'Извлечение звука остановлено.' : 'ffmpeg не смог прочитать звук из этого файла.'));
        return;
      }
      try {
        const data = fs.readFileSync(output);
        if (!data.length) { finish(failure('failed', 'В файле не нашлось звуковой дорожки.')); return; }
        cleanup();
        finish({ ok: true, data, name: outputName(input), mime: 'audio/mpeg', bytes: data.length, durationSeconds: parseDuration(stderr) });
      } catch { finish(failure('failed', 'Не удалось прочитать подготовленное аудио.')); }
    });
  });
}

/** Full bridge operation for one renderer request. Never throws. */
async function prepareCallAudio(pathValue, options = {}) {
  const checked = validateCallMediaPath(pathValue, options.fs);
  if (!checked.ok) return checked;
  let ffmpeg;
  try { ffmpeg = await (options.findFfmpeg || findFfmpeg)(options); } catch { ffmpeg = null; }
  if (!ffmpeg) return failure('unavailable', 'На компьютере не найден ffmpeg. Загружу файл целиком.');
  try { return await convertCallAudio(checked.path, { ...options, ffmpeg }); }
  catch { return failure('failed', 'Не удалось подготовить аудио созвона.'); }
}

module.exports = {
  MAX_CALL_MEDIA_BYTES, FFMPEG_TIMEOUT_MS, CALL_MEDIA_EXTENSIONS,
  validateCallMediaPath, findFfmpeg, ffmpegArguments, parseDuration, outputName, convertCallAudio, prepareCallAudio,
};
