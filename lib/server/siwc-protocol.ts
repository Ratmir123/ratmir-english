import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { inferenceUsage, observeTiming, type StreamTimingEvent, type TimingObserver } from './inference-timing';

export const SIWC_MODEL = 'gpt-6.1-sol';
export const SIWC_ISSUER = 'https://auth.openai.com';
export const SIWC_RESOURCE = 'https://api.openai.com/v1';
export const SIWC_AUTHORIZE = SIWC_ISSUER + '/api/accounts/authorize';
export const SIWC_TOKEN = SIWC_ISSUER + '/api/accounts/oauth/token';
export const SIWC_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'] as const;
export type SiwcEffort = 'low' | 'medium' | 'high';
export type Fetcher = typeof fetch;
type ObjectValue = Record<string, unknown>;

const MESSAGES = {
  not_connected: 'Подключи подписку командой connect-chatgpt --login.',
  protocol: 'SIWC вернул неподтверждённый ответ протокола. Запрос остановлен.',
  state: 'Вход не подтверждён: callback отсутствует, истёк или не совпадает с попыткой.',
  declined: 'Разрешение ChatGPT отклонено. Учебный запрос не выполнялся.',
  code_expired: 'Одноразовый код входа истёк. Открой новую локальную попытку входа.',
  identity: 'Подпись или привязка аккаунта ChatGPT не подтверждена. Вход остановлен.',
  permission: 'Вход сохранён, но разрешение использовать подписку не выдано. Повтори --login после проверки доступа.',
  expired: 'Подключение ChatGPT истекло. Повтори --login.',
  too_early: 'SIWC пока не разрешает обновить подключение. Повтори запрос позже.',
  busy: 'Подключение уже обновляется другим процессом. Повтори запрос позже.',
  storage: 'Защищённое хранилище SIWC недоступно. Проверь каталог и права владельца.',
  network: 'Сервис SIWC временно недоступен. Подключение сохранено; повтори позже.',
  unavailable: 'GPT-6.1 Sol недоступна этому подключению. Другая модель не будет выбрана.',
  timeout: 'GPT-6.1 Sol не завершила запрос за три минуты.',
  stream: 'Ответ GPT-6.1 Sol не завершён. Частичный текст не засчитан.',
  tools: 'Модель запросила инструмент или изменила модель. Учебный запрос остановлен.',
  limit: 'Достигнут лимит приложения или подписки. Проверь ChatGPT Settings → Usage.',
  restricted: 'SIWC отклонил доступ по правилам аккаунта, региона или приложения.',
} as const;
export type SiwcErrorCode = keyof typeof MESSAGES;
export class SiwcError extends Error {
  readonly code: SiwcErrorCode;
  retryAt?: string;
  constructor(code: SiwcErrorCode) { super(MESSAGES[code]); this.name = 'SiwcError'; this.code = code; }
}
const OAUTH_ERRORS = ['access_denied', 'invalid_request', 'invalid_client', 'unauthorized_client', 'invalid_scope',
  'unsupported_response_type', 'server_error', 'temporarily_unavailable', 'subscription_sharing_user_not_eligible',
  'subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'] as const;
export class SiwcOAuthError extends SiwcError {
  readonly providerCode: string;
  constructor(providerCode: string) {
    const known = OAUTH_ERRORS.find(code => code === providerCode);
    const code = known === 'access_denied' ? 'declined'
      : known === 'server_error' || known === 'temporarily_unavailable' ? 'network'
      : known === 'unauthorized_client' ? 'restricted' : responseError(400, known).code;
    super(code);
    this.providerCode = known || 'unrecognized_error';
  }
}
export function safeSiwcError(error: unknown): string {
  if (error instanceof SiwcOAuthError) return error.message + ' OpenAI OAuth: ' + error.providerCode + '.';
  return error instanceof SiwcError ? error.message : MESSAGES.protocol;
}
export function objectValue(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SiwcError('protocol');
  return value as ObjectValue;
}
export function secretEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function validClientId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value !== 'dynamic_agent_client' && !/[\s\u0000-\u001f\u007f]/.test(value);
}
export interface SignInAttempt {
  state: string; nonce: string; verifier: string; challenge: string; redirectUri: string;
  hostId: string; clientId?: string; subject?: string; expiresAt: number; consumed: boolean;
}
export function signInAttempt(redirectUri: string, hostId: string, account?: { client_id: string; subject?: string }, now = Date.now()): SignInAttempt {
  const callback = new URL(redirectUri);
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/auth/callback' || callback.search || callback.hash || callback.username || callback.password) throw new SiwcError('state');
  const verifier = randomBytes(48).toString('base64url');
  return { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
    verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri, hostId,
    ...(account ? { clientId: account.client_id, subject: account.subject } : {}), expiresAt: now + 10 * 60_000, consumed: false };
}
export function authorizationUrl(attempt: SignInAttempt): URL {
  const url = new URL(SIWC_AUTHORIZE);
  url.search = new URLSearchParams({ client_id: attempt.clientId || 'dynamic_agent_client',
    ...(attempt.clientId ? {} : { agent_name_hint: 'Ratmir English' }), ext_agent_host_id: attempt.hostId,
    response_type: 'code', redirect_uri: attempt.redirectUri, scope: SIWC_SCOPES.join(' '),
    resource: SIWC_RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: attempt.challenge }).toString();
  // Returning sign-in intentionally omits optional email and retained ID-token hints.
  return url;
}
export function consumeCallback(attempt: SignInAttempt, callback: URL, now = Date.now()): { code: string; clientId: string } {
  const expected = new URL(attempt.redirectUri);
  const state = callback.searchParams.get('state') || '';
  if (attempt.consumed || attempt.expiresAt <= now || callback.origin !== expected.origin || callback.pathname !== expected.pathname
    || callback.hash || callback.searchParams.getAll('state').length !== 1 || !secretEqual(state, attempt.state)) throw new SiwcError('state');
  attempt.consumed = true;
  if (callback.searchParams.has('error')) {
    if (callback.searchParams.getAll('error').length !== 1) throw new SiwcError('protocol');
    throw new SiwcOAuthError(callback.searchParams.get('error') || '');
  }
  const code = callback.searchParams.get('code');
  const supplied = callback.searchParams.get('client_id');
  if (!code || code.length > 4096 || callback.searchParams.getAll('code').length !== 1 || callback.searchParams.getAll('client_id').length > 1) throw new SiwcError('protocol');
  const clientId = supplied || attempt.clientId;
  if (!validClientId(clientId)
    || (attempt.clientId && clientId !== attempt.clientId)) throw new SiwcError('identity');
  return { code, clientId };
}
export interface OpenAiDiscovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export async function readJsonBounded(response: Response, limit = 256_000): Promise<ObjectValue> {
  if (!response.body) throw new SiwcError('protocol');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length; if (size > limit) throw new SiwcError('protocol'); chunks.push(value);
    }
    return objectValue(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) { if (error instanceof SiwcError) throw error; throw new SiwcError('protocol'); }
  finally { await reader.cancel().catch(() => undefined); }
}
export async function discovery(fetcher: Fetcher = fetch): Promise<OpenAiDiscovery> {
  try {
    const response = await fetcher(SIWC_ISSUER + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) throw new SiwcError('network');
    const data = await readJsonBounded(response);
    if (data.issuer !== SIWC_ISSUER || data.authorization_endpoint !== SIWC_AUTHORIZE || data.token_endpoint !== SIWC_TOKEN
      || data.jwks_uri !== SIWC_ISSUER + '/.well-known/jwks.json') throw new SiwcError('identity');
    return data as unknown as OpenAiDiscovery;
  } catch (error) { if (error instanceof SiwcError) throw error; throw new SiwcError('network'); }
}
let remoteKeys: JWTVerifyGetKey | undefined;
export async function verifyIdentity(idToken: string, clientId: string, nonce: string | undefined, expectedSubject?: string, keys?: JWTVerifyGetKey, now?: number): Promise<JWTPayload> {
  try {
    if (!keys) {
      if (!remoteKeys) { const config = await discovery(); remoteKeys = createRemoteJWKSet(new URL(config.jwks_uri), { timeoutDuration: 15_000 }); }
      keys = remoteKeys;
    }
    const { payload } = await jwtVerify(idToken, keys, { issuer: SIWC_ISSUER, audience: clientId, algorithms: ['RS256', 'ES256', 'PS256', 'EdDSA'],
      requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5, ...(now === undefined ? {} : { currentDate: new Date(now) }) });
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)
      || (expectedSubject !== undefined && payload.sub !== expectedSubject)) throw new SiwcError('identity');
    return payload;
  } catch (error) { if (error instanceof SiwcError) throw error; throw new SiwcError('identity'); }
}
export function responseError(status: number, code?: unknown): SiwcError {
  if (code === 'model_not_found' || code === 'unsupported_model' || code === 'invalid_model') return new SiwcError('unavailable');
  if (code === 'subscription_sharing_usage_limit_exceeded' || status === 429) return new SiwcError('limit');
  if (code === 'subscription_sharing_user_not_eligible' || status === 403) return new SiwcError('restricted');
  if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') return new SiwcError('network');
  if (status === 401) return new SiwcError('expired');
  if (status >= 500) return new SiwcError('network');
  return new SiwcError('protocol');
}
export function responsesBody(prompt: string, schema: ObjectValue | undefined, effort: SiwcEffort, instructions: string): ObjectValue {
  if (!prompt.trim() || prompt.length > 200_000 || instructions.length > 100_000 || !['low', 'medium', 'high'].includes(effort)) throw new SiwcError('protocol');
  return { model: SIWC_MODEL, instructions, input: [{ role: 'user', content: prompt }], reasoning: { effort },
    tools: [], store: false, stream: true, ...(schema ? { text: { format: { type: 'json_schema', name: 'english_training', strict: true, schema } } } : {}) };
}
function completedText(response: ObjectValue): string {
  if (response.model !== SIWC_MODEL) throw new SiwcError('tools');
  if (response.status !== 'completed' || response.error || response.incomplete_details || !Array.isArray(response.output)) throw new SiwcError('stream');
  const texts: string[] = [];
  for (const raw of response.output) {
    const item = objectValue(raw);
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) throw new SiwcError('tools');
    for (const rawContent of item.content) {
      const content = objectValue(rawContent);
      if (content.type !== 'output_text' || typeof content.text !== 'string') throw new SiwcError('stream');
      texts.push(content.text);
    }
  }
  const text = texts.join('\n').trim();
  if (!text || text.length > 1_000_000) throw new SiwcError('stream');
  return text;
}
export async function consumeResponsesStream(response: Response, onTiming?: TimingObserver<StreamTimingEvent>): Promise<string> {
  const timing = (event: StreamTimingEvent) => observeTiming(onTiming, event);
  if (!response.ok) {
    const body: ObjectValue = await readJsonBounded(response).catch(() => ({}));
    const error = body.error && typeof body.error === 'object' ? body.error as ObjectValue : {};
    const failure = responseError(response.status, error.code);
    // Retry-After is an explicit retry hint, not a subscription reset prediction.
    const retry = response.headers.get('retry-after');
    if (failure.code === 'limit' && retry) {
      const timestamp = /^\d{1,8}$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
      if (Number.isFinite(timestamp) && timestamp > Date.now() && timestamp < Date.now() + 30 * 86_400_000) failure.retryAt = new Date(timestamp).toISOString();
    }
    throw failure;
  }
  const contentType = response.headers.get('content-type')?.toLowerCase();
  // Some plan-usage responses omit this header. The event parser still requires
  // a well-formed, completed response from the exact model before returning text.
  if ((contentType && !contentType.startsWith('text/event-stream')) || !response.body) throw new SiwcError('stream');
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = ''; let bytes = 0; let deltaLength = 0; let responseId: string | undefined;
  const completedItems = new Map<number, ObjectValue>();
  const event = (frame: string): string | undefined => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return;
    const item = objectValue(JSON.parse(data));
    if (typeof item.type !== 'string') throw new SiwcError('stream');
    if (item.response_id !== undefined && item.response_id !== responseId) throw new SiwcError('stream');
    if (item.type === 'error' || item.type === 'response.failed') {
      const failed = item.response ? objectValue(item.response) : item;
      const error = failed.error ? objectValue(failed.error) : failed;
      throw responseError(400, error.code);
    }
    if (item.type === 'response.incomplete' || item.type === 'response.output_text.refusal' || item.type.includes('refusal')) throw new SiwcError('stream');
    if (item.type.includes('function_call') || item.type.includes('tool_call')) throw new SiwcError('tools');
    if (item.type === 'response.output_item.added' || item.type === 'response.output_item.done') {
      const output = objectValue(item.item);
      if (!['message', 'reasoning'].includes(String(output.type))) throw new SiwcError('tools');
      if (item.type === 'response.output_item.done') {
        const index = item.output_index;
        if (!responseId || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 10_000
          || typeof output.id !== 'string' || !output.id || output.id.length > 256 || completedItems.has(index)) throw new SiwcError('stream');
        completedItems.set(index, output);
      }
    }
    if (item.type === 'response.output_text.delta') {
      if (typeof item.delta !== 'string') throw new SiwcError('stream');
      deltaLength += item.delta.length; if (deltaLength > 1_000_000) throw new SiwcError('stream');
      if (item.delta.length) timing({ phase: 'text', characters: item.delta.length });
    }
    if (item.type === 'response.created' || item.type === 'response.in_progress' || item.type === 'response.completed') {
      const result = objectValue(item.response);
      if (result.model !== SIWC_MODEL || typeof result.id !== 'string' || (responseId && result.id !== responseId)) throw new SiwcError('tools');
      responseId = result.id;
      if (item.type === 'response.created') timing({ phase: 'created' });
      if (item.type === 'response.completed') {
        // Plan-usage streams can leave terminal output empty after sending the
        // full items in output_item.done. Only committed items are reconstructed;
        // deltas alone never count as an answer, and completion remains required.
        if (Array.isArray(result.output) && result.output.length === 0 && completedItems.size) {
          const entries = [...completedItems].sort(([a], [b]) => a - b);
          if (entries.some(([index], position) => index !== position)) throw new SiwcError('stream');
          const text = completedText({ ...result, output: entries.map(([, output]) => output) });
          timing({ phase: 'completed', usage: inferenceUsage(result.usage) });
          return text;
        }
        const text = completedText(result);
        timing({ phase: 'completed', usage: inferenceUsage(result.usage) });
        return text;
      }
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      timing({ phase: 'first-byte' });
      bytes += chunk.value.length; if (bytes > 8_000_000) throw new SiwcError('stream');
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (frame.length > 1_200_000) throw new SiwcError('stream');
        const text = event(frame); if (text !== undefined) return text;
      }
      if (buffer.length > 1_200_000) throw new SiwcError('stream');
    }
    if (buffer.trim()) { const text = event(buffer.replace(/\r\n/g, '\n')); if (text !== undefined) return text; }
    throw new SiwcError('stream');
  } catch (error) { if (error instanceof SiwcError) throw error; throw new SiwcError('stream'); }
  finally { await reader.cancel().catch(() => undefined); }
}
