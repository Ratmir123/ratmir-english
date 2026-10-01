import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { assertServerConfiguration, publicApplicationOrigin } from './configuration';

export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest();
export function validAccessCode(value: string) {
  const expected = process.env.TRAINING_ACCESS_CODE;
  return !!expected && timingSafeEqual(hash(value), hash(expected));
}
export function accessCookie() {
  return createHash('sha256').update(`training-local:${process.env.TRAINING_ACCESS_CODE}`).digest('hex');
}
function requestAddress(req: NextRequest) {
  try { assertServerConfiguration(); }
  catch { throw new ApiError('Сервер приложения ещё не настроен для этого режима доступа.', 503); }
  const url = new URL(req.url);
  const host = req.headers.get('host');
  // Next can reconstruct req.url with its internal hostname. The incoming Host
  // is the browser's address; forwarded host headers are not trusted here.
  if (!host || !/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.test(host)) {
    throw new ApiError('Некорректный адрес приложения.', 400);
  }
  try {
    const incoming = new URL(`${url.protocol}//${host}/`);
    const publicOrigin = publicApplicationOrigin();
    if (!publicOrigin) return incoming;
    const publicAddress = new URL(publicOrigin);
    // TLS can terminate at our configured reverse proxy. The configured origin,
    // rather than arbitrary forwarded headers, defines the browser's address.
    const incomingAuthority = new URL(`https://${host}/`).host;
    if (incomingAuthority === publicAddress.host) return publicAddress;
    if (['localhost', '127.0.0.1', '::1'].includes(incoming.hostname.replace(/^\[|\]$/g, ''))) return incoming;
    throw new ApiError('Адрес запроса не совпадает с адресом личного приложения.', 403);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Некорректный адрес приложения.', 400);
  }
}
export function requestIsSecure(req: NextRequest): boolean { return requestAddress(req).protocol === 'https:'; }
export function checkOrigin(req: NextRequest) {
  const url = requestAddress(req);
  const origin = req.headers.get('origin');
  if (origin !== null && origin !== url.origin) throw new ApiError('Запрос пришёл из другого приложения.', 403);
}
export function checkAccess(req: NextRequest) {
  checkOrigin(req);
  const url = requestAddress(req);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  const code = process.env.TRAINING_ACCESS_CODE;
  if (!code) {
    if (!local) throw new ApiError('Для телефона сначала настрой личный код доступа на ПК.', 401);
    return;
  }
  const cookie = req.cookies.get('training-access')?.value;
  if (!cookie || !timingSafeEqual(hash(cookie), hash(accessCookie()))) throw new ApiError('Нужен личный код доступа.', 401);
}
