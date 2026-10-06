import XCTest
@testable import RatmirEnglish

/// The shared limit-notice cases (PASS-0.5.3 §2): the same vectors as tests/limit-notice.test.ts — change both together.
/// Synthetic data only.
final class LimitNoticeTests: XCTestCase {
    /// 2026-10-06T10:00:00Z, as in the web tests.
    private let now = Date(timeIntervalSince1970: 1_791_280_800)
    private let minute: TimeInterval = 60
    private var hour: TimeInterval { 60 * minute }
    private var day: TimeInterval { 24 * hour }

    private func data(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }

    private func at(_ offset: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(offset))
    }

    private func window(_ overrides: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = ["id": "fixture:primary", "bucketId": "fixture", "bucketName": "Fixture Codex", "kind": "primary",
                                    "usedPercent": 60.0, "remainingPercent": 40.0, "windowDurationMins": 300, "resetsAt": at(2 * day)]
        for (key, item) in overrides { value[key] = item }
        return value
    }

    private func usage(_ overrides: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = ["source": "codex", "available": true, "scope": "account", "checkedAt": at(-minute), "stale": false,
                                    "windows": [window()], "plan": "plus"]
        for (key, item) in overrides { value[key] = item }
        return value
    }

    private func activity(_ retryAt: String?) -> [String: Any] {
        var value: [String: Any] = ["scope": "app", "periodDays": 30, "requests": 12, "successful": 10, "failed": 2,
                                    "lastRequestAt": at(-2 * minute), "lastLimitAt": at(-2 * minute), "averageLatencyMs": 2400]
        if let retryAt { value["retryAt"] = retryAt } else { value["retryAt"] = NSNull() }
        return value
    }

    private func audio(_ used: Double, _ budget: Double = 50) -> AudioUsage {
        AudioUsage(usedUsd: used, estimated: true, budgetUsd: budget, recordedMinutes: 30, spokenCharacters: 12_000)
    }

    private func exhaustedUsage(resetIn: TimeInterval? = nil) -> [String: Any] {
        usage(["windows": [window(["remainingPercent": 0.0, "usedPercent": 100.0, "resetsAt": at(resetIn ?? 2 * day)])]])
    }

    private func lowUsage(_ remaining: Double = 12, resetIn: TimeInterval? = nil) -> [String: Any] {
        usage(["windows": [window(["remainingPercent": remaining, "usedPercent": 100 - remaining,
                                   "resetsAt": at(resetIn ?? 3 * hour + 20 * minute)])]])
    }

    private func rateLimited(_ retryIn: TimeInterval? = nil) -> [String: Any] {
        usage(["activity": activity(at(retryIn ?? 25 * minute))])
    }

    private func notice(_ usage: [String: Any]?, _ audio: AudioUsage?, after offset: TimeInterval = 0) throws -> LimitNotice? {
        let decoded = try usage.map { try JSONDecoder().decode(SubscriptionUsage.self, from: data($0)) }
        return LimitNotice.current(usage: decoded, audioUsage: audio, now: now.addingTimeInterval(offset))
    }

    func testNothingToSayForEmptyInputsAndHealthyLimits() throws {
        XCTAssertNil(try notice(nil, nil))
        XCTAssertNil(try notice(usage(), audio(3.42)))
        XCTAssertNil(try notice(usage(["activity": activity(nil)]), nil))
        XCTAssertNil(try notice(usage(["windows": [Any]()]), audio(0)))
    }

    func testRule1ExhaustedWindowIsADangerNoticeWithItsReset() throws {
        XCTAssertEqual(try notice(exhaustedUsage(), nil),
                       LimitNotice(kind: .subscriptionExhausted, tone: .danger, title: "Лимит подписки исчерпан",
                                   detail: "Сброс через 2 дня", section: .limits))
        XCTAssertEqual(try notice(exhaustedUsage(resetIn: 3 * hour + 20 * minute), nil)?.detail, "Сброс через 3 ч 20 мин")
        XCTAssertEqual(try notice(exhaustedUsage(resetIn: 30), nil)?.detail, "Сброс меньше чем через минуту")
        let unknownReset = usage(["windows": [window(["remainingPercent": 0.0, "resetsAt": NSNull()])]])
        XCTAssertEqual(try notice(unknownReset, nil)?.detail, LimitNotice.resetUnknownText)
        XCTAssertEqual(LimitNotice.resetUnknownText, "Подробности в профиле")
    }

    func testRule1LaterResetDecidesAndAnUnknownResetCountsAsTheLatest() throws {
        let two = usage(["windows": [window(["id": "a", "kind": "primary", "remainingPercent": 0.0, "resetsAt": at(5 * hour)]),
                                     window(["id": "b", "kind": "secondary", "remainingPercent": 0.0, "windowDurationMins": 10_080,
                                             "resetsAt": at(3 * day)])]])
        XCTAssertEqual(try notice(two, nil)?.detail, "Сброс через 3 дня")
        let unknown = usage(["windows": [window(["id": "a", "kind": "primary", "remainingPercent": 0.0, "resetsAt": at(5 * hour)]),
                                         window(["id": "b", "kind": "secondary", "remainingPercent": 0.0, "windowDurationMins": 10_080,
                                                 "resetsAt": NSNull()])]])
        XCTAssertEqual(try notice(unknown, nil)?.detail, LimitNotice.resetUnknownText)
    }

    /// The web's stale / failed / old / future-dated / SIWC / unavailable / passed / malformed / conflicting cases, with the
    /// window at `left` percent.
    private func unfreshCase(_ index: Int, left: Double) -> [String: Any] {
        let zero = window(["remainingPercent": left, "usedPercent": 100.0])
        switch index {
        case 0: return ["stale": true, "windows": [zero]]
        case 1: return ["error": "Fixture request failed", "windows": [zero]]
        case 2: return ["checkedAt": at(-11 * minute), "windows": [zero]]
        case 3: return ["checkedAt": at(2 * minute), "windows": [zero]]
        case 4: return ["checkedAt": NSNull(), "windows": [zero]]
        case 5: return ["source": "siwc", "windows": [zero]]
        case 6: return ["available": false, "windows": [zero]]
        case 7: return ["windows": [window(["remainingPercent": left, "resetsAt": at(-minute)])]]
        case 8: return ["windows": [window(["remainingPercent": left, "resetsAt": "not-a-date"])]]
        default: return ["windows": [zero, window(["remainingPercent": 30.0])]]
        }
    }

    func testRules1And4NeedFreshCodexData() throws {
        // Exhausted (0 %) and low (10 %) alike: nothing to say without fresh Codex data.
        for index in 0..<10 {
            XCTAssertNil(try notice(usage(unfreshCase(index, left: 0)), nil), "case \(index)")
            XCTAssertNil(try notice(usage(unfreshCase(index, left: 10)), nil), "low case \(index)")
        }
        // Dated within the allowed skew (≤ 1 min ahead) or exactly 10 min old: still fresh.
        let zero = window(["remainingPercent": 0.0, "usedPercent": 100.0])
        XCTAssertEqual(try notice(usage(["checkedAt": at(minute), "windows": [zero]]), nil)?.kind, .subscriptionExhausted)
        XCTAssertEqual(try notice(usage(["checkedAt": at(-10 * minute), "windows": [zero]]), nil)?.kind, .subscriptionExhausted)
    }

    func testRule2FutureRetryAtIsADangerNoticeForCodexAndSIWC() throws {
        XCTAssertEqual(try notice(rateLimited(), nil),
                       LimitNotice(kind: .rateLimited, tone: .danger, title: "Sol упёрся в лимит подписки",
                                   detail: "Ответы вернутся примерно через 25 мин", section: .limits))
        // Hosted SIWC: no windows, the service's own «try again after» still counts — even from a stale snapshot.
        var hosted = usage(["source": "siwc", "windows": [Any](), "available": false, "activity": activity(at(80 * minute))])
        XCTAssertEqual(try notice(hosted, nil)?.detail, "Ответы вернутся примерно через 1 ч 20 мин")
        hosted["stale"] = true
        hosted["error"] = "Fixture offline"
        XCTAssertEqual(try notice(hosted, nil)?.kind, .rateLimited)
        // Passed, current, missing or malformed retry times say nothing.
        for retryAt in [at(-minute), at(0), "not-a-date", ""] {
            XCTAssertNil(try notice(usage(["activity": activity(retryAt)]), nil), retryAt)
        }
        XCTAssertNil(try notice(usage(["activity": activity(nil)]), nil))
    }

    func testRetryWordingRoundsUpToWholeMinutesThenHours() {
        func text(_ offset: TimeInterval) -> String { LimitNotice.retryText(now.addingTimeInterval(offset), now: now) }
        XCTAssertEqual(text(1), "Ответы вернутся примерно через 1 мин")
        XCTAssertEqual(text(59), "Ответы вернутся примерно через 1 мин")
        XCTAssertEqual(text(minute), "Ответы вернутся примерно через 1 мин")
        XCTAssertEqual(text(minute + 1), "Ответы вернутся примерно через 2 мин")
        XCTAssertEqual(text(24 * minute + 30), "Ответы вернутся примерно через 25 мин")
        XCTAssertEqual(text(59 * minute), "Ответы вернутся примерно через 59 мин")
        XCTAssertEqual(text(59 * minute + 1), "Ответы вернутся примерно через 1 ч")
        XCTAssertEqual(text(hour), "Ответы вернутся примерно через 1 ч")
        XCTAssertEqual(text(2 * hour + 5 * minute), "Ответы вернутся примерно через 2 ч 5 мин")
        XCTAssertEqual(text(day + 2 * hour + 10 * minute), "Ответы вернутся примерно через 26 ч 10 мин")
    }

    func testRule3SpentVoiceBudgetIsADangerNoticeThatOpensVoice() throws {
        let expected = LimitNotice(kind: .voiceExhausted, tone: .danger, title: "Бюджет голоса на месяц исчерпан",
                                   detail: "Можно заниматься текстом или поднять бюджет в профиле", section: .voice)
        XCTAssertEqual(try notice(nil, audio(50)), expected)
        XCTAssertEqual(try notice(usage(), audio(63.27)), expected)
        XCTAssertEqual(try notice(nil, audio(1, 1)), expected)
        XCTAssertEqual(try notice(nil, audio(49.99))?.kind, .voiceLow)
    }

    func testRule4LowFreshWindowIsAWarningAndTheLowestWindowDecides() throws {
        XCTAssertEqual(SubscriptionSummary.lowPercent, 20)
        XCTAssertEqual(try notice(lowUsage(), nil),
                       LimitNotice(kind: .subscriptionLow, tone: .warning, title: "Лимит подписки почти исчерпан",
                                   detail: "Сброс через 3 ч 20 мин", section: .limits))
        XCTAssertEqual(try notice(lowUsage(20), nil)?.kind, .subscriptionLow)
        XCTAssertNil(try notice(lowUsage(20.5), nil))
        XCTAssertEqual(try notice(lowUsage(0.01), nil)?.kind, .subscriptionLow, "A tiny positive remainder is low, not exhausted")
        let two = usage(["windows": [window(["id": "a", "bucketId": "one", "remainingPercent": 18.0, "resetsAt": at(2 * hour)]),
                                     window(["id": "b", "bucketId": "two", "remainingPercent": 6.0, "resetsAt": at(4 * day)])]])
        XCTAssertEqual(try notice(two, nil)?.detail, "Сброс через 4 дня")
        let tie = usage(["windows": [window(["id": "a", "kind": "primary", "remainingPercent": 9.0, "resetsAt": at(2 * hour)]),
                                     window(["id": "b", "kind": "secondary", "remainingPercent": 9.0, "windowDurationMins": 10_080,
                                             "resetsAt": at(26 * hour)])]])
        XCTAssertEqual(try notice(tie, nil)?.detail, "Сброс через 1 день 2 ч")
        XCTAssertNil(try notice(usage(["windows": [window(["remainingPercent": 15.0, "resetsAt": "not-a-date"])]]), nil))
        XCTAssertEqual(try notice(usage(["windows": [window(["remainingPercent": 15.0, "resetsAt": NSNull()])]]), nil)?.detail,
                       LimitNotice.resetUnknownText)
    }

    func testRule5VoiceWarningAt85PercentHasAnExactBoundary() throws {
        XCTAssertEqual(LimitNotice.voiceLowPercent, 85)
        XCTAssertEqual(try notice(nil, audio(43)),
                       LimitNotice(kind: .voiceLow, tone: .warning, title: "Бюджет голоса почти исчерпан",
                                   detail: "$43 из $50 в этом месяце", section: .voice))
        XCTAssertEqual(try notice(nil, audio(43.8))?.detail, "$43 из $50 в этом месяце")
        XCTAssertEqual(try notice(nil, audio(42.5))?.detail, "$42 из $50 в этом месяце")
        XCTAssertNil(try notice(nil, audio(42.49)))
        XCTAssertEqual(try notice(nil, audio(17, 20))?.detail, "$17 из $20 в этом месяце")
        XCTAssertNil(try notice(nil, audio(16.99, 20)))
        XCTAssertEqual(try notice(nil, audio(25.5, 30))?.kind, .voiceLow)
        XCTAssertEqual(try notice(nil, audio(10.7, 12.5))?.detail, "$10 из $12.5 в этом месяце")
        XCTAssertEqual(try notice(nil, audio(49.99))?.detail, "$49 из $50 в этом месяце", "Rounded down: never «$50 из $50»")
    }

    func testVoiceRulesIgnoreNumbersThatCannotBeJudged() throws {
        let broken: [(Double, Double)] = [(60, 0), (60, -5), (60, .nan), (60, .infinity), (.nan, 50), (.infinity, 50), (-1, 50)]
        for (used, budget) in broken {
            XCTAssertNil(try notice(nil, audio(used, budget)), "\(used) / \(budget)")
        }
    }

    func testPriorityFromExhaustedSubscriptionToLowVoice() throws {
        let everything = usage(["windows": [window(["remainingPercent": 0.0, "resetsAt": at(2 * day)]),
                                            window(["id": "b", "kind": "secondary", "remainingPercent": 10.0, "resetsAt": at(day)])],
                                "activity": activity(at(25 * minute))])
        XCTAssertEqual(try notice(everything, audio(60))?.kind, .subscriptionExhausted)
        let limited = usage(["windows": [window(["remainingPercent": 10.0])], "activity": activity(at(25 * minute))])
        XCTAssertEqual(try notice(limited, audio(60))?.kind, .rateLimited)
        XCTAssertEqual(try notice(lowUsage(), audio(60))?.kind, .voiceExhausted)
        XCTAssertEqual(try notice(lowUsage(), audio(45))?.kind, .subscriptionLow)
        XCTAssertEqual(try notice(usage(), audio(45))?.kind, .voiceLow)
        // A passed retry no longer outranks anything.
        let passed = usage(["windows": [window(["remainingPercent": 10.0])], "activity": activity(at(-minute))])
        XCTAssertEqual(try notice(passed, audio(45))?.kind, .subscriptionLow)
    }

    func testTimeMovesTheNotice() throws {
        let limited = rateLimited(25 * minute)
        XCTAssertEqual(try notice(limited, nil, after: 10 * minute)?.detail, "Ответы вернутся примерно через 15 мин")
        XCTAssertNil(try notice(limited, nil, after: 25 * minute))
        // Checked a minute before now: fresh for 10 minutes, then the warning steps back.
        XCTAssertEqual(try notice(lowUsage(), nil, after: 9 * minute)?.kind, .subscriptionLow)
        XCTAssertNil(try notice(lowUsage(), nil, after: 10 * minute))
    }

    func testMoneyInWholeDollarsDownAndTheBudgetAsSet() {
        XCTAssertEqual(LimitNotice.wholeDollars(43.2), "$43")
        XCTAssertEqual(LimitNotice.wholeDollars(43.8), "$43")
        XCTAssertEqual(LimitNotice.wholeDollars(3), "$3")
        XCTAssertEqual(LimitNotice.wholeDollars(0.42), "$0")
        XCTAssertEqual(LimitNotice.wholeDollars(0.1 + 0.2 + 42.7), "$43")
        XCTAssertEqual(LimitNotice.wholeDollars(42.999999999999), "$43")
        for broken in [-2, Double.nan, Double.infinity] { XCTAssertEqual(LimitNotice.wholeDollars(broken), "$0") }
        XCTAssertEqual(LimitNotice.budgetDollars(50), "$50")
        XCTAssertEqual(LimitNotice.budgetDollars(12.5), "$12.5")
        XCTAssertEqual(LimitNotice.budgetDollars(12.25), "$12.25")
        XCTAssertEqual(LimitNotice.budgetDollars(1), "$1")
        for broken in [0, -5, Double.nan, Double.infinity] { XCTAssertEqual(LimitNotice.budgetDollars(broken), "$0") }
    }

    // MARK: Subscription view (lib/subscription-view.ts)

    func testSubscriptionWordingMatchesTheWeb() {
        XCTAssertEqual(SubscriptionSummary.periodTitle(300), "5 часов")
        XCTAssertEqual(SubscriptionSummary.periodTitle(60), "1 час")
        XCTAssertEqual(SubscriptionSummary.periodTitle(22), "22 минуты")
        XCTAssertEqual(SubscriptionSummary.periodTitle(1_440), "1 день")
        XCTAssertEqual(SubscriptionSummary.periodTitle(10_080), "7 дней")
        XCTAssertEqual(SubscriptionSummary.periodTitle(0), "Период не указан")
        XCTAssertEqual(SubscriptionSummary.periodTitle(1.5), "Период не указан")
        XCTAssertEqual(SubscriptionSummary.periodTitle(nil), "Период не указан")
        XCTAssertEqual(SubscriptionSummary.percentText(0.01), "<0,1")
        XCTAssertEqual(SubscriptionSummary.percentText(12.5), "12,5")
        XCTAssertEqual(SubscriptionSummary.percentText(37), "37")
        XCTAssertEqual(SubscriptionSummary.percentText(0), "0")
        XCTAssertEqual(SubscriptionSummary.resetText(now.addingTimeInterval(-1), now: now), "Срок сброса прошёл — обнови данные")
        XCTAssertEqual(SubscriptionSummary.resetText(now.addingTimeInterval(30), now: now), "Сброс меньше чем через минуту")
        XCTAssertEqual(SubscriptionSummary.resetText(now.addingTimeInterval(61), now: now), "Сброс через 2 минуты")
        XCTAssertEqual(SubscriptionSummary.resetText(now.addingTimeInterval(21 * minute), now: now), "Сброс через 21 минуту")
        XCTAssertEqual(SubscriptionSummary.resetText(now.addingTimeInterval(hour), now: now), "Сброс через 1 ч")
        XCTAssertEqual(SubscriptionSummary.resetText(now.addingTimeInterval(2 * day + 3 * hour), now: now), "Сброс через 2 дня 3 ч")
        XCTAssertEqual(SubscriptionSummary.planTitle("plus"), "ChatGPT Plus")
        XCTAssertNil(SubscriptionSummary.planTitle("unknown-provider-plan"))
    }

    func testSubscriptionSummaryKeepsBucketsDuplicatesAndHistoryApart() throws {
        func summary(_ value: [String: Any]) throws -> SubscriptionSummary {
            SubscriptionSummary.make(try JSONDecoder().decode(SubscriptionUsage.self, from: data(value)), now: now)
        }
        let buckets = try summary(usage(["windows": [window(["bucketId": "one", "bucketName": "Fixture One", "remainingPercent": 87.0]),
                                                     window(["bucketId": "two", "bucketName": "Fixture Two", "remainingPercent": 8.0])]]))
        XCTAssertEqual(buckets.windows.map { $0.bucketLabel }, ["Fixture One", "Fixture Two"])
        XCTAssertEqual(buckets.windows.map { $0.low }, [false, true])
        let unnamed = try summary(usage(["windows": [window(["bucketId": "one", "bucketName": NSNull()]),
                                                     window(["bucketId": "two", "bucketName": NSNull()])]]))
        XCTAssertEqual(unnamed.windows.map { $0.bucketLabel }, ["Группа лимитов 1", "Группа лимитов 2"])
        XCTAssertEqual(try summary(usage(["windows": [window(["bucketName": NSNull()])]])).windows.first?.bucketLabel, "Подписка")
        // Identical duplicates collapse; conflicting ones never choose a percentage.
        XCTAssertEqual(try summary(usage(["windows": [window(), window(["id": "same-data-other-id"])]])).windows.count, 1)
        let conflict = try summary(usage(["windows": [window(), window(["remainingPercent": 3.0])]]))
        XCTAssertEqual(conflict.windows.count, 1)
        XCTAssertEqual(conflict.windows.first?.duplicateConflict, true)
        XCTAssertNil(conflict.windows.first?.remainingPercent)
        XCTAssertFalse(conflict.fresh)
        // An unavailable refresh keeps the retained snapshot as history.
        let history = try summary(usage(["available": false, "error": "Fixture offline", "windows": [window(["remainingPercent": 4.0])]]))
        XCTAssertTrue(history.available)
        XCTAssertFalse(history.fresh)
        XCTAssertEqual(history.windows.first?.low, false)
        XCTAssertEqual(history.notice, "Не удалось обновить лимиты. Показана последняя проверка.")
        let hosted = try summary(usage(["source": "siwc"]))
        XCTAssertFalse(hosted.available)
        XCTAssertEqual(hosted.unavailableText, "Лимиты этого подключения доступны в ChatGPT. Здесь остаток пока не показан.")
        XCTAssertEqual(SubscriptionSummary.manageURL("https://example.org/usage")?.absoluteString, "https://chatgpt.com/settings/usage")
        XCTAssertEqual(SubscriptionSummary.manageURL("https://chatgpt.com/codex/settings/usage")?.absoluteString,
                       "https://chatgpt.com/codex/settings/usage")
    }
}

/// PASS-0.5.3 §2–§3 iPhone parity: hint levels, the comfort rating, the voice budget, usage refresh and the compact
/// Profile values. Synthetic data only; no network (preview mode answers from fixtures or refuses).
final class ParityTests: XCTestCase {
    private let sessionID = "22222222-2222-4222-8222-222222222222"

    private func data(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func defaults() -> UserDefaults { UserDefaults(suiteName: "smooth-parity-tests-" + UUID().uuidString)! }

    private func activeConversation() -> [String: Any] {
        ["id": sessionID, "status": "active", "mode": "learning",
         "lesson": ["title": "Weekend plans", "goal": "Pick up a detail", "why": "Keep the talk going", "minutes": 10],
         "turns": [["id": "a1", "role": "assistant", "text": "I might try the new climbing gym this weekend."]], "retries": [Any]()]
    }

    private func reviewConversation(status: String) -> [String: Any] {
        ["id": sessionID, "status": status, "mode": "learning",
         "lesson": ["title": "Weekend plans", "goal": "Pick up a detail", "why": "Keep the talk going", "minutes": 10],
         "turns": [["id": "a1", "role": "assistant", "text": "I might try climbing."],
                   ["id": "u1", "role": "user", "text": "Nice, what got you into it?"]],
         "retries": [Any](), "completion": ["canComplete": true, "needsRetry": false],
         "analysis": ["version": 1, "summary": "A good follow-up question.", "strengths": [Any](), "priorities": [Any](),
                      "limitations": [Any]()]]
    }

    @MainActor private func reviewClient(comfort: Int? = nil) throws -> TrainingClient {
        let client = TrainingClient(reminderDefaults: defaults())
        client.previewMode = true
        client.signedIn = true
        var review = reviewConversation(status: "review")
        if let comfort { review["comfort"] = comfort }
        client.conversation = try JSONDecoder().decode(Conversation.self, from: data(review))
        client.conversationPresented = true
        client.previewResponses["sessions/\(sessionID)/complete"] = try data(reviewConversation(status: "completed"))
        return client
    }

    private func stateJSON(budget: Double) -> [String: Any] {
        ["profile": ["name": "Alex", "dailyMinutes": 15, "goals": "Speak calmly on calls", "budgetUsd": budget],
         "sessions": [Any](), "skills": [Any](), "xp": 0, "completed": 0,
         "audioUsage": ["usedUsd": 1.5, "estimated": true, "budgetUsd": budget, "recordedMinutes": 4.0, "spokenCharacters": 300]]
    }

    private func usageJSON() -> [String: Any] {
        let now = ISO8601DateFormatter().string(from: Date())
        return ["source": "codex", "available": true, "scope": "account", "checkedAt": now, "stale": false, "plan": "plus",
                "windows": [["id": "w1", "bucketId": "codex", "bucketName": "Codex", "kind": "primary", "usedPercent": 40.0,
                             "remainingPercent": 60.0, "windowDurationMins": 300, "resetsAt": NSNull()]]]
    }

    // MARK: Usage refresh

    @MainActor func testFailedUsageReadKeepsTheSnapshotAsHistory() async throws {
        let client = TrainingClient(reminderDefaults: defaults())
        client.previewMode = true
        client.signedIn = true
        await client.refreshUsage()
        XCTAssertEqual(client.subscriptionUsage?.available, false)
        XCTAssertEqual(client.subscriptionUsage?.error, "Лимиты временно недоступны. Попробуй обновить.")
        client.previewResponses["usage"] = try data(usageJSON())
        await client.refreshUsage()
        XCTAssertNil(client.subscriptionUsage?.error)
        XCTAssertEqual(client.subscriptionUsage?.windows.first?.bucketId, "codex")
        client.previewResponses.removeValue(forKey: "usage")
        await client.refreshUsage()
        XCTAssertEqual(client.subscriptionUsage?.stale, true)
        XCTAssertEqual(client.subscriptionUsage?.windows.count, 1, "The last snapshot stays readable")
        XCTAssertEqual(client.subscriptionUsage?.error, "Не удалось обновить лимиты. Последние данные сохранены.")
    }

    // MARK: Hints

    @MainActor func testHintAsksForTheChosenLevelInAnyOrder() async throws {
        let client = TrainingClient(reminderDefaults: defaults())
        client.previewMode = true
        client.signedIn = true
        client.conversation = try JSONDecoder().decode(Conversation.self, from: data(activeConversation()))
        let path = "sessions/\(sessionID)/hint"
        client.previewResponses[path] = try data(["text": "Ask what got them into it.", "support": 2])
        await client.getHint(level: 2)
        XCTAssertEqual(client.previewRequestBodies[path]?["level"] as? Int, 2)
        XCTAssertEqual(client.hint, "Ask what got them into it.")
        XCTAssertEqual(client.selectedHintLevel, 2)
        XCTAssertFalse(client.busy)
        await client.getHint(level: 1)
        XCTAssertEqual(client.previewRequestBodies[path]?["level"] as? Int, 1, "Any level, in any order")
        XCTAssertEqual(client.selectedHintLevel, 1)
        client.hint = nil
        XCTAssertEqual(client.selectedHintLevel, 0, "«Скрыть подсказку» clears the selection")
        let sent = client.previewRequests.count
        await client.getHint(level: 4)
        XCTAssertEqual(client.previewRequests.count, sent, "Only levels 1–3 exist")
        XCTAssertEqual(TrainingClient.hintBody(level: 3)["level"] as? Int, 3)
        XCTAssertEqual(TrainingClient.hintStage, "Подбираю подсказку")
        XCTAssertEqual(try JSONDecoder().decode(Hint.self, from: data(["text": "x", "support": 3])).support, 3)
        XCTAssertNil(try JSONDecoder().decode(Hint.self, from: data(["text": "x"])).support)
    }

    func testHintsAreOfferedOnlyInSupportedSpeakingLessons() throws {
        func lesson(mode: String = "learning", activity: String? = nil, material: [String: Any]? = nil,
                    baseline: Bool = false) throws -> Conversation {
            var lessonValue: [String: Any] = ["title": "T", "goal": "g", "why": "w", "minutes": 10]
            if let activity { lessonValue["activity"] = activity }
            if let material { lessonValue["material"] = material }
            var value: [String: Any] = ["id": "s1", "status": "active", "mode": mode, "lesson": lessonValue,
                                        "turns": [Any](), "retries": [Any]()]
            if baseline { value["baseline"] = ["kind": "probe"] }
            return try JSONDecoder().decode(Conversation.self, from: data(value))
        }
        XCTAssertTrue(try lesson().offersHints)
        XCTAssertTrue(try lesson(activity: "speaking").offersHints)
        XCTAssertFalse(try lesson(mode: "call").offersHints, "«Как на созвоне» has no supports")
        XCTAssertFalse(try lesson(activity: "reading").offersHints)
        XCTAssertFalse(try lesson(activity: "writing").offersHints)
        XCTAssertFalse(try lesson(material: ["type": "reading-passage", "text": "A short text.", "instruction": "Answer."]).offersHints)
        XCTAssertFalse(try lesson(baseline: true).offersHints)
    }

    // MARK: Comfort

    @MainActor func testComfortTravelsWithCompleteAndDefer() async throws {
        let path = "sessions/\(sessionID)/complete"
        let client = try reviewClient()
        client.setComfort(4, for: sessionID)
        client.setComfort(9, for: sessionID)
        XCTAssertEqual(client.comfort(for: try XCTUnwrap(client.conversation)), 4, "Only 1–5 is kept")
        await client.action("complete", deferRetry: true, returnHome: true)
        let deferred = try XCTUnwrap(client.previewRequestBodies[path])
        XCTAssertEqual(deferred["comfort"] as? Int, 4)
        XCTAssertEqual(deferred["deferRetry"] as? Bool, true)

        let plain = try reviewClient()
        await plain.action("complete", returnHome: true)
        let body = try XCTUnwrap(plain.previewRequestBodies[path])
        XCTAssertNil(body["comfort"], "Optional: no rating, no field")
        XCTAssertNil(body["deferRetry"])

        let saved = try reviewClient(comfort: 2)
        XCTAssertEqual(saved.comfort(for: try XCTUnwrap(saved.conversation)), 2, "A rating saved with the session is shown")
        await saved.action("complete", returnHome: true)
        XCTAssertEqual(saved.previewRequestBodies[path]?["comfort"] as? Int, 2, "…and never erased by finishing again")

        XCTAssertEqual(TrainingClient.completionBody(comfort: 5, deferRetry: false)["comfort"] as? Int, 5)
        XCTAssertNil(TrainingClient.completionBody(comfort: 0, deferRetry: false)["comfort"])
        XCTAssertNil(TrainingClient.completionBody(comfort: nil, deferRetry: false)["deferRetry"])
    }

    func testSessionComfortDecodesLeniently() throws {
        func comfort(_ raw: Any?) throws -> Int? {
            var value = reviewConversation(status: "completed")
            if let raw { value["comfort"] = raw }
            return try JSONDecoder().decode(Conversation.self, from: data(value)).comfort
        }
        XCTAssertEqual(try comfort(3), 3)
        XCTAssertEqual(try comfort(4.0), 4)
        XCTAssertNil(try comfort(nil))
        XCTAssertNil(try comfort(9))
        XCTAssertNil(try comfort(0))
        XCTAssertNil(try comfort("calm"))
        XCTAssertNil(try comfort(NSNull()))
    }

    // MARK: Voice budget

    func testVoiceBudgetFallsBackToFiftyAndClamps() throws {
        let learner = try JSONDecoder().decode(Learner.self, from: data(["name": "Alex", "dailyMinutes": 15]))
        XCTAssertEqual(learner.budgetUsd, 50, "The server default, not 35")
        XCTAssertEqual(Learner(name: "Alex", dailyMinutes: 15).budgetUsd, 50)
        XCTAssertEqual(try JSONDecoder().decode(Learner.self, from: data(["name": "Alex", "budgetUsd": 12.5])).budgetUsd, 12.5)
        XCTAssertEqual(VoiceBudget.clamped(75), 50)
        XCTAssertEqual(VoiceBudget.clamped(0.4), 1)
        XCTAssertEqual(VoiceBudget.clamped(20), 20)
        XCTAssertNil(VoiceBudget.clamped(.nan))
        XCTAssertEqual(VoiceBudget.stepped(12.5, toward: 13.5), 13)
        XCTAssertEqual(VoiceBudget.stepped(12.5, toward: 11.5), 12)
        XCTAssertEqual(VoiceBudget.stepped(20, toward: 21), 21)
        XCTAssertEqual(VoiceBudget.stepped(49.5, toward: 50), 50)
        XCTAssertEqual(VoiceBudget.stepped(50, toward: 50), 50)
        XCTAssertEqual(VoiceBudget.stepped(1.5, toward: 1), 1)
        XCTAssertEqual(VoiceBudget.label(50), "50")
        XCTAssertEqual(VoiceBudget.label(12.5), "12,5")
        let body = TrainingClient.profileBody(learner, budgetUsd: 75)
        XCTAssertEqual(body["budgetUsd"] as? Double, 50)
        XCTAssertEqual(TrainingClient.profileBody(learner, budgetUsd: 0)["budgetUsd"] as? Double, 1)
        XCTAssertEqual(TrainingClient.profileBody(learner)["budgetUsd"] as? Double, 50)
        for key in ["name", "goals", "interests", "professionalContext", "relocation", "dailyMinutes", "feedback",
                    "audioRetentionDays", "budgetUsd"] {
            XCTAssertNotNil(body[key], key)
        }
        XCTAssertEqual(body["goals"] as? String, "Говорить увереннее", "The server requires goals")
        XCTAssertEqual(body["dailyMinutes"] as? Int, 15)
        XCTAssertEqual(body["audioRetentionDays"] as? Int, 30)
    }

    @MainActor func testVoiceBudgetSavesOnItsOwnWithoutTheSharedAlert() async throws {
        let client = TrainingClient(reminderDefaults: defaults())
        client.previewMode = true
        client.signedIn = true
        client.state = try JSONDecoder().decode(TrainingState.self, from: data(stateJSON(budget: 35)))
        client.previewResponses["profile"] = try data(stateJSON(budget: 20))
        let saved = await client.saveVoiceBudget(20)
        XCTAssertTrue(saved)
        XCTAssertEqual(client.previewRequestBodies["profile"]?["budgetUsd"] as? Double, 20)
        XCTAssertEqual(client.previewRequestBodies["profile"]?["name"] as? String, "Alex")
        XCTAssertEqual(client.previewRequestBodies["profile"]?["goals"] as? String, "Speak calmly on calls")
        XCTAssertEqual(client.state?.profile.budgetUsd, 20)
        XCTAssertFalse(client.busy)
        client.previewResponses.removeValue(forKey: "profile")
        let failed = await client.saveVoiceBudget(10)
        XCTAssertFalse(failed)
        XCTAssertNil(client.error, "The field says «Не удалось сохранить бюджет.» itself; no shared alert")
        XCTAssertEqual(client.state?.profile.budgetUsd, 20)
    }

    // MARK: Compact Profile (§3)

    func testShortToneFollowsTheWebRule() {
        XCTAssertEqual(ProfileCopy.shortTone("Прямо и по делу."), "прямо и по делу")
        XCTAssertEqual(ProfileCopy.shortTone("Подробный разбор с объяснением и собственной улучшенной попыткой."),
                       "подробный разбор с объяснением и…")
        XCTAssertEqual(ProfileCopy.shortTone("AI-тренер, строго"), "AI-тренер", "An abbreviation keeps its capitals")
        XCTAssertEqual(ProfileCopy.shortTone("IELTS: строго по критериям"), "IELTS")
        XCTAssertEqual(ProfileCopy.shortTone("(Мягко) и подробно"), "мягко", "The first non-empty clause")
        XCTAssertEqual(ProfileCopy.shortTone("Прямо - без воды"), "прямо")
        XCTAssertEqual(ProfileCopy.shortTone("Прямо — без воды"), "прямо")
        XCTAssertEqual(ProfileCopy.shortTone("Коротко\nи по делу"), "коротко")
        XCTAssertEqual(ProfileCopy.shortTone(String(repeating: "а", count: 45)), String(repeating: "а", count: 39) + "…",
                       "No space: cut at 39 characters")
        XCTAssertEqual(ProfileCopy.shortTone("Очень " + String(repeating: "б", count: 40)), "очень " + String(repeating: "б", count: 33) + "…",
                       "A space before position 20 does not shorten the cut")
        XCTAssertEqual(ProfileCopy.shortTone(String(repeating: "в", count: 40)), String(repeating: "в", count: 40), "40 characters fit")
        XCTAssertNil(ProfileCopy.shortTone("   "))
        XCTAssertNil(ProfileCopy.shortTone(" . , "))
    }

    func testCompactProfileRowValues() throws {
        let learner = try JSONDecoder().decode(Learner.self, from: data(["name": "Alex", "dailyMinutes": 15, "feedback": "Прямо и по делу."]))
        XCTAssertEqual(ProfileCopy.practiceLine(learner), "Практика 15 мин в день · тон: прямо и по делу")
        let quiet = try JSONDecoder().decode(Learner.self, from: data(["name": "Alex", "dailyMinutes": 20, "feedback": ""]))
        XCTAssertEqual(ProfileCopy.practiceLine(quiet), "Практика 20 мин в день")
        XCTAssertEqual(ProfileCopy.displayName("Alex"), "Alex")
        for placeholder in ["Ты", "You", "Learner", "ты", "  ", nil] as [String?] {
            XCTAssertEqual(ProfileCopy.displayName(placeholder), "Твой профиль")
        }

        let configured = try JSONDecoder().decode(ServerStatus.self, from: data(["brain": ["model": "m", "verified": true],
                                                                                  "audio": ["configured": true]]))
        let keyless = try JSONDecoder().decode(ServerStatus.self, from: data(["brain": ["model": "m", "verified": false, "error": "offline"],
                                                                               "audio": ["configured": false]]))
        let spend = AudioUsage(usedUsd: 3.9, estimated: true, budgetUsd: 50, recordedMinutes: 12, spokenCharacters: 900)
        XCTAssertEqual(ProfileCopy.voiceValue(status: configured, statusUnavailable: false, usage: spend), "Подключён · $3 из $50")
        XCTAssertEqual(ProfileCopy.voiceValue(status: keyless, statusUnavailable: false, usage: spend), "Нет ключа")
        XCTAssertEqual(ProfileCopy.voiceValue(status: nil, statusUnavailable: false, usage: spend), "Проверяю…")
        XCTAssertEqual(ProfileCopy.voiceValue(status: nil, statusUnavailable: true, usage: spend), "Статус недоступен")

        XCTAssertEqual(ProfileCopy.coachState(notice: nil, status: configured, statusUnavailable: false).label, "На связи")
        XCTAssertEqual(ProfileCopy.coachState(notice: nil, status: configured, statusUnavailable: false).tone, .good)
        XCTAssertEqual(ProfileCopy.coachState(notice: nil, status: keyless, statusUnavailable: false).label, "Не подключается")
        XCTAssertEqual(ProfileCopy.coachState(notice: nil, status: nil, statusUnavailable: false).label, "Проверяю…")
        XCTAssertEqual(ProfileCopy.coachState(notice: nil, status: nil, statusUnavailable: true).label, "Статус недоступен")
        let low = LimitNotice(kind: .subscriptionLow, tone: .warning, title: "t", detail: "d", section: .limits)
        let limited = LimitNotice(kind: .rateLimited, tone: .danger, title: "t", detail: "d", section: .limits)
        let exhausted = LimitNotice(kind: .subscriptionExhausted, tone: .danger, title: "t", detail: "d", section: .limits)
        XCTAssertEqual(ProfileCopy.coachState(notice: low, status: configured, statusUnavailable: false).label, "Лимит на исходе")
        XCTAssertEqual(ProfileCopy.coachState(notice: limited, status: configured, statusUnavailable: false).label, "Упёрся в лимит")
        XCTAssertEqual(ProfileCopy.coachState(notice: exhausted, status: configured, statusUnavailable: false).tone, .danger)
        XCTAssertEqual(ProfileCopy.coachState(notice: exhausted, status: configured, statusUnavailable: false).label, "Лимит исчерпан")

        XCTAssertEqual(ProfileCopy.playbookValue(accepted: 4, toCheck: 2), "4 факта · 2 новых")
        XCTAssertEqual(ProfileCopy.playbookValue(accepted: 0, toCheck: 1), "1 новое — проверь")
        XCTAssertEqual(ProfileCopy.playbookValue(accepted: 5, toCheck: 0), "5 фактов")
        XCTAssertEqual(ProfileCopy.playbookValue(accepted: 0, toCheck: 0), "Пока пусто")

        let reminders = [PracticeReminder(id: "smooth-practice-b", hour: 21, minute: 0),
                         PracticeReminder(id: "smooth-practice-a", hour: 19, minute: 0),
                         PracticeReminder(id: "smooth-practice-c", hour: 8, minute: 30, enabled: false)]
        XCTAssertEqual(ProfileCopy.remindersValue(reminders, notificationState: "authorized"), "19:00, 21:00")
        XCTAssertEqual(ProfileCopy.remindersValue(reminders, notificationState: "denied"), "Выключены")
        XCTAssertEqual(ProfileCopy.remindersValue([], notificationState: "authorized"), "Выключены")
        let many = (6...10).map { PracticeReminder(id: "smooth-practice-\($0)", hour: $0, minute: 0) }
        XCTAssertEqual(ProfileCopy.remindersValue(many, notificationState: "authorized"), "06:00, 07:00 и ещё 3")
        XCTAssertEqual(ProfileCopy.retentionValue(30), "Аудио 30 дней")
        XCTAssertEqual(ProfileCopy.retentionValue(90), "Аудио 3 месяца")
        XCTAssertEqual(ProfileCopy.retentionValue(180), "Аудио 6 месяцев")
        XCTAssertEqual(ProfileCopy.retentionValue(7), "Аудио 7 дней")
    }
}
