/** Browser-side API helper shared by all web screens (same semantics as the original training-app request). */
export class ApiRequestError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown> = {}) { super(message); }
}

export async function api<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data: Record<string, unknown> = {};
  try { data = await response.json(); } catch { /* empty or non-JSON body */ }
  if (!response.ok) throw new ApiRequestError(typeof data.error === 'string' ? data.error : 'Не удалось выполнить действие.', response.status, data);
  return data as T;
}

/** Relative API path for media returned by the server (e.g. 'audio/<file>', 'calls/<id>/audio'). */
export function mediaUrl(path: string): string { return `/api/${path.replace(/^\/+/, '').replace(/^api\//, '')}`; }
