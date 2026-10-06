import { randomUUID } from 'node:crypto';
import { openAiAudioKey, reserveAudioBudget } from '../audio';
import { FILE_TRANSCRIPTION_MODEL, TRANSCRIPTION_MINUTE_USD } from '../audio-transcription';
import { connection, transaction } from '../db';
import { ApiError } from '../security';
import { addAudioUsage } from '../store';
import { LISTEN_MAX_SECONDS, type ListenClip, type ListenSource, type PhraseOrigin } from '../../phrases/types';
import { enqueueListenAnalysis } from './listen-queue';
import { LISTEN_TRANSCRIPT_LIMIT } from './listen-prompt';
import { LISTEN_CLIP_ID, LISTEN_RETENTION_DAYS, type StoredClip, countClipsCreatedSince, deleteClipsCreatedBefore, presentClip, readClip,
  writeClip } from './listen-repository';
import { clipText } from './prompt';
import { PHRASE_DAILY_LIMIT_MESSAGE, PHRASE_ORIGINS, moscowDayStart } from './service';

/**
 * «Послушать» on the server (PASS-0.5.4 §1.2): the clip is transcribed inside the request (the audio stays in memory and is never
 * written anywhere), stored as 'analyzing' and explained by Sol in the background (listen-queue.ts). Errors are short and Russian.
 */
export const LISTEN_DAILY_LIMIT = 60;
export const LISTEN_MIN_BYTES = 2 * 1024;
export const LISTEN_MAX_BYTES = 25 * 1024 * 1024;
export const LISTEN_SOURCES: readonly ListenSource[] = ['system', 'microphone'];
export const LISTEN_NOT_FOUND = 'Запись не найдена.';
export const LISTEN_BAD_UPLOAD = 'Проверь запись.';
export const LISTEN_TOO_LARGE = 'Запись слишком большая: до 25 МБ.';
export const LISTEN_NOTHING_HEARD = 'Не расслышал речи. Сделай звук громче и попробуй ещё раз.';
const AUDIO_KEY_MISSING = 'Добавь OpenAI API-ключ в настройках, чтобы включить голос.';
const DAY = 86_400_000;

/** Media he listened to, not his own speech: not the learner verbatim prompt (no fillers or mistakes to preserve). */
export const LISTEN_TRANSCRIPTION_PROMPT = 'A short clip from a video, podcast or conversation, usually in English, sometimes in Russian. '
  + 'Transcribe exactly what is said. Keep slang, informal and reduced forms (gonna, wanna, kinda) as spoken. '
  + 'Do not add, correct, translate or summarise words. Unclear words must not be guessed.';

/** Speech-to-text for one clip; returns the raw text ('' when nothing was heard). Throws ApiError with a Russian message. */
export type ListenTranscriber = (audio: Blob, fileName: string) => Promise<string>;
const globals = globalThis as typeof globalThis & { smoothListenTranscriber?: ListenTranscriber | null };
/** Tests replace OpenAI; pass null to restore the default transcriber. */
export function setListenTranscriber(transcriber: ListenTranscriber | null): void { globals.smoothListenTranscriber = transcriber; }

async function openAiTranscriber(audio: Blob, fileName: string): Promise<string> {
  const apiKey = openAiAudioKey();
  if (!apiKey) throw new ApiError(AUDIO_KEY_MISSING, 412);
  const form = new FormData();
  form.set('file', audio, fileName);
  form.set('model', FILE_TRANSCRIPTION_MODEL);
  form.append('languages[]', 'en'); form.append('languages[]', 'ru');
  form.set('prompt', LISTEN_TRANSCRIPTION_PROMPT);
  form.set('response_format', 'json');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
      body: form, signal: AbortSignal.timeout(65_000) });
  } catch { throw new ApiError('Нет связи с голосовым API. Попробуй ещё раз.', 502); }
  // Never echo provider payloads, keys or what was heard into logs or errors.
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ApiError(response.status === 401 ? 'OpenAI не принял ключ. Проверь его в настройках.' :
      response.status === 429 ? 'Голосовой API временно ограничил запросы. Повтори позже.' :
      `Голосовой API недоступен (${response.status}). Попробуй ещё раз.`, 502);
  }
  let value: { text?: unknown } | null;
  try { value = await response.json() as { text?: unknown } | null; } catch { value = null; }
  if (typeof value?.text !== 'string') throw new ApiError('Голосовой API вернул некорректный ответ. Попробуй ещё раз.', 502);
  return value.text;
}

export interface ListenUpload { audio: Blob; fileName: string; seconds: number; origin: PhraseOrigin; source: ListenSource }

/** The audio formats the transcription accepts, by MIME subtype or file extension. */
const AUDIO_EXTENSIONS: Record<string, string> = { webm: 'webm', weba: 'webm', ogg: 'ogg', oga: 'ogg', opus: 'ogg', wav: 'wav', wave: 'wav',
  'vnd.wave': 'wav', mp3: 'mp3', mpeg: 'mp3', mpga: 'mp3', m4a: 'm4a', mp4: 'mp4' };
function audioExtension(audio: Blob): string | null {
  const type = audio.type.toLowerCase().split(';')[0].trim();
  const subtype = /^(?:audio|video)\/(?:x-)?([a-z0-9.+-]+)$/u.exec(type)?.[1];
  if (subtype) return AUDIO_EXTENSIONS[subtype] ?? null;
  // No usable type (some clients send none or octet-stream): the file name decides.
  if (type && type !== 'application/octet-stream') return null;
  const name = typeof (audio as { name?: unknown }).name === 'string' ? (audio as File).name : '';
  const extension = /\.([a-z0-9]+)$/iu.exec(name)?.[1].toLowerCase();
  return extension ? AUDIO_EXTENSIONS[extension] ?? null : null;
}

/** §1.2: an audio file of 2 KB–25 MB in a known format, 1–180 s (rounded), a known origin and source. */
export function validListenUpload(input: { audio: unknown; seconds: unknown; origin: unknown; source: unknown }): ListenUpload {
  const bad = () => new ApiError(LISTEN_BAD_UPLOAD, 400);
  const audio = input.audio;
  if (!(audio instanceof Blob)) throw bad();
  if (audio.size > LISTEN_MAX_BYTES) throw new ApiError(LISTEN_TOO_LARGE, 413);
  if (audio.size < LISTEN_MIN_BYTES) throw bad();
  const extension = audioExtension(audio);
  if (!extension) throw bad();
  const raw = typeof input.seconds === 'number' ? input.seconds
    : typeof input.seconds === 'string' && input.seconds.trim() ? Number(input.seconds) : Number.NaN;
  const seconds = Math.round(raw);
  if (!Number.isFinite(raw) || seconds < 1 || seconds > LISTEN_MAX_SECONDS) throw bad();
  if (typeof input.origin !== 'string' || !(PHRASE_ORIGINS as readonly string[]).includes(input.origin)) throw bad();
  if (typeof input.source !== 'string' || !(LISTEN_SOURCES as readonly string[]).includes(input.source)) throw bad();
  return { audio, fileName: `clip.${extension}`, seconds, origin: input.origin as PhraseOrigin, source: input.source as ListenSource };
}

/** Whitespace collapsed, at most 4000 characters (cut at a word boundary); '' when nothing was heard. */
export function cleanTranscript(text: unknown): string {
  return typeof text === 'string' ? clipText(text, LISTEN_TRANSCRIPT_LIMIT) ?? '' : '';
}

/** Budget reserved for the clip's minutes during the call and released after it; the usage is logged once OpenAI answered. */
async function transcribeClip(upload: ListenUpload): Promise<string> {
  const minutes = upload.seconds / 60;
  const cost = minutes * TRANSCRIPTION_MINUTE_USD;
  const release = reserveAudioBudget(cost);
  try {
    let text: string;
    try { text = await (globals.smoothListenTranscriber ?? openAiTranscriber)(upload.audio, upload.fileName); }
    catch (error) { throw error instanceof ApiError ? error : new ApiError('Не получилось расшифровать запись. Попробуй ещё раз.', 502); }
    // Billed even when nothing was heard.
    addAudioUsage('transcription', minutes, cost);
    return text;
  } finally { release(); }
}

/**
 * POST /api/phrases/listen: validate, check the daily cap (60 clips per Moscow day) and the key before anything is paid for,
 * transcribe, store the clip as 'analyzing' (clips older than 30 days go at the same time) and queue the Sol analysis. Nothing
 * is stored when nothing was heard (422).
 */
export async function createListenClip(input: { audio: unknown; seconds: unknown; origin: unknown; source: unknown }, now = Date.now()): Promise<ListenClip> {
  const upload = validListenUpload(input);
  const { db } = connection();
  if (countClipsCreatedSince(db, moscowDayStart(now)) >= LISTEN_DAILY_LIMIT) throw new ApiError(PHRASE_DAILY_LIMIT_MESSAGE, 429);
  if (!openAiAudioKey()) throw new ApiError(AUDIO_KEY_MISSING, 412);
  const transcript = cleanTranscript(await transcribeClip(upload));
  if (!transcript) throw new ApiError(LISTEN_NOTHING_HEARD, 422);
  const at = new Date(now).toISOString();
  const stored: StoredClip = { id: randomUUID(), createdAt: at, updatedAt: at, origin: upload.origin, source: upload.source, seconds: upload.seconds,
    transcript, status: 'analyzing', gist: null, points: [], note: null, phraseRefs: [], job: { attempts: 0, lastAttemptAt: null, token: null } };
  const clip = transaction(db, () => {
    deleteClipsCreatedBefore(db, new Date(now - LISTEN_RETENTION_DAYS * DAY).toISOString());
    writeClip(db, stored);
    return presentClip(db, stored);
  });
  // After the commit: the queue opens its own transactions.
  enqueueListenAnalysis(stored.id);
  return clip;
}

export function getListenClip(id: string): ListenClip {
  const { db } = connection();
  const stored = LISTEN_CLIP_ID.test(id) ? readClip(db, id) : null;
  if (!stored) throw new ApiError(LISTEN_NOT_FOUND, 404);
  return presentClip(db, stored);
}
