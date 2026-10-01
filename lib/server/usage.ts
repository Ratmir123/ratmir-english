import type { SubscriptionUsage, SubscriptionWindow } from '../types';

type JsonObject = Record<string, unknown>;
const CACHE_MILLISECONDS = 60_000;
const READ_FAILED = 'Не удалось обновить лимиты подписки. Повтори проверку позже.';
const NO_METRICS = 'Сервис не передал остаток лимитов подписки.';

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function publicLabel(value: unknown, maximum = 100): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)
    || /Bearer\s|\bsk-[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return null;
  return text;
}

function percentage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function duration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function resetDate(value: unknown): string | null {
  // The app-server protocol sends epoch seconds, never milliseconds. Limit the
  // range so an accidentally supplied millisecond value cannot look credible.
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 253_402_300_799) return null;
  return new Date(value * 1000).toISOString();
}

export function unavailableSubscriptionUsage(source: SubscriptionUsage['source'], error: string, checkedAt: string | null = null): SubscriptionUsage {
  return { source, available: false, scope: source === 'codex' ? 'account' : 'unknown', checkedAt, stale: false, windows: [], plan: null, error };
}

/** Whitelist the quota fields; account identities, tokens and credit details never leave this function. */
export function normalizeCodexUsage(value: unknown, checkedAt: string): SubscriptionUsage {
  const result = object(value);
  const multiple = object(result?.rateLimitsByLimitId);
  const entries = multiple ? Object.entries(multiple).filter((entry): entry is [string, JsonObject] => object(entry[1]) !== null) : [];
  const legacy = object(result?.rateLimits);
  const buckets: [string, JsonObject][] = entries.length ? entries : legacy ? [['codex', legacy]] : [];
  const windows: SubscriptionWindow[] = [];
  let plan: string | null = null;
  for (const [key, bucket] of buckets) {
    const bucketId = publicLabel(bucket.limitId) || publicLabel(key) || 'codex';
    const bucketName = publicLabel(bucket.limitName, 80);
    plan ||= publicLabel(bucket.planType, 40);
    for (const kind of ['primary', 'secondary'] as const) {
      const rawWindow = object(bucket[kind]);
      if (!rawWindow) continue;
      const usedPercent = percentage(rawWindow.usedPercent);
      windows.push({ id: `${bucketId}:${kind}`, bucketId, bucketName, kind, usedPercent,
        remainingPercent: usedPercent === null ? null : Math.min(100, Math.max(0, 100 - usedPercent)),
        windowDurationMins: duration(rawWindow.windowDurationMins), resetsAt: resetDate(rawWindow.resetsAt) });
    }
  }
  const available = windows.some(window => window.remainingPercent !== null);
  return { source: 'codex', available, scope: 'account', checkedAt, stale: false, windows, plan,
    ...(!available ? { error: NO_METRICS } : {}) };
}

/** In-memory, bounded cache: reading usage never schedules inference or a background poll. */
export class SubscriptionUsageCache {
  private value: SubscriptionUsage | undefined;
  private expiresAt = 0;
  private pending: Promise<SubscriptionUsage> | undefined;
  private generation = 0;
  private revision = 0;

  constructor(private readonly load: () => Promise<unknown>, private readonly now: () => number = Date.now) {}

  invalidate(): void { this.revision += 1; this.expiresAt = 0; }

  clear(): void {
    this.generation += 1;
    this.revision += 1;
    this.value = undefined;
    this.expiresAt = 0;
    this.pending = undefined;
  }

  async read(force = false): Promise<SubscriptionUsage> {
    if (this.pending) return this.pending;
    const now = this.now();
    if (!force && this.value && now < this.expiresAt) {
      const resetPassed = this.value.windows.some(window => window.resetsAt !== null && Date.parse(window.resetsAt) <= now);
      // A passed reset is not evidence that a quota has replenished.
      if (!resetPassed || this.value.stale) return this.value;
    }
    const generation = this.generation;
    const revision = this.revision;
    const pending = Promise.resolve().then(() => this.load()).then(raw => {
      if (generation !== this.generation) return unavailableSubscriptionUsage('codex', 'Подписка изменилась. Обнови лимиты.');
      const checkedAt = new Date(this.now()).toISOString();
      this.value = normalizeCodexUsage(raw, checkedAt);
      // A notification received during this request can describe newer usage
      // than its response. Do not let completion undo that invalidation.
      const changed = revision !== this.revision;
      if (changed) this.value = { ...this.value, stale: true, error: 'Лимиты изменились во время проверки. Обнови данные.' };
      this.expiresAt = changed ? 0 : this.now() + CACHE_MILLISECONDS;
      return this.value;
    }).catch(() => {
      if (generation !== this.generation) return unavailableSubscriptionUsage('codex', 'Подписка изменилась. Обнови лимиты.');
      this.value = this.value?.available
        ? { ...this.value, stale: true, error: READ_FAILED }
        : unavailableSubscriptionUsage('codex', READ_FAILED, new Date(this.now()).toISOString());
      this.expiresAt = revision !== this.revision ? 0 : this.now() + CACHE_MILLISECONDS;
      return this.value;
    });
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }
}
