import type { SubscriptionUsage, SubscriptionWindow } from './types';

const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

export interface SubscriptionWindowView {
  key: string;
  bucketId: string;
  bucketLabel: string;
  periodLabel: string;
  remainingPercent: number | null;
  percentLabel: string | null;
  fresh: boolean;
  low: boolean;
  exhausted: boolean;
  resetAt: string | null;
  resetLabel: string | null;
  resetRelative: string | null;
  resetExpired: boolean;
  duplicateConflict: boolean;
}

export interface SubscriptionView {
  available: boolean;
  fresh: boolean;
  checkedAt: string | null;
  checkedLabel: string | null;
  planLabel: string | null;
  scopeLabel: string;
  notice: string | null;
  unavailableText: string;
  windows: SubscriptionWindowView[];
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function plural(value: number, forms: readonly [string, string, string]): string {
  const lastTwo = value % 100;
  const last = value % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
}

export function subscriptionPeriodLabel(durationMins: number | null): string {
  if (typeof durationMins !== 'number' || !Number.isSafeInteger(durationMins) || durationMins <= 0) return 'Период не указан';
  if (durationMins % 1440 === 0) {
    const days = durationMins / 1440;
    return `${days} ${plural(days, ['день', 'дня', 'дней'])}`;
  }
  if (durationMins % 60 === 0) {
    const hours = durationMins / 60;
    return `${hours} ${plural(hours, ['час', 'часа', 'часов'])}`;
  }
  return `${durationMins} ${plural(durationMins, ['минута', 'минуты', 'минут'])}`;
}

export function subscriptionPercentLabel(value: number): string {
  if (value > 0 && value < 0.1) return '<0,1';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

/** One time zone for the whole client: the device's own (audit U-25). Tests pass an explicit zone. */
function localDate(value: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

function relativeReset(resetsAt: number, now: number): string {
  const delta = resetsAt - now;
  if (delta <= 0) return 'Срок сброса прошёл — обнови данные';
  if (delta < 60_000) return 'Сброс меньше чем через минуту';
  const minutes = Math.ceil(delta / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `Сброс через ${days} ${plural(days, ['день', 'дня', 'дней'])}${hours ? ` ${hours} ч` : ''}`;
  if (hours > 0) return `Сброс через ${hours} ч${rest ? ` ${rest} мин` : ''}`;
  return `Сброс через ${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`;
}

function meaningfulName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function planLabel(value: unknown): string | null {
  const label = meaningfulName(value);
  if (!label) return null;
  const known: Record<string, string> = { free: 'ChatGPT Free', plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team', business: 'ChatGPT Business', enterprise: 'ChatGPT Enterprise', edu: 'ChatGPT Edu', go: 'ChatGPT Go' };
  // Provider identifiers are not user-facing plan names; don't invent a tier.
  return known[label.toLowerCase()] || null;
}

function sameWindow(left: SubscriptionWindow, right: SubscriptionWindow): boolean {
  return left.remainingPercent === right.remainingPercent && left.usedPercent === right.usedPercent
    && left.windowDurationMins === right.windowDurationMins && left.resetsAt === right.resetsAt
    && left.bucketName === right.bucketName;
}

/** Keeps historical values visibly historical. A passed reset never invents a renewed allowance. */
export function subscriptionView(usage: SubscriptionUsage | null, now = Date.now(), timeZone?: string): SubscriptionView {
  const checked = timestamp(usage?.checkedAt);
  const baseFresh = !!usage?.available && !usage.stale && !usage.error && checked !== null
    && checked <= now + MAX_CLOCK_SKEW_MS && now - checked <= MAX_SNAPSHOT_AGE_MS;
  const scopeLabel = usage?.scope === 'app' ? 'Лимиты этого приложения'
    : usage?.scope === 'unknown' ? 'Область лимитов не подтверждена' : 'Общие с другими задачами Codex';
  const unavailableText = usage?.source === 'siwc'
    ? 'Лимиты этого подключения доступны в ChatGPT. Здесь остаток пока не показан.'
    : usage?.error ? 'Не удалось получить лимиты. Повтори проверку или открой ChatGPT.'
      : 'Подписка пока не передала лимиты. Обнови данные или проверь остаток в ChatGPT.';

  // The hosted SIWC connection has no documented quota endpoint. Never reuse local-account windows for it.
  const candidates = usage?.source === 'codex' && Array.isArray(usage.windows) ? usage.windows : [];
  const unique = new Map<string, { window: SubscriptionWindow; conflict: boolean }>();
  for (const window of candidates) {
    if (!window || !meaningfulName(window.bucketId) || !['primary', 'secondary'].includes(window.kind)) continue;
    const key = `${window.bucketId}:${window.kind}`;
    const previous = unique.get(key);
    if (previous) previous.conflict ||= !sameWindow(previous.window, window);
    else unique.set(key, { window, conflict: false });
  }
  const bucketIds = [...new Set([...unique.values()].map(item => item.window.bucketId))];
  const windows = [...unique.entries()].map(([key, { window, conflict }]): SubscriptionWindowView => {
    const reset = timestamp(window.resetsAt);
    const resetExpired = reset !== null && reset <= now;
    const invalidReset = window.resetsAt !== null && reset === null;
    const remaining = conflict ? null : percent(window.remainingPercent);
    const fresh = baseFresh && !resetExpired && !invalidReset && !conflict;
    return {
      key, bucketId: window.bucketId,
      bucketLabel: meaningfulName(window.bucketName) || (bucketIds.length > 1 ? `Группа лимитов ${bucketIds.indexOf(window.bucketId) + 1}` : 'Подписка'),
      periodLabel: subscriptionPeriodLabel(window.windowDurationMins),
      remainingPercent: remaining, percentLabel: remaining === null ? null : subscriptionPercentLabel(remaining),
      fresh, low: fresh && remaining !== null && remaining <= 20,
      exhausted: fresh && remaining === 0,
      resetAt: reset === null ? null : new Date(reset).toISOString(),
      resetLabel: reset === null ? null : localDate(reset, timeZone),
      resetRelative: reset === null ? null : relativeReset(reset, now),
      resetExpired, duplicateConflict: conflict,
    };
  });
  // A failed refresh may mark the source unavailable while retaining its previous snapshot.
  // Keep that snapshot readable as history instead of replacing it with an empty state.
  const available = windows.length > 0;
  const fresh = available && baseFresh && windows.every(window => window.fresh);
  let notice: string | null = null;
  if (available && usage?.error) notice = 'Не удалось обновить лимиты. Показана последняя проверка.';
  else if (available && !fresh) notice = 'Это данные прошлой проверки. Обнови их перед занятием.';
  return {
    available, fresh, checkedAt: checked === null ? null : new Date(checked).toISOString(),
    checkedLabel: checked === null ? null : localDate(checked, timeZone), planLabel: planLabel(usage?.plan),
    scopeLabel, notice, unavailableText, windows,
  };
}
