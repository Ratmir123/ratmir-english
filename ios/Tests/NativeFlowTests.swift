import XCTest
import AVFoundation
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
