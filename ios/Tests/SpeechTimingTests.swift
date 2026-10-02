import XCTest
@testable import RatmirEnglish

final class SpeechTimingTests: XCTestCase {
    private let recording = "00000000-0000-4000-8000-000000000099.wav"
    private func fixture() -> [String: Any] {
        ["version": 1, "method": "webrtc-vad", "source": "server-audio", "audioFile": recording,
         "durationSeconds": 10.0, "detectedSpeechSeconds": 6.0, "speechSpanSeconds": 8.0,
         "leadingSilenceSeconds": 1.0, "trailingSilenceSeconds": 1.0, "internalPauseSeconds": 2.0,
         "longestPauseSeconds": 2.0, "internalPauseCount": 1, "pauseThresholdSeconds": 0.6,
         "quality": "usable", "recognizedWords": 12, "approximateWordsPerMinute": 90.0, "transcriptEdited": false,
         "limitations": ["Synthetic unit-test data"], "segments": [
            ["startSeconds": 0.0, "endSeconds": 1.0, "kind": "leading-silence"],
            ["startSeconds": 1.0, "endSeconds": 4.0, "kind": "speech"],
            ["startSeconds": 4.0, "endSeconds": 6.0, "kind": "pause"],
            ["startSeconds": 6.0, "endSeconds": 9.0, "kind": "speech"],
            ["startSeconds": 9.0, "endSeconds": 10.0, "kind": "trailing-silence"]]]
    }
    private func decode(_ value: [String: Any]) throws -> SpeechTiming {
        try JSONDecoder().decode(SpeechTiming.self, from: JSONSerialization.data(withJSONObject: value))
    }

    func testLegacyTurnsAndReviewsDecodeWithoutTiming() throws {
        let turn = try JSONDecoder().decode(Turn.self, from: Data(#"{"id":"u1","role":"user","text":"A legacy answer"}"#.utf8))
        let review = try JSONDecoder().decode(Review.self, from: Data(#"{"summary":"Legacy review","strengths":[],"priorities":[],"limitations":[]}"#.utf8))
        let retry = try JSONDecoder().decode(Retry.self, from: Data(#"{"text":"My retry","feedback":"Try again"}"#.utf8))
        XCTAssertNil(turn.speechTiming)
        XCTAssertNil(review.timingFeedback)
        XCTAssertNil(retry.speechTiming)
    }

    func testSourceLinkedTimingAndPauseDecode() throws {
        let timing = try decode(fixture())
        XCTAssertTrue(timing.canDisplay(for: recording))
        XCTAssertFalse(timing.canDisplay(for: "different.wav"))
        XCTAssertEqual(timing.longestPause?.startSeconds, 4)
        XCTAssertEqual(timing.longestPause?.endSeconds, 6)
        XCTAssertEqual(timing.displayedPace, 90)
    }

    func testEditedOrLimitedTranscriptsNeverDisplayWordBasedPace() throws {
        var value = fixture()
        value["transcriptEdited"] = true
        XCTAssertNil(try decode(value).displayedPace)
        value["transcriptEdited"] = false
        value["quality"] = "limited"
        XCTAssertNil(try decode(value).displayedPace)
        value["approximateWordsPerMinute"] = NSNull()
        XCTAssertNil(try decode(value).approximateWordsPerMinute)
    }

    func testUnsupportedOrUnlinkedTimelineCannotDisplay() throws {
        var value = fixture()
        value["source"] = "asr-text"
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
        value = fixture()
        value["version"] = 2
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
        value = fixture()
        value["durationSeconds"] = -1
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
    }

    func testFeedbackMustReferToAnActualMeasuredPause() throws {
        let timing = try decode(fixture())
        func feedback(start: Double, end: Double) throws -> TimingFeedback {
            let object: [String: Any] = ["turnId": "u1", "startSeconds": start, "endSeconds": end, "durationSeconds": end - start,
                "observation": "Detected pause", "practice": "A short useful retry"]
            return try JSONDecoder().decode(TimingFeedback.self, from: JSONSerialization.data(withJSONObject: object))
        }
        XCTAssertTrue(try feedback(start: 4, end: 6).matches(timing))
        XCTAssertFalse(try feedback(start: 1, end: 4).matches(timing), "Speech cannot be relabeled a pause")
        XCTAssertFalse(try feedback(start: 5, end: 7).matches(timing), "A fabricated interval cannot be displayed as evidence")
    }

    func testAggregatesMustMatchMeasuredSegments() throws {
        for (field, falseValue) in [("detectedSpeechSeconds", 5.0), ("speechSpanSeconds", 7.0),
                                    ("leadingSilenceSeconds", 0.0), ("trailingSilenceSeconds", 2.0),
                                    ("internalPauseSeconds", 1.0), ("longestPauseSeconds", 1.0),
                                    ("internalPauseCount", 2.0)] {
            var value = fixture()
            value[field] = falseValue
            let timing = try decode(value)
            XCTAssertFalse(timing.canDisplay(for: recording), field)
            XCTAssertNil(timing.displayedPace, "Corrupt aggregates cannot show word-based pace")
        }
    }

    func testInternalGapsAndMarginsCannotBeRelabeled() throws {
        for (index, kind) in [(0, "pause"), (2, "gap"), (2, "leading-silence"), (2, "trailing-silence"), (4, "pause")] {
            var value = fixture()
            var segments = value["segments"] as! [[String: Any]]
            segments[index]["kind"] = kind
            value["segments"] = segments
            XCTAssertFalse(try decode(value).canDisplay(for: recording), "Invalid \(kind) at segment \(index)")
        }
    }

    func testPaceAndEditedMetadataMustMatchSourceCounts() throws {
        var value = fixture()
        value["approximateWordsPerMinute"] = 400.0
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
        XCTAssertNil(try decode(value).displayedPace)
        for invalidWords in [0, 7001] {
            value = fixture()
            value["recognizedWords"] = invalidWords
            XCTAssertFalse(try decode(value).canDisplay(for: recording))
        }
        value = fixture()
        value["transcriptEdited"] = true
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
        value["recognizedWords"] = NSNull()
        value["approximateWordsPerMinute"] = NSNull()
        XCTAssertTrue(try decode(value).canDisplay(for: recording), "Edited transcript keeps original acoustic timeline")
        XCTAssertNil(try decode(value).displayedPace)
        value = fixture()
        value["quality"] = "limited"
        value["approximateWordsPerMinute"] = NSNull()
        XCTAssertTrue(try decode(value).canDisplay(for: recording), "Quiet or clipped recordings retain valid timing without a rate")
    }

    func testSilentRecordingHasNoInventedSpeechOrInternalPause() throws {
        var value = fixture()
        value["quality"] = "no-speech"
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
        value["detectedSpeechSeconds"] = 0.0
        value["speechSpanSeconds"] = 0.0
        value["leadingSilenceSeconds"] = 10.0
        value["trailingSilenceSeconds"] = 0.0
        value["internalPauseSeconds"] = 0.0
        value["longestPauseSeconds"] = 0.0
        value["internalPauseCount"] = 0
        value["recognizedWords"] = NSNull()
        value["approximateWordsPerMinute"] = NSNull()
        value["segments"] = [["startSeconds": 0.0, "endSeconds": 10.0, "kind": "leading-silence"]]
        XCTAssertTrue(try decode(value).canDisplay(for: recording))
        XCTAssertNil(try decode(value).displayedPace)
        value["quality"] = "usable"
        XCTAssertFalse(try decode(value).canDisplay(for: recording))
    }

    func testValidShortGapAndMillisecondRoundingRemainReadable() throws {
        var value = fixture()
        value["detectedSpeechSeconds"] = 5.7
        value["approximateWordsPerMinute"] = 90.003
        value["segments"] = [
            ["startSeconds": 0.0, "endSeconds": 1.0, "kind": "leading-silence"],
            ["startSeconds": 1.0, "endSeconds": 3.0, "kind": "speech"],
            ["startSeconds": 3.0, "endSeconds": 3.3, "kind": "gap"],
            ["startSeconds": 3.3, "endSeconds": 4.0, "kind": "speech"],
            ["startSeconds": 4.0, "endSeconds": 6.0, "kind": "pause"],
            ["startSeconds": 6.0, "endSeconds": 9.0, "kind": "speech"],
            ["startSeconds": 9.0, "endSeconds": 10.0, "kind": "trailing-silence"]]
        let timing = try decode(value)
        XCTAssertTrue(timing.canDisplay(for: recording), "Short internal gaps are distinct from counted pauses")
        XCTAssertEqual(timing.internalPauseCount, 1)
        XCTAssertEqual(timing.displayedPace, 90.003, "Server rounding tolerance is preserved")
    }
}
