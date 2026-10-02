import SwiftUI

/// Optional additive server DTO. Old lessons without it remain fully readable.
struct SpeechTiming: Decodable {
    struct Segment: Decodable {
        let startSeconds: Double
        let endSeconds: Double
        let kind: String
        var duration: Double { endSeconds - startSeconds }
    }
    let version: Int
    let method: String
    let source: String
    let audioFile: String
    let durationSeconds: Double
    let detectedSpeechSeconds: Double
    let speechSpanSeconds: Double
    let leadingSilenceSeconds: Double
    let trailingSilenceSeconds: Double
    let internalPauseSeconds: Double
    let longestPauseSeconds: Double
    let internalPauseCount: Int
    let pauseThresholdSeconds: Double
    let segments: [Segment]
    let quality: String
    let limitations: [String]
    let recognizedWords: Int?
    let approximateWordsPerMinute: Double?
    let transcriptEdited: Bool

    func canDisplay(for recording: String?) -> Bool {
        guard version == 1, method == "webrtc-vad", source == "server-audio", recording == audioFile,
              audioFile.range(of: "^[a-f0-9-]+\\.(webm|mp4|ogg|wav|mp3)$", options: .regularExpression) != nil,
              ["usable", "limited", "no-speech"].contains(quality),
              durationSeconds.isFinite, durationSeconds > 0, durationSeconds <= 600,
              pauseThresholdSeconds.isFinite, near(pauseThresholdSeconds, 0.6),
              limitations.count <= 8, limitations.allSatisfy({ $0.utf16.count <= 500 }),
              internalPauseCount >= 0, !segments.isEmpty, segments.count <= 2048 else { return false }
        let values = [detectedSpeechSeconds, speechSpanSeconds, leadingSilenceSeconds, trailingSilenceSeconds, internalPauseSeconds, longestPauseSeconds]
        guard values.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= durationSeconds + 0.005 }) else { return false }
        var cursor = 0.0
        var speech: [Segment] = []
        var pauses: [Segment] = []
        for segment in segments {
            guard ["speech", "pause", "gap", "leading-silence", "trailing-silence"].contains(segment.kind),
                  segment.startSeconds.isFinite, segment.endSeconds.isFinite,
                  near(segment.startSeconds, cursor), segment.endSeconds > segment.startSeconds,
                  segment.startSeconds >= 0, segment.endSeconds <= durationSeconds + 0.001 else { return false }
            if segment.kind == "speech" { speech.append(segment) }
            if segment.kind == "pause" {
                guard segment.duration >= 0.6 - 0.002 else { return false }
                pauses.append(segment)
            }
            if segment.kind == "gap" && (segment.duration >= 0.6 + 0.002 || speech.isEmpty) { return false }
            if segment.kind == "leading-silence" && cursor != 0 { return false }
            if segment.kind == "trailing-silence" && !near(segment.endSeconds, durationSeconds) { return false }
            cursor = segment.endSeconds
        }
        guard near(cursor, durationSeconds) else { return false }
        let first = speech.first
        let last = speech.last
        let speechTotal = speech.reduce(0) { $0 + $1.duration }
        let pauseTotal = pauses.reduce(0) { $0 + $1.duration }
        guard pauses.allSatisfy({ segment in
            guard let first, let last else { return false }
            return segment.startSeconds > first.startSeconds && segment.endSeconds < last.endSeconds
        }), near(detectedSpeechSeconds, speechTotal),
            near(speechSpanSeconds, first != nil ? last!.endSeconds - first!.startSeconds : 0),
            near(leadingSilenceSeconds, first?.startSeconds ?? durationSeconds),
            near(trailingSilenceSeconds, last.map { durationSeconds - $0.endSeconds } ?? 0),
            near(internalPauseSeconds, pauseTotal), internalPauseCount == pauses.count,
            near(longestPauseSeconds, pauses.map(\.duration).max() ?? 0),
            (quality == "no-speech") == speech.isEmpty else { return false }
        if let words = recognizedWords, words < 1 || words > 7000 { return false }
        if let pace = approximateWordsPerMinute {
            guard pace.isFinite, pace >= 0, let words = recognizedWords,
                  quality == "usable", !transcriptEdited, speechSpanSeconds > 0,
                  near(pace, (Double(words) * 60 / speechSpanSeconds * 1000).rounded() / 1000) else { return false }
        }
        if transcriptEdited && (recognizedWords != nil || approximateWordsPerMinute != nil) { return false }
        return true
    }
    private func near(_ left: Double, _ right: Double) -> Bool { abs(left - right) <= 0.004 }
    var longestPause: Segment? { segments.filter { $0.kind == "pause" }.max { $0.duration < $1.duration } }
    var displayedPace: Double? {
        guard canDisplay(for: audioFile), quality == "usable", !transcriptEdited, let words = recognizedWords, words > 0,
              let pace = approximateWordsPerMinute, pace.isFinite, pace >= 0, speechSpanSeconds >= 5 else { return nil }
        return pace
    }
}

struct TimingFeedback: Decodable {
    let turnId: String
    let startSeconds: Double
    let endSeconds: Double
    let durationSeconds: Double
    let observation: String
    let practice: String
    func matches(_ timing: SpeechTiming) -> Bool {
        guard timing.canDisplay(for: timing.audioFile), timing.quality == "usable", startSeconds.isFinite, endSeconds.isFinite, durationSeconds.isFinite else { return false }
        return timing.segments.contains {
            $0.kind == "pause" && abs($0.startSeconds - startSeconds) < 0.005 && abs($0.endSeconds - endSeconds) < 0.005
                && abs($0.duration - durationSeconds) < 0.005
        }
    }
}

private struct TimedAnswer: Identifiable {
    let id: String
    let title: String
    let text: String
    let timing: SpeechTiming
    let feedback: TimingFeedback?
}

struct SpeechTimingView: View {
    let conversation: Conversation
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var answers: [TimedAnswer] {
        var result: [TimedAnswer] = []
        let ownTurns = conversation.turns.filter { $0.role == "user" }
        for (index, turn) in ownTurns.enumerated() {
            guard turn.source == "audio", turn.disputed != true, let timing = turn.speechTiming,
                  timing.canDisplay(for: turn.audioFile) else { continue }
            let feedback = conversation.analysis?.timingFeedback?.filter { $0.turnId == turn.id && $0.matches(timing) }
                .max { $0.durationSeconds < $1.durationSeconds }
            result.append(TimedAnswer(id: "answer:" + turn.id, title: "Ответ \(index + 1)", text: turn.text, timing: timing, feedback: feedback))
        }
        for (index, retry) in conversation.retries.enumerated() {
            guard let timing = retry.speechTiming, timing.canDisplay(for: retry.audioFile) else { continue }
            result.append(TimedAnswer(id: "retry:\(index)", title: "Новая попытка \(index + 1)", text: retry.text, timing: timing, feedback: nil))
        }
        return result.sorted { left, right in
            if (left.timing.quality == "usable") != (right.timing.quality == "usable") { return left.timing.quality == "usable" }
            return left.timing.longestPauseSeconds > right.timing.longestPauseSeconds
        }
    }
    var body: some View {
        if let first = answers.first {
            VStack(alignment: .leading, spacing: 16) {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Твоя речь в записи", systemImage: "waveform").font(.headline)
                        Text("По аудио").font(.caption).foregroundStyle(Theme.secondary)
                    }
                } else {
                    HStack {
                        Label("Твоя речь в записи", systemImage: "waveform").font(.headline)
                        Spacer(minLength: 8)
                        Text("По аудио").font(.caption).foregroundStyle(Theme.secondary)
                    }
                }
                TimedAnswerView(answer: first)
                if answers.count > 1 {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 20) {
                            ForEach(Array(answers.dropFirst())) { answer in
                                Divider().opacity(0.5)
                                TimedAnswerView(answer: answer)
                            }
                        }.padding(.top, 12)
                    } label: { Text("Другие записи: \(answers.count - 1)").font(.footnote.weight(.medium)) }
                }
            }.padding(20).background(Color.white, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                .foregroundStyle(Theme.charcoal)
        }
    }
}

private struct TimedAnswerView: View {
    let answer: TimedAnswer
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var timing: SpeechTiming { answer.timing }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) { answerHeader }
            } else {
                HStack(alignment: .firstTextBaseline) { answerHeader }
            }
            SpeechTimeline(timing: timing)
            if timing.quality == "no-speech" {
                Text("Детектор не выделил речь. Это не оценка твоего английского.").font(.subheadline)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 18) { pauseMetrics }
                    VStack(alignment: .leading, spacing: 12) { pauseMetrics }
                }
                if timing.quality == "limited" {
                    Text("Запись короткая или сигнал ограничен. По ней пока трудно сравнивать темп.").font(.footnote).foregroundStyle(Theme.secondary)
                }
            }
            if let feedback = answer.feedback {
                VStack(alignment: .leading, spacing: 9) {
                    Text(feedback.observation).font(.footnote).fixedSize(horizontal: false, vertical: true)
                    Button {
                        if client.playingLearnerRecording { client.stopSpeaking() }
                        else { Task { await client.playRecording(audioFile: timing.audioFile, startSeconds: max(0, feedback.startSeconds - 0.4), endSeconds: min(timing.durationSeconds, feedback.endSeconds + 0.8)) } }
                    } label: { Label(client.playingLearnerRecording ? "Остановить запись" : "Прослушать этот момент", systemImage: client.playingLearnerRecording ? "stop.fill" : "play.fill") }
                        .buttonStyle(QuietButton()).disabled(client.busy || client.recording || client.microphoneStarting || client.voiceLoading)
                    Text(feedback.practice).font(.footnote).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Text("Пауза сама по себе не ошибка. Разметка не оценивает произношение и не объясняет, почему ты остановился.")
                .font(.caption).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 12) {
                    Text(answer.text).font(.subheadline).textSelection(.enabled)
                    LabeledContent("Детектор выделил речь", value: SpeechTime.seconds(timing.detectedSpeechSeconds) + " с")
                    LabeledContent("До / после ответа", value: SpeechTime.seconds(timing.leadingSilenceSeconds) + " / " + SpeechTime.seconds(timing.trailingSilenceSeconds) + " с")
                    if let pace = timing.displayedPace {
                        LabeledContent("Примерный темп", value: "≈ \(pace.formatted(.number.precision(.fractionLength(0)))) слов/мин")
                        Text("По распознанным словам и отрезку от первой до последней речи, включая внутренние паузы. Распознавание может пропускать слова и повторы. Это не оценка беглости.")
                            .font(.caption).foregroundStyle(Theme.secondary)
                    } else if timing.transcriptEdited {
                        Text("Текст исправлен. Темп по словам не показываем; паузы относятся к оригинальной записи.")
                            .font(.caption).foregroundStyle(Theme.secondary)
                    }
                    ForEach(Array(timing.limitations.enumerated()), id: \.offset) { _, limitation in
                        Text(limitation).font(.caption).foregroundStyle(Theme.secondary)
                    }
                }.font(.footnote).padding(.top, 12)
            } label: { Text("Текст, темп и ограничения").font(.footnote.weight(.medium)) }
        }
    }
    @ViewBuilder private var answerHeader: some View {
        Text(answer.title).font(.subheadline.weight(.semibold))
        if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
        Text(SpeechTime.clock(timing.durationSeconds)).font(.subheadline).monospacedDigit()
            .accessibilityLabel("Длительность записи: \(SpeechTime.seconds(timing.durationSeconds)) секунд")
    }
    @ViewBuilder private var pauseMetrics: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(SpeechTime.seconds(timing.longestPauseSeconds) + " с").font(.title3.weight(.semibold)).monospacedDigit()
            Text("Самая длинная пауза").font(.caption).foregroundStyle(Theme.secondary)
        }
        VStack(alignment: .leading, spacing: 5) {
            Text("\(timing.internalPauseCount)").font(.title3.weight(.semibold)).monospacedDigit()
            Text("Пауз от \(SpeechTime.seconds(timing.pauseThresholdSeconds)) с внутри ответа").font(.caption).foregroundStyle(Theme.secondary)
        }
    }
}

private struct SpeechTimeline: View {
    let timing: SpeechTiming
    var body: some View {
        VStack(spacing: 8) {
            Canvas { context, size in
                for segment in timing.segments {
                    let rect = CGRect(x: size.width * segment.startSeconds / timing.durationSeconds, y: 0,
                        width: size.width * segment.duration / timing.durationSeconds, height: size.height)
                    let color = segment.kind == "speech" ? Theme.lavender : segment.kind == "pause" ? Theme.charcoal.opacity(0.84) : Theme.surface
                    context.fill(Path(rect), with: .color(color))
                }
            }.frame(height: 18).clipShape(Capsule()).accessibilityHidden(true)
            HStack {
                Text("0:00")
                Spacer()
                Text(SpeechTime.clock(timing.durationSeconds))
            }.font(.caption2).monospacedDigit().foregroundStyle(Theme.secondary)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { legend }
                VStack(alignment: .leading, spacing: 6) { legend }
            }.font(.caption).foregroundStyle(Theme.secondary).frame(maxWidth: .infinity, alignment: .leading)
        }.accessibilityElement(children: .ignore)
            .accessibilityLabel("Разметка записи: \(SpeechTime.seconds(timing.detectedSpeechSeconds)) секунд обнаруженной речи, \(timing.internalPauseCount) внутренних пауз от \(SpeechTime.seconds(timing.pauseThresholdSeconds)) секунды.")
    }
    @ViewBuilder private var legend: some View {
        Label { Text("Речь") } icon: { Circle().fill(Theme.lavender).frame(width: 7, height: 7) }
        Label { Text("Паузы") } icon: { Circle().fill(Theme.charcoal.opacity(0.84)).frame(width: 7, height: 7) }
        Label { Text("До / после, короткие промежутки") } icon: { Circle().fill(Theme.surface).frame(width: 7, height: 7) }
    }
}

private enum SpeechTime {
    static func seconds(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(1))) }
    static func clock(_ value: Double) -> String {
        let safe = max(0, Int(value.rounded()))
        return String(format: "%d:%02d", safe / 60, safe % 60)
    }
}
