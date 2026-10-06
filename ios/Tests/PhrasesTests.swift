import XCTest
import UIKit
@testable import RatmirEnglish

/// «Мои фразы» (planning/v05/PASS-0.5.3.md §1): decoding, the shared schedule and words (the same cases as
/// tests/phrases-labels.test.ts for lib/phrases/schedule.ts and labels.ts), the request bodies, the phrase round start, the
/// «Вернуть» window, the capture flow and the Home Screen quick action; 0.5.4 «Послушать» (ListenClip, `heard`, the upload
/// body, the pill). Fictional, generic expressions only; no network.
final class PhrasesTests: XCTestCase {
    /// 2026-10-06T09:00:00Z: 12:00 in Moscow.
    private let now = ISO8601DateFormatter().date(from: "2026-10-06T09:00:00Z")!
    private var serial = 0

    private var moscow: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Moscow")!
        return calendar
    }

    private func at(_ hours: Double) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(hours * 3_600)) }
    private func data(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T { try JSONDecoder().decode(type, from: data(value)) }
    private func json(_ phrase: SavedPhrase) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(phrase)) }
    private func freshDefaults() -> UserDefaults { UserDefaults(suiteName: "smooth-phrases-tests-" + UUID().uuidString)! }

    /// A ready, learning phrase due an hour ago, adjusted by `configure`.
    private func phrase(_ configure: (inout SavedPhrase) -> Void = { _ in }) -> SavedPhrase {
        serial += 1
        var value = SavedPhrase(id: "phrase-\(serial)", text: "be on the same page", origin: .web, createdAt: at(-48), updatedAt: at(-48),
                                enrichment: .ready, phrase: "be on the same page", meaning: "понимать друг друга одинаково",
                                example: "Let us talk first so we are on the same page.",
                                exampleRu: "Давай сначала обсудим, чтобы понимать друг друга.", cue: "одинаково понимать задачу",
                                situation: "Before we start, should we agree on the plan?", status: .learning, stage: 1,
                                dueAt: at(-1), lastPracticedAt: at(-30))
        configure(&value)
        return value
    }

    private func roundSession() -> [String: Any] {
        ["id": "33333333-3333-4333-8333-333333333333", "status": "active", "mode": "learning",
         "lesson": ["title": "Мои фразы · 2", "goal": "Сказать свои фразы к месту.", "why": "w", "minutes": 4,
                    "familyId": "my-phrases", "phraseIds": ["p1", "p2"]] as [String: Any],
         "turns": [["id": "a1", "role": "assistant", "text": "We're almost out of time, and the budget is still open."]], "retries": []]
    }

    @MainActor private func waitUntil(_ condition: @MainActor () -> Bool, timeout: Double = 2) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            guard Date() < deadline else { return XCTFail("Timed out waiting for the capture result") }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    // MARK: Decoding

    func testSavedPhraseDecodesEveryField() throws {
        let value = try decode(SavedPhrase.self, [
            "id": "11111111-2222-4333-8444-555555555555", "text": "как сказать «давай созвонимся в пятницу»", "origin": "iphone",
            "createdAt": "2026-10-05T10:00:00.000Z", "updatedAt": "2026-10-05T10:01:00.000Z", "enrichment": "ready",
            "phrase": "touch base", "meaning": "коротко связаться", "note": "Неформально, между коллегами.",
            "example": "Let's touch base on Friday.", "exampleRu": "Давай коротко созвонимся в пятницу.", "cue": "коротко связаться",
            "situation": "When can we talk again?", "status": "learning", "stage": 2, "dueAt": "2026-10-08T10:00:00.000Z",
            "lastPracticedAt": "2026-10-05T10:00:00.000Z", "lastOfferedAt": NSNull(), "archived": false,
            "history": [["at": "2026-10-05T10:00:00.000Z", "sessionId": "s1", "result": "used"]]] as [String: Any])
        XCTAssertEqual(value.id, "11111111-2222-4333-8444-555555555555")
        XCTAssertEqual(value.origin, .iphone)
        XCTAssertEqual(value.enrichment, .ready)
        XCTAssertEqual(value.phrase, "touch base")
        XCTAssertEqual(value.meaning, "коротко связаться")
        XCTAssertEqual(value.note, "Неформально, между коллегами.")
        XCTAssertEqual(value.example, "Let's touch base on Friday.")
        XCTAssertEqual(value.exampleRu, "Давай коротко созвонимся в пятницу.")
        XCTAssertEqual(value.cue, "коротко связаться")
        XCTAssertEqual(value.situation, "When can we talk again?")
        XCTAssertEqual(value.status, .learning)
        XCTAssertEqual(value.stage, 2)
        XCTAssertEqual(value.dueAt, "2026-10-08T10:00:00.000Z")
        XCTAssertEqual(value.lastPracticedAt, "2026-10-05T10:00:00.000Z")
        XCTAssertNil(value.lastOfferedAt)
        XCTAssertFalse(value.archived)
        XCTAssertEqual(value.history, [SavedPhrase.HistoryEntry(at: "2026-10-05T10:00:00.000Z", sessionId: "s1", result: .used)])
        XCTAssertEqual(PhraseSchedule.target(value), "touch base")
    }

    func testMissingOptionalFieldsFallBackToTheServerDefaults() throws {
        let value = try decode(SavedPhrase.self, ["id": "p-min", "text": "touch base"])
        XCTAssertEqual(value.enrichment, .pending)
        XCTAssertEqual(value.status, .new)
        XCTAssertEqual(value.stage, 0)
        XCTAssertNil(value.phrase)
        XCTAssertNil(value.meaning)
        XCTAssertNil(value.example)
        XCTAssertTrue(value.history.isEmpty)
        XCTAssertFalse(value.archived)
        XCTAssertNil(PhraseSchedule.target(value), "Sol is still at it: nothing to practise yet")
        XCTAssertThrowsError(try decode(SavedPhrase.self, ["id": "no-text"]), "The text is required")
        let result = try decode(PhraseResult.self, ["phraseId": "p1", "phrase": "touch base"])
        XCTAssertFalse(result.used)
        XCTAssertFalse(result.hinted)
        XCTAssertNil(result.meaning)
        XCTAssertNil(result.quote)
        let created = try decode(PhraseCreateResult.self, ["phrase": ["id": "p2", "text": "circle back"]])
        XCTAssertEqual(created.phrase.id, "p2")
        XCTAssertFalse(created.duplicate)
    }

    func testUnknownValuesDecodeWithoutBreakingThePhrase() throws {
        let value = try decode(SavedPhrase.self, [
            "id": "p-new", "text": "touch base", "status": "paused", "enrichment": "queued", "origin": "watch", "stage": 9.6,
            "dueAt": at(-1), "history": [["at": at(-2), "sessionId": "s1", "result": "skipped"], ["at": at(-3)], 7]] as [String: Any])
        XCTAssertEqual(value.status.rawValue, "paused")
        XCTAssertNotEqual(value.status, .learned)
        XCTAssertEqual(value.enrichment.rawValue, "queued")
        XCTAssertEqual(value.origin.rawValue, "watch")
        XCTAssertEqual(value.stage, 5, "Clamped to the ladder")
        XCTAssertEqual(value.history.map { $0.result.rawValue }, ["skipped"], "Entries without a result are skipped")
        XCTAssertEqual(PhraseSchedule.target(value), "touch base", "Not pending: the English text stands in")
        XCTAssertTrue(PhraseSchedule.isDue(value, now: now))
        XCTAssertEqual(PhraseLabels.historyLine(value.history[0], calendar: moscow), PhraseLabels.shortDay(at(-2), calendar: moscow))
        let again = try JSONDecoder().decode(SavedPhrase.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(again, value, "Unknown values survive a round trip")
    }

    func testStateAndSessionsDecodePhraseFieldsOptionally() throws {
        let base: [String: Any] = ["profile": ["name": "Test", "dailyMinutes": 15], "sessions": [], "skills": [], "xp": 0, "completed": 0]
        let plain = try decode(TrainingState.self, base)
        XCTAssertNil(plain.phrases, "Older servers send no phrases")
        XCTAssertEqual(plain.duePhraseCount(now: now), 0)
        let usable = try json(phrase())
        let archived = try json(phrase { $0.archived = true })
        var withPhrases = base
        withPhrases["phrases"] = [usable, ["id": "broken"], 7, archived] as [Any]
        let state = try decode(TrainingState.self, withPhrases)
        XCTAssertEqual(state.phrases?.count, 2, "A broken phrase never hides the others")
        XCTAssertEqual(state.duePhraseCount(now: now), 1)

        var session = roundSession()
        XCTAssertNil(try decode(Conversation.self, session).phraseResults, "No results until the conversation finishes")
        session["phraseResults"] = [["phraseId": "p1", "phrase": "circle back", "meaning": "вернуться к вопросу позже", "used": true,
                                     "hinted": false, "quote": "Let's circle back to it after the demo."],
                                    ["phrase": "no id"]] as [Any]
        let finished = try decode(Conversation.self, session)
        XCTAssertEqual(finished.phraseResults?.map(\.phraseId), ["p1"])
        XCTAssertEqual(finished.lesson.phraseIds, ["p1", "p2"])
        XCTAssertEqual(finished.lesson.familyId, PhraseLabels.roundFamily)
        var older = roundSession()
        older["lesson"] = ["title": "Планы на выходные", "goal": "g", "why": "w", "minutes": 10, "phraseIds": ["p1", "  ", 3]] as [String: Any]
        XCTAssertEqual(try decode(Conversation.self, older).lesson.phraseIds, ["p1"])
    }

    // MARK: Schedule (lib/phrases/schedule.ts)

    func testMostlyLatinMatchesTheSharedRule() {
        XCTAssertTrue(PhraseSchedule.mostlyLatin("be on the same page"))
        XCTAssertFalse(PhraseSchedule.mostlyLatin("как сказать «на одной волне»"))
        XCTAssertFalse(PhraseSchedule.mostlyLatin(""))
        XCTAssertFalse(PhraseSchedule.mostlyLatin("12:30 — 14:00"), "No letters")
        XCTAssertFalse(PhraseSchedule.mostlyLatin("café crème"), "7 of 9 letters are basic Latin: below 80 %")
        XCTAssertTrue(PhraseSchedule.mostlyLatin("abcd é"), "Exactly 80 %")
        XCTAssertFalse(PhraseSchedule.mostlyLatin("touch base (созвониться)"))
    }

    func testTargetAndUsableFollowTheSchedule() {
        XCTAssertEqual(PhraseSchedule.target(phrase { $0.phrase = "  a ballpark figure " }), "a ballpark figure")
        XCTAssertEqual(PhraseSchedule.target(phrase { $0.phrase = "   "; $0.text = " touch base " }), "touch base")
        XCTAssertNil(PhraseSchedule.target(phrase { $0.enrichment = .pending; $0.phrase = nil; $0.text = "touch base" }))
        XCTAssertNil(PhraseSchedule.target(phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "как сказать «не горит»" }))
        XCTAssertEqual(PhraseSchedule.target(phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "call it a day" }), "call it a day")
        XCTAssertTrue(PhraseSchedule.isUsable(phrase()))
        XCTAssertFalse(PhraseSchedule.isUsable(phrase { $0.archived = true }), "«Уже знаю»")
        XCTAssertFalse(PhraseSchedule.isUsable(phrase { $0.status = .learned; $0.stage = 5 }))
        XCTAssertTrue(PhraseSchedule.isUsable(phrase { $0.status = PhraseStatus(rawValue: "paused") }))
    }

    func testDueCountIncludesNewOnesAndSkipsWhatCannotComeBack() {
        let list = [
            phrase { $0.status = .new; $0.stage = 0; $0.dueAt = self.at(-0.5) },
            phrase { $0.dueAt = self.at(30) },
            phrase { $0.dueAt = "garbage" },
            phrase { $0.enrichment = .pending; $0.phrase = nil },
            phrase { $0.archived = true },
            phrase { $0.status = .learned; $0.stage = 5 },
            phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "как сказать «в общих чертах»" },
        ]
        XCTAssertEqual(PhraseSchedule.dueCount(list, now: now), 2, "A new one and an unreadable date (due at once, like the web)")
        XCTAssertEqual(PhraseSchedule.dueCount(nil, now: now), 0)
        XCTAssertFalse(PhraseSchedule.isDue(list[1], now: now))
        XCTAssertTrue(PhraseSchedule.isDue(list[1], now: now.addingTimeInterval(31 * 3_600)))
    }

    // MARK: Words (lib/phrases/labels.ts)

    func testRussianPluralsForWaitingPhrases() {
        XCTAssertEqual([1, 2, 4, 5, 11, 12, 14, 20, 21, 22, 25, 101, 111, 0].map { RuFormat.plural($0, "фраза", "фразы", "фраз") },
                       ["фраза", "фразы", "фразы", "фраз", "фраз", "фраз", "фраз", "фраз", "фраза", "фразы", "фраз", "фраза", "фраз", "фраз"])
        XCTAssertEqual(PhraseLabels.phraseCount(3), "3 фразы")
        XCTAssertEqual(PhraseLabels.waiting(3), "3 ждут повторения")
        XCTAssertEqual(PhraseLabels.waiting(1), "1 ждёт повторения", "The verb agrees with one")
        XCTAssertEqual(PhraseLabels.waiting(11), "11 ждут повторения")
        XCTAssertEqual(PhraseLabels.waiting(21), "21 ждёт повторения")
        XCTAssertEqual(PhraseLabels.phrasesWaiting(5), "5 фраз ждут повторения")
        XCTAssertEqual(PhraseLabels.phrasesWaiting(1), "1 фраза ждёт повторения")
        XCTAssertEqual(PhraseLabels.phrasesWaiting(22), "22 фразы ждут повторения")
    }

    func testDueLabelsGoByCalendarDaysInTheLearnersZone() throws {
        XCTAssertEqual(PhraseLabels.dueIn(now.addingTimeInterval(-1), now: now, calendar: moscow), "сегодня", "Already due")
        XCTAssertEqual(PhraseLabels.dueIn(now.addingTimeInterval(6 * 3_600), now: now, calendar: moscow), "сегодня", "Later today")
        XCTAssertEqual(PhraseLabels.dueIn(now.addingTimeInterval(24 * 3_600), now: now, calendar: moscow), "завтра")
        XCTAssertEqual(PhraseLabels.dueIn(now.addingTimeInterval(3 * 86_400), now: now, calendar: moscow), "через 3 дня")
        XCTAssertEqual(PhraseLabels.dueIn(now.addingTimeInterval(5 * 86_400), now: now, calendar: moscow), "через 5 дней")
        XCTAssertEqual(PhraseLabels.dueIn(now.addingTimeInterval(21 * 86_400), now: now, calendar: moscow), "через 21 день")
        let lateEvening = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-06T20:30:00Z"))
        XCTAssertEqual(PhraseLabels.dueIn(lateEvening.addingTimeInterval(3_600), now: lateEvening, calendar: moscow), "завтра",
                       "Past midnight in Moscow is tomorrow even one hour later")
    }

    func testRowLabelsHeadlinesAndHistoryLines() {
        XCTAssertEqual(PhraseLabels.dueLabel(phrase { $0.archived = true }, now: now, calendar: moscow), "уже знаю")
        XCTAssertEqual(PhraseLabels.dueLabel(phrase { $0.status = .learned; $0.stage = 5; $0.dueAt = self.at(24 * 35) }, now: now, calendar: moscow), "выучена")
        XCTAssertNil(PhraseLabels.dueLabel(phrase { $0.enrichment = .pending; $0.phrase = nil; $0.status = .new }, now: now, calendar: moscow))
        XCTAssertNil(PhraseLabels.dueLabel(phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "как сказать «договорились»" },
                                           now: now, calendar: moscow), "A Russian text without a target")
        XCTAssertEqual(PhraseLabels.dueLabel(phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "touch base" }, now: now, calendar: moscow),
                       "сегодня", "An English text is its own target")
        XCTAssertEqual(PhraseLabels.dueLabel(phrase { $0.dueAt = self.at(24 * 3) }, now: now, calendar: moscow), "через 3 дня")

        let pending = phrase { $0.enrichment = .pending; $0.phrase = nil; $0.text = "  как сказать «давай созвонимся»  " }
        XCTAssertEqual(PhraseLabels.headline(pending), "как сказать «давай созвонимся»")
        XCTAssertFalse(PhraseLabels.headlineIsEnglish(pending))
        let ready = phrase { $0.text = "как сказать «давай созвонимся»"; $0.phrase = "touch base" }
        XCTAssertEqual(PhraseLabels.headline(ready), "touch base")
        XCTAssertTrue(PhraseLabels.headlineIsEnglish(ready))
        XCTAssertTrue(PhraseLabels.headlineIsEnglish(phrase { $0.enrichment = .pending; $0.phrase = nil; $0.text = "a ballpark figure" }))
        XCTAssertEqual(PhraseLabels.enrichmentProblem(phrase { $0.note = "  " }), "Разбор не получился.")
        XCTAssertEqual(PhraseLabels.enrichmentProblem(phrase { $0.note = "Не понял, что запомнить. Попробуй сформулировать иначе." }),
                       "Не понял, что запомнить. Попробуй сформулировать иначе.")

        func entry(_ at: String, _ result: PhraseHistoryResult) -> SavedPhrase.HistoryEntry {
            SavedPhrase.HistoryEntry(at: at, sessionId: "s", result: result)
        }
        XCTAssertEqual(PhraseLabels.historyLine(entry("2026-10-06T10:00:00Z", .used), calendar: moscow), "06.10 · сказал в разговоре")
        XCTAssertEqual(PhraseLabels.historyLine(entry("2026-10-05T10:00:00Z", .missed), calendar: moscow), "05.10 · не прозвучала")
        XCTAssertEqual(PhraseLabels.historyLine(entry("2026-10-04T22:30:00Z", .hinted), calendar: moscow), "05.10 · сказал с подсказкой",
                       "The local day")
        XCTAssertEqual(PhraseLabels.historyLine(entry("2026-10-03T10:00:00Z", .offered), calendar: moscow), "03.10 · повода не было")
    }

    func testRepeatOrderOverviewAndTheRoundSize() {
        let overdue = phrase { $0.dueAt = self.at(-30) }
        let dueNow = phrase { $0.dueAt = self.at(-2) }
        let newer = phrase { $0.status = .new; $0.stage = 0; $0.createdAt = self.at(-1); $0.dueAt = self.at(-1) }
        let older = phrase { $0.status = .new; $0.stage = 0; $0.createdAt = self.at(-5); $0.dueAt = self.at(-5) }
        let list = [newer, dueNow, older, overdue,
                    phrase { $0.archived = true }, phrase { $0.status = .learned; $0.stage = 5 }, phrase { $0.dueAt = self.at(30) },
                    phrase { $0.enrichment = .pending; $0.phrase = nil; $0.status = .new; $0.stage = 0 },
                    phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "как сказать «в общих чертах»"; $0.status = .new }]
        XCTAssertEqual(PhraseLabels.toRepeat(list, now: now).map(\.id), [overdue.id, dueNow.id, older.id, newer.id])
        XCTAssertEqual(PhraseSchedule.roundCandidates(list, now: now).map(\.id), [overdue.id, dueNow.id, older.id, newer.id],
                       "The server's round (phraseRoundCandidates) takes the same ones in the same order")
        XCTAssertEqual(PhraseLabels.all([older, newer, overdue]).map(\.id), [newer.id, older.id, overdue.id], "«Все»: newest first")

        let waiting = (0..<7).map { index in phrase { $0.dueAt = self.at(Double(index) - 10); $0.phrase = "expression \(index)" } }
        let view = PhraseLabels.overview(waiting + [phrase { $0.archived = true }], now: now, calendar: moscow)
        XCTAssertEqual(view.total, 8, "Archived ones are counted in «Все»")
        XCTAssertEqual(view.due, 7)
        XCTAssertEqual(view.round, 5, "One round takes at most five")
        XCTAssertEqual(PhraseSchedule.roundCandidates(waiting, now: now).count, 5)
        XCTAssertEqual(view.chips.map(\.text), ["expression 0", "expression 1", "expression 2"])
        XCTAssertNil(view.next)

        let later = PhraseLabels.overview([phrase { $0.dueAt = self.at(24 * 3) }, phrase { $0.dueAt = self.at(24) },
                                           phrase { $0.status = .learned; $0.dueAt = self.at(2) }], now: now, calendar: moscow)
        XCTAssertEqual(later.due, 0)
        XCTAssertEqual(later.round, 0)
        XCTAssertEqual(later.next, "завтра", "The nearest usable one; learned ones are not scheduled")
        XCTAssertEqual(PhraseLabels.overview(nil, now: now, calendar: moscow), PhrasesOverview(total: 0, due: 0, round: 0, chips: [], next: nil))
        let fallback = PhraseLabels.overview([phrase { $0.enrichment = .failed; $0.phrase = nil; $0.text = "call it a day"; $0.status = .new }],
                                             now: now, calendar: moscow)
        XCTAssertEqual(fallback.chips.map(\.text), ["call it a day"], "An English text stands in for a failed enrichment")
    }

    func testUpsertKeepsTheNewestCopyAndTheListHidesRemovals() {
        let first = phrase { $0.updatedAt = self.at(-3) }
        let second = phrase()
        let list = [second, first]
        let added = phrase()
        XCTAssertEqual(PhraseLabels.upsert(list, added).map(\.id), [added.id, second.id, first.id])
        var fresher = first
        fresher.meaning = "новое"
        fresher.updatedAt = at(0)
        XCTAssertEqual(PhraseLabels.upsert(list, fresher)[1].meaning, "новое")
        var stale = first
        stale.meaning = "старое"
        stale.updatedAt = at(-10)
        XCTAssertEqual(PhraseLabels.upsert(list, stale), list, "An older copy never replaces a newer one")

        let saved = phrase { $0.createdAt = self.at(0); $0.updatedAt = self.at(0) }
        let copy = FreshPhrase(phrase: saved, receivedAt: now)
        let merged = PhraseLabels.merge(server: list, fresh: [copy], lastRefresh: now.addingTimeInterval(-60), hidden: [])
        XCTAssertEqual(merged.first?.id, saved.id, "Saved on this iPhone, not in /api/state yet: on top")
        let caughtUp = PhraseLabels.merge(server: list, fresh: [copy], lastRefresh: now.addingTimeInterval(10), hidden: [])
        XCTAssertFalse(caughtUp.contains { $0.id == saved.id }, "A refresh well after it no longer lists it: deleted elsewhere")
        XCTAssertEqual(PhraseLabels.merge(server: list, fresh: [], lastRefresh: nil, hidden: [second.id]).map(\.id), [first.id],
                       "A removal in its «Вернуть» window is hidden")
    }

    func testReviewNotesDifferBetweenARoundAndAWovenSession() {
        XCTAssertNil(PhraseLabels.resultNote(used: true, hinted: false, round: true), "His own sentence speaks for itself")
        XCTAssertEqual(PhraseLabels.resultNote(used: true, hinted: true, round: false), "С подсказкой — вернётся завтра")
        XCTAssertEqual(PhraseLabels.resultNote(used: false, hinted: false, round: true), "Не прозвучала — вернётся завтра")
        XCTAssertEqual(PhraseLabels.resultNote(used: false, hinted: false, round: false), "Повода не было")
        XCTAssertTrue(PhraseLabels.isRound(familyId: "my-phrases"))
        XCTAssertFalse(PhraseLabels.isRound(familyId: "strategy-price"))
        XCTAssertFalse(PhraseLabels.isRound(familyId: nil))
    }

    func testCaptureTextNeedsALetterAndPasteNeverExceedsTheLimit() {
        XCTAssertEqual(PhraseLabels.captureText("  touch base \n"), "touch base")
        XCTAssertEqual(PhraseLabels.captureText("как сказать «созвонимся»"), "как сказать «созвонимся»")
        XCTAssertNil(PhraseLabels.captureText("   "))
        XCTAssertNil(PhraseLabels.captureText("12:30 — 14:00"), "No letter, nothing to remember")
        XCTAssertEqual(PhraseLabels.captureText(String(repeating: "a", count: 600))?.count, 600)
        XCTAssertNil(PhraseLabels.captureText(String(repeating: "a", count: 601)))
        XCTAssertEqual(PhraseLabels.captureProblem("   "), "Напиши, что запомнить.")
        XCTAssertEqual(PhraseLabels.captureProblem(String(repeating: "a", count: 601)), "Слишком длинно: до 600 символов.")
        XCTAssertEqual(PhraseLabels.captureProblem("12:30 — 14:00"), "Нужны слова, а не только знаки.")
        XCTAssertNil(PhraseLabels.captureProblem("circle back"))

        let first = PhraseLabels.insert("", "  touch base\r\n")
        XCTAssertEqual(first.text, "touch base")
        XCTAssertFalse(first.truncated)
        XCTAssertEqual(PhraseLabels.insert("как сказать", "touch base").text, "как сказать touch base")
        XCTAssertEqual(PhraseLabels.insert("say it ", "clearly").text, "say it clearly", "No double space")
        let clipped = PhraseLabels.insert("abc", String(repeating: "x", count: 20), limit: 10)
        XCTAssertEqual(clipped.text, "abc xxxxxx")
        XCTAssertTrue(clipped.truncated)
        let full = PhraseLabels.insert("full", "more", limit: 4)
        XCTAssertEqual(full.text, "full", "No room: unchanged")
        XCTAssertTrue(full.truncated)
        XCTAssertEqual(PhraseLabels.prefix("ab😀cd", utf16: 3), "ab", "Never splits a character")
    }

    // MARK: Requests

    func testRequestBodiesFollowTheContract() {
        let create = PhraseRequests.create("circle back")
        XCTAssertEqual(create.count, 2)
        XCTAssertEqual(create["text"] as? String, "circle back")
        XCTAssertEqual(create["origin"] as? String, "iphone")
        XCTAssertEqual(PhraseRequests.update(archived: true) as NSDictionary, ["archived": true] as NSDictionary)
        XCTAssertEqual(PhraseRequests.update(archived: false, relearn: true) as NSDictionary,
                       ["archived": false, "relearn": true] as NSDictionary)
        XCTAssertEqual(PhraseRequests.update(retryEnrichment: true) as NSDictionary, ["retryEnrichment": true] as NSDictionary)
        XCTAssertTrue(PhraseRequests.update().isEmpty, "Only what changes is sent")
        let round = PhraseRequests.round(mode: "learning", minutes: 15, requestId: "r-1")
        XCTAssertEqual(round["phraseRound"] as? Bool, true)
        XCTAssertEqual(round["mode"] as? String, "learning")
        XCTAssertEqual(round["intent"] as? String, "new")
        XCTAssertNil(round["drillId"])
        XCTAssertNil(round["familyId"])
        XCTAssertNil(round["topic"])
        XCTAssertEqual(PhraseRequests.defaultRoundMode, "learning", "«Повторить» starts «С опорами»")
        XCTAssertEqual(PhraseRequests.path("p1") + "/delete", "phrases/p1/delete")
    }

    @MainActor func testClientSendsTheCreateUpdateAndDeleteRequests() async throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        let stored = try json(phrase { $0.id = "p1"; $0.text = "circle back"; $0.phrase = "circle back" })
        client.previewResponses["phrases"] = try data(["phrase": stored, "duplicate": true] as [String: Any])
        let created = try await client.createPhrase(text: "  circle back \n")
        XCTAssertEqual(created.phrase.id, "p1")
        XCTAssertTrue(created.duplicate)
        XCTAssertEqual(client.previewRequestBodies["phrases"]?["text"] as? String, "circle back", "Trimmed")
        XCTAssertEqual(client.previewRequestBodies["phrases"]?["origin"] as? String, "iphone")
        do {
            _ = try await client.createPhrase(text: " … ")
            XCTFail("Nothing to remember is never sent")
        } catch {
            XCTAssertEqual(TrainingClient.describe(error), "Нужны слова, а не только знаки.")
        }

        client.previewResponses["phrases/p1"] = try data(["phrase": stored])
        _ = try await client.fetchPhrase(id: "p1")
        XCTAssertTrue(client.previewRequests.contains("phrases/p1"))
        XCTAssertNil(client.previewRequestBodies["phrases/p1"], "GET carries no body")
        _ = try await client.updatePhrase(id: "p1", archived: true)
        let archive = try XCTUnwrap(client.previewRequestBodies["phrases/p1"])
        XCTAssertEqual(archive as NSDictionary, ["archived": true] as NSDictionary)
        _ = try await client.updatePhrase(id: "p1", relearn: true)
        let relearn = try XCTUnwrap(client.previewRequestBodies["phrases/p1"])
        XCTAssertEqual(relearn as NSDictionary, ["relearn": true] as NSDictionary)
        client.previewResponses["phrases/p1/delete"] = try data(["deleted": true])
        try await client.deletePhrase(id: "p1")
        XCTAssertEqual(client.previewRequestBodies["phrases/p1/delete"]?.count, 0, "POST …/delete with {}")
    }

    @MainActor func testPhraseRoundStartsWithSupportsAndReusesItsRequestId() async throws {
        PhrasesStore.shared.reset()
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        await client.startPhraseRound()
        let first = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(first["phraseRound"] as? Bool, true)
        XCTAssertEqual(first["mode"] as? String, "learning", "«Повторить» starts «С опорами»")
        XCTAssertEqual(first["intent"] as? String, "new")
        XCTAssertEqual(first["minutes"] as? Int, 15)
        XCTAssertNil(first["drillId"])
        XCTAssertNil(first["familyId"])
        XCTAssertNil(first["topic"])
        XCTAssertNotNil(client.error, "No answer: the start failed with the usual message")
        XCTAssertFalse(client.conversationPresented)
        XCTAssertFalse(PhrasesStore.shared.roundStarting)

        client.error = nil
        client.previewResponses["sessions"] = try data(roundSession())
        await client.startPhraseRound()
        let second = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(second["requestId"] as? String, first["requestId"] as? String, "A retry is the same request: never two rounds")
        XCTAssertTrue(client.conversationPresented)
        XCTAssertEqual(client.conversation?.lesson.familyId, PhraseLabels.roundFamily)
        XCTAssertEqual(client.conversation?.lesson.phraseIds, ["p1", "p2"])

        await client.startPhraseRound(mode: "call")
        let third = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(third["mode"] as? String, "call")
        XCTAssertNotEqual(third["requestId"] as? String, second["requestId"] as? String, "A new round is a new request")

        client.hasUnuploadedRecording = true
        let sent = client.previewRequests.count
        await client.startPhraseRound()
        XCTAssertEqual(client.previewRequests.count, sent, "A recording that never reached the server comes first")
        XCTAssertEqual(client.error, TrainingClient.pendingRecordingGuidance)
    }

    // MARK: «Вернуть»

    func testUndoWindowCommitsAfterSixSecondsAndUndoCancels() {
        var window = PhraseUndoWindow()
        let start = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(window.schedule("a", now: start), [])
        XCTAssertEqual(window.hidden, ["a"], "Gone from the list at once")
        XCTAssertEqual(window.undoable, "a")
        XCTAssertNil(window.schedule("a", now: start), "Already waiting")
        XCTAssertTrue(window.expired(at: start.addingTimeInterval(5.9)).isEmpty)
        XCTAssertEqual(window.expired(at: start.addingTimeInterval(6)), ["a"], "The delete goes out after six seconds")
        XCTAssertTrue(window.cancel("a"))
        XCTAssertTrue(window.hidden.isEmpty, "«Вернуть» brings it back")
        XCTAssertFalse(window.cancel("a"))

        XCTAssertEqual(window.schedule("a", now: start), [])
        XCTAssertEqual(window.schedule("b", now: start.addingTimeInterval(2)), ["a"], "Only the newest one can be undone")
        XCTAssertTrue(window.beginCommit("a"))
        XCTAssertFalse(window.beginCommit("a"))
        XCTAssertFalse(window.cancel("a"), "Too late once the delete is on its way")
        XCTAssertEqual(window.undoable, "b")
        XCTAssertEqual(window.hidden, ["a", "b"], "Hidden until the delete settles")
        XCTAssertEqual(window.expired(at: start.addingTimeInterval(7.9)), [], "b's window ends at 8 s; a is committing")
        XCTAssertEqual(window.expired(at: start.addingTimeInterval(8)), ["b"])
        window.settle("a")
        XCTAssertEqual(window.hidden, ["b"])
        XCTAssertEqual(PhraseTiming.undoSeconds, 6)
    }

    // MARK: Capture

    @MainActor func testSaveProblemShowsTheServersWordsOrTheOfflineLine() {
        XCTAssertEqual(CaptureModel.problem(TrainingHTTPError(status: 429, message: "На сегодня хватит — завтра продолжим.")),
                       "На сегодня хватит — завтра продолжим.")
        XCTAssertEqual(CaptureModel.problem(TrainingHTTPError(status: 400, message: "Слишком длинно: до 600 символов.")),
                       "Слишком длинно: до 600 символов.")
        XCTAssertEqual(CaptureModel.problem(URLError(.notConnectedToInternet)), "Не получилось сохранить. Проверь связь.")
        XCTAssertEqual(CaptureModel.problem(TrainingHTTPError(status: 503, message: "Сервер временно не отвечает (503).")),
                       "Не получилось сохранить. Проверь связь.")
        XCTAssertEqual(CaptureModel.problem(TrainingHTTPError(status: 404, message: "Действие не найдено.")),
                       "Не получилось сохранить. Проверь связь.")
    }

    @MainActor func testOptimisticSaveClearsTheFieldAndAFailureBringsTheTextBack() async throws {
        PhrasesStore.shared.reset()
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        let model = CaptureModel(prefill: "  circle back  ")
        model.onScreen = true
        XCTAssertEqual(model.text, "circle back", "A shared text arrives trimmed")
        XCTAssertTrue(model.save(client: client, store: PhrasesStore.shared))
        XCTAssertEqual(model.text, "", "Cleared at once: «Запомнил!» before the server answers")
        XCTAssertEqual(model.saved?.text, "circle back")
        XCTAssertEqual(model.serial, 1)
        try await waitUntil { model.saved == nil }
        XCTAssertEqual(model.text, "circle back", "The request failed: the text is back in the field")
        XCTAssertNotNil(model.error)

        let stored = try json(phrase { $0.id = "p-circle"; $0.text = "circle back"; $0.phrase = "circle back" })
        client.previewResponses["phrases"] = try data(["phrase": stored, "duplicate": false] as [String: Any])
        XCTAssertTrue(model.save(client: client, store: PhrasesStore.shared))
        XCTAssertNil(model.error)
        try await waitUntil { model.saved?.phraseID != nil }
        XCTAssertEqual(model.saved?.phraseID, "p-circle")
        XCTAssertEqual(model.saved?.duplicate, false)
        XCTAssertEqual(PhrasesStore.shared.latest("p-circle", in: nil)?.phrase, "circle back", "Lists show it before /api/state does")
        XCTAssertEqual(PhrasesStore.shared.phrases(in: nil, lastRefresh: nil).map(\.id), ["p-circle"])
        model.reset()
        XCTAssertNil(model.saved)
        XCTAssertFalse(model.save(client: client, store: PhrasesStore.shared), "An empty field saves nothing")
        PhrasesStore.shared.reset()
    }

    // MARK: «Послушать» (PASS-0.5.4 §1, lib/phrases/types.ts ListenClip)

    func testListenClipDecodesEveryField() throws {
        let shot: [String: Any] = ["id": "p-shot", "text": "give it a shot", "enrichment": "ready", "phrase": "give it a shot",
                                   "meaning": "попробовать", "heard": "No worries, let's give it a shot."]
        let clip = try decode(ListenClip.self, [
            "id": "clip-1", "createdAt": "2026-10-07T10:00:00.000Z", "updatedAt": "2026-10-07T10:00:09.000Z", "origin": "iphone",
            "source": "microphone", "seconds": 24, "transcript": "No worries, let's give it a shot.", "status": "ready",
            "gist": "Короткий совет из кулинарного видео.", "points": ["«Give it a shot» — попробовать.", "  ", 7] as [Any],
            "phrases": [["phrase": shot, "duplicate": false] as [String: Any],
                        ["phrase": ["id": "p-worries", "text": "no worries"], "duplicate": true] as [String: Any],
                        ["duplicate": true] as [String: Any]] as [Any],
            "note": NSNull()] as [String: Any])
        XCTAssertEqual(clip.id, "clip-1")
        XCTAssertEqual(clip.createdAt, "2026-10-07T10:00:00.000Z")
        XCTAssertEqual(clip.updatedAt, "2026-10-07T10:00:09.000Z")
        XCTAssertEqual(clip.origin, .iphone)
        XCTAssertEqual(clip.source, .microphone)
        XCTAssertEqual(clip.seconds, 24)
        XCTAssertEqual(clip.transcript, "No worries, let's give it a shot.")
        XCTAssertEqual(clip.status, .ready)
        XCTAssertTrue(clip.isReady)
        XCTAssertFalse(clip.isAnalyzing)
        XCTAssertFalse(clip.isFailed)
        XCTAssertEqual(clip.gist, "Короткий совет из кулинарного видео.")
        XCTAssertEqual(clip.points, ["«Give it a shot» — попробовать."], "Blank and broken points are dropped")
        XCTAssertEqual(clip.phrases.map { $0.phrase.id }, ["p-shot", "p-worries"], "A phrase without its record is skipped")
        XCTAssertEqual(clip.phrases.map { $0.duplicate }, [false, true])
        XCTAssertEqual(clip.phrases[0].phrase.heard, "No worries, let's give it a shot.")
        XCTAssertEqual(clip.phrases[0].phrase.enrichment, .ready)
        XCTAssertNil(clip.note)
        XCTAssertEqual(ListenLabels.summary(clip), "Запомнил 1 фразу. Повторим в разговорах", "The duplicate is not counted")
        var known = clip
        known.phrases = [clip.phrases[1]]
        XCTAssertEqual(ListenLabels.summary(known), "Эти фразы уже в копилке")
        let again = try JSONDecoder().decode(ListenClip.self, from: JSONEncoder().encode(clip))
        XCTAssertEqual(again, clip, "A clip survives a round trip")
    }

    func testListenClipDecodesMinimalAndUnknownStatusSafely() throws {
        let minimal = try decode(ListenClip.self, ["id": "clip-min"])
        XCTAssertEqual(minimal.transcript, "")
        XCTAssertEqual(minimal.status, .failed, "No status: failed-safe, never polled forever")
        XCTAssertTrue(minimal.isFailed)
        XCTAssertTrue(minimal.points.isEmpty)
        XCTAssertTrue(minimal.phrases.isEmpty)
        XCTAssertNil(minimal.gist)
        XCTAssertNil(minimal.note)
        XCTAssertEqual(minimal.seconds, 0)
        XCTAssertEqual(minimal.source, .microphone)
        XCTAssertEqual(ListenLabels.failure(minimal), "Не получилось разобрать. Попробуй ещё раз.")
        XCTAssertEqual(ListenLabels.summary(minimal), "Тут нечего запомнить — попробуй кусок с речью.")

        let analyzing = try decode(ListenClip.self, ["id": "clip-a", "status": "analyzing", "transcript": "Let's give it a shot.",
                                                     "seconds": 7.6, "points": NSNull(), "phrases": NSNull()] as [String: Any])
        XCTAssertTrue(analyzing.isAnalyzing)
        XCTAssertFalse(analyzing.isFailed)
        XCTAssertEqual(analyzing.seconds, 8)
        XCTAssertEqual(analyzing.transcript, "Let's give it a shot.", "The transcript is there from the first answer on")
        XCTAssertTrue(analyzing.points.isEmpty)

        let newer = try decode(ListenClip.self, ["id": "clip-n", "status": "queued", "source": "system",
                                                 "note": "Тут нечего запомнить — попробуй кусок с речью."])
        XCTAssertEqual(newer.status.rawValue, "queued")
        XCTAssertTrue(newer.isFailed, "An unknown status stops the card waiting")
        XCTAssertFalse(newer.isAnalyzing)
        XCTAssertEqual(newer.source, .system)
        XCTAssertEqual(ListenLabels.failure(newer), "Тут нечего запомнить — попробуй кусок с речью.")
        XCTAssertEqual(ListenLabels.summary(newer), "Тут нечего запомнить — попробуй кусок с речью.", "The server's own note")
        XCTAssertThrowsError(try decode(ListenClip.self, ["status": "ready"]), "The id is required")
        let bare = try decode(ListenPhrase.self, ["phrase": ["id": "p", "text": "no worries"]])
        XCTAssertFalse(bare.duplicate)
        XCTAssertThrowsError(try decode(ListenPhrase.self, ["duplicate": true]), "The phrase is required")
    }

    func testSavedPhraseHeardIsOptionalAndSurvivesARoundTrip() throws {
        let heard = try decode(SavedPhrase.self, ["id": "p-heard", "text": "give it a shot", "heard": "Let's give it a shot."])
        XCTAssertEqual(heard.heard, "Let's give it a shot.")
        XCTAssertEqual(PhraseLabels.heard(heard), "Let's give it a shot.")
        XCTAssertNil(try decode(SavedPhrase.self, ["id": "p-typed", "text": "touch base"]).heard, "Typed phrases and older servers")
        XCTAssertNil(try decode(SavedPhrase.self, ["id": "p-null", "text": "touch base", "heard": NSNull()] as [String: Any]).heard)
        XCTAssertNil(try decode(SavedPhrase.self, ["id": "p-odd", "text": "touch base", "heard": 7] as [String: Any]).heard,
                     "A wrong type never breaks the phrase")
        XCTAssertNil(PhraseLabels.heard(phrase { $0.heard = "   " }), "A blank line shows nothing")
        let again = try JSONDecoder().decode(SavedPhrase.self, from: JSONEncoder().encode(heard))
        XCTAssertEqual(again, heard, "heard survives a round trip")
        let encoded = try XCTUnwrap(try json(heard) as? [String: Any])
        XCTAssertEqual(encoded["heard"] as? String, "Let's give it a shot.")
        let typed = try XCTUnwrap(try json(phrase()) as? [String: Any])
        XCTAssertNil(typed["heard"], "A typed phrase sends no heard line")
        var plain = heard
        plain.heard = nil
        XCTAssertNotEqual(plain, heard, "heard is part of equality, so a newer copy replaces the old one")
    }

    func testListenUploadBodyCarriesTheContractFields() throws {
        XCTAssertEqual(ListenRequests.upload, "phrases/listen")
        XCTAssertEqual(ListenRequests.path("clip-1"), "phrases/listen/clip-1")
        XCTAssertEqual(ListenRequests.seconds(23.6), 24)
        XCTAssertEqual(ListenRequests.seconds(0.2), 1, "At least one second")
        XCTAssertEqual(ListenRequests.seconds(181.4), 180, "At most three minutes")
        XCTAssertEqual(ListenRequests.seconds(.nan), 1)
        XCTAssertEqual(ListenRequests.fields(seconds: 5).map { $0.name }, ["seconds", "origin", "source"])
        let audio = Data("RIFF-fake-wav".utf8)
        let body = try XCTUnwrap(String(data: ListenRequests.body(audio: audio, seconds: 24, boundary: "B"), encoding: .utf8))
        XCTAssertTrue(body.hasPrefix("--B\r\nContent-Disposition: form-data; name=\"seconds\"\r\n\r\n24\r\n"))
        XCTAssertTrue(body.contains("--B\r\nContent-Disposition: form-data; name=\"origin\"\r\n\r\niphone\r\n"))
        XCTAssertTrue(body.contains("--B\r\nContent-Disposition: form-data; name=\"source\"\r\n\r\nmicrophone\r\n"))
        XCTAssertTrue(body.hasSuffix("--B\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"listen.wav\"\r\n"
            + "Content-Type: audio/wav\r\n\r\nRIFF-fake-wav\r\n--B--\r\n"), "The WAV take comes last")
        XCTAssertTrue(ListenRequests.canResend(URLError(.notConnectedToInternet)), "No connection: the same take is sent again")
        XCTAssertTrue(ListenRequests.canResend(TrainingHTTPError(status: 503, message: "Сервер временно не отвечает (503).")))
        XCTAssertFalse(ListenRequests.canResend(TrainingHTTPError(status: 422, message: "Не расслышал речи.")), "A refusal needs a new take")
        XCTAssertFalse(ListenRequests.canResend(TrainingHTTPError(status: 429, message: "На сегодня хватит — завтра продолжим.")))
    }

    func testListenPillClockWarningAndTheTwoSecondMinimum() {
        XCTAssertEqual(ListenLabels.clock(0), "0:00")
        XCTAssertEqual(ListenLabels.clock(12.9), "0:12", "Whole seconds")
        XCTAssertEqual(ListenLabels.clock(65), "1:05")
        XCTAssertEqual(ListenLabels.clock(170), "2:50")
        XCTAssertEqual(ListenLabels.clock(180), "3:00")
        XCTAssertEqual(ListenLabels.clock(-3), "0:00")
        XCTAssertEqual(ListenLabels.clock(.infinity), "0:00")
        XCTAssertEqual(ListenLabels.spoken(1), "1 секунда")
        XCTAssertEqual(ListenLabels.spoken(12), "12 секунд")
        XCTAssertEqual(ListenLabels.spoken(65), "1 минута 5 секунд")
        XCTAssertEqual(ListenLabels.spoken(122), "2 минуты 2 секунды")
        XCTAssertEqual(ListenLabels.spoken(180), "3 минуты")
        XCTAssertFalse(ListenLabels.warns(169.9))
        XCTAssertTrue(ListenLabels.warns(170), "From 2:50 the pill warns")
        XCTAssertEqual(ListenLabels.warning(170.4), "Через 10 с запись остановится сама.")
        XCTAssertEqual(ListenLabels.warning(179.9), "Через 1 с запись остановится сама.")
        XCTAssertEqual(ListenTiming.maxSeconds, 180, "LISTEN_MAX_SECONDS: the recorder stops by itself at 3:00")
        XCTAssertEqual(ListenTiming.minSeconds, 2, "LISTEN_MIN_SECONDS")
        XCTAssertEqual(ListenTiming.phraseLimit, 3, "LISTEN_PHRASE_LIMIT")
        XCTAssertEqual(ListenTiming.pollInterval, 1.5, "LISTEN_POLL_MS")
        XCTAssertEqual(ListenTiming.pollLimit, 90, "LISTEN_POLL_LIMIT_MS")
        XCTAssertEqual(ListenLabels.durationProblem(1.99), "Слишком коротко — запиши хотя бы пару секунд.", "Not sent")
        XCTAssertEqual(ListenLabels.durationProblem(.nan), ListenLabels.tooShort)
        XCTAssertNil(ListenLabels.durationProblem(2))
        XCTAssertNil(ListenLabels.durationProblem(180))
    }

    @MainActor func testClientUploadsAndFetchesListenClips() async throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("listen-test-" + UUID().uuidString + ".wav")
        try Data("RIFF-fake-wav".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        do {
            _ = try await client.uploadListenClip(url: file, seconds: 4)
            XCTFail("Previews never reach a server")
        } catch {
            XCTAssertEqual(TrainingClient.describe(error), "Предпросмотр не отправляет запросы к серверу.")
        }
        let analyzing: [String: Any] = ["id": "clip-9", "status": "analyzing", "transcript": "No worries, give it a shot.",
                                        "seconds": 4, "origin": "iphone", "source": "microphone", "points": [String](),
                                        "phrases": [Any]()]
        client.previewResponses[ListenRequests.upload] = try data(["clip": analyzing])
        let uploaded = try await client.uploadListenClip(url: file, seconds: 4)
        XCTAssertEqual(uploaded.id, "clip-9")
        XCTAssertTrue(uploaded.isAnalyzing)
        XCTAssertEqual(uploaded.transcript, "No worries, give it a shot.")
        var ready = analyzing
        ready["status"] = "ready"
        ready["gist"] = "Короткая реплика из видео."
        client.previewResponses["phrases/listen/clip-9"] = try data(["clip": ready])
        let fetched = try await client.fetchListenClip(id: "clip-9")
        XCTAssertTrue(fetched.isReady)
        XCTAssertEqual(fetched.gist, "Короткая реплика из видео.")
        XCTAssertTrue(client.previewRequests.contains("phrases/listen/clip-9"))
        XCTAssertNil(client.previewRequestBodies["phrases/listen/clip-9"], "GET carries no body")
    }

    // MARK: Entry points

    @MainActor func testQuickActionAndIntentQueueTheCaptureSheet() {
        let inbox = AppEntryInbox.shared
        inbox.clear()
        let notified = expectation(forNotification: .smoothTalkCapturePhrase, object: nil)
        XCTAssertFalse(inbox.handle(UIApplicationShortcutItem(type: "app.ratmirenglish.other", localizedTitle: "Другое")))
        XCTAssertNil(inbox.pending)
        XCTAssertTrue(inbox.handle(UIApplicationShortcutItem(type: AppEntryInbox.captureShortcutType, localizedTitle: "Запомнить фразу")))
        wait(for: [notified], timeout: 1)
        guard case .capture(let prefill, _)? = inbox.pending else { return XCTFail("The capture sheet waits for the shell") }
        XCTAssertNil(prefill)
        inbox.requestCapture(text: "  keep me posted \n")
        guard case .capture(let shared, _)? = inbox.take() else { return XCTFail("The App Intent queues the sheet with its text") }
        XCTAssertEqual(shared, "keep me posted")
        XCTAssertNil(inbox.pending, "Taken once")
        inbox.requestCapture(text: "   ")
        guard case .capture(let blank, _)? = inbox.take() else { return XCTFail("A blank text still opens the sheet") }
        XCTAssertNil(blank)
        XCTAssertEqual(AppEntryInbox.captureShortcutType, "app.ratmirenglish.capture")
    }

    func testHomeScreenQuickActionIsDeclaredInInfoPlist() throws {
        let items = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "UIApplicationShortcutItems") as? [[String: Any]])
        let capture = try XCTUnwrap(items.first { $0["UIApplicationShortcutItemType"] as? String == "app.ratmirenglish.capture" })
        XCTAssertEqual(capture["UIApplicationShortcutItemTitle"] as? String, "Запомнить фразу")
        XCTAssertEqual(capture["UIApplicationShortcutItemIconSymbolName"] as? String, "text.badge.plus")
    }
}
