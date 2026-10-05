import { z } from 'zod';
import type { CallSegment } from '../../calls/types';
import { FILE_TRANSCRIPTION_MODEL, VERBATIM_TRANSCRIPTION_PROMPT } from '../audio-transcription';
import { CallStepError } from './errors';

/**
 * OpenAI transcription for uploaded calls:
 * - gpt-4o-transcribe-diarize (diarized_json, chunking_strategy=auto) per ≤10-minute chunk, with known-speaker references
 *   so labels stay consistent across chunks ('me' = the learner when his voice sample or an in-call clip is supplied);
 * - a verbatim pass over the learner's own lines with the file model and the verbatim prompt (fillers and errors kept).
 * Errors never include provider payloads, keys or audio content.
 */
export const DIARIZE_MODEL = 'gpt-4o-transcribe-diarize';
export const DIARIZE_MINUTE_USD = 0.006;
const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
export const MAX_REFERENCES = 4;

export interface SpeakerReference { name: string; audio: Uint8Array; mime: string }
export interface DiarizeRequest { audio: Uint8Array; fileName: string; references: SpeakerReference[] }
export interface DiarizedSegment { speaker: string; start: number; end: number; text: string }
export interface DiarizeResult { segments: DiarizedSegment[]; duration: number | null }
export interface VerbatimRequest { audio: Uint8Array; fileName: string }
export interface ProviderOptions { fetch?: typeof fetch; apiKey: string; timeoutMs?: number }

function blob(bytes: Uint8Array, type: string): Blob { return new Blob([Uint8Array.from(bytes)], { type }); }
export function dataUrl(reference: SpeakerReference): string { return `data:${reference.mime};base64,${Buffer.from(reference.audio).toString('base64')}`; }

export function providerError(status: number): CallStepError {
  if (status === 401) return new CallStepError('OpenAI не принял API-ключ для расшифровки. Проверь ключ в настройках, попытка повторится.', true);
  if (status === 429) return new CallStepError('OpenAI временно ограничил запросы на расшифровку. Повторю позже.', true);
  if (status >= 500) return new CallStepError(`Сервис расшифровки OpenAI недоступен (код ${status}). Повторю позже.`, true);
  if (status === 413) return new CallStepError('OpenAI отклонил часть записи как слишком большую.', false);
  return new CallStepError(`OpenAI не принял запись для расшифровки (код ${status}).`, false);
}

async function post(form: FormData, options: ProviderOptions): Promise<unknown> {
  if (!options.apiKey) throw new CallStepError('Добавь OpenAI API-ключ в настройках: без него запись созвона не расшифровать.', false);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}` }, body: form,
      signal: AbortSignal.timeout(options.timeoutMs ?? 300_000) });
  } catch {
    throw new CallStepError('Нет связи с OpenAI для расшифровки. Повторю позже.', true);
  }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw providerError(response.status); }
  try { return await response.json(); } catch { throw new CallStepError('OpenAI вернул некорректный ответ расшифровки. Повторю позже.', true); }
}

const diarizedSchema = z.object({
  duration: z.number().nullish(),
  segments: z.array(z.object({
    speaker: z.string().max(80).nullish(),
    start: z.number(),
    end: z.number(),
    text: z.string(),
  })).max(20_000),
});

export async function transcribeDiarized(request: DiarizeRequest, options: ProviderOptions): Promise<DiarizeResult> {
  const form = new FormData();
  form.set('model', DIARIZE_MODEL);
  form.set('file', blob(request.audio, 'audio/mpeg'), request.fileName);
  form.set('response_format', 'diarized_json');
  form.set('chunking_strategy', 'auto');
  for (const reference of request.references.slice(0, MAX_REFERENCES)) {
    form.append('known_speaker_names[]', reference.name);
    form.append('known_speaker_references[]', dataUrl(reference));
  }
  const parsed = diarizedSchema.safeParse(await post(form, options));
  if (!parsed.success) throw new CallStepError('OpenAI вернул расшифровку в неожиданном формате. Повторю позже.', true);
  const segments = parsed.data.segments
    .map(segment => ({ speaker: (segment.speaker ?? 'unknown').trim() || 'unknown', start: Math.max(0, segment.start),
      end: Math.max(segment.start, segment.end), text: segment.text.replace(/\s+/g, ' ').trim() }))
    .filter(segment => segment.text && Number.isFinite(segment.start) && Number.isFinite(segment.end));
  return { segments, duration: parsed.data.duration ?? null };
}

export async function transcribeVerbatim(request: VerbatimRequest, options: ProviderOptions): Promise<string> {
  const form = new FormData();
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || FILE_TRANSCRIPTION_MODEL;
  form.set('model', model);
  form.set('file', blob(request.audio, 'audio/mpeg'), request.fileName);
  if (model === FILE_TRANSCRIPTION_MODEL) { form.append('languages[]', 'en'); form.append('languages[]', 'ru'); }
  else form.set('language', 'en');
  form.set('prompt', VERBATIM_TRANSCRIPTION_PROMPT);
  form.set('response_format', 'json');
  const value = await post(form, options) as { text?: unknown };
  if (typeof value?.text !== 'string') throw new CallStepError('OpenAI вернул некорректную дословную расшифровку.', true);
  return value.text.replace(/\s+/g, ' ').trim();
}

// ---------- speakers across chunks ----------

export interface MappedSegment { speaker: string; start: number; end: number; text: string }
interface StoredReference { id: string; name: string; audio: Uint8Array; mime: string; origin: 'sample' | 'call' }

/** The one clean clip (2–8 s, preferring 4–8 s, no other speaker within 0.3 s) that best represents a speaker. */
export function pickClip(segments: MappedSegment[], id: string, minimum = 2, maximum = 8, margin = 0.3): { start: number; duration: number } | null {
  const others = segments.filter(segment => segment.speaker !== id);
  const clean = segments.filter(segment => segment.speaker === id && segment.end - segment.start >= minimum
    && !others.some(other => other.start < segment.end + margin && other.end > segment.start - margin));
  if (!clean.length) return null;
  const best = clean.reduce((left, right) => Math.min(right.end - right.start, maximum) > Math.min(left.end - left.start, maximum) ? right : left);
  const length = Math.min(best.end - best.start, maximum);
  const start = best.start + Math.max(0, (best.end - best.start - length) / 2);
  return { start: Math.round(start * 1000) / 1000, duration: Math.round(length * 1000) / 1000 };
}

/**
 * Keeps speaker ids stable across chunks: 'me' for the learner, 'A', 'B', … for others in order of appearance.
 * Chunk 1 gets only the learner's practice voice sample (if any); afterwards clean clips from the call itself become
 * known-speaker references (max 4) named 'me' / 'known_a' …, so later chunks return the same people under those names.
 */
export class SpeakerRegistry {
  private readonly refs: StoredReference[] = [];
  private readonly collected: MappedSegment[] = [];
  private letters = 0;

  constructor(learnerSample?: { audio: Uint8Array; mime: string } | null) {
    if (learnerSample) this.refs.push({ id: 'me', name: 'me', audio: learnerSample.audio, mime: learnerSample.mime, origin: 'sample' });
  }

  static nameFor(id: string): string { return id === 'me' ? 'me' : `known_${id.toLowerCase()}`; }

  references(): SpeakerReference[] { return this.refs.map(({ name, audio, mime }) => ({ name, audio, mime })); }
  referenceNames(): string[] { return this.refs.map(reference => reference.name); }
  hasLearnerReference(): boolean { return this.refs.some(reference => reference.id === 'me'); }

  private allocate(): string {
    const index = this.letters++;
    return index < 26 ? String.fromCharCode(65 + index) : `S${index + 1}`;
  }

  /** Map one chunk's provider labels to stable ids. `usedNames` are the reference names sent with that chunk. */
  ingest(offset: number, segments: DiarizedSegment[], usedNames: string[]): MappedSegment[] {
    const known = new Map<string, string>();
    for (const name of usedNames) {
      const reference = this.refs.find(item => item.name === name);
      known.set(name.toLowerCase(), reference?.id ?? (name === 'me' ? 'me' : name.replace(/^known_/, '').toUpperCase()));
    }
    const local = new Map<string, string>();
    const mapped: MappedSegment[] = [];
    for (const segment of segments) {
      const label = segment.speaker.trim().toLowerCase();
      let id = known.get(label) ?? local.get(label);
      if (!id) { id = this.allocate(); local.set(label, id); }
      mapped.push({ speaker: id, start: segment.start, end: segment.end, text: segment.text });
      this.collected.push({ speaker: id, start: segment.start + offset, end: segment.end + offset, text: segment.text });
    }
    return mapped;
  }

  /** Clips to cut from the current chunk: replace the practice sample with an in-call clip, then add new speakers while slots remain. */
  wantedClips(mapped: MappedSegment[]): { id: string; start: number; duration: number }[] {
    const talk = new Map<string, number>();
    for (const segment of mapped) talk.set(segment.speaker, (talk.get(segment.speaker) ?? 0) + segment.end - segment.start);
    const ordered = [...talk.keys()].sort((left, right) => Number(right === 'me') - Number(left === 'me') || talk.get(right)! - talk.get(left)!);
    const wanted: { id: string; start: number; duration: number }[] = [];
    let slots = MAX_REFERENCES - this.refs.length;
    for (const id of ordered) {
      const existing = this.refs.find(reference => reference.id === id);
      if (existing?.origin === 'call') continue;
      if (!existing && slots <= 0) continue;
      const clip = pickClip(mapped, id);
      if (!clip) continue;
      wanted.push({ id, ...clip });
      if (!existing) slots--;
    }
    return wanted;
  }

  addReference(id: string, audio: Uint8Array, mime: string): void {
    const existing = this.refs.findIndex(reference => reference.id === id);
    const value: StoredReference = { id, name: SpeakerRegistry.nameFor(id), audio, mime, origin: 'call' };
    if (existing >= 0) this.refs[existing] = value;
    else if (this.refs.length < MAX_REFERENCES) this.refs.push(value);
  }

  /** All chunks merged in time order; consecutive lines of one speaker (gap ≤ 1 s, ≤ 60 s total) become one segment. */
  merged(): CallSegment[] {
    const sorted = [...this.collected].sort((left, right) => left.start - right.start || left.end - right.end);
    const merged: MappedSegment[] = [];
    for (const segment of sorted) {
      const last = merged.at(-1);
      if (last && last.speaker === segment.speaker && segment.start - last.end <= 1 && segment.end - last.start <= 60) {
        last.end = Math.max(last.end, segment.end);
        last.text = `${last.text} ${segment.text}`;
      } else merged.push({ ...segment });
    }
    return merged.map((segment, index) => ({ id: `s${index}`, speaker: segment.speaker,
      start: Math.round(segment.start * 100) / 100, end: Math.round(segment.end * 100) / 100, text: segment.text }));
  }
}
