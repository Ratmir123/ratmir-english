import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppState, Session } from '../../types';
import { CALL_AUDIO_RETENTION_DAYS, type CallSegment, type CallSpeaker } from '../../calls/types';
import { connection, transaction } from '../db';
import { addAudioUsage, getAppState } from '../store';
import { getAudio, openAiAudioKey, reserveAudioBudget } from '../audio';
import { TRANSCRIPTION_MINUTE_USD } from '../audio-transcription';
import { BRAIN_MODEL, codexJson } from '../codex';
import { SiwcError } from '../siwc-protocol';
import { ApiError } from '../security';
import { placementVoiceSamples } from '../placement/state';
import { LANGUAGE_PATTERNS, SEED_PATTERNS } from './catalog';
import { CallCancelled, CallStepError, withRetries } from './errors';
import { derivePattern, practiceByPattern } from './lifecycle';
import { MAX_CALL_SECONDS, createMediaTools, planChunks, type MediaTools } from './media';
import { buildSpeakers, computeMetrics } from './metrics';
import { type CallRecord, type ClaimedJob, JOB_MAX_ATTEMPTS, advanceJob, callDate, callDirectory, callDirectoryNames, callsRoot, claimJob,
  completeJob, deleteCallRows, ensureCallDirectory, ensurePatternDefinitions, failJob, listCallRecords, mutateCall, prunePatterns, readCall,
  readCallText, readDrills, readFacts, readPatternDefinitions, readPatternEvents, readTranscript, removeCallFiles, replaceCallDrills,
  replaceCallEvents, replaceSuggestedFacts, retryJobLater, withOwnedCall, writeFileAtomic } from './repository';
import { JUDGE_JSON_SCHEMA, MAP_JSON_SCHEMA, buildJudgePrompt, buildMapPrompt, type PromptContext, type ReviewMode } from './review-prompt';
import { assembleReview, mostlyInvented, sanitiseJudge, sanitiseMap, type ReviewEnv } from './review-sanitise';
import { playbookForPrompt } from './state';
import { normaliseText } from './text';
import { DIARIZE_MINUTE_USD, SpeakerRegistry, transcribeDiarized, transcribeVerbatim, type DiarizeRequest, type DiarizeResult,
  type DiarizedSegment, type VerbatimRequest } from './transcription';

/**
 * Background pipeline for uploaded calls, driven by the shared worker tick (and by scripts/import-calls.ts).
 * process: ffprobe/ffmpeg → chunks at silences → diarized transcription with consistent speakers → needs-speaker | analyse.
 * analyse: verbatim pass over the learner's lines (audio) → Sol pass A (map, medium) → Sol pass B (judge, high)
 *          → validated review, pattern events, suggested facts and drills → ready.
 * Jobs hold a lease and a token; a call deleted or re-queued meanwhile is never resurrected by a slow worker.
 */
export interface CallWorkerDeps {
  media: MediaTools;
  diarize(request: DiarizeRequest): Promise<DiarizeResult>;
  verbatim(request: VerbatimRequest): Promise<string>;
  sol(prompt: string, schema: Record<string, unknown>, effort: 'medium' | 'high'): Promise<unknown>;
  /** Learner voice recordings (newest first) usable as a known-speaker reference. */
  learnerSamples(): Promise<{ name: string; audio: Uint8Array }[]>;
  reserveBudget(usd: number): () => void;
  recordUsage(minutes: number, usd: number): void;
  appState(): Pick<AppState, 'profile' | 'placement'>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const DAY_MS = 86_400_000;
const RETRY_DELAYS_MS = [20_000, 90_000, 300_000];
/** Keeps one review request well inside the model's context and time budget (~3 hours of conversation). */
export const MAX_PROMPT_TRANSCRIPT_CHARS = 240_000;

class NeedsSpeaker extends Error {}

async function defaultLearnerSamples(): Promise<{ name: string; audio: Uint8Array }[]> {
  const { db } = connection();
  const names: string[] = [];
  try { names.push(...placementVoiceSamples(db)); } catch { /* placement is optional */ }
  const rows = db.prepare('SELECT data FROM sessions ORDER BY updated_at DESC LIMIT 80').all() as { data: string }[];
  const turns = rows.flatMap(row => (JSON.parse(row.data) as Session).turns)
    .filter(turn => turn.role === 'user' && turn.source === 'audio' && turn.audioFile && !turn.transcriptEdited && !turn.disputed)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const turn of [...turns.filter(turn => (turn.speechTiming?.detectedSpeechSeconds ?? 0) >= 3), ...turns]) {
    if (!names.includes(turn.audioFile!)) names.push(turn.audioFile!);
  }
  const samples: { name: string; audio: Uint8Array }[] = [];
  for (const name of names.slice(0, 6)) {
    try { samples.push({ name, audio: new Uint8Array(getAudio(name)) }); } catch { /* expired or deleted recording */ }
  }
  return samples;
}

function defaultDeps(): CallWorkerDeps {
  return {
    media: createMediaTools(),
    diarize: request => transcribeDiarized(request, { apiKey: openAiAudioKey() }),
    verbatim: request => transcribeVerbatim(request, { apiKey: openAiAudioKey() }),
    sol: (prompt, schema, effort) => codexJson<unknown>(prompt, schema, effort, 'call-review'),
    learnerSamples: defaultLearnerSamples,
    reserveBudget: usd => reserveAudioBudget(usd),
    recordUsage: (minutes, usd) => addAudioUsage('transcription', minutes, usd),
    appState: () => getAppState(),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}

const globals = globalThis as typeof globalThis & { trainingCallWorkerBusy?: boolean; trainingCallWorkerDeps?: Partial<CallWorkerDeps>; trainingCallSweepAt?: number };

/** Tests and the import CLI can replace providers (fake ffmpeg / OpenAI / Sol). Pass null to restore the defaults. */
export function setCallWorkerDeps(overrides: Partial<CallWorkerDeps> | null): void {
  globals.trainingCallWorkerDeps = overrides ?? undefined;
  globals.trainingCallSweepAt = undefined;
}
function deps(): CallWorkerDeps { return { ...defaultDeps(), ...(globals.trainingCallWorkerDeps ?? {}) }; }

/** Process at most one call job. Own busy flag; never throws. */
export async function processCallQueue(): Promise<void> {
  if (globals.trainingCallWorkerBusy) return;
  globals.trainingCallWorkerBusy = true;
  try {
    const d = deps();
    maintain(d);
    const job = claimJob(d.now());
    if (job) await runJob(job, d);
  } catch { /* the queue never throws into the shared tick */ }
  finally { globals.trainingCallWorkerBusy = false; }
}

function classify(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof CallStepError) return { message: error.message, retryable: error.retryable };
  if (error instanceof SiwcError) return { message: error.message, retryable: error.code === 'timeout' || error.code === 'network' };
  if (error instanceof ApiError) return { message: error.message, retryable: false };
  const message = error instanceof Error && /[А-Яа-яЁё]/.test(error.message) ? error.message.slice(0, 300) : 'Не удалось обработать созвон.';
  return { message, retryable: true };
}

async function runJob(job: ClaimedJob, d: CallWorkerDeps): Promise<void> {
  try {
    if (job.stage === 'process') await processStage(job, d);
    else await analyseStage(job, d);
  } catch (error) {
    if (error instanceof CallCancelled) return;
    const now = d.now();
    if (error instanceof NeedsSpeaker) {
      withOwnedCall(job.callId, job.token, (record, db) => {
        record.status = 'needs-speaker'; record.progress = null; record.error = null; completeJob(db, job.callId, now);
      }, now);
      return;
    }
    const { message, retryable } = classify(error);
    withOwnedCall(job.callId, job.token, (record, db) => {
      if (retryable && job.attempt < JOB_MAX_ATTEMPTS[job.stage]) {
        retryJobLater(db, job.callId, message, RETRY_DELAYS_MS[job.attempt - 1] ?? RETRY_DELAYS_MS.at(-1)!, now);
        record.progress = { stage: message, percent: record.progress?.percent ?? 0 };
        record.error = null;
      } else {
        failJob(db, job.callId, message, now);
        Object.assign(record, { status: 'error', error: message, progress: null, failedStage: job.stage });
      }
    }, now);
  }
}

function progressFn(job: ClaimedJob, d: CallWorkerDeps, status: 'processing' | 'analysing') {
  return (stage: string, percent: number, extra?: (record: CallRecord) => void) => {
    const ok = withOwnedCall(job.callId, job.token, record => {
      record.status = status;
      record.progress = { stage, percent: Math.max(0, Math.min(99, Math.round(percent))) };
      extra?.(record);
    }, d.now());
    if (!ok) throw new CallCancelled();
  };
}

function budgetError(usd: number): CallStepError {
  return new CallStepError(`Месячный бюджет голоса исчерпан: расшифровка этого созвона стоит около $${Math.max(0.01, usd).toFixed(2)}. `
    + 'Увеличь бюджет в профиле или загрузи текстовую расшифровку.', false);
}

function reserve(d: CallWorkerDeps, usd: number): () => void {
  try { return d.reserveBudget(usd); }
  catch (error) {
    if (error instanceof ApiError && error.status === 402) throw budgetError(usd);
    throw error;
  }
}

// ---------- process stage (audio) ----------

interface ChunkCache { referenceNames: string[]; segments: DiarizedSegment[] }
function readChunkCache(work: string, index: number): ChunkCache | null {
  try { return JSON.parse(readFileSync(join(work, `chunk-${index}.json`), 'utf8')) as ChunkCache; } catch { return null; }
}

async function learnerReference(d: CallWorkerDeps, work: string): Promise<{ audio: Uint8Array; mime: string } | null> {
  let samples: { name: string; audio: Uint8Array }[];
  try { samples = await d.learnerSamples(); } catch { return null; }
  for (const [index, sample] of samples.slice(0, 5).entries()) {
    const extension = /\.(webm|mp4|ogg|wav|mp3)$/i.exec(sample.name)?.[1]?.toLowerCase();
    if (!extension) continue;
    const input = join(work, `voice-${index}.${extension}`);
    const output = join(work, `voice-${index}.wav`);
    try {
      writeFileSync(input, sample.audio, { mode: 0o600 });
      if (await d.media.speechSample(input, output, 9) >= 2.5) return { audio: readFileSync(output), mime: 'audio/wav' };
    } catch { /* try the next recording */ }
  }
  return null;
}

async function processStage(job: ClaimedJob, d: CallWorkerDeps): Promise<void> {
  const id = job.callId;
  const record = readCall(connection().db, id);
  if (!record) throw new CallCancelled();
  const progress = progressFn(job, d, 'processing');
  const directory = ensureCallDirectory(id);
  const work = join(directory, 'work');
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const audioPath = join(directory, 'audio.mp3');
  progress('Проверяю запись', 2);
  if (!existsSync(audioPath)) {
    const original = record.upload ? join(directory, `original.${record.upload.extension}`) : null;
    if (!original || !existsSync(original)) throw new CallStepError('Исходный файл созвона не найден. Загрузи запись заново.', false);
    const probe = await d.media.probe(original);
    if (probe.audioStreams < 1) throw new CallStepError('В файле нет звуковой дорожки.', false);
    if (probe.durationSeconds < 3) throw new CallStepError('Запись слишком короткая для разбора.', false);
    if (probe.durationSeconds > MAX_CALL_SECONDS) throw new CallStepError('Запись длиннее 4 часов. Обрежь её и загрузи снова.', false);
    progress('Готовлю звук', 5);
    const temporary = join(work, 'audio.tmp.mp3');
    await d.media.normalise(original, temporary, probe.audioStreams, probe.durationSeconds);
    renameSync(temporary, audioPath);
  }
  const { durationSeconds } = await d.media.probe(audioPath);
  if (!(durationSeconds >= 3)) throw new CallStepError('В записи слишком мало звука для разбора.', false);
  progress('Ищу паузы для нарезки', 9, current => { current.durationSeconds = Math.round(durationSeconds * 10) / 10; });
  const plan = planChunks(durationSeconds, await d.media.silences(audioPath, durationSeconds));
  const cached = plan.map(chunk => readChunkCache(work, chunk.index));
  const pendingUsd = plan.filter((_, index) => !cached[index]).reduce((sum, chunk) => sum + (chunk.end - chunk.start) / 60 * DIARIZE_MINUTE_USD, 0);
  if (pendingUsd > 0) reserve(d, pendingUsd)(); // affordability check before spending anything
  progress('Ищу образец твоего голоса', 12);
  const registry = new SpeakerRegistry(await learnerReference(d, work));
  for (const chunk of plan) {
    progress(plan.length > 1 ? `Расшифровываю: часть ${chunk.index + 1} из ${plan.length}` : 'Расшифровываю запись', 15 + 70 * chunk.index / plan.length);
    const chunkPath = join(work, `chunk-${chunk.index}.mp3`);
    const length = chunk.end - chunk.start;
    let result = cached[chunk.index];
    if (!result) {
      if (!existsSync(chunkPath)) await d.media.cut(audioPath, chunk.start, length, chunkPath, 'mp3');
      const references = registry.references();
      const release = reserve(d, length / 60 * DIARIZE_MINUTE_USD);
      try {
        const response = await withRetries(() => d.diarize({ audio: readFileSync(chunkPath), fileName: `call-part-${chunk.index + 1}.mp3`, references }), d.sleep);
        d.recordUsage(length / 60, length / 60 * DIARIZE_MINUTE_USD);
        result = { referenceNames: references.map(reference => reference.name), segments: response.segments };
        writeFileAtomic(join(work, `chunk-${chunk.index}.json`), JSON.stringify(result));
      } finally { release(); }
    }
    const mapped = registry.ingest(chunk.start, result.segments, result.referenceNames);
    for (const wanted of registry.wantedClips(mapped)) {
      try {
        if (!existsSync(chunkPath)) await d.media.cut(audioPath, chunk.start, length, chunkPath, 'mp3');
        const clipPath = join(work, `ref-${wanted.id}.wav`);
        await d.media.cut(chunkPath, wanted.start, wanted.duration, clipPath, 'wav');
        registry.addReference(wanted.id, readFileSync(clipPath), 'audio/wav');
      } catch { /* a missing reference only weakens speaker consistency */ }
    }
  }
  progress('Собираю расшифровку', 88);
  const segments = registry.merged();
  if (!segments.length) throw new CallStepError('В записи не удалось распознать речь.', false);
  writeFileAtomic(join(directory, 'transcript.next.json'), JSON.stringify({ version: 1, segments }));
  const meIds = new Set(segments.some(segment => segment.speaker === 'me') ? ['me'] : []);
  const record2 = readCall(connection().db, id);
  const speakers = buildSpeakers(segments, { counterpart: record2?.counterpart ?? record.counterpart, meIds });
  const now = d.now();
  const done = withOwnedCall(id, job.token, (current, db) => {
    renameSync(join(directory, 'transcript.next.json'), join(directory, 'transcript.json'));
    Object.assign(current, { durationSeconds: Math.round(durationSeconds * 10) / 10, speakers, attribution: meIds.size ? 'voice' : null, verbatimFor: null,
      metrics: meIds.size ? computeMetrics(segments, speakers) : null, error: null, failedStage: null, revision: current.revision + 1,
      audio: { processedAt: new Date(now).toISOString(), expiresAt: new Date(now + CALL_AUDIO_RETENTION_DAYS * DAY_MS).toISOString() } });
    if (meIds.size) { current.status = 'analysing'; current.progress = { stage: 'В очереди на разбор', percent: 0 }; advanceJob(db, id, 'analyse', now); }
    else { current.status = 'needs-speaker'; current.progress = null; completeJob(db, id, now); }
  }, now);
  if (!done) throw new CallCancelled();
  // The processed mono audio is enough for playback and re-runs: drop the original upload and work files.
  rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (record.upload) rmSync(join(directory, `original.${record.upload.extension}`), { force: true, maxRetries: 3, retryDelay: 100 });
}

// ---------- analyse stage ----------

/** Re-transcribe the learner's own lines with the verbatim prompt (fillers, false starts and errors kept). Never fatal. */
async function ensureVerbatim(job: ClaimedJob, d: CallWorkerDeps, record: CallRecord, segments: CallSegment[],
  progress: ReturnType<typeof progressFn>): Promise<CallSegment[]> {
  const meIds = record.speakers.filter(speaker => speaker.isMe).map(speaker => speaker.id).sort();
  const key = meIds.join(',');
  if (!key || record.verbatimFor === key) return segments;
  const directory = callDirectory(record.id);
  const audioPath = join(directory, 'audio.mp3');
  const next: CallSegment[] = segments.map(segment => {
    const { verbatim: _ignored, ...rest } = segment;
    void _ignored;
    return segment.speaker !== null && meIds.includes(segment.speaker) ? { ...rest, verbatim: null } : rest;
  });
  const targets = next.filter(segment => segment.speaker !== null && meIds.includes(segment.speaker) && !segment.disputed
    && segment.start !== null && segment.end !== null && segment.end - segment.start >= 0.8);
  if (record.audio && existsSync(audioPath) && targets.length) {
    const usd = targets.reduce((sum, segment) => sum + (segment.end! - segment.start! + 0.3), 0) / 60 * TRANSCRIPTION_MINUTE_USD;
    let release: (() => void) | null = null;
    try { release = reserve(d, usd); } catch { release = null; }
    if (release) {
      const work = join(directory, 'work');
      mkdirSync(work, { recursive: true, mode: 0o700 });
      const queue = [...targets];
      let finished = 0;
      let stop = false;
      const worker = async () => {
        for (let segment = queue.shift(); segment && !stop; segment = queue.shift()) {
          const clipPath = join(work, `verbatim-${segment.id}.mp3`);
          const start = Math.max(0, segment.start! - 0.15);
          const length = segment.end! - segment.start! + 0.3;
          try {
            await d.media.cut(audioPath, start, length, clipPath, 'mp3');
            const text = await withRetries(() => d.verbatim({ audio: readFileSync(clipPath), fileName: 'line.mp3' }), d.sleep);
            d.recordUsage(length / 60, length / 60 * TRANSCRIPTION_MINUTE_USD);
            segment.verbatim = text || null;
          } catch (error) {
            if (error instanceof CallCancelled) throw error;
            if (error instanceof CallStepError && !error.retryable) stop = true;
          } finally { rmSync(clipPath, { force: true }); }
          finished++;
          if (finished % 6 === 0) progress(`Дословно расшифровываю твои реплики: ${finished} из ${targets.length}`, 3 + 9 * finished / targets.length);
        }
      };
      try { await Promise.all([worker(), worker(), worker()]); }
      finally { release(); }
    }
  }
  const temporary = join(directory, 'transcript.next.json');
  writeFileAtomic(temporary, JSON.stringify({ version: 1, segments: next }));
  const ok = withOwnedCall(job.callId, job.token, current => {
    renameSync(temporary, join(directory, 'transcript.json'));
    current.verbatimFor = key;
  }, d.now());
  if (!ok) throw new CallCancelled();
  return next;
}

interface AnalysisInputs { ctx: PromptContext; env: ReviewEnv }

function exemplarFor(record: CallRecord, records: CallRecord[]): string | null {
  for (const other of records) {
    if (other.id === record.id) continue;
    const text = other.source === 'debrief' ? readCallText(other.id, 'debrief.md') : other.hasReference ? readCallText(other.id, 'reference.md') : null;
    if (text?.trim()) return text;
  }
  return null;
}

function analysisInputs(record: CallRecord, mode: ReviewMode, segments: CallSegment[], needsAttribution: boolean, d: CallWorkerDeps): AnalysisInputs {
  const { db } = connection();
  const state = d.appState();
  const date = callDate(record);
  const records = listCallRecords(db);
  const otherEvents = readPatternEvents(db).filter(event => event.callId !== record.id);
  const earlier = otherEvents.filter(event => event.date < date);
  const sessions = (db.prepare(`SELECT data FROM sessions WHERE status='completed'`).all() as { data: string }[]).map(row => JSON.parse(row.data) as Session);
  const practice = practiceByPattern(sessions, readDrills(db));
  const definitions = readPatternDefinitions(db);
  const activePatterns = definitions.map(definition => {
    const events = earlier.filter(event => event.patternId === definition.id).map(event => ({ source: 'call' as const, sourceId: event.callId, date: event.date,
      status: event.status, quote: event.quote, at: event.at, memory: event.memory, independent: false, callMode: false }));
    return { definition, events, pattern: derivePattern(definition, events, practice.get(definition.id)) };
  }).filter(item => item.events.some(event => event.status !== 'no-opportunity') && !item.pattern.dismissed && item.pattern.status !== 'resolved')
    .filter(item => item.definition.contexts.includes(record.context === 'other' ? 'life' : record.context) || record.context === 'other')
    .sort((left, right) => left.pattern.costRank - right.pattern.costRank).slice(0, 12)
    .map(item => ({ id: item.pattern.id, title: item.pattern.title, kind: item.pattern.kind, status: item.pattern.status, costRank: item.pattern.costRank,
      lastQuote: item.pattern.evidence.find(entry => entry.source === 'call')?.quote ?? null,
      history: item.events.map(event => `${event.date.slice(0, 10)} ${event.status}`) }));
  const previousCalls = records.filter(other => other.id !== record.id && other.review && callDate(other) < date).slice(0, 8)
    .map(other => ({ date: callDate(other).slice(0, 10), title: other.title, kind: other.review!.kind, outcome: other.review!.outcome,
      topCosts: other.review!.costs.slice(0, 3).map(cost => cost.title) }));
  const facts = readFacts(db).filter(fact => !(fact.source.type === 'call' && fact.source.callId === record.id && fact.status === 'suggested'));
  const result = state.placement?.result ?? null;
  const skill = (id: string) => result?.skills.find(item => item.id === id)?.label ?? null;
  const meIds = new Set(record.speakers.filter(speaker => speaker.isMe).map(speaker => speaker.id));
  const timed = segments.length > 0 && segments.every(segment => segment.start !== null);
  const serverLimitations = [
    mode === 'debrief' ? 'Разбор перенесён из готового письменного разбора: записи и расшифровки нет, цитаты взяты из него.' : null,
    mode === 'memory' ? 'Разбор по памяти: без точных цитат, анализа английского и темпа.' : null,
    record.source === 'transcript' ? 'Разбор по текстовой расшифровке: звук не прослушан, ошибки распознавания возможны.' : null,
    needsAttribution ? 'Кто говорит, определено по смыслу текста: в строках, где говорят оба, возможны ошибки.' : null,
    mode === 'transcript' && !timed ? 'В расшифровке нет таймкодов: доля речи, темп и паузы не посчитаны.' : null,
    record.source === 'audio' && !segments.some(segment => typeof segment.verbatim === 'string')
      ? 'Дословной расшифровки твоих реплик нет: английский оценён по обычной расшифровке, где часть ошибок и слов-паразитов сглажена.' : null,
  ].filter((item): item is string => !!item);
  const ctx: PromptContext = {
    mode,
    call: { title: record.title, counterpart: record.counterpart, context: record.context, date: date.slice(0, 10), durationSeconds: record.durationSeconds,
      source: record.source, notes: record.notes },
    learner: { name: state.profile.name, goals: state.profile.goals, professionalContext: state.profile.professionalContext,
      relocation: state.profile.relocation, interests: state.profile.interests, feedback: state.profile.feedback },
    playbook: playbookForPrompt(db),
    levels: result ? { overall: result.overall?.label ?? null, speaking: skill('speaking'), listening: skill('listening') } : null,
    activePatterns, previousCalls, speakers: record.speakers, metrics: record.metrics, segments, needsAttribution,
    sourceText: mode === 'debrief' ? readCallText(record.id, 'debrief.md') : mode === 'memory' ? readCallText(record.id, 'source.txt') : null,
    referenceDebrief: record.hasReference ? readCallText(record.id, 'reference.md') : null,
    exemplar: exemplarFor(record, records), serverLimitations,
  };
  const env: ReviewEnv = {
    mode, segments, meIds, needsAttribution, sourceText: ctx.sourceText,
    knownPatterns: new Set([...definitions.map(item => item.id), ...SEED_PATTERNS.map(item => item.id), ...LANGUAGE_PATTERNS.map(item => item.id)]),
    persistentPatterns: new Set(otherEvents.filter(event => event.status !== 'no-opportunity').map(event => event.patternId)),
    activePatternIds: activePatterns.filter(item => item.kind === 'weakness').map(item => item.id),
    existingFacts: new Set(facts.map(fact => normaliseText(fact.text))),
    context: record.context === 'other' ? 'life' : record.context,
  };
  return { ctx, env };
}

function timeoutLike(error: unknown): boolean {
  if (error instanceof SiwcError) return error.code === 'timeout';
  return error instanceof Error && /три минуты|timed out|timeout/i.test(error.message);
}

async function analyseStage(job: ClaimedJob, d: CallWorkerDeps): Promise<void> {
  const id = job.callId;
  const record = readCall(connection().db, id);
  if (!record) throw new CallCancelled();
  const revision = record.revision;
  const progress = progressFn(job, d, 'analysing');
  const mode: ReviewMode = record.source === 'debrief' ? 'debrief' : record.source === 'memory' ? 'memory' : 'transcript';
  let segments = mode === 'transcript' ? readTranscript(id) : [];
  if (mode === 'transcript' && !segments.length) throw new CallStepError('Расшифровка созвона не найдена. Загрузи её заново.', false);
  const needsAttribution = mode === 'transcript' && record.attribution === null && !record.speakers.some(speaker => speaker.isMe)
    && segments.every(segment => segment.speaker === null);
  if (mode === 'transcript' && !needsAttribution && !record.speakers.some(speaker => speaker.isMe)) throw new NeedsSpeaker();
  progress('Готовлю разбор', 2);
  if (record.source === 'audio') segments = await ensureVerbatim(job, d, record, segments, progress);
  const transcriptChars = segments.reduce((sum, segment) => sum + segment.text.length + (segment.verbatim?.length ?? 0), 0);
  if (transcriptChars > MAX_PROMPT_TRANSCRIPT_CHARS) {
    throw new CallStepError('Созвон слишком длинный для одного разбора. Загрузи его частями, примерно до трёх часов каждая.', false);
  }

  const { ctx, env } = analysisInputs(record, mode, segments, needsAttribution, d);
  progress('Sol размечает звонок', 15);
  let mapped = sanitiseMap(await d.sol(buildMapPrompt(ctx), MAP_JSON_SCHEMA, 'medium'), env);
  if (!mapped.ok) {
    progress('Sol уточняет разметку', 28);
    mapped = sanitiseMap(await d.sol(buildMapPrompt(ctx, mapped.error), MAP_JSON_SCHEMA, 'medium'), env);
  }
  if (!mapped.ok) {
    throw new CallStepError(needsAttribution ? 'Sol не смогла определить, где твои реплики. Загрузи расшифровку с именами («Имя: текст») или запись.'
      : 'Sol вернула разметку звонка не по формату. Нажми «Повторить».', false);
  }
  segments = mapped.segments;
  let speakers: CallSpeaker[] = record.speakers;
  if (needsAttribution) speakers = buildSpeakers(segments, { counterpart: record.counterpart, meIds: mapped.meIds });
  const metrics = mode === 'transcript' ? computeMetrics(segments, speakers) : null;
  const judgeCtx: PromptContext = { ...ctx, segments, speakers, metrics, needsAttribution: false };
  const judgeEnv: ReviewEnv = { ...env, segments, meIds: mapped.meIds, needsAttribution: false };
  const mapForPrompt = { ...mapped.map, facts: undefined };

  progress('Sol разбирает звонок', 40);
  const judge = async (feedback?: string) => {
    const effort = job.attempt > 1 ? 'medium' as const : 'high' as const;
    try { return await d.sol(buildJudgePrompt(judgeCtx, mapForPrompt, feedback), JUDGE_JSON_SCHEMA, effort); }
    catch (error) {
      if (effort === 'high' && timeoutLike(error)) return d.sol(buildJudgePrompt(judgeCtx, mapForPrompt, feedback), JUDGE_JSON_SCHEMA, 'medium');
      throw error;
    }
  };
  let judged = sanitiseJudge(await judge(), judgeEnv, segments, mapped.meIds);
  if (!judged.ok || mostlyInvented(judged.stats)) {
    progress('Sol перепроверяет разбор', 65);
    const feedback = judged.ok ? 'More than half of the quotes were not found in the transcript. Copy quotes character for character from the lines, or use null.'
      : judged.error;
    judged = sanitiseJudge(await judge(feedback), judgeEnv, segments, mapped.meIds);
    if (!judged.ok) throw new CallStepError('Sol вернула разбор не по формату. Нажми «Повторить».', false);
    if (mostlyInvented(judged.stats)) throw new CallStepError('В разборе слишком много цитат, которых нет в расшифровке. Разбор не сохранён; нажми «Повторить».', false);
  }

  progress('Обновляю паттерны и тренировки', 92);
  const now = d.now();
  const assembled = assembleReview({ env: judgeEnv, map: mapped.map, judge: judged.judge, dropped: mapped.stats.dropped + judged.stats.dropped,
    callId: id, version: (record.review?.version ?? 0) + 1, model: BRAIN_MODEL, serverLimitations: ctx.serverLimitations, now });
  const directory = callDirectory(id);
  if (needsAttribution) writeFileAtomic(join(directory, 'transcript.next.json'), JSON.stringify({ version: 1, segments }));
  const published = withOwnedCall(id, job.token, (current, db) => {
    if (current.revision !== revision) throw new CallCancelled();
    if (needsAttribution) {
      renameSync(join(directory, 'transcript.next.json'), join(directory, 'transcript.json'));
      current.speakers = speakers;
      current.attribution = 'model';
    }
    Object.assign(current, { review: assembled.review, hits: assembled.hits, metrics, status: 'ready', progress: null, error: null, failedStage: null,
      firstReviewedAt: current.firstReviewedAt ?? new Date(now).toISOString() });
    ensurePatternDefinitions(db, assembled.definitions, now);
    replaceCallEvents(db, id, callDate(current), assembled.hits, mode === 'memory');
    prunePatterns(db);
    replaceSuggestedFacts(db, id, assembled.facts, now);
    replaceCallDrills(db, id, assembled.drills);
    completeJob(db, id, now);
  }, now);
  if (!published) throw new CallCancelled();
}

// ---------- maintenance ----------

/** Every 10 minutes: delete raw call audio after the retention period, stale unfinished uploads and orphaned directories. */
function maintain(d: CallWorkerDeps): void {
  const now = d.now();
  if (globals.trainingCallSweepAt !== undefined && now - globals.trainingCallSweepAt < 10 * 60_000) return;
  globals.trainingCallSweepAt = now;
  try {
    const { db } = connection();
    const records = listCallRecords(db);
    const ids = new Set(records.map(record => record.id));
    for (const record of records) {
      const failedLongAgo = record.status === 'error' && now - Date.parse(record.updatedAt) > CALL_AUDIO_RETENTION_DAYS * DAY_MS;
      if ((record.audio && Date.parse(record.audio.expiresAt) <= now && record.status !== 'processing') || (failedLongAgo && !record.audio)) {
        // Raw call audio (upload, processed copy, chunks, voice clips) follows the retention period; transcript and review stay.
        const directory = callDirectory(record.id);
        for (const name of readdirSafe(directory)) {
          if (name === 'audio.mp3' || name.startsWith('original.') || name === 'work') rmSync(join(directory, name), { recursive: true, force: true });
        }
        if (record.audio) mutateCall(record.id, current => { current.audio = null; }, now);
      } else if (record.status === 'awaiting-upload' && now - Date.parse(record.updatedAt) > 7 * DAY_MS) {
        transaction(db, () => { deleteCallRows(db, record.id); });
        removeCallFiles(record.id);
      }
    }
    for (const name of callDirectoryNames()) {
      if (ids.has(name)) continue;
      const path = join(callsRoot(), name);
      try { if (now - statSync(path).mtimeMs > 30 * 60_000) rmSync(path, { recursive: true, force: true }); } catch { /* retried next sweep */ }
    }
  } catch { /* maintenance never blocks the queue */ }
}

function readdirSafe(path: string): string[] { try { return readdirSync(path); } catch { return []; } }
