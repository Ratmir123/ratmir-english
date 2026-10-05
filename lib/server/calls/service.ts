import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CALL_AUDIO_EXTENSIONS, CALL_TRANSCRIPT_EXTENSIONS, MAX_CALL_UPLOAD_BYTES, type CallContext, type CallDetail, type CallSegment,
  type CommunicationPattern, type ConfirmSpeakersRequest, type CreateCallRequest, type FactDecisionRequest, type PatternUpdateRequest,
  type ProfileFact, type SegmentDisputeRequest, type UpdateCallRequest } from '../../calls/types';
import { MAX_TRANSCRIPT_LINES, parseTranscript } from '../../calls/transcript';
import { connection, transaction } from '../db';
import { ApiError } from '../security';
import { buildSpeakers, computeMetrics } from './metrics';
import { type CallRecord, CALL_ID, callDate, callDirectory, decideFact, deleteCallRows, enqueueJob, ensureCallDirectory, fileSize, nowIso,
  readCall, readDrills, readFacts, readTranscript, removeCallFiles, setCallEventsDate, touch, updatePatternFlags, writeCall, writeCallText,
  writeTranscript } from './repository';
import { listPatterns, listProfileFacts, presentDrills, summarise } from './state';
import { sortDrills } from './lifecycle';

/** Call operations shared by the HTTP routes and scripts/import-calls.ts. Errors are Russian ApiErrors with HTTP statuses. */
export const MAX_TRANSCRIPT_BYTES = 400_000;
export const MAX_DEBRIEF_BYTES = 200_000;
export const MAX_NOTES_CHARS = 20_000;
const BUSY: CallRecord['status'][] = ['awaiting-upload', 'queued', 'processing'];
const QUEUED = { stage: 'В очереди', percent: 0 };

function bytes(text: string): number { return Buffer.byteLength(text, 'utf8'); }
function cleanLine(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
function cleanNotes(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length > MAX_NOTES_CHARS) throw new ApiError(`Заметки длиннее ${MAX_NOTES_CHARS} символов. Сократи их.`, 413);
  return text || null;
}

/** ISO date-time, or a calendar date kept at noon UTC so it shows the same day in every time zone. */
export function normaliseOccurredAt(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T12:00:00.000Z`) : Date.parse(text);
  if (!Number.isFinite(parsed)) throw new ApiError('Не удалось прочитать дату созвона.', 400);
  const year = new Date(parsed).getUTCFullYear();
  if (year < 2000 || year > 2100) throw new ApiError('Проверь дату созвона.', 400);
  return new Date(parsed).toISOString();
}

function extension(fileName: string): string { return basename(fileName).toLowerCase().split('.').at(-1) ?? ''; }

const LEARNER_LABELS = new Set(['me', 'i', 'я', 'ты', 'learner', 'myself']);
export function isLearnerLabel(label: string, profileName: string): boolean {
  const value = label.trim().toLowerCase();
  if (LEARNER_LABELS.has(value)) return true;
  const name = profileName.trim().toLowerCase().split(/\s+/)[0];
  return !!name && !LEARNER_LABELS.has(name) && value.split(/\s+/)[0] === name;
}

function baseRecord(input: CreateCallRequest, now: number): CallRecord {
  const counterpart = cleanLine(input.counterpart, 160);
  const title = cleanLine(input.title, 160) ?? (counterpart ? `Созвон с ${counterpart}`.slice(0, 160)
    : input.source.type === 'memory' ? 'Созвон по памяти' : 'Созвон');
  return {
    version: 1, id: randomUUID(), title, counterpart, context: (input.context ?? 'work') as CallContext, occurredAt: normaliseOccurredAt(input.occurredAt),
    createdAt: nowIso(now), updatedAt: nowIso(now), source: input.source.type, status: 'queued', progress: QUEUED, error: null,
    notes: cleanNotes(input.notes), upload: null, transcriptFormat: null, hasReference: false, durationSeconds: null, speakers: [],
    metrics: null, review: null, hits: [], attribution: null, audio: null, verbatimFor: null, revision: 0, failedStage: null, firstReviewedAt: null,
  };
}

/** Create a call: audio waits for chunked upload; transcripts, debriefs and recollections are queued for analysis at once. */
export function createCall(input: CreateCallRequest, profileName: string, now = Date.now()): CallRecord {
  const record = baseRecord(input, now);
  const source = input.source;
  let segments: CallSegment[] | null = null;
  if (source.type === 'audio') {
    const fileName = basename(source.fileName.trim()).slice(0, 255);
    const ext = extension(fileName);
    if (!(CALL_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ApiError(`Этот формат не подходит. Загрузи аудио или видео: ${CALL_AUDIO_EXTENSIONS.join(', ')}.`, 400);
    }
    if (!Number.isSafeInteger(source.bytes) || source.bytes < 1) throw new ApiError('Файл пустой.', 400);
    if (source.bytes > MAX_CALL_UPLOAD_BYTES) throw new ApiError('Файл больше 2 ГБ. Сохрани запись только со звуком или обрежь её.', 413);
    record.upload = { fileName, extension: ext, mime: (source.mime ?? '').slice(0, 200), bytes: source.bytes, received: 0, completedAt: null };
    record.status = 'awaiting-upload';
    record.progress = null;
    ensureCallDirectory(record.id);
  } else if (source.type === 'transcript') {
    if (source.fileName && !(CALL_TRANSCRIPT_EXTENSIONS as readonly string[]).includes(extension(source.fileName))) {
      throw new ApiError(`Расшифровка должна быть текстом: ${CALL_TRANSCRIPT_EXTENSIONS.join(', ')}.`, 400);
    }
    if (bytes(source.text) > MAX_TRANSCRIPT_BYTES) throw new ApiError('Расшифровка больше 400 КБ. Загрузи часть созвона.', 413);
    if (source.referenceDebrief && bytes(source.referenceDebrief) > MAX_DEBRIEF_BYTES) throw new ApiError('Разбор для сверки больше 200 КБ.', 413);
    const parsed = parseTranscript(source.text);
    if (parsed.lines.length < 2) throw new ApiError('Не удалось прочитать расшифровку: нужно хотя бы две реплики.', 400);
    if (parsed.lines.length > MAX_TRANSCRIPT_LINES) throw new ApiError('В расшифровке слишком много строк. Загрузи часть созвона.', 413);
    const ids = new Map(parsed.speakers.map((label, index) => [label, index < 26 ? String.fromCharCode(65 + index) : `S${index + 1}`]));
    segments = parsed.lines.map((line, index) => ({ id: `s${index}`, speaker: line.speaker ? ids.get(line.speaker) ?? null : null,
      start: line.start, end: line.end, text: line.text }));
    record.transcriptFormat = parsed.format;
    const last = parsed.lines.at(-1)!;
    record.durationSeconds = parsed.timed ? Math.round((last.end ?? last.start ?? 0) * 10) / 10 : null;
    if (parsed.speakers.length) {
      const me = parsed.speakers.filter(label => isLearnerLabel(label, profileName));
      const meIds = new Set(me.length === 1 ? [ids.get(me[0])!] : []);
      record.speakers = buildSpeakers(segments, { counterpart: record.counterpart, meIds,
        labels: Object.fromEntries([...ids].map(([label, id]) => [id, meIds.has(id) ? 'Ты' : label])) });
      if (meIds.size) { record.attribution = 'labels'; record.metrics = computeMetrics(segments, record.speakers); }
      else { record.status = 'needs-speaker'; record.progress = null; }
    }
    record.hasReference = !!source.referenceDebrief?.trim();
  } else {
    const text = source.text.trim();
    if (bytes(text) > MAX_DEBRIEF_BYTES) throw new ApiError('Текст больше 200 КБ. Сократи его.', 413);
    if (text.length < (source.type === 'memory' ? 40 : 200)) {
      throw new ApiError(source.type === 'memory' ? 'Опиши звонок подробнее: кто был, о чём договорились, что пошло не так.'
        : 'Разбор слишком короткий для импорта.', 400);
    }
  }
  // Files first: a row never points to missing source text.
  if (source.type === 'transcript') {
    writeCallText(record.id, 'source.txt', source.text);
    writeTranscript(record.id, segments!);
    if (record.hasReference) writeCallText(record.id, 'reference.md', source.referenceDebrief!.trim());
  } else if (source.type === 'debrief') writeCallText(record.id, 'debrief.md', source.text.trim());
  else if (source.type === 'memory') writeCallText(record.id, 'source.txt', source.text.trim());
  const { db } = connection();
  transaction(db, () => {
    writeCall(db, record);
    if (record.status === 'queued') enqueueJob(db, record.id, 'analyse', now);
  });
  return record;
}

function requireCall(id: string): CallRecord {
  if (!CALL_ID.test(id)) throw new ApiError('Созвон не найден.', 404);
  const record = readCall(connection().db, id);
  if (!record) throw new ApiError('Созвон не найден.', 404);
  return record;
}

/** Transactional change with the shared not-found handling. */
function change(id: string, mutate: (record: CallRecord) => void, now = Date.now()): CallRecord {
  requireCall(id);
  const { db } = connection();
  return transaction(db, () => {
    const record = readCall(db, id);
    if (!record) throw new ApiError('Созвон не найден.', 404);
    mutate(record);
    touch(record, now);
    writeCall(db, record);
    return record;
  });
}

export function callDetail(id: string): CallDetail {
  const record = requireCall(id);
  const { db } = connection();
  const drills = presentDrills(db, readDrills(db, id));
  const audioReady = !!record.audio && existsSync(join(callDirectory(id), 'audio.mp3'));
  return {
    ...summarise(record, drills), notes: record.notes, speakers: record.speakers,
    segments: record.source === 'audio' || record.source === 'transcript' ? readTranscript(id) : [],
    metrics: record.metrics, review: record.review, facts: readFacts(db, { callId: id }), drills: sortDrills(drills),
    audioUrl: audioReady ? `calls/${id}/audio` : null, audioExpiresAt: audioReady ? record.audio!.expiresAt : null,
  };
}

export function completeUpload(id: string, now = Date.now()): CallRecord {
  return change(id, record => {
    if (record.source !== 'audio' || !record.upload) throw new ApiError('У этого созвона нет загрузки файла.', 409);
    if (record.status !== 'awaiting-upload') {
      if (record.upload.completedAt) return;
      throw new ApiError('Загрузка уже завершена.', 409);
    }
    const stored = fileSize(join(callDirectory(id), `original.${record.upload.extension}`));
    if (stored !== record.upload.bytes) throw new ApiError(`Файл загружен не полностью: ${stored} из ${record.upload.bytes} байт.`, 400);
    record.upload.received = stored;
    record.upload.completedAt = nowIso(now);
    record.status = 'queued';
    record.progress = QUEUED;
    enqueueJob(connection().db, id, 'process', now);
  }, now);
}

export function confirmSpeakers(id: string, request: ConfirmSpeakersRequest, now = Date.now()): CallRecord {
  return change(id, record => {
    if (record.source === 'debrief' || record.source === 'memory') throw new ApiError('В этом разборе нет расшифровки с голосами.', 409);
    if (BUSY.includes(record.status)) throw new ApiError('Сначала дождись расшифровки.', 409);
    if (!record.speakers.length) throw new ApiError('Говорящие ещё не определены. Дождись разбора или загрузи расшифровку с именами.', 409);
    if (!record.speakers.some(speaker => speaker.id === request.me)) throw new ApiError('Такого говорящего нет в этом созвоне.', 400);
    // Keep real names (from captions or the learner); generated labels are renumbered for the new line-up.
    const labels: Record<string, string> = {};
    for (const speaker of record.speakers) {
      if (!speaker.isMe && !/^Собеседник( \d+)?$/.test(speaker.label) && speaker.label !== record.counterpart) labels[speaker.id] = speaker.label;
    }
    for (const [key, value] of Object.entries(request.labels ?? {})) {
      const label = cleanLine(value, 60);
      if (label && record.speakers.some(speaker => speaker.id === key)) labels[key] = label;
    }
    delete labels[request.me];
    const segments = readTranscript(id);
    record.speakers = buildSpeakers(segments, { counterpart: record.counterpart, meIds: new Set([request.me]), labels: { ...labels, [request.me]: request.labels?.[request.me]?.trim() || 'Ты' } });
    record.attribution = 'confirmed';
    record.metrics = computeMetrics(segments, record.speakers);
    record.status = 'analysing';
    record.progress = { stage: 'В очереди на разбор', percent: 0 };
    record.error = null;
    record.failedStage = null;
    record.revision++;
    enqueueJob(connection().db, id, 'analyse', now);
  }, now);
}

export function updateDetails(id: string, request: UpdateCallRequest, now = Date.now()): CallRecord {
  return change(id, record => {
    if (request.title !== undefined) record.title = cleanLine(request.title, 160) ?? record.title;
    if (request.counterpart !== undefined) {
      const counterpart = cleanLine(request.counterpart, 160);
      const others = record.speakers.filter(speaker => !speaker.isMe);
      if (others.length === 1 && (others[0].label === record.counterpart || /^Собеседник( 1)?$/.test(others[0].label)) && counterpart) others[0].label = counterpart.slice(0, 80);
      record.counterpart = counterpart;
    }
    if (request.context !== undefined) record.context = request.context;
    if (request.occurredAt !== undefined) {
      record.occurredAt = normaliseOccurredAt(request.occurredAt);
      setCallEventsDate(connection().db, id, callDate(record));
    }
    if (request.notes !== undefined) record.notes = cleanNotes(request.notes);
  }, now);
}

export function retryCall(id: string, now = Date.now()): CallRecord {
  return change(id, record => {
    if (record.status !== 'error') throw new ApiError('Повторить можно только после ошибки.', 409);
    const directory = callDirectory(id);
    const hasTranscript = existsSync(join(directory, 'transcript.json'));
    const stage = record.failedStage ?? (record.source === 'audio' && !hasTranscript ? 'process' : 'analyse');
    if (stage === 'process' && !existsSync(join(directory, 'audio.mp3')) && !(record.upload && existsSync(join(directory, `original.${record.upload.extension}`)))) {
      throw new ApiError('Исходного файла уже нет. Загрузи запись заново.', 409);
    }
    record.status = stage === 'process' ? 'queued' : 'analysing';
    record.progress = QUEUED;
    record.error = null;
    record.failedStage = null;
    record.revision++;
    enqueueJob(connection().db, id, stage, now);
  }, now);
}

export function reanalyseCall(id: string, notes: string | null | undefined, now = Date.now()): CallRecord {
  return change(id, record => {
    if (BUSY.includes(record.status)) throw new ApiError('Созвон ещё обрабатывается.', 409);
    if (record.status === 'needs-speaker') throw new ApiError('Сначала отметь, какой голос твой.', 409);
    if (notes !== undefined) record.notes = cleanNotes(notes);
    record.status = 'analysing';
    record.progress = { stage: 'В очереди на разбор', percent: 0 };
    record.error = null;
    record.failedStage = null;
    record.revision++;
    enqueueJob(connection().db, id, 'analyse', now);
  }, now);
}

/** Removes the call, its files, drills, events and unaccepted facts; patterns are recomputed from what remains. */
export function deleteCall(id: string): void {
  if (!CALL_ID.test(id)) return;
  const { db } = connection();
  transaction(db, () => { deleteCallRows(db, id); });
  removeCallFiles(id);
}

export function disputeSegment(id: string, request: SegmentDisputeRequest, now = Date.now()): CallRecord {
  const record = requireCall(id);
  if (record.source !== 'audio' && record.source !== 'transcript') throw new ApiError('В этом разборе нет расшифровки.', 409);
  if (BUSY.includes(record.status) || record.status === 'analysing') throw new ApiError('Подожди, пока закончится обработка.', 409);
  const segments = readTranscript(id);
  const segment = segments.find(item => item.id === request.segmentId);
  if (!segment) throw new ApiError('Реплика не найдена.', 404);
  if (request.disputed) segment.disputed = true;
  else delete segment.disputed;
  writeTranscript(id, segments);
  return change(id, () => undefined, now);
}

export function updatePattern(id: string, request: PatternUpdateRequest): CommunicationPattern[] {
  const { db } = connection();
  const note = request.note === undefined ? undefined : cleanLine(request.note, 500);
  const updated = transaction(db, () => updatePatternFlags(db, id, { confirm: request.confirm, dismiss: request.dismiss, note }));
  if (!updated) throw new ApiError('Паттерн не найден.', 404);
  return listPatterns(db);
}

export function decideProfileFact(request: FactDecisionRequest): ProfileFact[] {
  const { db } = connection();
  if (!decideFact(db, request.factId, request.decision)) throw new ApiError('Факт не найден.', 404);
  return listProfileFacts(db);
}
