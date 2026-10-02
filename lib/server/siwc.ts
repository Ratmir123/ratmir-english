import type { JWTVerifyGetKey } from 'jose';
import type { BrainStatus } from '../types';
import { SiwcStore, type SiwcRegistration, type SiwcTokens } from './siwc-store';
import { addBrainActivity } from './store';
import { inferenceTiming, observeTiming, type InferenceTiming, type InferencePurpose, type TimingObserver } from './inference-timing';
import { SIWC_ISSUER, SIWC_MODEL, SIWC_RESOURCE, SIWC_TOKEN, SiwcError, consumeCallback, consumeResponsesStream, objectValue, readJsonBounded, responseError, responsesBody, safeSiwcError, verifyIdentity,
  type Fetcher, type SignInAttempt, type SiwcEffort } from './siwc-protocol';

const SHARING = 'chatgpt.tokens.use.direct';
const REFRESH_LIFETIME = 30 * 24 * 60 * 60_000;
const TERMINAL_REFRESH = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
export function earliestRefreshMs(value: unknown): number {
  if (value === undefined) return 0;
  // The official OpenAI DevKit treats numbers as Unix seconds and strings as dates.
  const time = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || time < 0) throw new SiwcError('protocol');
  return time;
}
function tokenFields(data: Record<string, unknown>, now: number, previous?: SiwcRegistration): SiwcTokens {
  const scope = data.scope === undefined && previous ? previous.scopes.join(' ') : data.scope;
  if (typeof scope !== 'string') throw new SiwcError('protocol');
  const scopes = [...new Set(scope.split(/\s+/).filter(Boolean))];
  const direct = scopes.includes(SHARING);
  const idToken = data.id_token === undefined && previous ? previous.id_token : data.id_token;
  const idTokenReceivedAt = data.id_token === undefined && previous ? previous.id_token_received_at : now;
  if (typeof idToken !== 'string' || !idToken || idToken.length > 32_000) throw new SiwcError('protocol');
  if (data.access_token === undefined && !direct && !previous) return { id_token: idToken, id_token_received_at: idTokenReceivedAt, access_token: '', refresh_token: '', scopes, expires_at: 0, refresh_expires_at: 0 };
  if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 32_000
    || typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 32_000
    || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'
    || typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 3600) throw new SiwcError('protocol');
  earliestRefreshMs(data.earliest_refresh_at);
  return { id_token: idToken, id_token_received_at: idTokenReceivedAt, access_token: data.access_token, refresh_token: data.refresh_token, scopes,
    expires_at: now + data.expires_in * 1000, refresh_expires_at: now + REFRESH_LIFETIME,
    ...(data.earliest_refresh_at === undefined ? {} : { earliest_refresh_at: data.earliest_refresh_at as string | number }) };
}
export class SiwcClient {
  readonly store: SiwcStore;
  private fetcher: Fetcher;
  private keys?: JWTVerifyGetKey;
  private now: () => number;
  private onTiming?: TimingObserver<InferenceTiming>;
  private purpose: InferencePurpose;
  constructor(options: { store?: SiwcStore; fetcher?: Fetcher; keys?: JWTVerifyGetKey; now?: () => number;
    onTiming?: TimingObserver<InferenceTiming>; purpose?: InferencePurpose } = {}) {
    this.store = options.store || new SiwcStore(); this.fetcher = options.fetcher || fetch; this.keys = options.keys; this.now = options.now || Date.now;
    this.onTiming = options.onTiming; this.purpose = options.purpose ?? 'other';
  }
  async status(): Promise<BrainStatus> {
    const base: BrainStatus = { connected: false, authenticated: false, model: SIWC_MODEL, modelAvailable: false, verified: false, authType: 'siwc', plan: null };
    try {
      const [host, record] = await Promise.all([this.store.host(), this.store.registration()]);
      if (!record) return { ...base, error: safeSiwcError(new SiwcError('not_connected')) };
      if (!host) throw new SiwcError('storage');
      const permitted = record.scopes.includes(SHARING);
      const renewable = record.refresh_expires_at > this.now() && !!record.refresh_token;
      const authenticated = permitted && (!!record.pending_refresh || record.expires_at > this.now() || renewable);
      const verified = authenticated && !!record.model_verified_at;
      return { ...base, connected: true, authenticated, verified, modelAvailable: authenticated && record.model_available === true,
        ...(!permitted ? { error: safeSiwcError(new SiwcError('permission')) } : !authenticated ? { error: safeSiwcError(new SiwcError('expired')) }
          : record.model_available === false ? { error: safeSiwcError(new SiwcError('unavailable')) }
          : !verified ? { error: 'Вход сохранён. Проверь доступ к GPT-6.1 Sol явной командой --probe.' } : {}) };
    } catch (error) { return { ...base, error: safeSiwcError(error) }; }
  }
  async finishLogin(attempt: SignInAttempt, callback: URL): Promise<void> {
    const { code, clientId } = consumeCallback(attempt, callback, this.now());
    // Issued registration metadata can survive a rejected one-time code within
    // this process. It is not a verified identity and is never persisted alone.
    attempt.clientId = clientId;
    const record = await this.store.withLock(async () => {
      // The browser wait stays outside this lock. Exchange, verification and commit
      // share the refresh lock so a rotated grant cannot be overwritten by login.
      const data = await this.tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
        code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: SIWC_RESOURCE }));
      if (data.client_id !== undefined && data.client_id !== clientId) throw new SiwcError('identity');
      const receivedAt = this.now(); const fields = tokenFields(data, receivedAt);
      const identity = await verifyIdentity(fields.id_token, clientId, attempt.nonce, attempt.subject, this.keys, receivedAt);
      const replacement: SiwcRegistration = { version: 1, issuer: SIWC_ISSUER, client_id: clientId, subject: identity.sub!,
        received_at: receivedAt, ...fields };
      const host = await this.store.host(); const current = await this.store.registration();
      if (host?.host_id !== attempt.hostId || (current && (current.client_id !== clientId || current.subject !== identity.sub))) throw new SiwcError('identity');
      await this.store.save(replacement);
      return replacement;
    });
    if (!record.scopes.includes(SHARING)) throw new SiwcError('permission');
  }
  private async tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetcher(SIWC_TOKEN, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
      const data = await readJsonBounded(response);
      if (!response.ok) {
        const error = typeof data.error === 'string' ? data.error : data.error && typeof data.error === 'object' ? objectValue(data.error).code : undefined;
        if (body.get('grant_type') === 'refresh_token' && typeof error === 'string' && TERMINAL_REFRESH.has(error)) throw new SiwcError('expired');
        if (body.get('grant_type') === 'authorization_code' && error === 'invalid_grant') throw new SiwcError('code_expired');
        throw responseError(response.status, error);
      }
      if (response.status !== 200) throw new SiwcError('protocol');
      return data;
    } catch (error) { if (error instanceof SiwcError) throw error; throw new SiwcError('network'); }
  }
  async access(minValidityMs = 60_000): Promise<SiwcRegistration> {
    if (!Number.isSafeInteger(minValidityMs) || minValidityMs < 0 || minValidityMs > 210_000) throw new SiwcError('protocol');
    return this.store.withLock(async () => {
      let current = await this.store.registration();
      if (!current || !await this.store.host()) throw new SiwcError('not_connected');
      if (!current.scopes.includes(SHARING)) throw new SiwcError('permission');
      if (!current.pending_refresh && current.expires_at > this.now() + minValidityMs) return current;
      if (!current.pending_refresh) {
        if (current.refresh_expires_at <= this.now()) throw new SiwcError('expired');
        if (earliestRefreshMs(current.earliest_refresh_at) > this.now()) {
          throw new SiwcError('too_early');
        }
        let data;
        try { data = await this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', client_id: current.client_id,
          refresh_token: current.refresh_token, resource: SIWC_RESOURCE })); }
        catch (error) {
          if (error instanceof SiwcError && error.code === 'expired') await this.store.save({ ...current, access_token: '', refresh_token: '',
            scopes: [], expires_at: 0, refresh_expires_at: 0, model_available: false, model_verified_at: undefined });
          throw error;
        }
        if (data.client_id !== undefined && data.client_id !== current.client_id) throw new SiwcError('identity');
        const receivedAt = this.now(); const fields = tokenFields(data, receivedAt, current);
        // Checkpoint a rotated grant before JWKS verification. A transient outage must
        // never make another process reuse the consumed refresh token.
        current = { ...current, pending_refresh: { ...fields, received_at: receivedAt } };
        await this.store.save(current);
      }
      const pending = current.pending_refresh!;
      await verifyIdentity(pending.id_token, current.client_id, undefined, current.subject, this.keys, pending.id_token_received_at);
      const { pending_refresh: ignored, ...previous } = current; void ignored;
      const { received_at: receivedAt, ...fields } = pending;
      const replacement = { ...previous, ...fields, received_at: receivedAt };
      await this.store.save(replacement);
      if (!replacement.scopes.includes(SHARING)) throw new SiwcError('permission');
      if (replacement.expires_at <= this.now()) throw new SiwcError('expired');
      if (replacement.expires_at <= this.now() + minValidityMs) throw new SiwcError('too_early');
      return replacement;
    });
  }
  private async models(record: SiwcRegistration): Promise<boolean> {
    try {
      const response = await this.fetcher(SIWC_RESOURCE + '/models', { headers: { authorization: 'Bearer ' + record.access_token },
        redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw responseError(response.status); }
      // Catalog entries include substantial model instructions; the small token
      // response limit truncates real catalogs before their model list is parsed.
      const data = await readJsonBounded(response, 8_000_000);
      if (!Array.isArray(data.models)) throw new SiwcError('protocol');
      return data.models.some(raw => { const model = objectValue(raw); return model.slug === SIWC_MODEL && model.visibility === 'list'; });
    } catch (error) { if (error instanceof SiwcError) throw error; throw new SiwcError('network'); }
  }
  async run(prompt: string, schema: Record<string, unknown> | undefined, effort: SiwcEffort, instructions: string): Promise<string> {
    return this.execute(prompt, schema, effort, instructions, false);
  }
  private async execute(prompt: string, schema: Record<string, unknown> | undefined, effort: SiwcEffort, instructions: string, explicitProbe: boolean): Promise<string> {
    const timing = inferenceTiming({ purpose: this.purpose, effort, promptCharacters: prompt.length,
      instructionsCharacters: instructions.length, schemaCharacters: schema ? JSON.stringify(schema).length : 0 });
    let outcome: InferenceTiming['outcome'] = 'failed'; let failure: string | null = null;
    try {
      const text = await this.executeMeasured(prompt, schema, effort, instructions, explicitProbe, timing);
      outcome = 'success'; return text;
    } catch (error) { failure = error instanceof SiwcError ? error.code : 'unknown'; throw error; }
    finally {
      try { observeTiming(this.onTiming, timing.finish(outcome, failure)); }
      catch { /* A diagnostic snapshot failure must not replace the inference result. */ }
    }
  }
  private async executeMeasured(prompt: string, schema: Record<string, unknown> | undefined, effort: SiwcEffort, instructions: string,
    explicitProbe: boolean, timing: ReturnType<typeof inferenceTiming>): Promise<string> {
    const body = responsesBody(prompt, schema, effort, instructions);
    // Reserve the full 3-minute response deadline plus model discovery/overhead.
    const record = await this.access(210_000);
    timing.mark('accessReadyMs');
    // A catalog is a discovery aid. An explicit probe of the user's fixed model
    // can verify access when a new model has not reached the catalog yet. Normal
    // lessons require either a listing or a previously completed exact-model turn.
    if (!record.model_verified_at && !await this.models(record) && !explicitProbe) {
      await this.markModel(record, false); throw new SiwcError('unavailable');
    }
    const remaining = record.expires_at - this.now();
    if (remaining <= 0) throw new SiwcError('expired');
    const controller = new AbortController();
    const deadline = Math.min(180_000, remaining); const timer = setTimeout(() => controller.abort(), deadline);
    try {
      timing.mark('requestStartMs');
      const response = await this.fetcher(SIWC_RESOURCE + '/responses', { method: 'POST', headers: { authorization: 'Bearer ' + record.access_token,
        'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
      timing.mark('headersMs');
      const text = await consumeResponsesStream(response, timing.event);
      if (record.expires_at <= this.now()) throw new SiwcError('expired');
      if (!record.model_verified_at || record.model_available !== true) await this.markModel(record, true);
      return text;
    } catch (error) {
      if (controller.signal.aborted) throw new SiwcError(deadline < 180_000 ? 'expired' : 'timeout');
      if (error instanceof SiwcError) {
        if (error.code === 'unavailable' || error.code === 'restricted') await this.markModel(record, false);
        throw error;
      }
      throw new SiwcError('network');
    } finally { clearTimeout(timer); }
  }
  private async markModel(record: SiwcRegistration, verified: boolean): Promise<void> {
    await this.store.withLock(async () => {
      const latest = await this.store.registration();
      if (!latest || latest.client_id !== record.client_id || latest.subject !== record.subject) throw new SiwcError('identity');
      await this.store.save({ ...latest, model_available: verified, model_verified_at: verified ? this.now() : undefined });
    });
  }
  async probe(): Promise<BrainStatus> {
    const marker = 'Subscription connection verified.';
    const text = await this.execute('Reply with exactly: ' + marker, undefined, 'low', 'Return the requested sentence. Do not use tools.', true);
    if (text !== marker) throw new SiwcError('protocol');
    return this.status();
  }
}
function client(): SiwcClient { return new SiwcClient(); }
export async function getSiwcBrainStatus(): Promise<BrainStatus> { return client().status(); }
export async function siwcRun(prompt: string, schema: Record<string, unknown> | undefined, effort: SiwcEffort, instructions: string, purpose: InferencePurpose = 'other'): Promise<string> {
  const started = Date.now();
  try {
    const answer = await new SiwcClient({ purpose, onTiming: result => console.info('[sol-timing]', JSON.stringify(result)) }).run(prompt, schema, effort, instructions);
    try { addBrainActivity('success', Date.now() - started); } catch { /* Statistics must not discard a completed response. */ }
    return answer;
  } catch (error) {
    try { addBrainActivity(error instanceof SiwcError && error.code === 'limit' ? 'limit' : 'failed', Date.now() - started,
      error instanceof SiwcError ? error.retryAt ?? null : null); } catch { /* Preserve the original provider failure. */ }
    throw error;
  }
}
