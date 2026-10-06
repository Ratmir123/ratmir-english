import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ApiError, json, locked } from '../http';
import { ensurePhraseQueue } from './queue';
import { PHRASE_ID } from './repository';
import { PHRASE_NOT_FOUND, createPhrase, deletePhrase, getPhrase, updatePhrase } from './service';

/**
 * /api/phrases/* (PASS-0.5.3 §1.2), called by app/api/[...path]/route.ts AFTER checkAccess(); `path` includes 'phrases'.
 *   POST /api/phrases                { text, origin }                        → { phrase, duplicate }
 *   GET  /api/phrases/:id                                                    → { phrase }        (404 «Фраза не найдена.»)
 *   POST /api/phrases/:id            { archived?, relearn?, retryEnrichment? } → { phrase }
 *   POST /api/phrases/:id/delete     {}                                      → { deleted: true }
 */
const NOT_FOUND = 'Действие не найдено.';
const updateSchema = z.object({ archived: z.boolean().optional(), relearn: z.literal(true).optional(), retryEnrichment: z.literal(true).optional() });

/** A bounded JSON body; an empty body is {}. */
async function readBody(req: NextRequest, limit = 16_000): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') || 0) > limit) throw new ApiError('Слишком большой запрос.', 413);
  const text = (await req.text()).trim();
  if (text.length > limit) throw new ApiError('Слишком большой запрос.', 413);
  if (!text) return {};
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ApiError('Некорректные данные.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('Некорректные данные.');
  return value as Record<string, unknown>;
}

export async function handlePhrasesRoute(req: NextRequest, path: string[]): Promise<Response> {
  ensurePhraseQueue();
  const method = req.method;
  if (path.length === 1) {
    if (method !== 'POST') throw new ApiError(NOT_FOUND, 404);
    const data = await readBody(req);
    return json(createPhrase({ text: data.text, origin: data.origin }));
  }
  const id = path[1];
  if (!PHRASE_ID.test(id) || path.length > 3) throw new ApiError(PHRASE_NOT_FOUND, 404);
  if (path.length === 2 && method === 'GET') return json({ phrase: getPhrase(id) });
  if (path.length === 2 && method === 'POST') {
    const parsed = updateSchema.safeParse(await readBody(req, 8_000));
    if (!parsed.success) throw new ApiError('Проверь введённые данные.', 400);
    return locked(`phrase:${id}`, async () => json({ phrase: updatePhrase(id, parsed.data) }));
  }
  if (path.length === 3 && path[2] === 'delete' && method === 'POST') {
    await readBody(req, 8_000);
    return locked(`phrase:${id}`, async () => { deletePhrase(id); return json({ deleted: true }); });
  }
  throw new ApiError(NOT_FOUND, 404);
}
