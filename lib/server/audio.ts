import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from './security';
import { addAudioUsage, getAppState } from './store';
import { FILE_TRANSCRIPTION_MODEL, LIVE_TRANSCRIPTION_MODEL, MAX_RECORDING_MINUTES, TRANSCRIPTION_MINUTE_USD, LIVE_TRANSCRIPTION_MINUTE_USD, VERBATIM_TRANSCRIPTION_PROMPT, liveTranscriptionConfiguration } from './audio-transcription';
import { bindRecordingTranscript, deleteRecordingTiming, measureSavedRecording } from './speech-timing';

// TRAINING_DATA_DIR isolates previews/tests from the real key and recordings (production leaves it unset).
const dataDir = process.env.TRAINING_DATA_DIR ? resolve(process.env.TRAINING_DATA_DIR) : resolve(process.cwd(), '.data');
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
const audioGlobals = globalThis as typeof globalThis & {
  trainingAudioReserved?: number;
  trainingLiveReservations?: Map<string, { release: () => void; expiresAt: number }>;
};
function clearExpiredLiveReservations() {
  for (const [id, entry] of audioGlobals.trainingLiveReservations || []) {
    if (entry.expiresAt > Date.now()) continue;
    // An abandoned live connection may have incurred usage. Count its upper
    // bound as an estimate rather than silently allowing it to bypass budget.
    addAudioUsage('transcription', MAX_RECORDING_MINUTES, MAX_RECORDING_MINUTES * LIVE_TRANSCRIPTION_MINUTE_USD);
    entry.release();
    audioGlobals.trainingLiveReservations!.delete(id);
  }
}
/** Server-side OpenAI audio key (env first, then the key saved from Settings). Never send it to clients. */
export function openAiAudioKey(): string { return key(); }
/** Reserve part of the monthly audio budget for an in-flight request. Call the returned release() in finally. */
export function reserveAudioBudget(estimatedUsd: number): () => void { return reserveBudget(estimatedUsd); }
function reserveBudget(reserve: number) {
  clearExpiredLiveReservations();
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
    if (only ? only.includes(file) : Date.now() - statSync(path).mtimeMs > days * 86400000) { unlinkSync(path); deleteRecordingTiming(file); }
  }
}
export async function createLiveTranscriptionSession() {
  const origin = process.env.TRAINING_PUBLIC_ORIGIN;
  if (!origin || !origin.startsWith('https://')) throw new ApiError('Живые субтитры требуют подключения к серверу по HTTPS.', 412);
  const relayUrl = new URL('/api/audio/live-stream', origin);
  relayUrl.protocol = 'wss:';
  const apiKey = key();
  if (!apiKey) throw new ApiError('Добавь OpenAI API-ключ в настройках, чтобы включить голос.', 412);
  const release = reserveBudget(MAX_RECORDING_MINUTES * LIVE_TRANSCRIPTION_MINUTE_USD);
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session: liveTranscriptionConfiguration() }),
    });
    if (!response.ok) throw new ApiError('Живые субтитры сейчас недоступны. Запись можно расшифровать после остановки.', 502);
    const value = await response.json();
    if (typeof value.value !== 'string' || !Number.isFinite(value.expires_at)) throw new ApiError('Не удалось подключить живые субтитры.', 502);
    const ticket = randomUUID();
    (audioGlobals.trainingLiveReservations ??= new Map()).set(ticket, { release, expiresAt: Date.now() + (MAX_RECORDING_MINUTES + 2) * 60000 });
    // Only a sixty-second, transcription-scoped ephemeral is returned. The
    // persistent API key and the learner access code never leave this server.
    return { clientSecret: value.value, expiresAt: value.expires_at, ticket,
      model: LIVE_TRANSCRIPTION_MODEL, url: relayUrl.toString() };
  } catch (error) { release(); throw error; }
}
export function closeLiveTranscriptionSession(ticket: string, minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_RECORDING_MINUTES) throw new ApiError('Некорректная длительность записи.');
  const entry = audioGlobals.trainingLiveReservations?.get(ticket);
  if (!entry) return;
  if (minutes > 0) addAudioUsage('transcription', minutes, minutes * LIVE_TRANSCRIPTION_MINUTE_USD);
  entry.release();
  audioGlobals.trainingLiveReservations!.delete(ticket);
}
export async function transcribe(file: File, minutes: number, live?: { text: string; final: boolean; ticket?: string; minutes?: number }) {
  if (file.size > 25 * 1024 * 1024 || file.size < 100) throw new ApiError('Нужна запись размером до 25 МБ.');
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10) throw new ApiError('Некорректная длительность записи.');
  if (!audioConfigured()) throw new ApiError('Добавь OpenAI API-ключ в настройках, чтобы включить голос.', 412);
  const reservation = live?.ticket && audioGlobals.trainingLiveReservations?.get(live.ticket);
  if (reservation && live?.ticket) {
    const streamedMinutes = live.minutes === undefined ? minutes : live.minutes;
    if (!Number.isFinite(streamedMinutes) || streamedMinutes < 0 || streamedMinutes > MAX_RECORDING_MINUTES) throw new ApiError('Некорректная длительность живой записи.');
    if (streamedMinutes > 0) addAudioUsage('transcription', streamedMinutes, streamedMinutes * LIVE_TRANSCRIPTION_MINUTE_USD);
    reservation.release();
    audioGlobals.trainingLiveReservations!.delete(live.ticket);
  }
  const useLiveFinal = !!reservation && live?.final === true && typeof live.text === 'string' && live.text.trim().length > 0 && live.text.length <= 7000;
  const releaseBudget = reserveBudget(useLiveFinal ? 0 : minutes * TRANSCRIPTION_MINUTE_USD);
  try {
  const type = file.type.toLowerCase();
  const ext = type.includes('mpeg') || type.includes('mp3') ? 'mp3' :
    type.includes('mp4') || type.includes('m4a') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  const audioFile = saveAudio(new Uint8Array(await file.arrayBuffer()), ext);
  // Offline VAD runs while ASR is in flight. Its failures never invalidate the transcript.
  const measured = measureSavedRecording(audioFile, '', useLiveFinal ? 'live' : 'file');
  async function timing(text: string, source: 'live' | 'file') {
    await measured;
    return bindRecordingTranscript(audioFile, text, source);
  }
  // The completed live transcript is kept verbatim alongside its original WAV;
  // a second recognizer must not silently polish it or drop disfluencies.
  if (useLiveFinal) return { text: live!.text.trim(), audioFile, model: LIVE_TRANSCRIPTION_MODEL, transcriptSource: 'live',
    speechTiming: await timing(live!.text.trim(), 'live') };
  const form = new FormData();
  form.set('file', file, `speech.${ext}`);
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || FILE_TRANSCRIPTION_MODEL;
  form.set('model', model);
  if (model === FILE_TRANSCRIPTION_MODEL) { form.append('languages[]', 'en'); form.append('languages[]', 'ru'); }
  else form.set('language', 'en');
  form.set('prompt', VERBATIM_TRANSCRIPTION_PROMPT);
  form.set('response_format', 'json');
  const response = await audioRequest('transcriptions', { method: 'POST', body: form });
  const result = await response.json();
  if (typeof result.text !== 'string' || !result.text.trim()) throw new ApiError('Речь не распознана. Попробуй ещё раз.');
  addAudioUsage('transcription', minutes, minutes * (model === FILE_TRANSCRIPTION_MODEL ? TRANSCRIPTION_MINUTE_USD : 0.006));
  return { text: result.text.trim(), audioFile, model, transcriptSource: 'file', speechTiming: await timing(result.text.trim(), 'file') };
  } finally { releaseBudget(); }
}
export async function synthesize(text: string, options: { voice?: string; instructions?: string } = {}) {
  return saveAudio(await synthesizeSpeech(text, options), 'mp3');
}

/** The practice partner always speaks with a male voice (Ratmir's choice, 07.10.2026). */
export const PARTNER_VOICE = 'cedar';

/** TTS bytes (mp3) with an optional voice and delivery instruction; budget-checked and logged. */
export async function synthesizeSpeech(text: string, options: { voice?: string; instructions?: string } = {}): Promise<Uint8Array> {
  if (!text.trim() || text.length > 4096) throw new ApiError('Реплика слишком длинная для озвучки.');
  const estimatedCost = text.length * 0.00003; // conservative estimate, clearly labelled in UI
  if (!audioConfigured()) throw new ApiError('Добавь OpenAI API-ключ в настройках, чтобы включить голос.', 412);
  const releaseBudget = reserveBudget(estimatedCost);
  try {
    const response = await audioRequest('speech', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: options.voice || process.env.OPENAI_VOICE || PARTNER_VOICE, input: text, response_format: 'mp3',
        instructions: options.instructions || 'Speak in natural conversational English. Clear, relaxed pace, adult conversation. Do not add words.' }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    addAudioUsage('speech', text.length, estimatedCost);
    return bytes;
  } finally { releaseBudget(); }
}
