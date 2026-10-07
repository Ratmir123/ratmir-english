import XCTest
import UIKit
@testable import RatmirEnglish

/// «Подготовка к созвону» (planning/v05/PASS-0.5.5.md §2–3): decoding of the shared contract (lib/preps/types.ts), the rules
/// `prepTier`, `latestReminders` and `todayPrep`, the request bodies (the multipart create, the rehearsal start), screenshot scaling
/// and the words the screens show. Fictional data only; no network.
final class PrepTests: XCTestCase {
    /// 2026-10-07T09:00:00Z: 12:00 in Moscow.
    private let now = ISO8601DateFormatter().date(from: "2026-10-07T09:00:00Z")!

    private func at(_ hours: Double) -> String { ISO8601DateFormatter().string(from: now.addingTimeInterval(hours * 3_600)) }
    private func data(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T { try JSONDecoder().decode(type, from: data(value)) }
    private func freshDefaults() -> UserDefaults { UserDefaults(suiteName: "smooth-prep-tests-" + UUID().uuidString)! }

    /// A complete ready prep as the server sends it (an invented startup).
    private func fullPrep() -> [String: Any] {
        [
            "id": "prep-1", "createdAt": "2026-10-07T08:00:00.000Z", "updatedAt": "2026-10-07T08:02:00.000Z", "status": "ready",
            "input": ["images": 3, "text": "Their site is northwind.example", "goal": "Launch film, at least $2 600",
                      "callAt": "2026-10-08T15:00:00.000Z", "origin": "ios"],
            "title": "Фильм к запуску приложения", "counterpart": "Alex, co-founder, Northwind", "when": "завтра в 18:00",
            "situation": "Стартап запускает приложение и хочет фильм.", "goal": "Фильм не ниже $2 600, предоплата 50%.",
            "watchouts": [["title": "Цена раньше объёма", "why": "Так было в прошлых созвонах.",
                           "instead": "Before I give you a number, how many versions do you need?", "patternId": "price-too-early"]],
            "questions": [["en": "Who signs off on the final cut?", "why": "Больше согласующих — больше правок."]],
            "lines": ["opening": "Thanks for the time, Alex.", "pitch": "I make short launch films for apps.",
                      "close": "I'll send a proposal today — does that work?"],
            "price": ["anchor": "$3 200 за фильм", "floor": "$2 600", "say": "It's thirty-two hundred, half up front.",
                      "ifLow": "I can get closer if we drop one cut-down.", "notes": "Чужие условия не называй."],
            "avoid": ["Не обещай срок за выходные."], "risks": ["Договора нет."], "limitations": ["Один скриншот обрезан."],
            "note": NSNull(),
            "rehearsals": [["sessionId": "s1", "createdAt": "2026-10-07T08:30:00.000Z", "tier": 2, "mode": "call", "status": "review",
                            "remember": [["kind": "cost", "title": "Назвал цену до вопросов", "said": "It's about fifteen hundred.",
                                          "better": "How many versions do you need?"],
                                         ["kind": "language", "title": "«I am agree»", "said": "I am agree.", "better": "I agree."]]]],
        ]
    }

    private func prep(_ id: String, status: PrepStatus = .ready, created: Double, callAt: Double? = nil) -> CallPrep {
        CallPrep(id: id, createdAt: at(created), updatedAt: at(created), status: status,
                 input: PrepInput(images: 1, callAt: callAt.map(at)))
    }

    // MARK: Decoding

    func testCallPrepDecodesEveryField() throws {
        let value = try decode(CallPrep.self, fullPrep())
        XCTAssertEqual(value.id, "prep-1")
        XCTAssertEqual(value.status, .ready)
        XCTAssertTrue(value.isReady)
        XCTAssertFalse(value.isReading)
        XCTAssertEqual(value.createdAt, "2026-10-07T08:00:00.000Z")
        XCTAssertEqual(value.updatedAt, "2026-10-07T08:02:00.000Z")
        XCTAssertEqual(value.input, PrepInput(images: 3, text: "Their site is northwind.example", goal: "Launch film, at least $2 600",
                                              callAt: "2026-10-08T15:00:00.000Z", origin: .ios))
        XCTAssertEqual(value.title, "Фильм к запуску приложения")
        XCTAssertEqual(value.counterpart, "Alex, co-founder, Northwind")
        XCTAssertEqual(value.when, "завтра в 18:00")
        XCTAssertEqual(value.situation, "Стартап запускает приложение и хочет фильм.")
        XCTAssertEqual(value.goal, "Фильм не ниже $2 600, предоплата 50%.")
        XCTAssertEqual(value.watchouts, [PrepWatchout(title: "Цена раньше объёма", why: "Так было в прошлых созвонах.",
                                                      instead: "Before I give you a number, how many versions do you need?",
                                                      patternId: "price-too-early")])
        XCTAssertEqual(value.questions, [PrepQuestion(en: "Who signs off on the final cut?", why: "Больше согласующих — больше правок.")])
        XCTAssertEqual(value.lines, PrepLines(opening: "Thanks for the time, Alex.", pitch: "I make short launch films for apps.",
                                              close: "I'll send a proposal today — does that work?"))
        XCTAssertEqual(value.price, PrepPrice(anchor: "$3 200 за фильм", floor: "$2 600", say: "It's thirty-two hundred, half up front.",
                                              ifLow: "I can get closer if we drop one cut-down.", notes: "Чужие условия не называй."))
        XCTAssertEqual(value.avoid, ["Не обещай срок за выходные."])
        XCTAssertEqual(value.risks, ["Договора нет."])
        XCTAssertEqual(value.limitations, ["Один скриншот обрезан."])
        XCTAssertNil(value.note)
        XCTAssertEqual(value.rehearsals.count, 1)
        let rehearsal = try XCTUnwrap(value.rehearsals.first)
        XCTAssertEqual(rehearsal.sessionId, "s1")
        XCTAssertEqual(rehearsal.tier, 2)
        XCTAssertEqual(rehearsal.mode, "call")
        XCTAssertEqual(rehearsal.status, "review")
        XCTAssertEqual(rehearsal.remember, [
            PrepReminder(kind: .cost, title: "Назвал цену до вопросов", said: "It's about fifteen hundred.", better: "How many versions do you need?"),
            PrepReminder(kind: .language, title: "«I am agree»", said: "I am agree.", better: "I agree."),
        ])
        let envelope = try decode(PrepEnvelope.self, ["prep": fullPrep()])
        XCTAssertEqual(envelope.prep, value)
    }

    func testMinimalPartialAndNewerPrepsDecodeSafely() throws {
        let minimal = try decode(CallPrep.self, ["id": "p1"])
        XCTAssertEqual(minimal.status, .failed, "A missing status is never polled forever")
        XCTAssertTrue(minimal.isFailed)
        XCTAssertEqual(minimal.input.images, 0)
        XCTAssertEqual(minimal.input.origin, .web)
        XCTAssertNil(minimal.title)
        XCTAssertNil(minimal.lines)
        XCTAssertNil(minimal.price)
        XCTAssertTrue(minimal.watchouts.isEmpty && minimal.questions.isEmpty && minimal.rehearsals.isEmpty)
        XCTAssertTrue(minimal.avoid.isEmpty && minimal.risks.isEmpty && minimal.limitations.isEmpty)

        let reading = try decode(CallPrep.self, [
            "id": "p2", "status": "reading", "createdAt": "2026-10-07T08:59:30.000Z", "updatedAt": "2026-10-07T08:59:30.000Z",
            "input": ["images": 2.0, "text": NSNull(), "goal": "  ", "callAt": NSNull(), "origin": "ios"],
            "title": NSNull(), "counterpart": NSNull(), "watchouts": NSNull(), "questions": [Any](), "lines": NSNull(), "price": NSNull(),
            "avoid": [Any](), "rehearsals": [Any](),
        ] as [String: Any])
        XCTAssertTrue(reading.isReading)
        XCTAssertEqual(reading.input.images, 2, "Numbers may come as decimals")
        XCTAssertNil(reading.input.goal, "Blank text reads as nothing")
        XCTAssertEqual(reading.input.origin, .ios)
        XCTAssertTrue(reading.watchouts.isEmpty)

        let newer = try decode(CallPrep.self, [
            "id": "p3", "status": "archived", "input": "broken",
            "watchouts": [["why": "no title"], ["title": "T", "instead": "Say this"]],
            "questions": [["why": "no English line"], ["en": "Q?"]],
            "lines": ["opening": "", "pitch": "", "close": ""], "price": ["anchor": "", "floor": ""],
            "avoid": ["  ", "Не говори X", 42],
            "rehearsals": [["sessionId": "s1", "tier": 9, "mode": "call", "status": "review",
                            "remember": [["kind": "mystery", "title": "Something"], ["kind": "cost"]]],
                           ["createdAt": "no session id"]],
        ] as [String: Any])
        XCTAssertEqual(newer.status.rawValue, "archived")
        XCTAssertFalse(newer.isReading)
        XCTAssertFalse(newer.isReady)
        XCTAssertTrue(newer.isFailed, "An unknown status reads as failed, never as reading")
        XCTAssertEqual(newer.input, PrepInput(origin: .web))
        XCTAssertEqual(newer.watchouts, [PrepWatchout(title: "T", why: "", instead: "Say this", patternId: nil)])
        XCTAssertEqual(newer.questions.map(\.en), ["Q?"])
        XCTAssertNil(newer.lines, "All-empty key lines are not shown")
        XCTAssertNil(newer.price, "An empty price is not shown")
        XCTAssertEqual(newer.avoid, ["Не говори X"])
        XCTAssertEqual(newer.rehearsals.count, 1, "A rehearsal without its session is skipped")
        XCTAssertEqual(newer.rehearsals.first?.tier, 3, "Pressure is clamped to 1–3")
        XCTAssertEqual(newer.rehearsals.first?.remember.count, 1, "A reminder without a title is skipped")
        XCTAssertEqual(newer.rehearsals.first?.remember.first?.kind.rawValue, "mystery")
        XCTAssertEqual(PrepLabels.reminderSymbol(PrepReminderKind(rawValue: "mystery")), "lightbulb")
        XCTAssertThrowsError(try decode(CallPrep.self, ["status": "ready"]), "A prep needs its id")

        let list = try decode(PrepListEnvelope.self, ["preps": [fullPrep(), ["title": "no id"], ["id": "p4", "status": "reading"]]])
        XCTAssertEqual(list.preps.map(\.id), ["prep-1", "p4"], "One prep in a newer format never hides the others")
    }

    func testStateAndLessonDecodePrepFieldsOptionally() throws {
        let base: [String: Any] = ["profile": ["name": "Test", "dailyMinutes": 15], "sessions": [Any](), "skills": [Any](), "xp": 0,
                                   "completed": 0]
        var withPreps = base
        withPreps["preps"] = [fullPrep(), ["title": "no id"], ["id": "p2", "status": "reading"]]
        XCTAssertEqual(try decode(TrainingState.self, withPreps).preps?.map(\.id), ["prep-1", "p2"])
        XCTAssertNil(try decode(TrainingState.self, base).preps, "Older servers send no preps")
        var broken = base
        broken["preps"] = "not a list"
        XCTAssertNil(try decode(TrainingState.self, broken).preps, "A broken field never breaks the state")

        func lesson(_ extra: [String: Any]) throws -> Lesson {
            var value: [String: Any] = ["title": "Репетиция: Фильм к запуску", "goal": "g", "why": "w", "minutes": 10]
            for (key, item) in extra { value[key] = item }
            let session: [String: Any] = ["id": "s1", "status": "active", "mode": "call", "lesson": value, "turns": [Any](), "retries": [Any]()]
            return try decode(Conversation.self, session).lesson
        }
        let rehearsal = try lesson(["prepId": "prep-1", "familyId": PrepLimits.familyId, "format": "conversation"])
        XCTAssertEqual(rehearsal.prepId, "prep-1")
        XCTAssertEqual(rehearsal.familyId, "call-prep")
        XCTAssertNil(try lesson([:]).prepId)
        XCTAssertNil(try lesson(["prepId": "  "]).prepId)
        XCTAssertNil(try lesson(["prepId": 42]).prepId)
        XCTAssertNil(try lesson(["prepId": NSNull()]).prepId)
    }

    // MARK: Rules

    func testPrepTierFollowsTheRehearsals() {
        XCTAssertEqual(PrepRules.tier(rehearsals: 0), 2, "The first rehearsal is firm")
        XCTAssertEqual(PrepRules.tier(rehearsals: 1), 3, "Every next one is tough")
        XCTAssertEqual(PrepRules.tier(rehearsals: 5), 3)
        var value = CallPrep(id: "p", status: .ready)
        XCTAssertEqual(PrepLabels.rehearseTitle(value), "Репетиция · ~10 мин")
        value.rehearsals = [PrepRehearsal(sessionId: "s1")]
        XCTAssertEqual(PrepLabels.rehearseTitle(value), "Ещё раз, жёстче")
        XCTAssertEqual(PrepLabels.tierNote(2), "Собеседник один раз упрётся в цене или условиях.")
        XCTAssertEqual(PrepLabels.tierNote(3), "Собеседник жёсткий: давит до конкретного довода.")
        XCTAssertEqual(PrepLabels.rehearseNote(mode: "call", rehearsals: 0),
                       "Без подсказок и поблажек, в темпе настоящего созвона. Собеседник один раз упрётся в цене или условиях.")
        XCTAssertEqual(PrepLabels.rehearseNote(mode: "learning", rehearsals: 2),
                       "Подсказки под рукой, собеседник говорит проще — удобно пробовать новое. Собеседник жёсткий: давит до конкретного довода.")
    }

    func testLatestRemindersTakesTheNewestRehearsalWithReminders() {
        var value = CallPrep(id: "p", status: .ready)
        XCTAssertNil(PrepRules.latestReminders(value))
        value.rehearsals = [PrepRehearsal(sessionId: "s1", status: "completed", remember: [PrepReminder(kind: .cost, title: "A")]),
                            PrepRehearsal(sessionId: "s2", status: "review", remember: [PrepReminder(kind: .language, title: "B")]),
                            PrepRehearsal(sessionId: "s3", status: "analysing")]
        XCTAssertEqual(PrepRules.latestReminders(value)?.sessionId, "s2", "A rehearsal still being analysed has nothing yet")
        value.rehearsals = [PrepRehearsal(sessionId: "s1"), PrepRehearsal(sessionId: "s2")]
        XCTAssertNil(PrepRules.latestReminders(value))
    }

    func testTodayPrepPicksANewReadyPrepOrAComingCall() {
        let fresh = prep("fresh", created: -3)
        let old = prep("old", created: -30)
        let coming = prep("coming", created: -72, callAt: 5)
        let past = prep("past", created: -3, callAt: -2)
        let started = prep("started", created: -50, callAt: -0.5)
        let reading = prep("reading", status: .reading, created: -0.1, callAt: 3)
        let failed = prep("failed", status: .failed, created: -1)
        XCTAssertEqual(PrepRules.todayPrep([fresh], now: now)?.id, "fresh", "Made within 24 h")
        XCTAssertNil(PrepRules.todayPrep([old], now: now), "Older than a day without a call time")
        XCTAssertEqual(PrepRules.todayPrep([coming], now: now)?.id, "coming", "The call is still ahead")
        XCTAssertNil(PrepRules.todayPrep([past], now: now), "The call is over: a new prep does not bring it back")
        XCTAssertEqual(PrepRules.todayPrep([started], now: now)?.id, "started", "A call that began within the hour still counts")
        XCTAssertNil(PrepRules.todayPrep([reading, failed], now: now), "Only a ready prep")
        XCTAssertEqual(PrepRules.todayPrep([reading, past, old, coming, fresh], now: now)?.id, "coming", "The newest match wins")
        XCTAssertNil(PrepRules.todayPrep(nil, now: now))
        XCTAssertNil(PrepRules.todayPrep([], now: now))
        var unreadable = prep("unreadable", created: -2)
        unreadable.input.callAt = "soon"
        XCTAssertEqual(PrepRules.todayPrep([unreadable], now: now)?.id, "unreadable", "An unreadable call time falls back to the day")
    }

    // MARK: Requests

    @MainActor func testRehearsalStartSendsThePrepAndTheMode() async throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        let session: [String: Any] = [
            "id": "44444444-4444-4444-8444-444444444444", "status": "active", "mode": "call",
            "lesson": ["title": "Репетиция: Фильм к запуску", "goal": "g", "why": "w", "minutes": 10, "familyId": "call-prep",
                       "prepId": "prep-1", "format": "conversation"] as [String: Any],
            "turns": [["id": "a1", "role": "assistant", "text": "Thanks for jumping on, so what would a film like that cost?"]],
            "retries": [Any](),
        ]
        client.previewResponses["sessions"] = try data(session)
        await client.startPrepRehearsal(prepId: "prep-1", mode: "call")
        let call = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(call["prepId"] as? String, "prep-1")
        XCTAssertEqual(call["mode"] as? String, "call")
        XCTAssertEqual(call["intent"] as? String, "new")
        XCTAssertEqual(call["minutes"] as? Int, 15)
        XCTAssertFalse((call["requestId"] as? String ?? "").isEmpty)
        XCTAssertNil(call["drillId"])
        XCTAssertNil(call["familyId"])
        XCTAssertNil(call["context"])
        XCTAssertTrue(client.conversationPresented, "The rehearsal opens in the usual conversation view")
        XCTAssertEqual(client.conversation?.lesson.prepId, "prep-1")
        XCTAssertNil(client.startingIntent)

        client.conversationPresented = false
        await client.startPrepRehearsal(prepId: "prep-1", mode: "learning")
        let learning = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(learning["mode"] as? String, "learning")
        XCTAssertNotEqual(learning["requestId"] as? String, call["requestId"] as? String, "Another mode is another request")
        XCTAssertEqual(PrepRequests.rehearsal(prepId: "p", mode: "anything")["mode"] as? String, "call", "«Как на созвоне» by default")
        XCTAssertEqual(TrainingClient.prepKey("p"), "prep:p")

        client.hasUnuploadedRecording = true
        let sent = client.previewRequests.count
        await client.startPrepRehearsal(prepId: "prep-1", mode: "call")
        XCTAssertEqual(client.previewRequests.count, sent, "A recording that never reached the server comes first")
        XCTAssertEqual(client.error, TrainingClient.pendingRecordingGuidance)
    }

    func testCreateBodyCarriesTheFieldsAndEveryScreenshot() throws {
        let jpeg = PrepUpload(data: Data([0xFF, 0xD8, 0xFF, 0xE0]), mime: "image/jpeg", pixelWidth: 10, pixelHeight: 20)
        let png = PrepUpload(data: Data([0x89, 0x50, 0x4E, 0x47]), mime: "image/png", pixelWidth: 20, pixelHeight: 10)
        let call = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-08T15:00:00Z"))
        let body = PrepRequests.body(images: [jpeg, png], text: "  Their site, who is on the call  ", goal: " Launch film ",
                                     callAt: call, boundary: "B")
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("--B\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nTheir site, who is on the call\r\n"))
        XCTAssertTrue(text.contains("name=\"goal\"\r\n\r\nLaunch film\r\n"))
        XCTAssertTrue(text.contains("name=\"callAt\"\r\n\r\n2026-10-08T15:00:00.000Z\r\n"))
        XCTAssertTrue(text.contains("name=\"origin\"\r\n\r\nios\r\n"))
        XCTAssertEqual(text.components(separatedBy: "name=\"images\"").count - 1, 2, "One `images` part per screenshot")
        XCTAssertTrue(text.contains("filename=\"screenshot-1.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n"))
        XCTAssertTrue(text.contains("filename=\"screenshot-2.png\"\r\nContent-Type: image/png\r\n\r\n"))
        XCTAssertTrue(text.hasSuffix("\r\n--B--\r\n"))
        XCTAssertNotNil(body.range(of: jpeg.data), "The bytes go as they are")

        XCTAssertEqual(PrepRequests.fields(text: "  ", goal: "", callAt: nil).map(\.name), ["origin"], "Only what he filled in")
        let long = String(repeating: "a", count: 7_000)
        let clipped = PrepRequests.fields(text: long, goal: long, callAt: nil)
        XCTAssertEqual(clipped.first { $0.name == "text" }?.value.count, PrepLimits.textLimit)
        XCTAssertEqual(clipped.first { $0.name == "goal" }?.value.count, PrepLimits.goalLimit)
        let many = Array(repeating: jpeg, count: 10)
        let capped = String(decoding: PrepRequests.body(images: many, text: "", goal: "", callAt: nil, boundary: "B"), as: UTF8.self)
        XCTAssertEqual(capped.components(separatedBy: "name=\"images\"").count - 1, PrepLimits.maxImages)
        XCTAssertEqual(PrepRequests.path("p1"), "preps/p1")
        XCTAssertEqual(PrepRequests.retry("p1"), "preps/p1/retry")
        XCTAssertEqual(PrepRequests.delete("p1"), "preps/p1/delete")
    }

    func testScreenshotsAreScaledToTheLongSideAndNeverUp() throws {
        func picture(width: Int, height: Int) -> Data {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = false
            let size = CGSize(width: width, height: height)
            return UIGraphicsImageRenderer(size: size, format: format).pngData { context in
                UIColor.systemIndigo.setFill()
                context.fill(CGRect(x: 0, y: 0, width: width, height: height / 2))
                for line in stride(from: 0, to: height, by: 40) {
                    UIColor(white: CGFloat(line % 255) / 255, alpha: 1).setFill()
                    context.fill(CGRect(x: 20, y: line, width: width / 2, height: 12))
                }
            }
        }
        let wide = try PrepImages.prepare(picture(width: 3_000, height: 1_500))
        let wideSize = try XCTUnwrap(PrepImages.pixelSize(wide.data))
        XCTAssertEqual(wide.mime, "image/jpeg", "A large screenshot is redrawn as JPEG")
        XCTAssertEqual(max(wideSize.width, wideSize.height), PrepLimits.imageLongSide)
        XCTAssertEqual(Double(wideSize.height), 1_024, accuracy: 1)
        XCTAssertEqual(wide.pixelWidth, wideSize.width)
        XCTAssertLessThanOrEqual(wide.data.count, PrepLimits.maxImageBytes)

        let tall = try PrepImages.prepare(picture(width: 1_170, height: 4_000))
        let tallSize = try XCTUnwrap(PrepImages.pixelSize(tall.data))
        XCTAssertEqual(tallSize.height, PrepLimits.imageLongSide)
        XCTAssertEqual(Double(tallSize.width), 1_170.0 * 2_048 / 4_000, accuracy: 1)

        let small = try PrepImages.prepare(picture(width: 800, height: 600))
        let smallSize = try XCTUnwrap(PrepImages.pixelSize(small.data))
        XCTAssertEqual(smallSize.width, 800, "Never scaled up")
        XCTAssertEqual(smallSize.height, 600)
        XCTAssertTrue(["image/jpeg", "image/png"].contains(small.mime))
        XCTAssertNotNil(PrepImages.thumbnail(small.data))
        XCTAssertThrowsError(try PrepImages.prepare(Data("not a picture".utf8))) { error in
            XCTAssertEqual(error as? PrepImages.Problem, .unreadable)
        }
    }

    // MARK: Words

    @MainActor func testSubmitNeedsAScreenshotOrTwentyCharacters() {
        XCTAssertFalse(PrepLabels.canSubmit(images: 0, text: ""))
        XCTAssertFalse(PrepLabels.canSubmit(images: 0, text: "   short note   "))
        XCTAssertFalse(PrepLabels.canSubmit(images: 0, text: String(repeating: "a", count: 19)))
        XCTAssertTrue(PrepLabels.canSubmit(images: 0, text: String(repeating: "a", count: 20)))
        XCTAssertTrue(PrepLabels.canSubmit(images: 0, text: "  " + String(repeating: "я", count: 20) + "\n"))
        XCTAssertTrue(PrepLabels.canSubmit(images: 1, text: ""))
        XCTAssertEqual(PrepLabels.submitProblem(images: 0, text: "hi"), "Добавь скриншоты переписки или пару фраз о созвоне.")
        XCTAssertNil(PrepLabels.submitProblem(images: 2, text: ""))

        let draft = PrepDraft()
        XCTAssertFalse(draft.canSubmit)
        XCTAssertEqual(draft.hint, PrepCopy.empty)
        draft.text = "Их сайт, кто будет на звонке, что уже обсуждали"
        XCTAssertTrue(draft.canSubmit)
        XCTAssertEqual(draft.hint, "Разбор займёт минуту-две.")
        draft.text = String(repeating: "a", count: 7_000)
        draft.goal = String(repeating: "b", count: 900)
        draft.clipFields()
        XCTAssertEqual(draft.text.count, PrepLimits.textLimit)
        XCTAssertEqual(draft.goal.count, PrepLimits.goalLimit)
        XCTAssertEqual(draft.room, PrepLimits.maxImages)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Moscow")!
        let morning = ISO8601DateFormatter().date(from: "2026-10-07T07:25:00Z")!
        XCTAssertEqual(PrepDraft.nextHour(morning, calendar: calendar), ISO8601DateFormatter().date(from: "2026-10-07T08:00:00Z"))
    }

    func testRowStatusTodayAndRehearsalWordsFollowTheWeb() throws {
        var value = CallPrep(id: "p", createdAt: at(-2), updatedAt: at(-2), status: .reading)
        XCTAssertEqual(PrepLabels.rowTitle(value), "Читаю переписку…")
        XCTAssertEqual(PrepLabels.title(value), "Подготовка к созвону")
        XCTAssertEqual(PrepLabels.status(value), "Читаю")
        XCTAssertEqual(PrepLabels.rowMeta(value), try XCTUnwrap(PrepLabels.day(at(-2))), "The day it was made while nothing else is known")
        value.status = .failed
        XCTAssertEqual(PrepLabels.status(value), "Не вышло")
        XCTAssertEqual(PrepLabels.rowTitle(value), "Подготовка к созвону")

        value.status = .ready
        value.title = "Фильм к запуску"
        value.counterpart = "Alex, co-founder"
        value.when = "завтра в 18:00"
        XCTAssertEqual(PrepLabels.rowTitle(value), "Фильм к запуску")
        XCTAssertEqual(PrepLabels.status(value), "Готово")
        XCTAssertEqual(PrepLabels.subtitle(value), "Alex, co-founder · завтра в 18:00")
        XCTAssertEqual(PrepLabels.rowMeta(value), "Alex, co-founder · завтра в 18:00")
        XCTAssertEqual(PrepLabels.todayTitle(value), "Созвон · Фильм к запуску")
        XCTAssertEqual(PrepLabels.todayTitle(CallPrep(id: "q", status: .ready)), "Созвон · Подготовка к созвону")

        value.when = nil
        value.input.callAt = "2026-10-08T15:00:00.000Z"
        let call = try XCTUnwrap(NativeDate.parse("2026-10-08T15:00:00.000Z"))
        XCTAssertEqual(PrepLabels.subtitle(value), "Alex, co-founder · " + RuFormat.dayTime(call), "His own call time when Sol could not word it")

        value.rehearsals = [PrepRehearsal(sessionId: "s1", createdAt: at(-1), tier: 2, mode: "call", status: "review",
                                          remember: [PrepReminder(kind: .pattern, title: "Снова новичком")]),
                            PrepRehearsal(sessionId: "s2", createdAt: at(-0.5), tier: 3, mode: "learning", status: "analysing")]
        XCTAssertEqual(PrepLabels.status(value), "Репетиция была")
        let day = try XCTUnwrap(PrepLabels.day(at(-1)))
        XCTAssertEqual(PrepLabels.rememberHint(value.rehearsals[0]), "Репетиция " + day)
        XCTAssertEqual(PrepLabels.rehearsalTitle(value.rehearsals[0], number: 1), "1. " + day + " · Как на созвоне · давление 2 из 3")
        XCTAssertTrue(PrepLabels.rehearsalTitle(value.rehearsals[1], number: 2).hasSuffix(" · С опорами · давление 3 из 3"))
        XCTAssertTrue(PrepLabels.canOpen(value.rehearsals[0]))
        XCTAssertFalse(PrepLabels.canOpen(value.rehearsals[1]), "A review still being written cannot be opened yet")
        XCTAssertFalse(PrepLabels.canOpen(PrepRehearsal(sessionId: "s3", status: "deleted")))
        XCTAssertEqual(PrepLabels.rehearsalStatus("deleted"), "удалена")
        XCTAssertEqual(PrepLabels.rehearsalStatus("analysing"), "разбираю…")
        XCTAssertEqual(PrepLabels.keyLines(PrepLines(opening: "Hi", pitch: "", close: "Bye")).map(\.label), ["Начало", "Закрытие"])
        XCTAssertEqual(PrepLabels.reminderSymbol(.cost), "dollarsign.circle")
        XCTAssertEqual(PrepLabels.readingDetail(images: 3), "Скриншотов: 3. Сверяю с твоими прошлыми созвонами, ставками и ошибками.")
        XCTAssertEqual(PrepLabels.readingDetail(images: 0), "Читаю твою заметку. Сверяю с твоими прошлыми созвонами, ставками и ошибками.")

        // PREP_COPY word for word (lib/preps/types.ts).
        XCTAssertEqual(PrepCopy.entryTitle, "Скоро созвон?")
        XCTAssertEqual(PrepCopy.entryText, "Закинь переписку — соберу план и репетицию под этот проект за 15 минут.")
        XCTAssertEqual(PrepCopy.readingSlow, "Ещё немного: собираю план под твои прошлые созвоны.")
        XCTAssertEqual(PrepCopy.failed, "Не получилось подготовиться. Попробуй ещё раз.")
        XCTAssertEqual(PrepCopy.rehearsalOf, "Репетиция созвона")
        XCTAssertEqual(PrepCopy.backToPrep, "К подготовке")
    }

    // MARK: Client and list

    @MainActor func testClientCallsTheContractPaths() async throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        do {
            _ = try await client.createPrep(images: [], text: "too short", goal: "", callAt: nil)
            XCTFail("Nothing to read is refused before any request")
        } catch {
            XCTAssertEqual(TrainingClient.describe(error), PrepCopy.empty)
        }
        do {
            _ = try await client.createPrep(images: [], text: String(repeating: "a", count: 30), goal: "", callAt: nil)
            XCTFail("Previews never reach a server")
        } catch {
            XCTAssertEqual(TrainingClient.describe(error), "Предпросмотр не отправляет запросы к серверу.")
        }
        let reading: [String: Any] = ["id": "p1", "status": "reading", "createdAt": at(0), "updatedAt": at(0),
                                      "input": ["images": 0, "text": "A long enough note about the call", "origin": "ios"]]
        client.previewResponses[PrepRequests.collection] = try data(["prep": reading])
        let created = try await client.createPrep(images: [], text: String(repeating: "a", count: 30), goal: "", callAt: nil)
        XCTAssertTrue(created.isReading)

        client.previewResponses["preps/p1"] = try data(["prep": fullPrep().merging(["id": "p1"]) { $1 }])
        let fetched = try await client.fetchPrep(id: "p1")
        XCTAssertTrue(fetched.isReady)
        XCTAssertNil(client.previewRequestBodies["preps/p1"], "GET carries no body")

        client.previewResponses[PrepRequests.collection] = try data(["preps": [fullPrep(), reading]])
        let list = try await client.listPreps()
        XCTAssertEqual(list.map(\.id), ["prep-1", "p1"])

        client.previewResponses["preps/p1/retry"] = try data(["prep": reading])
        let retried = try await client.retryPrep(id: "p1")
        XCTAssertTrue(retried.isReading)
        XCTAssertEqual(client.previewRequestBodies["preps/p1/retry"]?.count, 0, "POST …/retry with {}")

        client.previewResponses["preps/p1/delete"] = try data(["ok": true])
        try await client.deletePrep(id: "p1")
        XCTAssertEqual(client.previewRequestBodies["preps/p1/delete"]?.count, 0, "POST …/delete with {}")
    }

    func testMergeKeepsTheNewestCopyAndHidesDeletedPreps() {
        let server = [CallPrep(id: "a", createdAt: at(-5), updatedAt: at(-5), status: .reading),
                      CallPrep(id: "b", createdAt: at(-10), updatedAt: at(-10), status: .ready)]
        let newerA = CallPrep(id: "a", createdAt: at(-5), updatedAt: at(-4), status: .ready, title: "Ready")
        let olderB = CallPrep(id: "b", createdAt: at(-10), updatedAt: at(-20), status: .failed)
        let created = CallPrep(id: "c", createdAt: at(-1), updatedAt: at(-1), status: .reading)
        let copies = [FreshPrep(prep: newerA, receivedAt: now), FreshPrep(prep: olderB, receivedAt: now), FreshPrep(prep: created, receivedAt: now)]
        let merged = PrepLabels.merge(server: server, fresh: copies, lastRefresh: now.addingTimeInterval(-60), hidden: [])
        XCTAssertEqual(merged.map(\.id), ["c", "a", "b"], "Newest first")
        XCTAssertEqual(merged[1].title, "Ready", "A newer copy replaces the listed one")
        XCTAssertEqual(merged[2].status, .ready, "An older copy never does")
        let caughtUp = PrepLabels.merge(server: server, fresh: [FreshPrep(prep: created, receivedAt: now)],
                                        lastRefresh: now.addingTimeInterval(60), hidden: [])
        XCTAssertEqual(caughtUp.map(\.id), ["a", "b"], "A copy the server lacks well after it arrived was deleted elsewhere")
        XCTAssertEqual(PrepLabels.merge(server: server, fresh: [], lastRefresh: nil, hidden: ["a"]).map(\.id), ["b"])
    }
}
