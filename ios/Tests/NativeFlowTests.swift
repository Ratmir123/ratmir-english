import XCTest
import SwiftUI
import AVFoundation
import UserNotifications
import UIKit
@testable import RatmirEnglish

final class NativeFlowTests: XCTestCase {
    private let sessionID = "11111111-1111-4111-8111-111111111111"

    private func data(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func conversation(status: String, deferred: Bool = false) -> [String: Any] {
        ["id": sessionID, "status": status, "mode": "learning", "lesson": ["title": "A useful test", "goal": "Give a reason", "why": "Express a clear thought", "minutes": 10],
         "turns": [["id": "u1", "role": "user", "text": "Saturday works because I am free."]], "retries": [],
         "retryDeferred": deferred, "analysis": ["version": 1, "summary": "One next step", "strengths": [], "priorities": [], "limitations": []]]
    }
    @MainActor private func preparedClient(status: String = "review", deferred: Bool = false) throws -> TrainingClient {
        let client = TrainingClient()
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

    @MainActor func testAcceptedDeferredCompletionReturnsHomeAndPreservesSavedRetry() async throws {
        let client = try preparedClient(deferred: true)
        await client.action("complete", deferRetry: true, returnHome: true)
        XCTAssertFalse(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 1)
        XCTAssertEqual(client.conversation?.status, "completed")
        XCTAssertEqual(client.conversation?.retryDeferred, true)
        XCTAssertNil(client.completionMoment, "Completing does not leave a static banner in the review")
        XCTAssertEqual(client.previewRequestBodies["sessions/\(sessionID)/complete"]?["deferRetry"] as? Bool, true)
        XCTAssertNil(client.error)
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
        XCTAssertTrue(client.error?.hasPrefix("Занятие сохранено.") == true)
    }

    @MainActor func testCompletedHistoryReturnsHomeWithoutAnotherCompletionRequest() throws {
        let client = try preparedClient(status: "completed")
        client.returnToHome()
        XCTAssertFalse(client.conversationPresented)
        XCTAssertEqual(client.homeRequest, 1)
        XCTAssertTrue(client.previewRequests.isEmpty)
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
            XCTAssertEqual(updated.content.title, "Smooth English")
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
        XCTAssertEqual(request.content.title, "Smooth English")
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
        XCTAssertTrue(client.error?.contains("Smooth English") == true)
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
        XCTAssertLessThanOrEqual(NativeOpeningState.greetingMilliseconds, 1_350)
        var state = NativeOpeningState()
        XCTAssertTrue(state.begin(readiness: ready, reduceMotion: false))
        XCTAssertEqual(state.phase, .greeting)
        state.finish(animated: false)
        XCTAssertEqual(state.phase, .finished)
        XCTAssertFalse(state.animateHome, "Tap/keyboard/cancel reveals usable Home immediately")
        XCTAssertFalse(state.begin(readiness: ready, reduceMotion: false))
        state.finish(animated: true)
        XCTAssertFalse(state.animateHome, "A late auto-dismiss cannot restore an animation after skip")
        XCTAssertEqual(state.phase, .finished)
        var accessible = NativeOpeningState()
        XCTAssertFalse(accessible.begin(readiness: ready, reduceMotion: true))
        XCTAssertEqual(accessible.phase, .finished)
        XCTAssertFalse(accessible.animateHome)
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

    @MainActor func testTabContrastPersistsAfterHistoryAndOtherChildSelections() {
        let controller = StableTabBarAppearance.Controller()
        let history = UIViewController()
        let tabs = UITabBarController()
        tabs.viewControllers = [controller, UIViewController(), history, UIViewController()]
        _ = tabs.view
        for index in [0, 2, 1, 3, 2] {
            tabs.selectedIndex = index
            controller.apply()
            let selected = UIColor(red: 34 / 255, green: 33 / 255, blue: 36 / 255, alpha: 1)
            for appearance in [tabs.tabBar.standardAppearance, tabs.tabBar.scrollEdgeAppearance!] {
                for item in [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance] {
                    XCTAssertEqual(item.selected.iconColor, selected)
                    XCTAssertEqual(item.normal.iconColor, selected.withAlphaComponent(0.62))
                }
            }
            XCTAssertEqual(tabs.tabBar.tintColor, selected)
            XCTAssertEqual(tabs.tabBar.unselectedItemTintColor, selected.withAlphaComponent(0.62))
        }
    }
}
