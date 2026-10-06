import SwiftUI

// MARK: - Subscription limits (port of lib/subscription-view.ts)

/// How `/api/usage` reads for the learner (web `subscriptionView`, PASS-0.5.3 §2). Only Codex windows that name their
/// bucket count (the hosted SIWC connection has no quota endpoint, so its windows are never shown); a snapshot is fresh
/// for ten minutes (a minute of clock skew allowed); a passed or unreadable reset and a conflicting duplicate make a
/// window historical. Historical values stay readable as history and never raise a limit notice.
struct SubscriptionSummary: Equatable {
    struct Window: Equatable, Identifiable {
        let key: String
        let bucketId: String
        let bucketLabel: String
        let periodLabel: String
        let remainingPercent: Double?
        let percentLabel: String?
        let fresh: Bool
        let low: Bool
        let exhausted: Bool
        let resetAt: Date?
        let resetLabel: String?
        let resetRelative: String?
        let resetExpired: Bool
        let duplicateConflict: Bool
        var id: String { key }
    }

    let available: Bool
    let fresh: Bool
    let checkedAt: Date?
    let checkedLabel: String?
    let planLabel: String?
    let scopeLabel: String
    let notice: String?
    let unavailableText: String
    let windows: [Window]

    static let maxSnapshotAge: TimeInterval = 10 * 60
    static let maxClockSkew: TimeInterval = 60
    /// A fresh window at or below this share left is «почти исчерпан».
    static let lowPercent: Double = 20

    /// Keeps historical values visibly historical. A passed reset never invents a renewed allowance.
    static func make(_ usage: SubscriptionUsage?, now: Date = Date(), timeZone: TimeZone? = nil) -> SubscriptionSummary {
        let checked = timestamp(usage?.checkedAt)
        let failed = !(usage?.error ?? "").isEmpty
        var baseFresh = false
        if let usage, let checked, usage.available, !usage.stale, !failed {
            baseFresh = checked <= now.addingTimeInterval(maxClockSkew) && now.timeIntervalSince(checked) <= maxSnapshotAge
        }
        let scopeLabel: String
        switch usage?.scope ?? "" {
        case "app": scopeLabel = "Лимиты этого приложения"
        case "unknown": scopeLabel = "Область лимитов не подтверждена"
        default: scopeLabel = "Общие с другими задачами Codex"
        }
        let unavailableText: String
        if usage?.source == "siwc" {
            unavailableText = "Лимиты этого подключения доступны в ChatGPT. Здесь остаток пока не показан."
        } else if failed {
            unavailableText = "Не удалось получить лимиты. Повтори проверку или открой ChatGPT."
        } else {
            unavailableText = "Подписка пока не передала лимиты. Обнови данные или проверь остаток в ChatGPT."
        }

        // The hosted SIWC connection has no documented quota endpoint: local-account windows are never reused for it.
        let candidates: [SubscriptionUsage.Window] = usage?.source == "codex" ? (usage?.windows ?? []) : []
        var keys: [String] = []
        var unique: [String: (window: SubscriptionUsage.Window, conflict: Bool)] = [:]
        for window in candidates {
            guard let bucketId = window.bucketId, meaningful(bucketId) != nil,
                  window.kind == "primary" || window.kind == "secondary" else { continue }
            let key = bucketId + ":" + window.kind
            if let previous = unique[key] {
                if !previous.conflict && !sameWindow(previous.window, window) {
                    unique[key] = (window: previous.window, conflict: true)
                }
            } else {
                unique[key] = (window: window, conflict: false)
                keys.append(key)
            }
        }
        var bucketIds: [String] = []
        for key in keys {
            if let bucketId = unique[key]?.window.bucketId, !bucketIds.contains(bucketId) { bucketIds.append(bucketId) }
        }
        var windows: [Window] = []
        for key in keys {
            guard let entry = unique[key], let bucketId = entry.window.bucketId else { continue }
            let window = entry.window
            let conflict = entry.conflict
            let reset = timestamp(window.resetsAt)
            let resetExpired = reset.map { $0 <= now } ?? false
            let invalidReset = window.resetsAt != nil && reset == nil
            let remaining: Double? = conflict ? nil : percent(window.remainingPercent)
            let fresh = baseFresh && !resetExpired && !invalidReset && !conflict
            let index = bucketIds.firstIndex(of: bucketId) ?? 0
            let label = meaningful(window.bucketName) ?? (bucketIds.count > 1 ? "Группа лимитов \(index + 1)" : "Подписка")
            windows.append(Window(
                key: key, bucketId: bucketId, bucketLabel: label,
                periodLabel: periodTitle(window.windowDurationMins),
                remainingPercent: remaining, percentLabel: remaining.map { percentText($0) },
                fresh: fresh,
                low: fresh && remaining.map { $0 <= lowPercent } == true,
                exhausted: fresh && remaining == 0,
                resetAt: reset,
                resetLabel: reset.map { dateText($0, timeZone: timeZone) },
                resetRelative: reset.map { resetText($0, now: now) },
                resetExpired: resetExpired, duplicateConflict: conflict))
        }
        // A failed refresh may mark the source unavailable while keeping its previous snapshot: it stays readable as history.
        let available = !windows.isEmpty
        let fresh = available && baseFresh && windows.allSatisfy { $0.fresh }
        var notice: String? = nil
        if available && failed {
            notice = "Не удалось обновить лимиты. Показана последняя проверка."
        } else if available && !fresh {
            notice = "Это данные прошлой проверки. Обнови их перед занятием."
        }
        return SubscriptionSummary(available: available, fresh: fresh, checkedAt: checked,
                                   checkedLabel: checked.map { dateText($0, timeZone: timeZone) },
                                   planLabel: planTitle(usage?.plan), scopeLabel: scopeLabel, notice: notice,
                                   unavailableText: unavailableText, windows: windows)
    }

    // MARK: Wording (the same strings as the web)

    /// «5 часов», «7 дней», «90 минут»; anything that is not a whole positive number of minutes has no period.
    static func periodTitle(_ minutes: Double?) -> String {
        guard let minutes, minutes.isFinite, minutes > 0, minutes == minutes.rounded(), minutes <= 9_007_199_254_740_991 else {
            return "Период не указан"
        }
        let value = Int(minutes)
        if value % 1_440 == 0 {
            let days = value / 1_440
            return "\(days) " + RuFormat.plural(days, "день", "дня", "дней")
        }
        if value % 60 == 0 {
            let hours = value / 60
            return "\(hours) " + RuFormat.plural(hours, "час", "часа", "часов")
        }
        return "\(value) " + RuFormat.plural(value, "минута", "минуты", "минут")
    }

    /// «12,5», «78», «<0,1»: at most one decimal, Russian comma, half away from zero (as `Intl` in ru-RU).
    static func percentText(_ value: Double) -> String {
        if value > 0 && value < 0.1 { return "<0,1" }
        let tenths = Int((value * 10).rounded())
        let whole = tenths / 10
        let fraction = tenths % 10
        return fraction == 0 ? String(whole) : String(whole) + "," + String(fraction)
    }

    /// «Сброс через 2 ч 15 мин», «Сброс через 3 дня 4 ч», «Сброс меньше чем через минуту».
    static func resetText(_ reset: Date, now: Date) -> String {
        let delta = reset.timeIntervalSince(now)
        if delta <= 0 { return "Срок сброса прошёл — обнови данные" }
        if delta < 60 { return "Сброс меньше чем через минуту" }
        let minutes = Int((delta / 60).rounded(.up))
        let days = minutes / 1_440
        let hours = (minutes % 1_440) / 60
        let rest = minutes % 60
        if days > 0 {
            return "Сброс через \(days) " + RuFormat.plural(days, "день", "дня", "дней") + (hours > 0 ? " \(hours) ч" : "")
        }
        if hours > 0 { return "Сброс через \(hours) ч" + (rest > 0 ? " \(rest) мин" : "") }
        return "Сброс через \(minutes) " + RuFormat.plural(minutes, "минуту", "минуты", "минут")
    }

    /// The device's own time zone (audit U-25); tests pass an explicit zone.
    static func dateText(_ date: Date, timeZone: TimeZone? = nil) -> String {
        let style = Date.FormatStyle(date: .abbreviated, time: .shortened, locale: RuFormat.locale,
                                     timeZone: timeZone ?? TimeZone.current)
        return date.formatted(style)
    }

    /// Provider identifiers are not user-facing plan names; an unknown tier is never invented.
    static func planTitle(_ value: String?) -> String? {
        guard let label = meaningful(value) else { return nil }
        let known = ["free": "ChatGPT Free", "plus": "ChatGPT Plus", "pro": "ChatGPT Pro", "team": "ChatGPT Team",
                     "business": "ChatGPT Business", "enterprise": "ChatGPT Enterprise", "edu": "ChatGPT Edu", "go": "ChatGPT Go"]
        return known[label.lowercased()]
    }

    static func timestamp(_ value: String?) -> Date? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return NativeDate.parse(value)
    }

    static func percent(_ value: Double?) -> Double? {
        guard let value, value.isFinite, value >= 0, value <= 100 else { return nil }
        return value
    }

    static func meaningful(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func sameWindow(_ left: SubscriptionUsage.Window, _ right: SubscriptionUsage.Window) -> Bool {
        left.remainingPercent == right.remainingPercent && left.usedPercent == right.usedPercent
            && left.windowDurationMins == right.windowDurationMins && left.resetsAt == right.resetsAt
            && left.bucketName == right.bucketName
    }

    /// «Открыть лимиты ChatGPT»: only an https chatgpt.com address from the server, otherwise the usage page.
    static func manageURL(_ value: String?) -> URL? {
        let fallback = URL(string: "https://chatgpt.com/settings/usage")
        guard let value, let url = URL(string: value), url.scheme == "https", url.host == "chatgpt.com",
              url.user == nil, url.password == nil else { return fallback }
        return url
    }
}

extension SubscriptionUsage {
    /// The last snapshot after a failed refresh: kept readable and marked historical (web `refreshUsage`).
    func markedStale(error message: String) -> SubscriptionUsage {
        SubscriptionUsage(available: available, source: source, scope: scope, checkedAt: checkedAt, stale: true,
                          windows: windows, plan: plan, error: message, manageUrl: manageUrl, activity: activity)
    }

    /// No snapshot yet and the first read failed.
    static func unavailable(error message: String) -> SubscriptionUsage {
        SubscriptionUsage(available: false, source: "codex", scope: "unknown", checkedAt: nil, stale: true, windows: [],
                          plan: nil, error: message, manageUrl: nil, activity: nil)
    }
}

// MARK: - Limit notice (port of lib/limit-notice.ts)

/// The one limit notice (PASS-0.5.3 §2), field for field the web's `limitNotice` (lib/limit-notice.ts; its doc comment
/// holds the rule table, tests/limit-notice.test.ts the shared cases mirrored in `LimitNoticeTests`). The FIRST rule that
/// matches wins:
///
/// | # | kind                  | tone    | section | when                                    | title                             |
/// |---|-----------------------|---------|---------|-----------------------------------------|-----------------------------------|
/// | 1 | subscriptionExhausted | danger  | limits  | a fresh Codex window has 0 % left       | «Лимит подписки исчерпан»         |
/// | 2 | rateLimited           | danger  | limits  | `usage.activity.retryAt` is after `now` | «Sol упёрся в лимит подписки»     |
/// | 3 | voiceExhausted        | danger  | voice   | audio `usedUsd ≥ budgetUsd`             | «Бюджет голоса на месяц исчерпан» |
/// | 4 | subscriptionLow       | warning | limits  | a fresh Codex window has ≤ 20 % left    | «Лимит подписки почти исчерпан»   |
/// | 5 | voiceLow              | warning | voice   | audio `usedUsd ≥ 85 %` of `budgetUsd`   | «Бюджет голоса почти исчерпан»    |
///
/// Details: 1 and 4 — the reset text of the binding window (`resetRelative`, or «Подробности в профиле» when the reset is
/// unknown); 2 — «Ответы вернутся примерно через 25 мин»; 3 — «Можно заниматься текстом или поднять бюджет в профиле»;
/// 5 — «$43 из $50 в этом месяце». Windows come only from `SubscriptionSummary` (the port of lib/subscription-view.ts).
/// Of several matching windows the binding one wins: the lowest remaining percent, then the LATER reset (an unknown reset
/// counts as the latest), then the first in server order. `retryAt` counts whatever the source and the snapshot's
/// freshness. Voice rules need finite numbers, `usedUsd ≥ 0` and `budgetUsd > 0`; 85 % is compared as
/// `usedUsd · 100 ≥ budgetUsd · 85`.
struct LimitNotice: Equatable {
    enum Kind: String { case subscriptionExhausted, rateLimited, voiceExhausted, subscriptionLow, voiceLow }
    enum Tone: String { case danger, warning }

    let kind: Kind
    let tone: Tone
    let title: String
    let detail: String
    /// The Profile screen that explains it («Тренер и лимиты» or «Голос»): a tap on the banner opens it.
    let section: ProfileSection

    /// Voice warning threshold, in percent of the monthly budget (web `VOICE_LOW_PERCENT`).
    static let voiceLowPercent: Double = 85
    /// Detail of a subscription notice whose window has no known reset time (web `RESET_UNKNOWN_TEXT`).
    static let resetUnknownText = "Подробности в профиле"

    static func current(usage: SubscriptionUsage?, audioUsage: AudioUsage?, now: Date = Date()) -> LimitNotice? {
        let fresh = SubscriptionSummary.make(usage, now: now).windows.filter { $0.fresh }
        let voice = voiceNumbers(audioUsage)

        // 1. A fresh window at zero: Sol cannot answer until it resets.
        if let exhausted = bindingWindow(fresh.filter { $0.exhausted }) {
            return LimitNotice(kind: .subscriptionExhausted, tone: .danger, title: "Лимит подписки исчерпан",
                               detail: resetText(exhausted), section: .limits)
        }
        // 2. The service said «try again after …» (Codex or SIWC rate limit).
        if let retry = SubscriptionSummary.timestamp(usage?.activity?.retryAt), retry > now {
            return LimitNotice(kind: .rateLimited, tone: .danger, title: "Sol упёрся в лимит подписки",
                               detail: retryText(retry, now: now), section: .limits)
        }
        // 3. The monthly voice budget is spent: text practice still works.
        if let voice, voice.used >= voice.budget {
            return LimitNotice(kind: .voiceExhausted, tone: .danger, title: "Бюджет голоса на месяц исчерпан",
                               detail: "Можно заниматься текстом или поднять бюджет в профиле", section: .voice)
        }
        // 4. A fresh window running low.
        if let low = bindingWindow(fresh.filter { $0.low }) {
            return LimitNotice(kind: .subscriptionLow, tone: .warning, title: "Лимит подписки почти исчерпан",
                               detail: resetText(low), section: .limits)
        }
        // 5. Most of the voice budget is spent.
        if let voice, voice.used * 100 >= voice.budget * voiceLowPercent {
            return LimitNotice(kind: .voiceLow, tone: .warning, title: "Бюджет голоса почти исчерпан",
                               detail: wholeDollars(voice.used) + " из " + budgetDollars(voice.budget) + " в этом месяце",
                               section: .voice)
        }
        return nil
    }

    /// The window that decides: the lowest remaining percent, then the later reset (an unknown reset counts as the
    /// latest: nothing says the allowance comes back sooner), then the first in server order.
    static func bindingWindow(_ windows: [SubscriptionSummary.Window]) -> SubscriptionSummary.Window? {
        var best: SubscriptionSummary.Window? = nil
        for window in windows {
            guard let remaining = window.remainingPercent else { continue }
            guard let current = best, let currentRemaining = current.remainingPercent else {
                best = window
                continue
            }
            if remaining < currentRemaining || (remaining == currentRemaining && resetRank(window) > resetRank(current)) {
                best = window
            }
        }
        return best
    }

    private static func resetRank(_ window: SubscriptionSummary.Window) -> Double {
        window.resetAt?.timeIntervalSince1970 ?? Double.infinity
    }

    private static func resetText(_ window: SubscriptionSummary.Window) -> String {
        window.resetRelative ?? resetUnknownText
    }

    /// When Sol answers again after a rate limit, in whole minutes rounded UP (at least 1): «Ответы вернутся примерно
    /// через 25 мин»; from an hour «… через 1 ч», «… через 1 ч 20 мин», «… через 26 ч».
    static func retryText(_ retry: Date, now: Date) -> String {
        let minutes = max(1, Int((retry.timeIntervalSince(now) / 60).rounded(.up)))
        if minutes < 60 { return "Ответы вернутся примерно через \(minutes) мин" }
        let hours = minutes / 60
        let rest = minutes % 60
        return "Ответы вернутся примерно через \(hours) ч" + (rest > 0 ? " \(rest) мин" : "")
    }

    /// Money spent, in whole dollars rounded DOWN (the banner and the Profile «Голос» row; the voice screen shows cents):
    /// 43.2 → «$43», 49.99 → «$49» — a warning never reads «$50 из $50» while the budget is not spent yet. Negative, NaN
    /// and infinite amounts read «$0». (The 1e-9 keeps a binary 42.999…9 from reading «$42».)
    static func wholeDollars(_ value: Double) -> String {
        guard value.isFinite, value > 0 else { return "$0" }
        return "$" + plainNumber((value + 1e-9).rounded(.down))
    }

    /// The monthly budget as it was set: 50 → «$50», 12.5 → «$12.5», 12.25 → «$12.25» (at most two decimals).
    static func budgetDollars(_ value: Double) -> String {
        guard value.isFinite, value > 0 else { return "$0" }
        if value == value.rounded() { return "$" + plainNumber(value) }
        return "$" + plainNumber((value * 100).rounded() / 100)
    }

    /// A number as JavaScript prints it for these amounts: «50», «12.5», «12.25» (shortest form, dot decimal).
    private static func plainNumber(_ value: Double) -> String {
        if value == value.rounded() && abs(value) < 1e15 { return String(Int(value)) }
        return "\(value)"
    }

    private static func voiceNumbers(_ audio: AudioUsage?) -> (used: Double, budget: Double)? {
        guard let audio, audio.usedUsd.isFinite, audio.budgetUsd.isFinite, audio.usedUsd >= 0, audio.budgetUsd > 0 else {
            return nil
        }
        return (used: audio.usedUsd, budget: audio.budgetUsd)
    }
}

// MARK: - Today banner

/// Today's limit notice (iPhone: under the header, above the primary card). A tap opens Profile with the screen that
/// explains it (limits or voice). It arrives with the light reveal, never as a step of a running staircase (§5).
struct TodayLimitBanner: View {
    var select: (ShellTab) -> Void
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        if let notice = LimitNotice.current(usage: client.subscriptionUsage, audioUsage: client.state?.audioUsage) {
            LimitNoticeBanner(notice: notice) {
                ProfileNavigator.shared.open(notice.section)
                select(.profile)
            }
            .rowReveal(0)
        }
    }
}

/// The compact banner itself: one solid surface with a status edge, the title, the detail and a chevron.
struct LimitNoticeBanner: View {
    let notice: LimitNotice
    let open: () -> Void

    private var color: Color { notice.tone == .danger ? Theme.danger : Theme.warning }
    private var icon: String { notice.tone == .danger ? "exclamationmark.triangle.fill" : "exclamationmark.circle.fill" }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.tile, style: .continuous)
        Button(action: open) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: icon).font(.body.weight(.semibold)).foregroundStyle(color).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(notice.title).font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    Text(notice.detail).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Theme.ink)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.solid, in: shape)
            .overlay { shape.strokeBorder(color.opacity(0.45), lineWidth: 1).allowsHitTesting(false) }
            .contentShape(shape)
        }
        .buttonStyle(PressButton())
        .accessibilityLabel(notice.title + ". " + notice.detail)
        .accessibilityHint(notice.section == .voice ? "Открывает голос в профиле" : "Открывает тренера и лимиты в профиле")
    }
}
