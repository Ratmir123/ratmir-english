import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from './security';

export { ApiError };

export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Parse a bounded JSON body. Large binary uploads use their own streaming routes. */
export async function readJson(req: NextRequest, limit = 64_000): Promise<unknown> {
  if (Number(req.headers.get('content-length') || 0) > limit) throw new ApiError('Слишком большой запрос.', 413);
  try { return await req.json(); } catch { throw new ApiError('Некорректные данные.'); }
}

const globals = globalThis as unknown as { trainingLocks?: Map<string, Promise<unknown>> };
const locks = globals.trainingLocks ||= new Map();
/** Serialise work per key inside this process (sessions, placement attempt, call id). */
export async function locked<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) || Promise.resolve();
  const work = previous.catch(() => undefined).then(task);
  locks.set(id, work);
  try { return await work; } finally { if (locks.get(id) === work) locks.delete(id); }
}
