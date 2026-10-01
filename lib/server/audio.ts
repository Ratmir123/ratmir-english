import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './security';
import { addAudioUsage, getAppState } from './store';

const dataDir = resolve(process.cwd(), '.data');
const audioDir = join(dataDir, 'audio');
const keyFile = join(dataDir, 'audio-key.json');
function key() {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  try { return String(JSON.parse(readFileSync(keyFile, 'utf8')).key || ''); } catch { return ''; }
}
export function audioConfigured() { return !!key(); }
export function setAudioKey(value: string) {
  if (value && (!value.startsWith('sk-') || value.length < 20 || value.length > 500)) throw new ApiError('Проверь формат OpenAI API-ключа.');
  mkdirSync(dataDir, { recursive: true });
  if (!value) { if (existsSync(keyFile)) unlinkSync(keyFile); return; }
  writeFileSync(keyFile, JSON.stringify({ key: value }), { mode: 0o600 });
}
const audioGlobals = globalThis as typeof globalThis & { trainingAudioReserved?: number };
function reserveBudget(reserve: number) {
  const usage = getAppState().audioUsage;
  if (usage.usedUsd + (audioGlobals.trainingAudioReserved || 0) + reserve > usage.budgetUsd) throw new ApiError('Достигнут предел бюджета голоса. Можно продолжить текстом.', 402);
  audioGlobals.trainingAudioReserved = (audioGlobals.trainingAudioReserved || 0) + reserve;
  return () => { audioGlobals.trainingAudioReserved = Math.max(0, (audioGlobals.trainingAudioReserved || 0) - reserve); };
}
async function audioRequest(path: string, init: RequestInit) {
  const apiKey = key();
  if (!apiKey) throw new ApiError('Добавь OpenAI API-ключ в настройках, чтобы включить голос.', 412);
  const res = await fetch(`https://api.openai.com/v1/audio/${path}`, {
    ...init, headers: { ...init.headers, Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(65000),
  });
  if (!res.ok) {
    // Never echo provider payloads, keys or recorded content into logs/errors.
    throw new ApiError(res.status === 401 ? 'OpenAI не принял ключ. Проверь его в настройках.' :
      res.status === 429 ? 'Голосовой API временно ограничил запросы. Повтори позже.' :
      `Голосовой API недоступен (${res.status}). Если запрос содержал запись, она сохранена в тренинге.`, 502);
  }
  return res;
}
export function saveAudio(bytes: Uint8Array, extension: string) {
  mkdirSync(audioDir, { recursive: true });
  const file = `${randomUUID()}.${extension}`;
  writeFileSync(join(audioDir, file), bytes, { mode: 0o600 });
  return file;
}
export function getAudio(file: string) {
  if (file !== basename(file) || !/^[a-f0-9-]+\.(webm|mp4|ogg|wav|mp3)$/.test(file)) throw new ApiError('Запись не найдена.', 404);
  const path = join(audioDir, file);
  if (!existsSync(path)) throw new ApiError('Запись удалена или срок хранения истёк.', 404);
  return readFileSync(path);
}
export function cleanAudio(days: number, only?: string[]) {
  if (!existsSync(audioDir)) return;
  for (const file of readdirSync(audioDir)) {
    if (!/^[a-f0-9-]+\.(webm|mp4|ogg|wav|mp3)$/.test(file)) continue;
    const path = join(audioDir, file);
    if (only ? only.includes(file) : Date.now() - statSync(path).mtimeMs > days * 86400000) unlinkSync(path);
  }
}
export async function transcribe(file: File, minutes: number) {
  if (file.size > 20 * 1024 * 1024 || file.size < 100) throw new ApiError('Нужна запись размером до 20 МБ.');
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10) throw new ApiError('Некорректная длительность записи.');
  if (!audioConfigured()) throw new ApiError('Добавь OpenAI API-ключ в настройках, чтобы включить голос.', 412);
  const releaseBudget = reserveBudget(0.07);
  try {
  const ext = file.type.includes('mp4') ? 'mp4' : file.type.includes('ogg') ? 'ogg' : file.type.includes('wav') ? 'wav' : 'webm';
  const audioFile = saveAudio(new Uint8Array(await file.arrayBuffer()), ext);
  const form = new FormData();
  form.set('file', file, `speech.${ext}`);
  form.set('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
  form.set('language', 'en');
  form.set('response_format', 'json');
  const response = await audioRequest('transcriptions', { method: 'POST', body: form });
  const result = await response.json();
  if (typeof result.text !== 'string' || !result.text.trim()) throw new ApiError('Речь не распознана. Попробуй ещё раз.');
  addAudioUsage('transcription', minutes, minutes * 0.006);
  return { text: result.text.trim(), audioFile };
  } finally { releaseBudget(); }
}
export async function synthesize(text: string) {
  if (!text.trim() || text.length > 4096) throw new ApiError('Реплика слишком длинная для озвучки.');
  const estimatedCost = text.length * 0.00003; // conservative estimate, clearly labelled in UI
  if (!audioConfigured()) throw new ApiError('Добавь OpenAI API-ключ в настройках, чтобы включить голос.', 412);
  const releaseBudget = reserveBudget(estimatedCost);
  try {
  const response = await audioRequest('speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_VOICE || 'marin', input: text, response_format: 'mp3',
      instructions: 'Speak in natural conversational English. Clear, relaxed pace, adult conversation. Do not add words.' }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const file = saveAudio(bytes, 'mp3');
  addAudioUsage('speech', text.length, estimatedCost);
  return file;
  } finally { releaseBudget(); }
}
