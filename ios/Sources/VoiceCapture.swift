import Foundation
import AVFoundation

/// One microphone pipeline supplies both the original recording and live PCM.
/// The serial conversion queue preserves every buffer and its order.
final class VoiceCapture {
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "app.ratmirenglish.capture", qos: .userInitiated)
    private var file: AVAudioFile?
    private var converter: AVAudioConverter?
    private var active = false
    private var sequence = 0
    private var samples: Int64 = 0
    var onChunk: ((Int, Data, Double) -> Void)?
    var onFailure: ((String) -> Void)?

    func start(at url: URL) throws {
        var didStart = false
        defer { if !didStart { NativeAudioRoute.deactivate() } }
        try NativeAudioRoute.prepareCapture()
        let input = engine.inputNode
        let source = input.outputFormat(forBus: 0)
        guard source.sampleRate > 0, source.channelCount > 0,
              let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000,
                                         channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: source, to: target) else {
            throw ClientError.message("Микрофон пока недоступен. Проверь подключение наушников и попробуй снова.")
        }
        self.converter = converter
        file = try AVAudioFile(forWriting: url, settings: target.settings,
                               commonFormat: .pcmFormatInt16, interleaved: true)
        active = true; sequence = 0; samples = 0
        input.installTap(onBus: 0, bufferSize: 2048, format: source) { [weak self] buffer, _ in
            guard let self, let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return }
            copy.frameLength = buffer.frameLength
            let from = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
            let to = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
            for index in 0..<from.count {
                guard let sourceData = from[index].mData, let targetData = to[index].mData else { continue }
                let byteCount = min(from[index].mDataByteSize, to[index].mDataByteSize)
                memcpy(targetData, sourceData, Int(byteCount))
                to[index].mDataByteSize = byteCount
            }
            self.queue.async { self.consume(copy, target: target) }
        }
        engine.prepare()
        do { try engine.start(); didStart = true }
        catch { input.removeTap(onBus: 0); active = false; file = nil; throw error }
    }

    private func consume(_ input: AVAudioPCMBuffer, target: AVAudioFormat) {
        guard active, let converter, let file else { return }
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 24000 / input.format.sampleRate) + 16)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var supplied = false
        var conversionError: NSError?
        let result = converter.convert(to: output, error: &conversionError) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return input
        }
        guard result != .error, conversionError == nil,
              output.frameLength > 0, let channel = output.int16ChannelData?[0] else {
            if result == .error { onFailure?("Не удалось записать звук. Запись остановлена, уже записанная часть сохранена.") }
            return
        }
        do {
            try file.write(from: output)
            samples += Int64(output.frameLength)
            var sum = 0.0
            for index in 0..<Int(output.frameLength) {
                let value = Double(channel[index]) / 32768
                sum += value * value
            }
            let rms = sqrt(sum / Double(output.frameLength))
            let level = min(1, max(0, (20 * log10(max(rms, 0.00001)) + 55) / 55))
            let bytes = Data(bytes: channel, count: Int(output.frameLength) * MemoryLayout<Int16>.size)
            onChunk?(sequence, bytes, level)
            sequence += 1
        } catch { onFailure?("Запись не сохранилась. Освободи немного места на iPhone и попробуй снова.") }
    }

    /// Returns actual captured duration, rather than wall time while an OS prompt was open.
    func stop() -> (duration: Double, chunks: Int) {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        let result = queue.sync {
            active = false
            let duration = Double(samples) / 24000
            file = nil; converter = nil
            return (duration, sequence)
        }
        NativeAudioRoute.deactivate()
        return result
    }
}

struct LiveSpeechCredential: Decodable {
    let clientSecret: String
    let expiresAt: Int
    let model: String
    let url: String
    let ticket: String?
}

/// The permanent API key never reaches this client. Credentials exist only in memory.
@MainActor final class LiveTranscriber {
    private var socket: URLSessionWebSocketTask?
    private let serverOrigin: String
    private let network: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        return URLSession(configuration: config)
    }()
    private var receiver: Task<Void, Never>?
    private var sending: Task<Void, Never>?
    private var buffers: [Int: Data] = [:]
    private var nextSequence = 0
    private var pendingBytes = 0
    private var sentBytes = 0
    var streamedMinutes: Double { Double(sentBytes) / 48000 / 60 }
    private var ready = false
    private var failed = false
    private var committing = false
    private var closed = false
    var isClosed: Bool { closed }
    private var finalTranscript: String?
    private var transcript = ""
    var onTranscript: ((String) -> Void)?
    var onState: ((String) -> Void)?

    init(serverOrigin: String) { self.serverOrigin = serverOrigin }

    func connect(_ credential: LiveSpeechCredential) async throws {
        guard !closed else { throw CancellationError() }
        guard credential.model == "gpt-live-transcribe", let url = URL(string: credential.url),
              let trusted = URL(string: serverOrigin), trusted.scheme == "https",
              url.scheme == "wss", url.host == trusted.host, url.port == trusted.port,
              url.path == "/api/audio/live-stream", url.user == nil, url.password == nil,
              url.query == nil, credential.expiresAt > Int(Date().timeIntervalSince1970) else {
            throw ClientError.message("Не удалось подключить живое распознавание. Полная запись всё равно сохранится.")
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer " + credential.clientSecret, forHTTPHeaderField: "Authorization")
        var cookieURL = URLComponents(url: url, resolvingAgainstBaseURL: false)
        cookieURL?.scheme = "https"
        if let httpsURL = cookieURL?.url, let cookies = HTTPCookieStorage.shared.cookies(for: httpsURL) {
            for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) { request.setValue(value, forHTTPHeaderField: name) }
        }
        request.timeoutInterval = 20
        let socket = network.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        receiver = Task { [weak self] in await self?.receiveEvents() }
        try await send(["type": "session.update", "session": ["type": "transcription", "audio": ["input": [
            "format": ["type": "audio/pcm", "rate": 24000],
            "transcription": ["model": "gpt-live-transcribe", "languages": ["en", "ru"], "delay": "low",
                "prompt": "An English learner speaking spontaneously. Preserve fillers such as um, uh and like, repetitions, false starts, unfinished phrases and grammar mistakes. Transcribe what was actually said. Do not correct, translate, summarize or complete their words."],
            "turn_detection": NSNull()
        ]]]])
        guard !closed else { throw CancellationError() }
        ready = true
        onState?("Слушаю. Текст появится по ходу речи.")
        drain()
    }

    func append(sequence: Int, data: Data) {
        guard !closed, !failed, !committing, buffers[sequence] == nil, sequence >= nextSequence else { return }
        buffers[sequence] = data; pendingBytes += data.count
        // File capture remains complete if the connection is stalled. Never pretend a clipped live stream is final.
        if pendingBytes > 960_000 { fail(); return }
        drain()
    }

    private func drain() {
        guard ready, sending == nil, !failed else { return }
        sending = Task { [weak self] in
            guard let self else { return }
            defer { self.sending = nil }
            while !self.failed, let data = self.buffers.removeValue(forKey: self.nextSequence) {
                self.nextSequence += 1; self.pendingBytes -= data.count
                do {
                    try await self.send(["type": "input_audio_buffer.append", "audio": data.base64EncodedString()])
                    self.sentBytes += data.count
                }
                catch { self.fail(); return }
            }
        }
    }

    private func send(_ value: [String: Any]) async throws {
        guard let socket else { throw ClientError.message("Живое распознавание не подключено.") }
        let data = try JSONSerialization.data(withJSONObject: value)
        guard let json = String(data: data, encoding: .utf8) else { return }
        try await socket.send(.string(json))
    }

    private func receiveEvents() async {
        guard let socket else { return }
        do {
            while !Task.isCancelled, !failed {
                let message = try await socket.receive()
                let data: Data
                switch message { case .data(let value): data = value
                case .string(let value): data = Data(value.utf8)
                @unknown default: continue }
                guard let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let type = event["type"] as? String else { continue }
                if type == "conversation.item.input_audio_transcription.delta", let delta = event["delta"] as? String {
                    transcript += delta; onTranscript?(transcript)
                } else if type == "conversation.item.input_audio_transcription.completed", let text = event["transcript"] as? String {
                    if committing { finalTranscript = text }
                    transcript = text; onTranscript?(text)
                } else if type == "error" || type == "conversation.item.input_audio_transcription.failed" {
                    fail(); return
                }
            }
        } catch { if !Task.isCancelled { fail() } }
    }

    func finish(expectedChunks: Int) async -> String? {
        guard !failed, !closed else { close(); return nil }
        // Give the already-started connection a brief chance to flush captured audio.
        for _ in 0..<30 {
            if ready || failed { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard ready, !failed else { close(); return nil }
        // Capture callbacks cross to MainActor asynchronously. Wait for the final numbered buffer too.
        for _ in 0..<40 {
            drain()
            if nextSequence == expectedChunks, buffers.isEmpty, sending == nil { break }
            try? await Task.sleep(for: .milliseconds(25))
        }
        await sending?.value
        committing = true
        guard buffers.isEmpty, nextSequence == expectedChunks, !failed else { close(); return nil }
        do { try await send(["type": "input_audio_buffer.commit"]) }
        catch { close(); return nil }
        for _ in 0..<80 {
            if finalTranscript != nil || failed { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        let text = failed ? nil : finalTranscript
        close()
        return text
    }

    private func fail() {
        failed = true; buffers.removeAll(); pendingBytes = 0
        onState?("Живой текст недоступен. После остановки распознаю полную запись.")
        close()
    }
    func close() {
        closed = true
        receiver?.cancel(); receiver = nil
        sending?.cancel(); sending = nil
        socket?.cancel(with: .normalClosure, reason: nil); socket = nil
        network.invalidateAndCancel()
        buffers.removeAll(); pendingBytes = 0; ready = false
    }
}
