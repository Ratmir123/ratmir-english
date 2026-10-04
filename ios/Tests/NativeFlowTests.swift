import XCTest
import SwiftUI
import AVFoundation
import UserNotifications
import UIKit
@testable import RatmirEnglish

final class NativeFlowTests: XCTestCase {
    private let sessionID = "11111111-1111-4111-8111-111111111111"

    private func data(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func freshDefaults() -> UserDefaults { UserDefaults(suiteName: "smooth-flow-tests-" + UUID().uuidString)! }
    private func conversation(status: String, deferred: Bool = false) -> [String: Any] {
        ["id": sessionID, "status": status, "mode": "learning", "lesson": ["title": "A useful test", "goal": "Give a reason", "why": "Express a clear thought", "minutes": 10],
         "turns": [["id": "u1", "role": "user", "text": "Saturday works because I am free."]], "retries": [],
         "retryDeferred": deferred, "analysis": ["version": 1, "summary": "One next step", "strengths": [], "priorities": [], "limitations": []]]
    }
    @MainActor private func preparedClient(status: String = "review", deferred: Bool = false) throws -> TrainingClient {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        client.signedIn = true
        client.conversation = try JSONDecoder().decode(Conversation.self, from: data(conversation(status: status, deferred: deferred)))
        client.conversationPresented = true
        let completed = conversation(status: "completed", deferred: deferred)
        client.previewResponses["sessions/\(sessionID)/complete"] = try data(completed)
        client.previewResponses["sessions/\(sessionID)/finish"] = try data(conversation(status: "analysing"))
        client.previewResponses["state"] = try data(["profile": ["name": "Test", "dailyMinutes": 15], "sessions": [completed], "skills": [], "xp": 15, "completed": 1])
        client.previewResponses["status"] = try data(["brain": ["model": "gpt-6.1-sol", "verified": true], "audio": ["configured": true]])
        return client
    }
    private func state(_ extra: [String: Any]) throws -> TrainingState {
        var value: [String: Any] = ["profile": ["name": "Test", "dailyMinutes": 15], "sessions": [], "skills": [], "xp": 0, "completed": 0]
        for (key, item) in extra { value[key] = item }
        return try JSONDecoder().decode(TrainingState.self, from: data(value))
    }
    private func session(_ id: String, status: String, analysis: Bool = false) -> [String: Any] {
        var value: [String: Any] = ["id": id, "status": status, "mode": "call", "lesson": ["title": "Lesson " + id, "goal": "g", "why": "w", "minutes": 10],
                                    "turns": [["id": "a1", "role": "assistant", "text": "Hi"]], "retries": []]
        if analysis { value["analysis"] = ["summary": "s", "strengths": [], "priorities": [["title": "p", "turnId": "u1", "quote": "q", "explanation": "e", "example": "x", "retryInstruction": "r"]], "limitations": []] }
        return value
    }

    @MainActor func testAcceptedDeferredCompletionReturnsHomeAndKeepsTheReward() async throws {
        let client = try preparedClient(deferred: true)
        await client.action("complete", deferRetry: true, returnHome: true)
        XCTAssertFalse(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 1)
        XCTAssertEqual(client.conversation?.status, "completed")
        XCTAssertEqual(client.conversation?.retryDeferred, true)
        XCTAssertEqual(client.completionMoment?.sessionId, sessionID, "The reward survives the return to Today (C-02)")
        XCTAssertEqual(client.completionMoment?.deferred, true)
        XCTAssertEqual(client.previewRequestBodies["sessions/\(sessionID)/complete"]?["deferRetry"] as? Bool, true)
        XCTAssertNil(client.error)
    }

    @MainActor func testCompletionMomentRecordsValuesBeforeTheRefresh() async throws {
        let client = try preparedClient()
        await client.action("complete", returnHome: true)
        let moment = try XCTUnwrap(client.completionMoment)
        XCTAssertFalse(moment.deferred)
        XCTAssertEqual(moment.xpBefore, 0)
        XCTAssertFalse(client.conversationPresented)
        client.dismissCompletionMoment()
        XCTAssertNil(client.completionMoment)
    }

    @MainActor func testDraftCannotBeCompletedOrSilentlyDiscarded() async throws {
        let client = try preparedClient()
        client.draft = "My unsent answer"
        await client.action("complete", returnHome: true)
        XCTAssertTrue(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 0)
        XCTAssertEqual(client.draft, "My unsent answer")
        XCTAssertTrue(client.previewRequests.isEmpty)
        XCTAssertNotNil(client.error)
    }

    @MainActor func testRecordingAndMicPermissionPromptCannotFinishOrNavigateAway() async throws {
        let client = try preparedClient(status: "active")
        client.recording = true
        await client.action("finish")
        client.returnToHome()
        XCTAssertTrue(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 0)
        XCTAssertTrue(client.previewRequests.isEmpty)
        client.recording = false
        client.microphoneStarting = true
        await client.action("finish")
        client.returnToHome()
        XCTAssertTrue(client.conversationPresented)
        XCTAssertTrue(client.previewRequests.isEmpty)
    }

    @MainActor func testUnuploadedOrPendingAudioCannotFinish() async throws {
        let client = try preparedClient(status: "active")
        client.hasUnuploadedRecording = true
        await client.action("finish")
        XCTAssertTrue(client.previewRequests.isEmpty)
        XCTAssertTrue(client.conversationPresented)
        client.hasUnuploadedRecording = false
        client.recordedFile = "synthetic.wav"
        await client.action("finish")
        XCTAssertTrue(client.previewRequests.isEmpty)
        client.recordedFile = nil
        client.pendingMessageID = "pending-utterance"
        await client.action("finish")
        XCTAssertTrue(client.previewRequests.isEmpty)
        XCTAssertEqual(client.pendingMessageID, "pending-utterance")
    }

    @MainActor func testRejectedCompletionStaysInReview() async throws {
        let client = try preparedClient()
        client.previewResponses.removeValue(forKey: "sessions/\(sessionID)/complete")
        await client.action("complete", returnHome: true)
        XCTAssertTrue(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 0)
        XCTAssertEqual(client.conversation?.status, "review")
        XCTAssertNotNil(client.error)
    }

    @MainActor func testAcceptedReceiptReturnsHomeEvenWhenProfileRefreshFails() async throws {
        let client = try preparedClient()
        client.previewResponses.removeValue(forKey: "state")
        await client.action("complete", returnHome: true)
        XCTAssertFalse(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 1)
        XCTAssertEqual(client.conversation?.status, "completed")
        XCTAssertNil(client.error, "Profile/status reads run in the background and never turn an accepted action into an error")
    }

    @MainActor func testCompletedHistoryReturnsHomeWithoutAnotherCompletionRequest() throws {
        let client = try preparedClient(status: "completed")
        client.returnToHome()
        XCTAssertFalse(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 1)
        XCTAssertTrue(client.previewRequests.isEmpty)
    }

    @MainActor func testAcceptedMessageNeverWaitsForStatusOrUsageReads() async throws {
        let client = try preparedClient(status: "active")
        var reply = conversation(status: "active")
        reply["turns"] = [["id": "u1", "role": "user", "text": "Saturday works because I am free."],
                          ["id": "n1", "role": "user", "text": "Hello there"], ["id": "a2", "role": "assistant", "text": "Great!"]]
        client.previewResponses["sessions/\(sessionID)/message"] = try data(reply)
        client.previewResponses.removeValue(forKey: "status")
        client.previewResponses.removeValue(forKey: "state")
        client.draft = "Hello there"
        await client.send()
        XCTAssertNil(client.error, "C-01: a failing /status or /state never turns an accepted reply into an error")
        XCTAssertEqual(client.conversation?.turns.count, 3)
        XCTAssertEqual(client.draft, "")
        XCTAssertNil(client.pendingMessageID)
        XCTAssertFalse(client.busy)
        XCTAssertEqual(client.previewRequestBodies["sessions/\(sessionID)/message"]?["text"] as? String, "Hello there")
    }

    @MainActor func testDiscardAfterAFailedLocalSendUnlocksTheComposer() throws {
        let client = try preparedClient(status: "active")
        client.draft = "Unsent words"
        client.recordedFile = "synthetic.wav"
        client.pendingMessageID = "local-only"
        XCTAssertTrue(client.pendingIsLocalOnly)
        client.discardRecording()
        XCTAssertNil(client.pendingMessageID, "L-02: deleting the recording must not leave the composer disabled")
        XCTAssertNil(client.recordedFile)
        XCTAssertEqual(client.draft, "")
        client.draft = "Typed again"
        client.pendingMessageID = "local-two"
        client.editPendingAnswer()
        XCTAssertNil(client.pendingMessageID)
        XCTAssertEqual(client.draft, "Typed again")
        client.pendingMessageID = "u1"
        client.editPendingAnswer()
        XCTAssertEqual(client.pendingMessageID, "u1", "An answer the server already holds is never edited locally")
    }

    @MainActor func testUnansweredServerTurnOffersAResend() throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        var value = conversation(status: "active")
        value["turns"] = [["id": "a1", "role": "assistant", "text": "Hi"], ["id": "u9", "role": "user", "text": "My stored reply"]]
        let stored = try JSONDecoder().decode(Conversation.self, from: data(value))
        client.resume(stored)
        XCTAssertEqual(client.unansweredTurn?.id, "u9")
        XCTAssertEqual(client.pendingMessageID, "u9")
        XCTAssertEqual(client.draft, "My stored reply")
        XCTAssertFalse(client.pendingIsLocalOnly)
        client.clearDraft()
        XCTAssertEqual(client.draft, "My stored reply", "A reply the server holds is resent, not dropped")
    }

    @MainActor func testStartFamilyAndDrillSendTheContractBodies() async throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        client.previewResponses["sessions"] = try data(session("22222222-2222-4222-8222-222222222222", status: "active"))
        await client.startFamily(familyId: "strategy-pitch-30", mode: "call", topic: "  Pricing  ")
        let family = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(family["familyId"] as? String, "strategy-pitch-30")
        XCTAssertEqual(family["mode"] as? String, "call")
        XCTAssertEqual(family["intent"] as? String, "new")
        XCTAssertEqual(family["topic"] as? String, "Pricing")
        XCTAssertEqual(family["minutes"] as? Int, 15)
        XCTAssertNil(family["context"], "A family never sends a context that could contradict it")
        XCTAssertFalse((family["requestId"] as? String ?? "").isEmpty)
        XCTAssertTrue(client.conversationPresented)
        XCTAssertNil(client.startingIntent)
        await client.startDrill(id: "drill-1", mode: "learning")
        let drill = try XCTUnwrap(client.previewRequestBodies["sessions"])
        XCTAssertEqual(drill["drillId"] as? String, "drill-1")
        XCTAssertEqual(drill["mode"] as? String, "learning")
        XCTAssertNil(drill["familyId"])
    }

    @MainActor func testPendingRecordingBlocksStartsWithGuidance() async throws {
        let client = TrainingClient(reminderDefaults: freshDefaults())
        client.previewMode = true
        client.hasUnuploadedRecording = true
        await client.startFamily(familyId: "life-people", mode: "learning")
        XCTAssertTrue(client.previewRequests.isEmpty)
        XCTAssertEqual(client.error, TrainingClient.pendingRecordingGuidance)
        XCTAssertFalse(client.conversationPresented)
    }

    func testPollingBacksOffInsteadOfStopping() {
        XCTAssertEqual(TrainingClient.pollDelay(failures: 0), 3)
        XCTAssertEqual(TrainingClient.pollDelay(failures: 1), 6)
        XCTAssertEqual(TrainingClient.pollDelay(failures: 2), 12)
        XCTAssertEqual(TrainingClient.pollDelay(failures: 9), 30)
    }

    func testErrorsAreDescribedInRussian() {
        XCTAssertTrue(TrainingClient.describe(URLError(.notConnectedToInternet)).contains("интернета"))
        XCTAssertTrue(TrainingClient.describe(URLError(.timedOut)).contains("долго"))
        XCTAssertEqual(TrainingClient.describe(TrainingHTTPError(status: 409, message: "Сначала повтори ответ")), "Сначала повтори ответ")
        let decoding = DecodingError.dataCorrupted(DecodingError.Context(codingPath: [], debugDescription: "synthetic"))
        XCTAssertTrue(TrainingClient.describe(decoding).contains("новом формате"))
    }

    func testOneBrokenSessionNeverBreaksState() throws {
        let value = try state(["sessions": [session("s1", status: "active"), ["id": "broken"], 7]])
        XCTAssertEqual(value.sessions.map(\.id), ["s1"])
        XCTAssertEqual(value.skippedSessions, 2)
    }

    func testFractionalMinutesAndBrokenFeaturesNeverBreakState() throws {
        let value = try state(["profile": ["name": "Test", "dailyMinutes": 12.5], "placement": "garbage",
                               "calls": [1, ["id": "c1", "status": "needs-speaker"]], "drills": ["x": 1], "progression": "oops",
                               "patterns": [["id": "p1", "title": "Pattern", "history": [["status": "repeated"], ["status": "avoided"]]]]])
        XCTAssertEqual(value.profile.dailyMinutes, 13)
        XCTAssertNil(value.placementSignal)
        XCTAssertEqual(value.callSignals.map(\.id), ["c1"])
        XCTAssertTrue(value.drillSignals.isEmpty)
        XCTAssertNil(value.progression)
        XCTAssertEqual(value.patternSignals.first?.history, ["repeated", "avoided"])
    }

    func testTodayShowsExactlyOnePrimaryInTheAgreedOrder() throws {
        let notStarted: [String: Any] = ["status": "not-started", "result": NSNull(), "sections": []]
        let completed: [String: Any] = ["status": "completed", "result": ["overall": ["label": "B1+"]], "sections": []]
        let scoring: [String: Any] = ["status": "scoring", "result": NSNull(), "sections": []]
        let drill: [String: Any] = ["id": "d1", "title": "Replay", "status": "new"]
        let review = session("r1", status: "review", analysis: true)
        let speakerCall: [String: Any] = ["id": "c1", "status": "needs-speaker", "title": "Call"]
        let recommendation: [String: Any] = ["xp": 10, "level": 1, "recommendation": ["familyId": "life-people", "title": "T", "track": "life",
                                                                                       "activity": "speaking", "preferredMode": "learning", "why": "W"]]
        let first = try state(["placement": notStarted, "sessions": [review], "drills": [drill]])
        XCTAssertEqual(TodayPlanner.hero(state: first, hasPendingRecording: true), .pendingRecording)
        XCTAssertEqual(TodayPlanner.hero(state: first, hasPendingRecording: false), .placement(status: "not-started"))
        XCTAssertEqual(TodayPlanner.hero(state: try state(["placement": completed, "sessions": [review], "calls": [speakerCall]]), hasPendingRecording: false), .resume(sessionID: "r1"))
        XCTAssertEqual(TodayPlanner.hero(state: try state(["placement": completed, "calls": [speakerCall], "drills": [drill]]), hasPendingRecording: false), .confirmSpeaker(callID: "c1"))
        XCTAssertEqual(TodayPlanner.hero(state: try state(["placement": scoring, "drills": [drill]]), hasPendingRecording: false), .drill(id: "d1"),
                       "Scoring needs nothing from the learner, so it never blocks the next step")
        XCTAssertEqual(TodayPlanner.hero(state: try state(["placement": completed, "drills": [["id": "d2", "title": "Done", "status": "done"]], "progression": recommendation]), hasPendingRecording: false), .recommendation)
        XCTAssertEqual(TodayPlanner.hero(state: try state(["placement": completed]), hasPendingRecording: false), .empty)
    }

    func testDeferredSessionKeepsItsRetryLoop() throws {
        var value = session("d1", status: "completed", analysis: true)
        value["retryDeferred"] = true
        value["completion"] = ["canComplete": false, "needsRetry": true, "reason": NSNull()]
        let deferred = try JSONDecoder().decode(Conversation.self, from: data(value))
        XCTAssertTrue(deferred.awaitsRetry, "L-03: a deferred lesson keeps its improved-attempt dock")
        XCTAssertTrue(deferred.isResumable)
        value["retryDeferred"] = false
        value["completion"] = ["canComplete": true, "needsRetry": false, "reason": NSNull()]
        let finished = try JSONDecoder().decode(Conversation.self, from: data(value))
        XCTAssertFalse(finished.awaitsRetry)
        XCTAssertFalse(finished.isResumable)
    }

    func testCountersNeverExceedTargets() {
        XCTAssertEqual(ProgressCopy.fraction(6, 1), "1/1")
        XCTAssertEqual(ProgressCopy.fraction(2, 10), "2/10")
        XCTAssertEqual(ProgressCopy.ratio(6, 1), 1)
        let unlocked = PracticeAchievement(id: "first-practice", title: "T", description: "D", current: 6, target: 1, unlocked: true, unlockedAt: "2026-10-03T10:00:00Z")
        XCTAssertTrue(ProgressCopy.achievementStatus(unlocked).hasPrefix("Открыто"))
        XCTAssertFalse(ProgressCopy.achievementStatus(unlocked).contains("6"))
        let locked = PracticeAchievement(id: "ten-practices", title: "T", description: "D", current: 12, target: 10, unlocked: false, unlockedAt: nil)
        XCTAssertEqual(ProgressCopy.achievementStatus(locked), "10/10")
    }

    func testQuotaWindowsAreNamedByLength() throws {
        func window(_ kind: String, _ minutes: Double?) throws -> SubscriptionUsage.Window {
            var value: [String: Any] = ["id": UUID().uuidString, "kind": kind]
            if let minutes { value["windowDurationMins"] = minutes }
            return try JSONDecoder().decode(SubscriptionUsage.Window.self, from: data(value))
        }
        XCTAssertEqual(try window("primary", 300).title, "5 ч")
        XCTAssertEqual(try window("secondary", 10080).title, "Неделя")
        XCTAssertEqual(try window("primary", 4320).title, "3 дня")
        XCTAssertEqual(try window("secondary", nil).title, "Неделя")
        XCTAssertEqual(try window("primary", nil).title, "Короткое окно")
        XCTAssertEqual(try window("primary", 299.5).title, "5 ч", "Fractional durations decode")
    }

    func testSkillNamesMatchTheSharedSet() {
        XCTAssertEqual(SkillCopy.order.count, 10)
        XCTAssertEqual(SkillCopy.title("listening"), "Понимать на слух")
        XCTAssertEqual(SkillCopy.title("positioning"), "Подавать себя")
        XCTAssertEqual(SkillCopy.title("negotiation"), "Держать цену и условия")
        XCTAssertEqual(SkillCopy.area("negotiation"), .strategy)
        XCTAssertEqual(SkillCopy.area("clarity"), .language)
        XCTAssertEqual(SkillCopy.area("repair"), .dialogue)
        XCTAssertEqual(SkillCopy.state("unknown"), "Ещё не проверено")
        XCTAssertEqual(SkillArea.allCases.map(\.title), ["Английский", "Разговор", "Стратегия"])
    }

    @MainActor func testCatalogDecodesLenientlyWithValidSymbols() throws {
        let payload: [String: Any] = ["families": [], "calibration": [], "catalog": [
            ["id": "strategy", "title": "Стратегия разговора", "description": "d", "families": [
                ["id": "strategy-pitch-30", "title": "Питч", "description": "d", "category": "strategy", "context": "work", "activity": "speaking",
                 "preferredMode": "call", "skills": ["positioning"], "minutes": 7.5, "icon": ["sf": "definitely-not-an-sf-symbol", "phosphor": "X"],
                 "isNew": true, "format": "pitch", "patternIds": ["bio-not-pitch"]],
                ["id": 3]]],
            ["id": "empty", "title": "Empty", "families": [["broken": true]]]]]
        let response = try JSONDecoder().decode(FamiliesResponse.self, from: data(payload))
        XCTAssertEqual(response.catalog.map(\.id), ["strategy"])
        let family = try XCTUnwrap(response.catalog.first?.families.first)
        XCTAssertEqual(response.catalog.first?.families.count, 1)
        XCTAssertEqual(family.minutes, 8)
        XCTAssertEqual(family.preferredMode, "call")
        XCTAssertEqual(family.symbol, "target", "Unknown SF Symbols fall back to the category icon")
        XCTAssertEqual(family.format, "pitch")
    }

    func testPushbackIsOptionalAndPendingUntilAnswered() throws {
        var retry: [String: Any] = ["id": "r1", "text": "Better", "feedback": "Good", "improved": true,
                                    "pushback": ["npcLine": "Are you sure?", "reply": NSNull(), "held": NSNull(), "feedback": NSNull(), "createdAt": "2026-10-04T10:00:00Z"]]
        XCTAssertNotNil(try JSONDecoder().decode(Retry.self, from: data(retry)).pendingPushback)
        retry["pushback"] = ["npcLine": "Are you sure?", "reply": "Yes", "held": true, "feedback": "Held", "createdAt": "2026-10-04T10:00:00Z"]
        XCTAssertNil(try JSONDecoder().decode(Retry.self, from: data(retry)).pendingPushback)
        retry["pushback"] = "unexpected"
        let tolerant = try JSONDecoder().decode(Retry.self, from: data(retry))
        XCTAssertNil(tolerant.pushback, "An unknown pushback shape never drops the retry")
        XCTAssertEqual(tolerant.id, "r1")
    }

    func testReviewV05FieldsDecodeAsOptionals() throws {
        let value: [String: Any] = ["summary": "S", "strengths": ["one", 2], "limitations": [],
            "priorities": [["title": "P", "turnId": "u1", "quote": "q", "explanation": "e", "example": "x", "retryInstruction": "r", "costKind": "money", "patternId": NSNull()]],
            "outcome": ["achieved": "partly", "what": "Half way"],
            "languageErrors": [["turnId": "u1", "quote": "I seen", "correction": "I've seen", "tag": "present-perfect", "impact": "seniority"], ["broken": 1]],
            "minorErrorsIgnored": 3,
            "patternHits": [["patternId": "fee-disclosure", "outcome": "avoided", "turnId": "u1", "quote": "My range is"]],
            "strategyMoves": [["id": "discovery", "score": NSNull(), "quote": NSNull()], ["id": "anchor-hold", "score": 2, "quote": "Let's say"]],
            "debatable": [["title": "T", "turnId": "u1", "quote": NSNull(), "forSide": "F", "againstSide": "A", "verdict": "V"]],
            "dropped": 1]
        let review = try JSONDecoder().decode(Review.self, from: data(value))
        XCTAssertEqual(review.strengths, ["one"])
        XCTAssertEqual(review.priorities.first?.costKind, "money")
        XCTAssertEqual(review.outcome?.achieved, "partly")
        XCTAssertEqual(review.languageErrors?.count, 1)
        XCTAssertEqual(review.minorErrorsIgnored, 3)
        XCTAssertEqual(review.patternHits?.first?.outcome, "avoided")
        XCTAssertNil(review.strategyMoves?.first?.score)
        XCTAssertEqual(review.strategyMoves?.last?.title, "Якорь и цена")
        XCTAssertEqual(review.debatable?.first?.verdict, "V")
        XCTAssertEqual(review.dropped, 1)
        let legacy = try JSONDecoder().decode(Review.self, from: data(["summary": "S", "strengths": [], "priorities": [], "limitations": [], "outcome": "Plain text"]))
        XCTAssertEqual(legacy.outcome?.what, "Plain text")
    }

    func testRussianFormatting() {
        XCTAssertEqual(RuFormat.minutes(1), "1 минуту")
        XCTAssertEqual(RuFormat.minutes(3), "3 минуты")
        XCTAssertEqual(RuFormat.minutes(12), "12 минут")
        XCTAssertEqual(RuFormat.minutes(21), "21 минуту")
        XCTAssertFalse(RuFormat.xp(1500).contains(","))
        XCTAssertTrue(RuFormat.xp(1500).hasSuffix("500 XP"))
    }

    func testReceiverRepairNeverTakesOverAnExternalOutput() {
        XCTAssertTrue(NativeAudioRoute.needsReceiverRepair([.builtInReceiver]))
        XCTAssertFalse(NativeAudioRoute.needsReceiverRepair([.builtInSpeaker]))
        for external in [AVAudioSession.Port.headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .airPlay, .usbAudio] {
            XCTAssertFalse(NativeAudioRoute.needsReceiverRepair([.builtInReceiver, external]))
            XCTAssertTrue(NativeAudioRoute.hasExternalOutputTypes([external]))
        }
    }
}

final class LiveTranscriptTokenTests: XCTestCase {
    func testOnlyAppendedWordsReceiveEntranceAndPrefixIdentityStaysStable() {
        var stream = LiveTranscriptTokens(text: "One old thought")
        let prefix = stream.words.map(\.id)
        XCTAssertTrue(stream.words.allSatisfy { !$0.animateEntrance }, "Mounting an existing hypothesis does not replay it")
        stream.update("One old thought and another")
        XCTAssertEqual(Array(stream.words.prefix(3)).map(\.id), prefix)
        XCTAssertEqual(stream.words.filter(\.animateEntrance).map(\.text), ["and", "another"])
    }

    func testPartialWordAndPunctuationCorrectionNeverReplayPreviousWords() {
        var stream = LiveTranscriptTokens(text: "Let's go clim")
        let identities = stream.words.map(\.id)
        stream.update("Let's go climbing,")
        XCTAssertEqual(stream.words.map(\.id), identities)
        XCTAssertTrue(stream.words.allSatisfy { !$0.animateEntrance })
        stream.update("Let's go climbing, tomorrow")
        XCTAssertEqual(Array(stream.words.prefix(3)).map(\.id), identities)
        XCTAssertEqual(stream.words.filter(\.animateEntrance).map(\.text), ["tomorrow"])
    }

    func testFinalRecognitionMayRewritePrefixWithoutAnimatingTheUnchangedSuffix() {
        var stream = LiveTranscriptTokens(text: "I love climbing")
        let suffix = stream.words.map(\.id)
        stream.update("Actually I love climbing")
        XCTAssertEqual(Array(stream.words.suffix(3)).map(\.id), suffix)
        XCTAssertTrue(stream.words.allSatisfy { !$0.animateEntrance }, "A changed prefix is recognition correction, not new spoken words")
        let revised = stream.words.map(\.id)
        stream.update("Honestly I love climbing")
        XCTAssertEqual(stream.words.map(\.id), revised)
        XCTAssertTrue(stream.words.allSatisfy { !$0.animateEntrance })
    }

    func testRepeatedWordsTruncationAndEmptyHypothesisPreserveContentWithoutReusingRetiredIdentities() {
        var stream = LiveTranscriptTokens(text: "um um I I think")
        let original = stream.words.map(\.id)
        stream.update("um um I")
        XCTAssertEqual(stream.words.map(\.text), ["um", "um", "I"])
        XCTAssertEqual(stream.words.map(\.id), Array(original.prefix(3)))
        stream.update("um um I I think so")
        XCTAssertEqual(stream.words.map(\.text), ["um", "um", "I", "I", "think", "so"])
        XCTAssertEqual(Set(stream.words.map(\.id)).count, stream.words.count)
        XCTAssertTrue(Set(stream.words.suffix(3).map(\.id)).isDisjoint(with: original.suffix(2)))
        let retired = Set(stream.words.map(\.id))
        stream.update("")
        XCTAssertTrue(stream.words.isEmpty)
        stream.update(" Fresh\n words   ")
        XCTAssertEqual(stream.words.map(\.text), ["Fresh", "words"])
        XCTAssertTrue(retired.isDisjoint(with: stream.words.map(\.id)))
    }

    func testRapidStreamUpdatesDoNotRestartOldWordEntrancesOrDuplicateIdentity() {
        var stream = LiveTranscriptTokens(text: "I think")
        let initial = stream.words.map(\.id)
        var phrase = "I think"
        for index in 0..<150 {
            phrase += index.isMultiple(of: 3) ? " um" : " word"
            stream.update(phrase)
            XCTAssertEqual(Array(stream.words.prefix(2)).map(\.id), initial)
            XCTAssertEqual(stream.words.filter(\.animateEntrance).count, 1)
            XCTAssertEqual(stream.words.last?.animateEntrance, true)
            XCTAssertEqual(Set(stream.words.map(\.id)).count, stream.words.count)
        }
        let revision = stream.revision
        stream.update(phrase)
        XCTAssertEqual(stream.revision, revision, "Duplicate deltas do not trigger another scroll/layout update")
    }
}

final class AudioSessionOwnershipTests: XCTestCase {
    func testAStalePlayerCannotReleaseTheNewMicrophoneOwner() {
        let order = AudioSessionCommandOrder()
        let playback = order.reserve()
        let capture = order.reserve()
        XCTAssertFalse(order.isCurrent(playback))
        XCTAssertTrue(order.isCurrent(capture))
        XCTAssertNil(order.reserveRelease(ifOwnedBy: playback), "Late playback callbacks must not silence a newer capture")
        XCTAssertTrue(order.isCurrent(capture))
        let release = order.reserveRelease(ifOwnedBy: capture)
        XCTAssertNotNil(release)
        XCTAssertFalse(order.isCurrent(capture))
        XCTAssertTrue(order.isCurrent(release!))
    }

    func testQueuedRepairAndStopAreSupersededByTheLatestAudioIntent() {
        let order = AudioSessionCommandOrder()
        _ = order.reserve()
        let queuedRepair = order.snapshot()
        let queuedStop = order.reserveRelease(ifOwnedBy: nil)!
        let latestPlayback = order.reserve()
        XCTAssertFalse(order.isCurrent(queuedRepair))
        XCTAssertFalse(order.isCurrent(queuedStop), "An obsolete stop cannot run after a newer activation")
        XCTAssertTrue(order.isCurrent(latestPlayback))
        XCTAssertNil(order.reserveRelease(ifOwnedBy: queuedStop))
        XCTAssertTrue(order.isCurrent(latestPlayback))
    }
}

private actor FakePracticeReminderCenter: PracticeReminderCenter {
    private var authorizationValue: String
    private var requests: [String: UNNotificationRequest]
    private var additions = 0
    private var permissionRequests = 0
    private var rejectAddition = false
    private var rejectAppliedAddition = false
    init(authorization: String = "authorized", requests: [UNNotificationRequest] = []) {
        authorizationValue = authorization
        self.requests = Dictionary(uniqueKeysWithValues: requests.map { ($0.identifier, $0) })
    }
    func authorization() async -> String { authorizationValue }
    func requestAuthorization() async throws { permissionRequests += 1; authorizationValue = "authorized" }
    func pending() async -> [UNNotificationRequest] { Array(requests.values) }
    func add(_ request: UNNotificationRequest) async throws {
        additions += 1
        if rejectAddition { rejectAddition = false; throw ClientError.message("Simulated rejected scheduling") }
        requests[request.identifier] = request
        if rejectAppliedAddition { rejectAppliedAddition = false; throw ClientError.message("Simulated ambiguous scheduling error") }
    }
    func remove(_ identifiers: [String]) async { for identifier in identifiers { requests.removeValue(forKey: identifier) } }
    func setAuthorization(_ value: String) { authorizationValue = value }
    func rejectNextAddition() { rejectAddition = true }
    func rejectNextAdditionAfterApplying() { rejectAppliedAddition = true }
    func statistics() -> (additions: Int, permissionRequests: Int) { (additions, permissionRequests) }
}

final class ReminderScheduleTests: XCTestCase {
    private func defaults() -> UserDefaults { UserDefaults(suiteName: "smooth-reminder-tests-" + UUID().uuidString)! }
    private func legacyRequest(title: String = "Ratmir English", hour: Int = 19, minute: Int = 15, repeats: Bool = true) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = "Личная практика"
        content.body = "Сохранённый текст напоминания."
        content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: "legacy-tone.caf"))
        content.badge = 3
        content.threadIdentifier = "ratmir-practice"
        content.categoryIdentifier = "legacy-practice"
        content.userInfo = ["appVersion": "0.4.1", "existingMetadata": "keep-me"]
        var components = DateComponents(hour: hour, minute: minute)
        components.timeZone = TimeZone(identifier: "Europe/Moscow")
        return UNNotificationRequest(identifier: "daily-practice", content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: repeats))
    }
    @MainActor func testLegacyDailyTimeMigratesWithoutChangingIdentifierOrForeignRequests() async {
        let legacy = PracticeReminder(id: "daily-practice", hour: 19, minute: 15)
        let other = UNNotificationRequest(identifier: "other-feature", content: UNMutableNotificationContent(), trigger: nil)
        let center = FakePracticeReminderCenter(requests: [legacy.request(), other])
        let storage = defaults()
        let client = TrainingClient(reminderCenter: center, reminderDefaults: storage)
        await client.refreshReminderStatus()
        XCTAssertEqual(client.reminders, [legacy])
        XCTAssertTrue(client.reminderEnabled)
        XCTAssertNotNil(storage.data(forKey: PracticeReminder.storageKey))
        let pending = await center.pending()
        XCTAssertEqual(Set(pending.map(\.identifier)), ["daily-practice", "other-feature"])
        let statistics = await center.statistics()
        XCTAssertEqual(statistics.additions, 0, "Opening settings never creates an extra notification")
    }

    @MainActor func testLegacyNotificationBrandingRefreshPreservesContentScheduleAndQueueSize() async throws {
        for previousTitle in ["Ratmir English", "Smooth English"] {
            let original = legacyRequest(title: previousTitle)
            let foreign = UNNotificationRequest(identifier: "other-feature", content: UNMutableNotificationContent(), trigger: nil)
            let center = FakePracticeReminderCenter(requests: [original, foreign])
            let storage = defaults()
            let client = TrainingClient(reminderCenter: center, reminderDefaults: storage)
            await client.refreshReminderStatus()
            let pending = await center.pending()
            XCTAssertEqual(pending.count, 2)
            XCTAssertEqual(client.reminders, [PracticeReminder(id: "daily-practice", hour: 19, minute: 15)])
            let updated = try XCTUnwrap(pending.first { $0.identifier == original.identifier })
            XCTAssertEqual(updated.content.title, "Smooth Talk")
            XCTAssertEqual(updated.content.userInfo["appVersion"] as? String, PracticeReminder.notificationVersion)
            XCTAssertEqual(updated.content.userInfo["existingMetadata"] as? String, "keep-me")
            XCTAssertEqual(updated.content.subtitle, original.content.subtitle)
            XCTAssertEqual(updated.content.body, original.content.body)
            XCTAssertEqual(updated.content.sound, original.content.sound)
            XCTAssertEqual(updated.content.badge, original.content.badge)
            XCTAssertEqual(updated.content.categoryIdentifier, original.content.categoryIdentifier)
            XCTAssertEqual(updated.content.threadIdentifier, original.content.threadIdentifier)
            let updatedTrigger = try XCTUnwrap(updated.trigger as? UNCalendarNotificationTrigger)
            let originalTrigger = try XCTUnwrap(original.trigger as? UNCalendarNotificationTrigger)
            XCTAssertEqual(updatedTrigger.dateComponents, originalTrigger.dateComponents)
            XCTAssertEqual(updatedTrigger.repeats, originalTrigger.repeats)
            XCTAssertTrue(client.reminderEnabled)
            XCTAssertFalse(client.reminderBusy)
            XCTAssertEqual(pending.first { $0.identifier == foreign.identifier }?.content.title, foreign.content.title)
            await client.refreshReminderStatus()
            let statistics = await center.statistics()
            XCTAssertEqual(statistics.additions, 1, "A same-ID refresh occurs once; opening Settings again does not reschedule it")
            XCTAssertEqual(statistics.permissionRequests, 0)
        }
    }

    @MainActor func testRejectedOrAmbiguousBrandingRefreshRestoresExactPreviousRequestWithoutDuplicate() async throws {
        for errorAfterApplying in [false, true] {
            let original = legacyRequest()
            let center = FakePracticeReminderCenter(requests: [original])
            if errorAfterApplying { await center.rejectNextAdditionAfterApplying() }
            else { await center.rejectNextAddition() }
            let client = TrainingClient(reminderCenter: center, reminderDefaults: defaults())
            await client.refreshReminderStatus()
            let pending = await center.pending()
            XCTAssertEqual(pending.count, 1)
            let retained = try XCTUnwrap(pending.first)
            XCTAssertEqual(retained.identifier, original.identifier)
            XCTAssertEqual(retained.content.title, original.content.title)
            XCTAssertEqual(retained.content.body, original.content.body)
            XCTAssertEqual(retained.content.sound, original.content.sound)
            XCTAssertEqual(retained.content.userInfo as NSDictionary, original.content.userInfo as NSDictionary)
            XCTAssertEqual((retained.trigger as? UNCalendarNotificationTrigger)?.dateComponents,
                           (original.trigger as? UNCalendarNotificationTrigger)?.dateComponents)
            XCTAssertTrue(client.reminderEnabled)
            XCTAssertEqual(client.reminders.map(\.timeLabel), ["19:15"])
            XCTAssertFalse(client.reminderBusy)
            XCTAssertNil(client.error, "A cosmetic refresh failure must not interrupt the learner")
            let statistics = await center.statistics()
            XCTAssertEqual(statistics.additions, 2, "One attempted refresh and one same-ID exact rollback")
            XCTAssertEqual(statistics.permissionRequests, 0)
        }
    }

    @MainActor func testPassiveBrandingRefreshSkipsDeniedUndecidedPausedMissingAndMismatchedRequests() async throws {
        let cases: [(String, Bool, Int, Bool, Bool)] = [
            ("denied", true, 19, true, true), ("notDetermined", true, 19, true, true),
            ("authorized", false, 19, true, true), ("authorized", true, 18, true, true),
            ("authorized", true, 19, false, true), ("authorized", true, 19, true, false)
        ]
        for (authorization, enabled, queuedHour, repeats, exists) in cases {
            let original = legacyRequest(hour: queuedHour, repeats: repeats)
            let storage = defaults()
            let configured = PracticeReminder(id: "daily-practice", hour: 19, minute: 15, enabled: enabled)
            storage.set(try JSONEncoder().encode([configured]), forKey: PracticeReminder.storageKey)
            let center = FakePracticeReminderCenter(authorization: authorization, requests: exists ? [original] : [])
            let client = TrainingClient(reminderCenter: center, reminderDefaults: storage)
            await client.refreshReminderStatus()
            XCTAssertEqual(client.reminders, [configured])
            let statistics = await center.statistics()
            XCTAssertEqual(statistics.additions, 0)
            XCTAssertEqual(statistics.permissionRequests, 0)
            let pending = await center.pending()
            XCTAssertEqual(pending.count, exists ? 1 : 0)
            if exists { XCTAssertEqual(pending[0].content.title, "Ratmir English") }
        }
    }

    @MainActor func testMultipleTimesEditInPlaceAndPersistAcrossClientRestore() async throws {
        let center = FakePracticeReminderCenter()
        let storage = defaults()
        let client = TrainingClient(reminderCenter: center, reminderDefaults: storage)
        let evening = await client.saveReminder(hour: 19, minute: 0)
        let morning = await client.saveReminder(hour: 8, minute: 30)
        XCTAssertTrue(evening); XCTAssertTrue(morning)
        XCTAssertEqual(client.reminders.map(\.timeLabel), ["08:30", "19:00"])
        let eveningID = try XCTUnwrap(client.reminders.last?.id)
        let edited = await client.saveReminder(id: eveningID, hour: 20, minute: 15)
        XCTAssertTrue(edited)
        XCTAssertEqual(client.reminders.last?.id, eveningID)
        let pending = await center.pending()
        XCTAssertEqual(pending.count, 2)
        let request = try XCTUnwrap(pending.first { $0.identifier == eveningID })
        let trigger = try XCTUnwrap(request.trigger as? UNCalendarNotificationTrigger)
        XCTAssertEqual(trigger.dateComponents.hour, 20)
        XCTAssertEqual(trigger.dateComponents.minute, 15)
        XCTAssertTrue(trigger.repeats)
        XCTAssertEqual(request.content.title, "Smooth Talk")
        let restored = TrainingClient(reminderCenter: center, reminderDefaults: storage)
        await restored.refreshReminderStatus()
        XCTAssertEqual(restored.reminders, client.reminders)
    }

    @MainActor func testDuplicateOrInvalidTimeNeverOverwritesExistingSchedule() async {
        let center = FakePracticeReminderCenter()
        let client = TrainingClient(reminderCenter: center, reminderDefaults: defaults())
        _ = await client.saveReminder(hour: 19, minute: 0)
        let before = client.reminders
        let duplicate = await client.saveReminder(hour: 19, minute: 0)
        let invalid = await client.saveReminder(id: before.first!.id, hour: 24, minute: 0)
        XCTAssertFalse(duplicate); XCTAssertFalse(invalid)
        XCTAssertEqual(client.reminders, before)
        let statistics = await center.statistics()
        XCTAssertEqual(statistics.additions, 1)
        XCTAssertFalse(client.reminderBusy)
    }

    @MainActor func testAuthorizationDenialKeepsConfiguredTimesAndDoesNotRequestAgain() async {
        let time = PracticeReminder(id: "daily-practice", hour: 19, minute: 0)
        let storage = defaults()
        storage.set(try! JSONEncoder().encode([time]), forKey: PracticeReminder.storageKey)
        let center = FakePracticeReminderCenter(authorization: "denied", requests: [time.request()])
        let client = TrainingClient(reminderCenter: center, reminderDefaults: storage)
        await client.refreshReminderStatus()
        let saved = await client.saveReminder(hour: 8, minute: 0)
        XCTAssertFalse(saved)
        XCTAssertEqual(client.notificationState, "denied")
        XCTAssertEqual(client.reminders, [time])
        XCTAssertFalse(client.reminderEnabled)
        let statistics = await center.statistics()
        XCTAssertEqual(statistics.additions, 0)
        XCTAssertEqual(statistics.permissionRequests, 0)
        XCTAssertTrue(client.error?.contains("Smooth Talk") == true)
    }

    @MainActor func testFirstSaveRequestsPermissionOnceAndRejectedEditKeepsOldTime() async {
        let center = FakePracticeReminderCenter(authorization: "notDetermined")
        let client = TrainingClient(reminderCenter: center, reminderDefaults: defaults())
        let first = await client.saveReminder(hour: 19, minute: 0)
        XCTAssertTrue(first)
        let previous = client.reminders[0]
        await center.rejectNextAddition()
        let edited = await client.saveReminder(id: previous.id, hour: 20, minute: 0)
        XCTAssertFalse(edited)
        XCTAssertEqual(client.reminders, [previous])
        let pending = await center.pending()
        let trigger = pending[0].trigger as? UNCalendarNotificationTrigger
        XCTAssertEqual(trigger?.dateComponents.hour, 19)
        let statistics = await center.statistics()
        XCTAssertEqual(statistics.permissionRequests, 1)
        XCTAssertFalse(client.reminderBusy)
    }

    @MainActor func testDisableEditAndDeleteKeepOtherTimesAndForeignQueueEntries() async {
        let foreign = UNNotificationRequest(identifier: "other-feature", content: UNMutableNotificationContent(), trigger: nil)
        let center = FakePracticeReminderCenter(requests: [foreign])
        let storage = defaults()
        let client = TrainingClient(reminderCenter: center, reminderDefaults: storage)
        _ = await client.saveReminder(hour: 8, minute: 0)
        _ = await client.saveReminder(hour: 19, minute: 0)
        let morning = client.reminders[0]
        await client.setReminderEnabled(id: morning.id, enabled: false)
        XCTAssertFalse(client.reminders[0].enabled)
        await center.setAuthorization("denied")
        let editedWhilePaused = await client.saveReminder(id: morning.id, hour: 9, minute: 15)
        XCTAssertTrue(editedWhilePaused, "Editing a paused schedule does not need notification authorization")
        let restored = TrainingClient(reminderCenter: center, reminderDefaults: storage)
        XCTAssertEqual(restored.reminders[0].timeLabel, "09:15")
        XCTAssertFalse(restored.reminders[0].enabled)
        await client.deleteReminder(id: morning.id)
        XCTAssertEqual(client.reminders.map(\.timeLabel), ["19:00"])
        let pending = await center.pending()
        XCTAssertEqual(pending.count, 2)
        XCTAssertTrue(pending.contains { $0.identifier == "other-feature" })
    }
}

final class NativeChromeTests: XCTestCase {
    func testOpeningWaitsForAccessAndForegroundButNeverBlocksProtectedFlows() {
        func readiness(signedIn: Bool = true, loaded: Bool = true, onboarding: Bool = false, protected: Bool = false, foreground: Bool = true) -> NativeOpeningReadiness {
            NativeOpeningReadiness(signedIn: signedIn, stateLoaded: loaded, onboardingBlocked: onboarding, protectedActivity: protected, foreground: foreground)
        }
        XCTAssertTrue(readiness(foreground: false).displayEligible, "The greeting owns the first frame while its timer waits for foreground")
        XCTAssertFalse(readiness(onboarding: true).displayEligible)
        XCTAssertFalse(readiness(protected: true).displayEligible)
        for input in [readiness(signedIn: false), readiness(loaded: false), readiness(foreground: false)] {
            var state = NativeOpeningState()
            XCTAssertFalse(state.begin(readiness: input, reduceMotion: false))
            XCTAssertFalse(state.consumed, "Access/state/loading is allowed to finish first")
            XCTAssertEqual(state.phase, .waiting)
        }
        for input in [readiness(onboarding: true), readiness(protected: true)] {
            var state = NativeOpeningState()
            XCTAssertFalse(state.begin(readiness: input, reduceMotion: false))
            XCTAssertTrue(state.consumed, "Completing onboarding or closing a conversation cannot unexpectedly play a launch greeting")
            XCTAssertEqual(state.phase, .finished)
            XCTAssertFalse(state.animateHome)
        }
    }

    func testOpeningIsBoundedAndCannotReplayAfterSkipOrForegroundResume() {
        let ready = NativeOpeningReadiness(signedIn: true, stateLoaded: true, onboardingBlocked: false, protectedActivity: false, foreground: true)
        XCTAssertGreaterThanOrEqual(NativeOpeningState.greetingMilliseconds, 3_000, "The greeting leaves time to see the mascot settle and read the phrase")
        XCTAssertLessThanOrEqual(NativeOpeningState.greetingMilliseconds, 3_500, "Launch remains bounded and immediately skippable")
        XCTAssertGreaterThanOrEqual(NativeOpeningState.handoffSeconds, 0.55)
        XCTAssertLessThanOrEqual(NativeOpeningState.handoffSeconds, 0.65)
        XCTAssertLessThanOrEqual(NativeOpeningState.homeEntranceSeconds + 5 * NativeOpeningState.homeStaggerSeconds, 1.05, "The complete Home cascade has a bounded final settlement")
        for pose in [VoiceOrbGreetingPose.neutral, .arriving, .lifted, .landing] {
            XCTAssertGreaterThanOrEqual(pose.scaleX, 0.90)
            XCTAssertGreaterThanOrEqual(pose.scaleY, 0.90)
            XCTAssertLessThanOrEqual(pose.scaleX, 1.08)
            XCTAssertLessThanOrEqual(pose.scaleY, 1.08)
            XCTAssertLessThanOrEqual(abs(pose.lift), 0.06)
            XCTAssertLessThanOrEqual(abs(pose.tilt), 4)
        }
        var state = NativeOpeningState()
        XCTAssertTrue(state.begin(readiness: ready, reduceMotion: false))
        XCTAssertEqual(state.phase, .greeting)
        state.finish(animated: false)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertFalse(state.animateHome, "Tap/keyboard/cancel reveals usable Home immediately")
        XCTAssertFalse(state.begin(readiness: ready, reduceMotion: false))
        XCTAssertFalse(state.beginHandoff(), "A late hold timer cannot recreate a handoff after skip")
        state.finish(animated: true)
        XCTAssertFalse(state.animateHome, "A late auto-dismiss cannot restore an animation after skip")
        XCTAssertEqual(state.phase, .finished)
        var accessible = NativeOpeningState()
        XCTAssertFalse(accessible.begin(readiness: ready, reduceMotion: true))
        XCTAssertEqual(accessible.phase, .finished)
        XCTAssertFalse(accessible.animateHome)
        var automatic = NativeOpeningState()
        XCTAssertTrue(automatic.begin(readiness: ready, reduceMotion: false))
        XCTAssertTrue(automatic.beginHandoff())
        XCTAssertEqual(automatic.phase, .handoff, "One shared phase reveals Home while its outgoing backing remains mounted")
        XCTAssertTrue(automatic.animateHome)
        XCTAssertFalse(automatic.beginHandoff(), "The same handoff cannot restart")
        automatic.finish(animated: true)
        XCTAssertEqual(automatic.phase, .finished)
        XCTAssertFalse(automatic.beginHandoff())
        var interruptedHandoff = NativeOpeningState()
        XCTAssertTrue(interruptedHandoff.begin(readiness: ready, reduceMotion: false))
        XCTAssertTrue(interruptedHandoff.beginHandoff())
        interruptedHandoff.finish(animated: false)
        interruptedHandoff.finish(animated: true)
        XCTAssertFalse(interruptedHandoff.animateHome, "Interaction/background during the handoff consumes animation intent permanently")
    }

    @MainActor func testSystemSegmentsKeepRealTitlesAndPlatformGlassWhileRetargeting() {
        let options = [SelectionOption(id: "life", title: "Жизнь", icon: "bubble.left"), SelectionOption(id: "work", title: "Работа", icon: "briefcase"), SelectionOption(id: "relocation", title: "Переезд", icon: "airplane")]
        let control = NativePracticeSegmentedControl(items: [])
        let systemDefault = UISegmentedControl(items: [])
        for id in ["life", "relocation", "work", "life", "work", "relocation", "life", "work"] {
            control.apply(options: options, selectedID: id, animated: true)
            XCTAssertEqual(control.selectedSegmentIndex, options.firstIndex { $0.id == id } ?? UISegmentedControl.noSegment)
            XCTAssertEqual(control.numberOfSegments, 3)
            XCTAssertEqual((0..<3).compactMap { control.titleForSegment(at: $0) }, options.map(\.title))
            XCTAssertEqual(control.backgroundImage(for: .normal, barMetrics: .default), systemDefault.backgroundImage(for: .normal, barMetrics: .default), "A custom background must not obscure the system glass")
            XCTAssertEqual(control.selectedSegmentTintColor, systemDefault.selectedSegmentTintColor, "The selection keeps the platform glass appearance")
        }
    }

    @MainActor func testNativeSelectionCoordinatorKeepsOnlyValidLatestSelection() {
        let options = [SelectionOption(id: "life", title: "Жизнь", icon: "bubble.left"), SelectionOption(id: "work", title: "Работа", icon: "briefcase"), SelectionOption(id: "relocation", title: "Переезд", icon: "airplane")]
        let control = NativePracticeSegmentedControl(items: [])
        var selected = "life"
        let coordinator = NativePracticeSegments.Coordinator(selection: Binding(get: { selected }, set: { selected = $0 }), options: options)
        control.apply(options: options, selectedID: "work", animated: false)
        XCTAssertEqual(selected, "life", "Rendering a persisted value must not send a second selection event")
        coordinator.changed(control)
        XCTAssertEqual(selected, "work")
        control.selectedSegmentIndex = UISegmentedControl.noSegment
        coordinator.changed(control)
        XCTAssertEqual(selected, "work", "An invalid segment is never written into the practice context")
        for index in [2, 0, 1, 2, 1] {
            control.selectedSegmentIndex = index
            coordinator.changed(control)
            XCTAssertEqual(selected, options[index].id)
        }
    }

    @MainActor func testThemeTokensFollowLightAndDark() {
        func components(_ color: UIColor, _ style: UIUserInterfaceStyle) -> (CGFloat, CGFloat, CGFloat, CGFloat) {
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
            color.resolvedColor(with: UITraitCollection(userInterfaceStyle: style)).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
            return (red, green, blue, alpha)
        }
        let darkBase = components(Theme.Palette.base, .dark)
        XCTAssertEqual(darkBase.0, 11.0 / 255, accuracy: 0.01)
        XCTAssertEqual(darkBase.2, 16.0 / 255, accuracy: 0.01)
        let lightBase = components(Theme.Palette.base, .light)
        XCTAssertEqual(lightBase.0, 238.0 / 255, accuracy: 0.01)
        let lightCTA = components(Theme.Palette.ctaFill, .light)
        let darkCTA = components(Theme.Palette.ctaFill, .dark)
        XCTAssertEqual(lightCTA.0, 24.0 / 255, accuracy: 0.01, "Primary is charcoal in light")
        XCTAssertEqual(darkCTA.0, 218.0 / 255, accuracy: 0.01, "Primary is lime in dark")
        XCTAssertEqual(components(Theme.Palette.ctaLabel, .light).1, 241.0 / 255, accuracy: 0.01)
        XCTAssertEqual(components(Theme.Palette.inkSecondary, .light).3, 0.62, accuracy: 0.01)
    }
}
