import type { AudioUsage, SubscriptionUsage } from './types';
import { subscriptionView, type SubscriptionWindowView } from './subscription-view';

/**
 * The one limit notice (PASS-0.5.3 §2). A pure rule shared by the web (Today banner, Profile «Тренер и лимиты» row)
 * and the iPhone (ios/Sources/LimitNotice.swift mirrors it field for field; tests/limit-notice.test.ts is the shared
 * list of cases). `limitNotice(usage, audioUsage, now)` returns the FIRST rule that matches, or null:
 *
 * | # | kind                   | tone    | section | when                                         | title                             | detail                                                  |
 * |---|------------------------|---------|---------|----------------------------------------------|-----------------------------------|---------------------------------------------------------|
 * | 1 | subscription-exhausted | danger  | limits  | a fresh Codex window has 0 % left            | «Лимит подписки исчерпан»         | reset text of that window                               |
 * | 2 | rate-limited           | danger  | limits  | `usage.activity.retryAt` is after `now`      | «Sol упёрся в лимит подписки»     | «Ответы вернутся примерно через 25 мин» (retryText)    |
 * | 3 | voice-exhausted        | danger  | voice   | audio `usedUsd ≥ budgetUsd`                  | «Бюджет голоса на месяц исчерпан» | «Можно заниматься текстом или поднять бюджет в профиле» |
 * | 4 | subscription-low       | warning | limits  | a fresh Codex window has ≤ 20 % left         | «Лимит подписки почти исчерпан»   | reset text of that window                               |
 * | 5 | voice-low              | warning | voice   | audio `usedUsd ≥ 85 %` of `budgetUsd`        | «Бюджет голоса почти исчерпан»    | «$43 из $50 в этом месяце» (whole / budget dollars)     |
 *
 * Subscription windows come only from `subscriptionView` (lib/subscription-view.ts; iOS ports it too): Codex source
 * only (a hosted SIWC connection has no windows), unique by `bucketId:kind`, conflicting duplicates and malformed
 * values dropped, `fresh` = an error-free, non-stale snapshot checked ≤ 10 min ago (≤ 1 min clock skew) whose reset has
 * not passed. Of several matching windows the binding one wins: the lowest remaining percent, then the LATER reset (an
 * unknown reset counts as the latest), then the first in server order. Reset text = that window's `resetRelative`
 * («Сброс через 2 дня», «Сброс через 3 ч 20 мин», «Сброс меньше чем через минуту»), or «Подробности в профиле» when
 * the reset time is unknown.
 *
 * `retryAt` counts whatever the source (Codex or SIWC) and whatever the snapshot's freshness: it is the service's own
 * «try again after». Voice rules need finite numbers, `usedUsd ≥ 0` and `budgetUsd > 0`; 85 % is compared as
 * `usedUsd · 100 ≥ budgetUsd · 85` so no floating-point 0.85 decides a boundary.
 */

export type LimitNoticeKind = 'subscription-exhausted' | 'rate-limited' | 'voice-exhausted' | 'subscription-low' | 'voice-low';
export type LimitNoticeTone = 'danger' | 'warning';
/** The Profile row the notice opens: «Тренер и лимиты» or «Голос». */
export type LimitNoticeSection = 'limits' | 'voice';

export interface LimitNotice {
  kind: LimitNoticeKind;
  tone: LimitNoticeTone;
  section: LimitNoticeSection;
  title: string;
  detail: string;
}

/** Voice warning threshold, in percent of the monthly budget. */
export const VOICE_LOW_PERCENT = 85;
/** Detail of a subscription notice whose window has no known reset time. */
export const RESET_UNKNOWN_TEXT = 'Подробности в профиле';

/**
 * Money spent, in whole dollars rounded DOWN (the banner and the Profile «Голос» row; the open voice row shows
 * cents): 43.2 → «$43», 49.99 → «$49» — a warning never reads «$50 из $50» while the budget is not spent yet.
 * Negative, NaN and infinite amounts read «$0». (The 1e-9 keeps a binary 42.999…9 from reading «$42».)
 */
export function wholeDollars(value: number): string {
  return `$${Number.isFinite(value) && value > 0 ? Math.floor(value + 1e-9) : 0}`;
}

/** The monthly budget as it was set: 50 → «$50», 12.5 → «$12.5», 12.25 → «$12.25» (at most two decimals). */
export function budgetDollars(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  return `$${Number.isInteger(value) ? value : Number(value.toFixed(2))}`;
}

/**
 * When Sol answers again after a rate limit, in whole minutes rounded UP (at least 1): «Ответы вернутся примерно через
 * 25 мин»; from an hour «… через 1 ч», «… через 1 ч 20 мин», «… через 26 ч».
 */
export function retryText(retryAt: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((retryAt - now) / 60_000));
  if (minutes < 60) return `Ответы вернутся примерно через ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Ответы вернутся примерно через ${hours} ч${rest ? ` ${rest} мин` : ''}`;
}

/** An unknown reset counts as the latest: nothing says the allowance comes back sooner. */
function resetRank(window: SubscriptionWindowView): number {
  const at = window.resetAt === null ? Number.NaN : Date.parse(window.resetAt);
  return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY;
}

/** The window that decides: lowest remaining percent, then the later reset, then the first in server order. */
function bindingWindow(windows: SubscriptionWindowView[]): SubscriptionWindowView | null {
  let best: SubscriptionWindowView | null = null;
  for (const window of windows) {
    if (window.remainingPercent === null) continue;
    if (!best || window.remainingPercent < best.remainingPercent!
      || (window.remainingPercent === best.remainingPercent && resetRank(window) > resetRank(best))) best = window;
  }
  return best;
}

function resetText(window: SubscriptionWindowView): string {
  return window.resetRelative ?? RESET_UNKNOWN_TEXT;
}

function voiceNumbers(audio: AudioUsage | null | undefined): { used: number; budget: number } | null {
  if (!audio) return null;
  const { usedUsd: used, budgetUsd: budget } = audio;
  if (typeof used !== 'number' || typeof budget !== 'number' || !Number.isFinite(used) || !Number.isFinite(budget)) return null;
  return used >= 0 && budget > 0 ? { used, budget } : null;
}

export function limitNotice(usage: SubscriptionUsage | null | undefined, audioUsage: AudioUsage | null | undefined, now: number = Date.now()): LimitNotice | null {
  const fresh = subscriptionView(usage ?? null, now).windows.filter(window => window.fresh);
  const voice = voiceNumbers(audioUsage);

  // 1. A fresh window at zero: Sol cannot answer until it resets.
  const exhausted = bindingWindow(fresh.filter(window => window.exhausted));
  if (exhausted) return { kind: 'subscription-exhausted', tone: 'danger', section: 'limits', title: 'Лимит подписки исчерпан', detail: resetText(exhausted) };

  // 2. The service said «try again after …» (Codex or SIWC rate limit).
  const retryAt = typeof usage?.activity?.retryAt === 'string' ? Date.parse(usage.activity.retryAt) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > now) return { kind: 'rate-limited', tone: 'danger', section: 'limits', title: 'Sol упёрся в лимит подписки', detail: retryText(retryAt, now) };

  // 3. The monthly voice budget is spent: text practice still works.
  if (voice && voice.used >= voice.budget) return { kind: 'voice-exhausted', tone: 'danger', section: 'voice', title: 'Бюджет голоса на месяц исчерпан', detail: 'Можно заниматься текстом или поднять бюджет в профиле' };

  // 4. A fresh window running low.
  const low = bindingWindow(fresh.filter(window => window.low));
  if (low) return { kind: 'subscription-low', tone: 'warning', section: 'limits', title: 'Лимит подписки почти исчерпан', detail: resetText(low) };

  // 5. Most of the voice budget is spent.
  if (voice && voice.used * 100 >= voice.budget * VOICE_LOW_PERCENT) {
    return { kind: 'voice-low', tone: 'warning', section: 'voice', title: 'Бюджет голоса почти исчерпан', detail: `${wholeDollars(voice.used)} из ${budgetDollars(voice.budget)} в этом месяце` };
  }
  return null;
}
