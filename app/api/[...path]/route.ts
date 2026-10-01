import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getBrainStatus, getSubscriptionUsage } from '@/lib/server/codex';
import { getAppState, getSession, createSession, saveSession, updateProfile, deleteSession, deleteAllTraining, enqueueAnalysis } from '@/lib/server/store';
import { planLesson, respond, hint, reviewRetryAssessment } from '@/lib/server/teacher';
import { audioConfigured, setAudioKey, getAudio, transcribe, synthesize, cleanAudio } from '@/lib/server/audio';
import { checkAccess, checkOrigin, validAccessCode, accessCookie, requestIsSecure, ApiError } from '@/lib/server/security';
import { ensureWorker, processAnalysisQueue } from '@/lib/server/worker';
import { assessQuickCoachRetry, explainQuickCoach, quickCoachInputSchema, quickCoachRetryInputSchema } from '@/lib/server/quick-coach';
import { FAMILIES, CALIBRATION_OPTIONS } from '@/lib/training';
import type { AppState, Session, Profile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Route = { params: Promise<{ path: string[] }> };
const globals = globalThis as unknown as { trainingLocks?: Map<string, Promise<unknown>> };
const locks = globals.trainingLocks ||= new Map();
async function locked<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) || Promise.resolve();
  const work = previous.catch(() => undefined).then(task);
  locks.set(id, work);
  try { return await work; } finally { if (locks.get(id) === work) locks.delete(id); }
}
function session(id: string) {
  const value = getSession(id);
  if (!value) throw new ApiError('Занятие не найдено.', 404);
  return value;
}
function safeSession(value: Session): Session {
  return { ...value, lesson: { ...value.lesson, npcBrief: '', hiddenFacts: [] } };
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
  professionalContext: z.string().max(2000), relocation: z.string().max(1000), dailyMinutes: z.number().min(5).max(60),
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
    if (path[0] === 'status') return json({ brain: await getBrainStatus(), hosting: process.env.TRAINING_DEPLOYMENT === 'server' ? 'server' : 'local', audio: { configured: audioConfigured(), model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts' } });
    if (path[0] === 'families') return json({ families: FAMILIES, calibration: CALIBRATION_OPTIONS });
    if (path[0] === 'sessions' && path[1]) return json(safeSession(session(path[1])));
    if (path[0] === 'audio' && path[1]) {
      const bytes = getAudio(path[1]);
      const type = path[1].endsWith('.mp3') ? 'audio/mpeg' : path[1].endsWith('.mp4') ? 'audio/mp4' : path[1].endsWith('.ogg') ? 'audio/ogg' : 'audio/webm';
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
  if (req.method === 'POST' && path[0] === 'transcribe') {
    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof File)) throw new ApiError('Запись отсутствует.');
    return json(await transcribe(file, Number(form.get('minutes'))));
  }
  if (req.method !== 'POST') throw new ApiError('Действие не найдено.', 404);
  if (path[0] === 'profile') { updateProfile(profileSchema.parse(await body(req)) as Profile); return json(safeState(getAppState())); }
  if (path[0] === 'audio-key') {
    const data = z.object({ key: z.string().max(500) }).parse(await body(req));
    setAudioKey(data.key.trim()); return json({ configured: audioConfigured() });
  }
  if (path[0] === 'reset') {
    const data = z.object({ confirmation: z.literal('DELETE') }).parse(await body(req));
    void data; cleanAudio(0); deleteAllTraining(); return json(safeState(getAppState()));
  }
  if (path[0] === 'sessions' && !path[1]) {
    const data = z.object({ mode: z.enum(['learning', 'call']), context: z.enum(['work', 'life', 'relocation']).optional(), familyId: z.string().max(100).optional(), topic: z.string().max(300).optional(), minutes: z.number().int().min(5).max(30).optional() }).parse(await body(req));
    return locked('planning', async () => {
      const existing = getAppState().sessions.find(s => s.status === 'active');
      if (existing) return json(safeSession(existing));
      const plan = await planLesson(getAppState(), data);
      const value = createSession({ ...plan, id: randomUUID() }, data.mode);
      value.turns.push({ id: randomUUID(), role: 'assistant', text: plan.opening, createdAt: new Date().toISOString(), source: 'text', support: 0 });
      saveSession(value); return json(safeSession(value));
    });
  }
  if (path[0] === 'sessions' && path[1]) {
    const id = path[1], action = path[2];
    return locked(id, async () => {
      const value = session(id);
      if (action === 'message') {
        if (value.status !== 'active' && value.status !== 'error') throw new ApiError('Этот разговор уже завершён.');
        const data = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(7000), source: z.enum(['text', 'audio']), audioFile: z.string().max(100).optional(), textVisible: z.boolean().default(false) }).parse(await body(req));
        const previous = value.turns.findIndex(t => t.id === data.id);
        if (previous >= 0 && value.turns.slice(previous + 1).some(t => t.role === 'assistant')) return json(safeSession(value));
        if (previous < 0 && value.turns.at(-1)?.role === 'user') throw new ApiError('Сначала повтори ответ собеседника на сохранённую реплику.', 409);
        if (data.textVisible) {
          const heard = [...value.turns].reverse().find(t => t.role === 'assistant');
          if (heard) heard.support = Math.max(heard.support, 1) as 1 | 2 | 3;
        }
        if (data.source === 'audio') { if (!data.audioFile) throw new ApiError('Нет исходной записи.'); getAudio(data.audioFile); }
        if (previous < 0) value.turns.push({ ...data, role: 'user', support: value.support, createdAt: new Date().toISOString() });
        value.status = 'active'; value.error = undefined; saveSession(value);
        try {
          const text = await respond(value, getAppState().profile);
          value.turns.push({ id: randomUUID(), role: 'assistant', text, source: 'text', support: data.textVisible ? 1 : 0, createdAt: new Date().toISOString() });
          value.support = 0; saveSession(value);
        } catch (error) {
          value.error = error instanceof Error ? error.message : 'Собеседник не смог ответить.';
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
        if (value.status === 'active') {
          const turn = [...value.turns].reverse().find(t => t.role === 'assistant');
          if (turn) turn.support = Math.max(turn.support, 1) as 1 | 2 | 3;
          saveSession(value);
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
        if (!turn.audioFile) { turn.audioFile = await synthesize(turn.text); saveSession(value); }
        return json({ file: turn.audioFile });
      }
      if (action === 'played') {
        const data = z.object({ turnId: z.string() }).parse(await body(req));
        const turn = value.turns.find(t => t.id === data.turnId && t.role === 'assistant');
        if (!turn?.audioFile) throw new ApiError('Озвучка не подготовлена.');
        turn.source = 'audio'; saveSession(value); return json({ ok: true });
      }
      if (action === 'finish' || action === 'reanalyse') {
        if (!value.turns.some(t => t.role === 'user')) throw new ApiError('Для разбора нужна хотя бы одна твоя попытка.');
        value.status = 'analysing'; value.error = undefined; value.analysis = null; saveSession(value);
        enqueueAnalysis(id); void processAnalysisQueue(); return json(safeSession(value));
      }
      if (action === 'retry') {
        if (!value.analysis) throw new ApiError('Сначала нужен разбор.');
        const data = z.object({ text: z.string().trim().min(1).max(7000), audioFile: z.string().max(100).optional() }).parse(await body(req));
        if (data.audioFile) getAudio(data.audioFile);
        const result = await reviewRetryAssessment(value, getAppState().profile, data.text);
        value.retries.push({ text: data.text, ...result, audioFile: data.audioFile, createdAt: new Date().toISOString() }); saveSession(value); return json(safeSession(value));
      }
      if (action === 'complete') {
        if (!value.analysis) throw new ApiError('Разбор ещё не готов.');
        if (value.analysis.priorities.length && value.retries.at(-1)?.improved !== true) throw new ApiError('Сначала добейся улучшения в своей попытке по разбору. Можно вернуться к ней позже.');
        const data = z.object({ comfort: z.number().int().min(1).max(5).optional() }).parse(await body(req));
        value.comfort = data.comfort; value.status = 'completed'; saveSession(value); return json(safeSession(value));
      }
      if (action === 'edit') {
        const data = z.object({ turnId: z.string(), text: z.string().trim().min(1).max(7000), disputed: z.boolean() }).parse(await body(req));
        const turn = value.turns.find(t => t.id === data.turnId && t.role === 'user');
        if (!turn) throw new ApiError('Твоя реплика не найдена.');
        turn.originalText ||= turn.text; turn.text = data.text; turn.disputed = data.disputed;
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
async function run(req: NextRequest, route: Route) {
  try { return await handle(req, route) || json({ error: 'Действие не найдено.' }, 404); }
  catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Проверь введённые данные.' }, 400);
    const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
    return json({ error: message }, error instanceof ApiError ? error.status : 503);
  }
}

