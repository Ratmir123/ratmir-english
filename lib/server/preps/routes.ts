import type { NextRequest } from 'next/server';
import { ApiError, json } from '../http';
import { getSession } from '../store';
import { PREP_MAX_TOTAL_BYTES } from '../../preps/types';
import { enqueuePrep, ensurePrepQueue, requeueStalePreps } from './queue';
import { PREP_BAD_UPLOAD, PREP_TOO_LARGE, createPrep, deletePrep, getPrep, listPreps, presentPrep, retryPrep } from './service';

/**
 * /api/preps/* (PASS-0.5.5 §2), called by app/api/[...path]/route.ts AFTER checkAccess(); `path` includes 'preps'.
 *   POST /api/preps              multipart: images (0–8), text, goal, callAt, origin → { prep }  (status 'reading')
 *   GET  /api/preps                                                                  → { preps }
 *   GET  /api/preps/:id                                                              → { prep }  (404 «Подготовка не найдена.»)
 *   POST /api/preps/:id/retry                                                        → { prep }
 *   POST /api/preps/:id/delete   (or DELETE /api/preps/:id)                          → { ok: true }
 * Rehearsals start with POST /api/sessions { prepId, mode }.
 */
const NOT_FOUND = 'Действие не найдено.';
const lookup = (id: string) => getSession(id);

async function readPrepForm(req: NextRequest) {
  // The screenshots plus the form overhead; a bigger body is refused unread.
  if (Number(req.headers.get('content-length') || 0) > PREP_MAX_TOTAL_BYTES + 2_000_000) throw new ApiError(PREP_TOO_LARGE, 413);
  let form: FormData;
  try { form = await req.formData(); } catch { throw new ApiError(PREP_BAD_UPLOAD, 400); }
  return { images: form.getAll('images'), text: form.get('text'), goal: form.get('goal'), callAt: form.get('callAt'), origin: form.get('origin') };
}

export async function handlePrepsRoute(req: NextRequest, path: string[]): Promise<Response> {
  ensurePrepQueue();
  const method = req.method;
  if (path.length === 1) {
    if (method === 'GET') return json({ preps: listPreps(lookup) });
    if (method === 'POST') {
      const prep = await createPrep(await readPrepForm(req));
      enqueuePrep(prep.id);
      return json({ prep: presentPrep(prep, lookup) });
    }
    throw new ApiError(NOT_FOUND, 404);
  }
  const id = path[1];
  if (path.length === 2 && method === 'GET') {
    // A poll also picks up a prep a previous process left half-read.
    requeueStalePreps();
    return json({ prep: getPrep(id, lookup) });
  }
  if ((path.length === 2 && method === 'DELETE') || (path.length === 3 && path[2] === 'delete' && method === 'POST')) {
    deletePrep(id);
    return json({ ok: true });
  }
  if (path.length === 3 && path[2] === 'retry' && method === 'POST') {
    const prep = retryPrep(id);
    enqueuePrep(prep.id);
    return json({ prep: presentPrep(prep, lookup) });
  }
  throw new ApiError(NOT_FOUND, 404);
}
