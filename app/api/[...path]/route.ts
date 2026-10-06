import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getBrainStatus, getSubscriptionUsage } from '@/lib/server/codex';
import { getAppState, getSession, getSessionByRequestId, createSession, saveSession, updateProfile, deleteSession, deleteAllTraining, enqueueAnalysis, finishConversation,
  completeOnboardingIntro, getOnboardingRecord, saveBaselineReport, getLearningGeneration } from '@/lib/server/store';
import { completionRequirement } from '@/lib/server/session-lifecycle';
import { messageInputSchema, retryInputSchema, transcriptIntegrity } from '@/lib/server/transcript-integrity';
import { correctedRecordingTiming, recordedSubmission } from '@/lib/server/speech-timing';
import { planLesson, respond, hint, reviewRetryAssessment, pushbackLine, assessPushback, ttsInstructionsFor } from '@/lib/server/teacher';
import { audioConfigured, setAudioKey, getAudio, transcribe, synthesize, cleanAudio, createLiveTranscriptionSession, closeLiveTranscriptionSession } from '@/lib/server/audio';
import { checkAccess, checkOrigin, validAccessCode, accessCookie, requestIsSecure, ApiError } from '@/lib/server/security';
import { ensureWorker, processAnalysisQueue } from '@/lib/server/worker';
import { assessQuickCoachRetry, explainQuickCoach, quickCoachInputSchema, quickCoachRetryInputSchema } from '@/lib/server/quick-coach';
import { FAMILIES, CALIBRATION_OPTIONS, familyCatalog, lessonMode } from '@/lib/training';
import { unassistedSpokenTurns } from '@/lib/onboarding';
import { baselineReportFingerprint } from '@/lib/server/onboarding-data';
import { generateBaselineReport } from '@/lib/server/baseline-report';
import { handlePlacementRoute } from '@/lib/server/placement/routes';
import { handleCallsRoute } from '@/lib/server/calls/routes';
import { getDrill, linkDrillSession } from '@/lib/server/calls/state';
import { locked } from '@/lib/server/http';
import { APP_CHANNEL, APP_NAME, APP_VERSION } from '@/lib/app-info';
import type { AppState, Session, Profile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Route = { params: Promise<{ path: string[] }> };
function session(id: string) {
  const value = getSession(id);
  if (!value) throw new ApiError('Занятие не найдено.', 404);
  return value;
}
function safeSession(value: Session): Session {
  // Partner-only material (brief, hidden facts, scripted pushback, evaluator snapshot) never reaches a client.
  return { ...value, completion: completionRequirement(value),
    lesson: { ...value.lesson, npcBrief: '', hiddenFacts: [], pushback: [], coaching: null } };
}
function partnerVoice(value: Session) {
  return { instructions: ttsInstructionsFor(value.lesson.speechLevel ?? null, value.lesson.persona ?? null) };
}
function safeState(state: AppState): AppState { return { ...state, sessions: state.sessions.map(safeSession) }; }
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function body(req: NextRequest) {
  if (Number(req.headers.get('content-length') || 0) > 64_000) throw new ApiError('Слишком большой запрос.', 413);
  try { return await req.json(); } catch { throw new ApiError('Некорректные данные.'); }
}
const profileSchema = z.object({
  name: z.string().min(1).max(80), goals: z.string().min(1).max(3000), interests: z.array(z.string().max(80)).max(20),
  professionalContext: z.string().max(2000), relocation: z.string().max(1000), dailyMinutes: z.number().min(5).max(60).transform(value => Math.round(value)),
  feedback: z.string().max(1000), audioRetentionDays: z.number().int().min(7).max(180), budgetUsd: z.number().min(1).max(50),
});
async function handle(req: NextRequest, route: Route) {
  const path = (await route.params).path;
  if (path[0] === 'login' && req.method === 'POST') {
    checkOrigin(req);
    const data = z.object({ code: z.string().max(500) }).parse(await body(req));
    if (!validAccessCode(data.code)) throw new ApiError('Код не подошёл.', 401);
    const response = json({ ok: true });
    response.cookies.set('training-access', accessCookie(), { httpOnly: true, sameSite: 'strict', secure: requestIsSecure(req), path: '/', maxAge: 86400 * 30 });
    return response;
  }
  checkAccess(req);
  // Reading subscription statistics must never start an analysis job.
  if (req.method === 'GET' && path.length === 1 && path[0] === 'usage') {
    return json(await getSubscriptionUsage(req.nextUrl.searchParams.get('refresh') === '1'));
  }
  if (path[0] === 'placement') { ensureWorker(); return handlePlacementRoute(req, path.slice(1)); }
  if (path[0] === 'calls' || path[0] === 'patterns' || path[0] === 'facts') { ensureWorker(); return handleCallsRoute(req, path); }
  if (path[0] === 'onboarding') {
    // Introduction and cached results never start unrelated analysis or make an AI call.
    if (req.method === 'GET' && path.length === 1) return json(getAppState().onboarding);
    if (req.method === 'POST' && path.length === 2 && path[1] === 'intro') {
      const data = z.object({ confirmed: z.literal(true), russianControl: z.string().trim().min(20).max(2000) }).parse(await body(req));
      completeOnboardingIntro(data.russianControl);
      return json(getAppState().onboarding);
    }
    if (req.method === 'POST' && path.length === 2 && path[1] === 'report') {
      await body(req);
      return locked('baseline-report', async () => {
        const state = getAppState();
        if (state.onboarding?.status !== 'ready') throw new ApiError('Сначала нужны три разобранные стартовые пробы с исходными ответами.', 409);
        if (state.onboarding.report) return json(state.onboarding);
        const record = getOnboardingRecord();
        const fingerprint = baselineReportFingerprint(record, state.sessions, state.profile);
        const report = await generateBaselineReport(state, record.russianControl!);
        // Atomic source check also rejects a result after reset, deletion, or a profile/ASR edit.
        saveBaselineReport(fingerprint, report);
        return json(getAppState().onboarding);
      });
    }
    throw new ApiError('Действие не найдено.', 404);
  }
  if (path[0] === 'quick-coach') {
    if (req.method !== 'POST') throw new ApiError('Действие не найдено.', 404);
    if (path.length === 1) {
      const data = quickCoachInputSchema.parse(await body(req));
      return locked('quick-coach', async () => json(await explainQuickCoach(getAppState(), data)));
    }
    if (path.length === 2 && path[1] === 'retry') {
      const data = quickCoachRetryInputSchema.parse(await body(req));
      return locked('quick-coach', async () => json(await assessQuickCoachRetry(getAppState(), data)));
    }
    throw new ApiError('Действие не найдено.', 404);
  }
  ensureWorker();
  if (req.method === 'GET') {
    if (path[0] === 'state') { cleanAudio(getAppState().profile.audioRetentionDays); return json(safeState(getAppState())); }
    if (path[0] === 'status') return json({ app: { name: APP_NAME, version: APP_VERSION, channel: APP_CHANNEL }, brain: await getBrainStatus(), hosting: process.env.TRAINING_DEPLOYMENT === 'server' ? 'server' : 'local', audio: { configured: audioConfigured(), model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts' } });
    if (path[0] === 'families') return json({ families: FAMILIES, calibration: CALIBRATION_OPTIONS, catalog: familyCatalog() });
    if (path[0] === 'sessions' && path[1]) return json(safeSession(session(path[1])));
    if (path[0] === 'audio' && path[1]) {
      const bytes = getAudio(path[1]);
      const type = path[1].endsWith('.mp3') ? 'audio/mpeg' : path[1].endsWith('.mp4') ? 'audio/mp4' : path[1].endsWith('.ogg') ? 'audio/ogg' : path[1].endsWith('.wav') ? 'audio/wav' : 'audio/webm';
      return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' } });
    }
    if (path[0] === 'export') return new Response(JSON.stringify(safeState(getAppState()), null, 2), { headers: {
      'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="ratmir-training.json"', 'Cache-Control': 'no-store',
    } });
  }
  if (req.method === 'DELETE' && path[0] === 'sessions' && path[1]) {
    const value = session(path[1]);
    cleanAudio(180, [...value.turns, ...value.retries].flatMap(t => t.audioFile ? [t.audioFile] : []));
    deleteSession(path[1]); return json({ ok: true });
  }
  if (req.method === 'POST' && path[0] === 'audio' && path[1] === 'live-session') {
    return json(await createLiveTranscriptionSession());
  }
  if (req.method === 'POST' && path[0] === 'audio' && path[1] === 'live-session-close') {
    const data = z.object({ ticket: z.string().uuid(), minutes: z.number().min(0).max(8) }).parse(await body(req));
    closeLiveTranscriptionSession(data.ticket, data.minutes);
    return json({ ok: true });
  }
  if (req.method === 'POST' && (path[0] === 'transcribe' || (path[0] === 'audio' && path[1] === 'transcribe'))) {
    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof File)) throw new ApiError('Запись отсутствует.');
    const liveText = form.get('liveText');
    const liveSessionId = form.get('liveSessionId');
    return json(await transcribe(file, Number(form.get('minutes')), {
      text: typeof liveText === 'string' ? liveText : '', final: form.get('liveFinal') === 'true',
      minutes: form.has('liveMinutes') ? Number(form.get('liveMinutes')) : undefined,
      ticket: typeof liveSessionId === 'string' ? liveSessionId : undefined,
    }));
  }
  if (req.method !== 'POST') throw new ApiError('Действие не найдено.', 404);
  if (path[0] === 'profile') { updateProfile(profileSchema.parse(await body(req)) as Profile); return json(safeState(getAppState())); }
  if (path[0] === 'tts') {
    // Short model lines (better answers, drill seeds, cards) — budget-checked like partner speech.
    const data = z.object({ text: z.string().trim().min(1).max(600) }).parse(await body(req));
    return json({ file: await synthesize(data.text) });
  }
  if (path[0] === 'audio-key') {
    const data = z.object({ key: z.string().max(500) }).parse(await body(req));
    setAudioKey(data.key.trim()); return json({ configured: audioConfigured() });
  }
  if (path[0] === 'reset') {
    const data = z.object({ confirmation: z.literal('DELETE') }).parse(await body(req));
    void data; cleanAudio(0); deleteAllTraining(); return json(safeState(getAppState()));
  }
  if (path[0] === 'sessions' && !path[1]) {
    // Clients may send the profile's daily minutes (5–60); one lesson is capped at 30 instead of failing.
    const data = z.object({ mode: z.enum(['learning', 'call']), context: z.enum(['work', 'life', 'relocation']).optional(), familyId: z.string().max(100).optional(), topic: z.string().max(300).optional(),
      minutes: z.number().min(1).max(240).transform(value => Math.min(30, Math.max(5, Math.round(value)))).optional(),
      intent: z.enum(['new', 'resume']).default('new'), sessionId: z.string().uuid().optional(), requestId: z.string().uuid().optional(),
      drillId: z.string().max(100).optional(),
      baselineStepId: z.enum(['expression', 'listening', 'interaction']).optional() }).parse(await body(req));
    return locked('planning', async () => {
      if (data.intent === 'resume') {
        if (!data.sessionId) throw new ApiError('Выбери разговор, который хочешь продолжить.');
        return json(safeSession(session(data.sessionId)));
      }
      // v0.5 replaced the three baseline probes with the placement test.
      if (data.baselineStepId) throw new ApiError('Старые стартовые пробы заменены тестом уровня. Обнови приложение.', 410);
      const existing = data.requestId ? getSessionByRequestId(data.requestId) : null;
      if (existing) return json(safeSession(existing));
      const state = getAppState();
      const generation = getLearningGeneration();
      const drill = data.drillId ? getDrill(data.drillId) : null;
      if (data.drillId && !drill) throw new ApiError('Тренировка не найдена. Обнови список.', 404);
      const options = { ...data, ...(drill ? { context: drill.context, familyId: undefined, topic: undefined, drill } : {}) };
      const family = FAMILIES.find(item => item.id === options.familyId);
      options.mode = lessonMode(family?.activity, options.mode);
      const plan = await planLesson(state, options);
      const mode = lessonMode(plan.activity, options.mode);
      const value = createSession({ ...plan, id: randomUUID() }, mode, data.requestId, generation);
      value.turns.push({ id: randomUUID(), role: 'assistant', text: plan.opening, createdAt: new Date().toISOString(), source: 'text', support: 0 });
      saveSession(value);
      if (drill) linkDrillSession(drill.id, value.id);
      return json(safeSession(value));
    });
  }
  if (path[0] === 'sessions' && path[1]) {
    const id = path[1], action = path[2];
    return locked(id, async () => {
      const value = session(id);
      if (action === 'message') {
        if (value.status !== 'active' && value.status !== 'error') throw new ApiError('Этот разговор уже завершён.');
        const data = messageInputSchema.parse(await body(req));
        const previous = value.turns.findIndex(t => t.id === data.id);
        if (previous >= 0 && value.turns.slice(previous + 1).some(t => t.role === 'assistant')) return json(safeSession(value));
        if (previous < 0 && value.turns.at(-1)?.role === 'user') throw new ApiError('Сначала повтори ответ собеседника на сохранённую реплику.', 409);
        // Partner text is per line (MOTION-PASS-0.5.2 §6): textVisible says whether the line he answers was on screen.
        if (data.textVisible) {
          const heard = [...value.turns].reverse().find(t => t.role === 'assistant');
          if (heard) heard.support = Math.max(heard.support, 1) as 1 | 2 | 3;
        }
        if (data.source === 'audio') { if (!data.audioFile) throw new ApiError('Нет исходной записи.'); getAudio(data.audioFile); }
        if (previous < 0) value.turns.push({ id: data.id, text: data.text, source: data.source, audioFile: data.audioFile,
          ...(data.source === 'audio' && data.audioFile ? recordedSubmission(data.audioFile, data.text, data.originalTranscript, value.support)
            : transcriptIntegrity(data.text, data.originalTranscript, data.source, value.support)), role: 'user', createdAt: new Date().toISOString() });
        value.status = 'active'; value.error = undefined;
        value.processing = { stage: 'responding', startedAt: new Date().toISOString() }; saveSession(value);
        try {
          const text = await respond(value, getAppState().profile);
          // A new partner line always starts hidden and unsupported: only its own reveal (show-text) or the next
          // message's textVisible may mark it, never the previous line's visibility.
          value.turns.push({ id: randomUUID(), role: 'assistant', text, source: 'text', support: 0, createdAt: new Date().toISOString() });
          value.support = 0; value.processing = undefined; saveSession(value);
        } catch (error) {
          value.error = error instanceof Error ? error.message : 'Собеседник не смог ответить.'; value.processing = undefined;
          saveSession(value); throw error;
        }
        return json(safeSession(value));
      }
      if (action === 'hint') {
        if (value.status !== 'active' || value.mode !== 'learning') throw new ApiError('Подсказки доступны во время учебного разговора.');
        const data = z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).parse(await body(req));
        const text = await hint(value, getAppState().profile, data.level);
        value.support = Math.max(value.support, data.level) as 1 | 2 | 3; saveSession(value);
        return json({ text, support: value.support });
      }
      if (action === 'show-text') {
        if (value.baseline && ['active', 'error'].includes(value.status)) {
          throw new ApiError('В стартовой пробе сначала слушаем реплику. После разбора её текст будет доступен.', 409);
        }
        // The revealed line is marked as read. A client may name it (turnId), so a reveal that arrives after the next
        // message can never mark the newer, still hidden line; without it the latest partner line is meant.
        const data = z.object({ turnId: z.string().max(100).optional() }).parse(await body(req).catch(() => ({})));
        if (value.status === 'active') {
          const turn = data.turnId ? value.turns.find(t => t.id === data.turnId && t.role === 'assistant')
            : [...value.turns].reverse().find(t => t.role === 'assistant');
          if (turn && turn.support < 1) { turn.support = 1; saveSession(value); }
        }
        return json(safeSession(value));
      }
      if (action === 'speech') {
        const data = z.object({ turnId: z.string() }).parse(await body(req));
        const turn = value.turns.find(t => t.id === data.turnId && t.role === 'assistant');
        if (!turn) throw new ApiError('Реплика не найдена.');
        if (turn.audioFile) {
          try { getAudio(turn.audioFile); } catch (error) { if (error instanceof ApiError && error.status === 404) turn.audioFile = undefined; else throw error; }
        }
        if (!turn.audioFile) { turn.audioFile = await synthesize(turn.text, partnerVoice(value)); saveSession(value); }
        return json({ file: turn.audioFile });
      }
      if (action === 'pushback-speech') {
        const data = z.object({ retryId: z.string().min(1).max(100) }).parse(await body(req));
        const retry = value.retries.find(item => item.id === data.retryId);
        if (!retry?.pushback) throw new ApiError('Возражение собеседника не найдено.', 404);
        if (retry.pushback.audioFile) {
          try { getAudio(retry.pushback.audioFile); } catch (error) { if (error instanceof ApiError && error.status === 404) retry.pushback.audioFile = undefined; else throw error; }
        }
        if (!retry.pushback.audioFile) { retry.pushback.audioFile = await synthesize(retry.pushback.npcLine, partnerVoice(value)); saveSession(value); }
        return json({ file: retry.pushback.audioFile });
      }
      if (action === 'pushback') {
        const data = z.object({ retryId: z.string().min(1).max(100), text: z.string().trim().min(1).max(7000),
          audioFile: z.string().max(100).optional(), originalTranscript: z.string().max(7000).optional() }).parse(await body(req));
        const index = value.retries.findIndex(item => item.id === data.retryId);
        const retry = value.retries[index];
        if (!retry?.pushback) throw new ApiError('Возражение собеседника не найдено.', 404);
        if (retry.pushback.held !== null) return json(safeSession(value)); // already answered: idempotent repeat
        if (data.audioFile) getAudio(data.audioFile);
        const result = await assessPushback(value, index, data.text, getAppState().profile);
        retry.pushback = { ...retry.pushback, reply: data.text, ...(data.audioFile ? { replyAudioFile: data.audioFile } : {}),
          held: result.held, feedback: result.feedback };
        saveSession(value); return json(safeSession(value));
      }
      if (action === 'played') {
        const data = z.object({ turnId: z.string() }).parse(await body(req));
        const turn = value.turns.find(t => t.id === data.turnId && t.role === 'assistant');
        if (!turn?.audioFile) throw new ApiError('Озвучка не подготовлена.');
        turn.source = 'audio'; saveSession(value); return json({ ok: true });
      }
      if (action === 'finish' || action === 'reanalyse') {
        if (value.baseline && unassistedSpokenTurns(value).length < 2
          && (action === 'reanalyse' || (!value.analysis && value.status !== 'analysing'))) {
          throw new ApiError('Для стартового разбора нужны хотя бы два своих ответа голосом без подсказок и изменения расшифровки. Оценка может быть любой.', 400);
        }
        const queued = finishConversation(id, action === 'reanalyse');
        if (queued.status === 'analysing') void processAnalysisQueue();
        return json(safeSession(queued));
      }
      if (action === 'retry') {
        if (!value.analysis) throw new ApiError('Сначала нужен разбор.');
        const data = retryInputSchema.parse(await body(req));
        if (data.id && value.retries.some(retry => retry.id === data.id)) return json(safeSession(value));
        if (data.audioFile) getAudio(data.audioFile);
        const { support: ignoredSupport, ...integrity } = data.audioFile ? recordedSubmission(data.audioFile, data.text, data.originalTranscript)
          : transcriptIntegrity(data.text, data.originalTranscript, 'text');
        void ignoredSupport;
        const profile = getAppState().profile;
        const result = await reviewRetryAssessment(value, profile, data.text, integrity);
        value.retries.push({ id: data.id ?? randomUUID(), text: data.text, ...result, ...integrity, audioFile: data.audioFile, analysisVersion: value.analysis.version, createdAt: new Date().toISOString() });
        // A deferred ("на потом") lesson stays open until an attempt actually improves; one weak try must not close it.
        if (result.improved) {
          value.retryDeferred = false;
          // Optional stress test: the partner objects once. A failure here never costs the learner the improved retry.
          try {
            const npcLine = await pushbackLine(value, value.retries.length - 1, profile);
            value.retries[value.retries.length - 1].pushback = { npcLine, reply: null, held: null, feedback: null, createdAt: new Date().toISOString() };
          } catch { /* no pushback round this time */ }
        }
        saveSession(value); return json(safeSession(value));
      }
      if (action === 'complete') {
        if (!value.analysis) throw new ApiError('Разбор ещё не готов.');
        const data = z.object({ comfort: z.number().int().min(1).max(5).optional(), deferRetry: z.boolean().default(false) }).parse(await body(req));
        const requirement = completionRequirement(value);
        if (!requirement.canComplete && !data.deferRetry) throw new ApiError(requirement.reason || 'Сначала нужна улучшенная попытка.', 409);
        value.comfort = data.comfort; value.retryDeferred = requirement.needsRetry && data.deferRetry;
        value.processing = undefined; value.status = 'completed'; saveSession(value); return json(safeSession(value));
      }
      if (action === 'edit') {
        const data = z.object({ turnId: z.string(), text: z.string().trim().min(1).max(7000), disputed: z.boolean() }).parse(await body(req));
        const turn = value.turns.find(t => t.id === data.turnId && t.role === 'user');
        if (!turn) throw new ApiError('Твоя реплика не найдена.');
        turn.originalText ||= turn.text; turn.text = data.text; turn.disputed = data.disputed;
        if (turn.source === 'audio') {
          turn.originalTranscript ??= turn.originalText;
          turn.transcriptEdited = turn.originalTranscript.trim() !== turn.text.trim();
          turn.speechTiming = turn.audioFile ? correctedRecordingTiming(turn.audioFile, turn.text) : undefined;
        }
        // A correction after feedback stays useful, but is no longer a fresh unaided probe.
        turn.support = Math.max(turn.support, 1) as 1 | 2 | 3;
        value.analysis = null; value.retries = []; value.comfort = undefined; value.status = 'analysing'; saveSession(value); enqueueAnalysis(id); void processAnalysisQueue();
        return json(safeSession(value));
      }
    });
  }
  throw new ApiError('Действие не найдено.', 404);
}
export async function GET(req: NextRequest, route: Route) { return run(req, route); }
export async function POST(req: NextRequest, route: Route) { return run(req, route); }
export async function DELETE(req: NextRequest, route: Route) { return run(req, route); }
// Chunked call uploads (PUT /api/calls/:id/upload) are handled by the calls module.
export async function PUT(req: NextRequest, route: Route) { return run(req, route); }
async function run(req: NextRequest, route: Route) {
  try { return await handle(req, route) || json({ error: 'Действие не найдено.' }, 404); }
  catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Проверь введённые данные.' }, 400);
    const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
    return json({ error: message }, error instanceof ApiError ? error.status : 503);
  }
}
