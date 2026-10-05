// Shared request helper for the web screens: lib/client/api.ts plus Russian error normalisation (audit U-21/C-12).
import { api, ApiRequestError } from '@/lib/client/api';

export { ApiRequestError };
export type RequestError = Error & { status?: number; data?: Record<string, unknown> };

export function normaliseError(error: unknown): RequestError {
  if (error instanceof ApiRequestError) {
    // A proxy HTML page or an empty body never carries a Russian `error` field.
    if (typeof error.data.error !== 'string' && error.status >= 500) {
      return Object.assign(new Error(`Сервер не ответил (код ${error.status}). Повтори через минуту.`), { status: error.status, data: error.data });
    }
    return Object.assign(error, { status: error.status });
  }
  if (error instanceof DOMException && error.name === 'AbortError') return error as RequestError;
  if (error instanceof TypeError) return Object.assign(new Error('Нет связи с сервером тренинга. Проверь подключение и повтори.'), { status: 0 });
  return error instanceof Error ? error : new Error('Не удалось выполнить действие.');
}

export async function request<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  try { return await api<T>(path, body, method, signal); }
  catch (error) { throw normaliseError(error); }
}

export function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}
export function messageOf(error: unknown, fallback = 'Не удалось выполнить действие.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
