import Foundation
import AVFoundation

/// A finished take on disk (24 kHz mono WAV from VoiceCapture).
struct TaskRecording: Equatable {
    let url: URL
    let duration: Double
}

/// Microphone recorder for placement speaking and roleplay tasks. Uses the same VoiceCapture
/// pipeline (and therefore the same NativeAudioRoute ownership clock) as conversation recording,
/// keeps the take on disk until the server has accepted it, and never edits the transcript.
@MainActor final class TaskRecorder: ObservableObject {
    enum Phase: Equatable { case idle, starting, recording, recorded, uploading, failed }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var permissionDenied = false
    @Published private(set) var take: TaskRecording?
    /// Increments every time a recording stops by itself (time limit, audio failure).
    @Published private(set) var autoStops = 0
    /// Called right after a recording stops by itself (the take is already kept): «Послушать» sends it at once.
    var onAutoStop: (@MainActor () -> Void)?
    @Published var message: String?
    /// Microphone level for the mascot (`MeasuredVoiceOrb(meter:mode: .listening)`); read per frame, never observed.
    let meter = VoiceMeter()

    private var capture: VoiceCapture?
    private var fileURL: URL?
    private var startedAt: Date?
    private var ticker: Task<Void, Never>?
    private var limit: Double = 60
    private var identifier = UUID()

    var isRecording: Bool { phase == .recording }
    var isBusy: Bool { phase == .starting || phase == .recording || phase == .uploading }

    static var microphoneDenied: Bool { AVAudioApplication.shared.recordPermission == .denied }

    /// Starts a take limited to `maxSeconds`. Returns false when the microphone is unavailable.
    @discardableResult func start(maxSeconds: Int, client: TrainingClient) async -> Bool {
        guard phase != .starting, phase != .recording, phase != .uploading else { return false }
        if client.recording || client.microphoneStarting {
            message = "Сначала закончи запись в занятии."
            return false
        }
        discardTake()
        phase = .starting
        message = nil
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            phase = .idle
            permissionDenied = true
            message = "Микрофон выключен для Smooth Talk. Разреши доступ в настройках iPhone или пропусти раздел."
            return false
        }
        permissionDenied = false
        client.stopSpeaking()
        let id = UUID()
        identifier = id
        do {
            let folder = try Self.folder()
            let url = folder.appendingPathComponent(UUID().uuidString + ".wav")
            let capture = VoiceCapture()
            capture.onChunk = { @Sendable [weak self] _, _, chunkLevel in
                guard let recorder = self else { return }
                Task { @MainActor [recorder] in
                    guard recorder.identifier == id, recorder.phase == .recording else { return }
                    recorder.meter.level = recorder.meter.level * 0.35 + chunkLevel * 0.65
                }
            }
            capture.onFailure = { @Sendable [weak self] text in
                guard let recorder = self else { return }
                Task { @MainActor [recorder] in
                    guard recorder.identifier == id, recorder.phase == .recording else { return }
                    recorder.message = text
                    recorder.finish(automatic: true)
                }
            }
            try await capture.start(at: url)
            guard identifier == id, phase == .starting else {
                _ = capture.stop()
                try? FileManager.default.removeItem(at: url)
                return false
            }
            self.capture = capture
            fileURL = url
            startedAt = Date()
            elapsed = 0
            limit = Double(max(5, maxSeconds))
            phase = .recording
            startTicker(id: id)
            return true
        } catch is CancellationError {
            if identifier == id { phase = .idle }
            return false
        } catch {
            if identifier == id {
                phase = .failed
                message = FeatureErrorText.describe(error)
            }
            return false
        }
    }

    /// Stops the take and keeps it for upload.
    @discardableResult func stop() -> TaskRecording? { finish(automatic: false) }

    @discardableResult private func finish(automatic: Bool) -> TaskRecording? {
        guard phase == .recording, let capture, let url = fileURL else { return nil }
        let result = capture.stop()
        self.capture = nil
        fileURL = nil
        ticker?.cancel()
        ticker = nil
        meter.level = 0
        let recording = TaskRecording(url: url, duration: max(0.01, result.duration))
        take = recording
        elapsed = recording.duration
        phase = .recorded
        if automatic {
            autoStops += 1
            onAutoStop?()
        }
        return recording
    }

    /// Uploads the current take to `audio/transcribe` (multipart: minutes, audio) → `{ text, audioFile }`.
    func upload(client: TrainingClient) async throws -> FeatureTranscription {
        guard let take else { throw ClientError.message("Запись не найдена. Запиши ответ ещё раз.") }
        phase = .uploading
        message = nil
        do {
            let result = try await Self.transcribe(take, client: client)
            phase = .recorded
            return result
        } catch {
            phase = .failed
            message = FeatureErrorText.describe(error)
            throw error
        }
    }

    /// Deletes the local take once the server has accepted the answer (or the user discards it).
    func discardTake() {
        if let url = take?.url { try? FileManager.default.removeItem(at: url) }
        take = nil
        elapsed = 0
        if phase == .recorded || phase == .failed { phase = .idle }
    }

    /// Stops any running capture and deletes everything (screen closed, task changed).
    func reset() {
        identifier = UUID()
        if phase == .recording, let capture {
            _ = capture.stop()
            if let fileURL { try? FileManager.default.removeItem(at: fileURL) }
        }
        capture = nil
        fileURL = nil
        ticker?.cancel()
        ticker = nil
        meter.level = 0
        discardTake()
        phase = .idle
        message = nil
    }

    private func startTicker(id: UUID) {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, self.identifier == id, self.phase == .recording, let started = self.startedAt else { return }
                self.elapsed = Date().timeIntervalSince(started)
                if self.elapsed >= self.limit {
                    self.finish(automatic: true)
                    return
                }
                do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
            }
        }
    }

    private static func folder() throws -> URL {
        let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                 appropriateFor: nil, create: true)
            .appendingPathComponent("PlacementRecordings", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Old takes (an interrupted test from another day) are never uploaded again.
        if let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]) {
            let cutoff = Date().addingTimeInterval(-86_400)
            for file in files {
                let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                if let modified, modified < cutoff { try? FileManager.default.removeItem(at: file) }
            }
        }
        return folder
    }

    private static func transcribe(_ take: TaskRecording, client: TrainingClient) async throws -> FeatureTranscription {
        let boundary = "SmoothTalk-" + UUID().uuidString
        var data = Data()
        func append(_ value: String) { data.append(Data(value.utf8)) }
        let minutes = min(8, max(0.01, take.duration / 60))
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"minutes\"\r\n\r\n\(minutes)\r\n")
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
        data.append(try Data(contentsOf: take.url))
        append("\r\n--\(boundary)--\r\n")
        var request = URLRequest(url: try client.endpoint("audio/transcribe"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        let response = try await client.checked(request)
        return try JSONDecoder().decode(FeatureTranscription.self, from: response)
    }
}
