import Foundation
import Security
import AVFoundation
import UserNotifications

enum ClientError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

enum AccessKey {
    private static let service = "app.ratmirenglish.personal"
    static func read() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "server-access",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ value: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "server-access"]
        let data = Data(value.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var create = query
            create[kSecValueData as String] = data
            create[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(create as CFDictionary, nil) == errSecSuccess else {
                throw ClientError.message("Не удалось сохранить доступ в Keychain.")
            }
        } else if status != errSecSuccess { throw ClientError.message("Не удалось обновить Keychain.") }
    }
}

@MainActor final class TrainingClient: ObservableObject {
    @Published var state: TrainingState?
    @Published var conversation: Conversation?
    @Published var status: ServerStatus?
    @Published var busy = false
    @Published var error: String?
    @Published var hint: String?
    @Published var signedIn = false
    @Published var recording = false
    @Published var playing = false
    @Published var draft = ""
    @Published var recordedFile: String?
    @Published var pendingMessageID: String?
    @Published var assistantTextShown = true
    @Published var server = UserDefaults.standard.string(forKey: "training-server") ?? ""
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var recordedAt = Date()
    private var localRecording: URL?
    private var pendingSpeechTurn: String?
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 240
        config.httpCookieStorage = HTTPCookieStorage.shared
        return URLSession(configuration: config)
    }()

    private func endpoint(_ path: String) throws -> URL {
        guard let base = URL(string: server), base.scheme == "https", base.host != nil,
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              base.path.isEmpty || base.path == "/" else {
            throw ClientError.message("Укажи HTTPS-адрес сервера без пути и параметров.")
        }
        return base.appendingPathComponent("api/" + path)
    }
    private func checked(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ClientError.message("Нет ответа сервера.") }
        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw ClientError.message(detail?["error"] as? String ?? "Ошибка сервера (\(http.statusCode)).")
        }
        return data
    }
    private func request<T: Decodable>(_ path: String, body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: try endpoint(path))
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try JSONDecoder().decode(T.self, from: await checked(request))
    }
    func perform(_ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do { try await action() } catch { self.error = error.localizedDescription }
    }
    func login(code: String) async {
        await perform {
            let _: Confirmation = try await request("login", body: ["code": code])
            try AccessKey.save(code)
            UserDefaults.standard.set(server, forKey: "training-server")
            try await refresh()
            signedIn = true
        }
    }
    func restore() async {
        guard !server.isEmpty, let code = AccessKey.read() else { return }
        await login(code: code)
    }
    func refresh() async throws {
        state = try await request("state")
        status = try await request("status")
        if let id = conversation?.id { conversation = state?.sessions.first { $0.id == id } }
    }
    func start(mode: String, context: String) async {
        await perform {
            conversation = try await request("sessions", body: ["mode": mode, "context": context,
                "minutes": state?.profile.dailyMinutes ?? 15])
            draft = ""; hint = nil; recordedFile = nil; pendingMessageID = nil
            assistantTextShown = mode == "learning"
            try await refresh()
        }
    }
    func send(retry: Bool = false) async {
        guard let conversation, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        await perform {
            let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            var body: [String: Any] = ["text": text]
            if let recordedFile { body["audioFile"] = recordedFile }
            if !retry {
                let id = pendingMessageID ?? UUID().uuidString.lowercased()
                pendingMessageID = id
                body["id"] = id
                body["source"] = recordedFile == nil ? "text" : "audio"
                body["textVisible"] = assistantTextShown
            }
            self.conversation = try await request("sessions/\(conversation.id)/\(retry ? "retry" : "message")", body: body)
            draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil
            assistantTextShown = conversation.mode == "learning"
            try await refresh()
        }
    }
    func action(_ name: String) async {
        guard let conversation else { return }
        await perform {
            self.conversation = try await request("sessions/\(conversation.id)/\(name)", body: [:])
            try await refresh()
        }
    }
    func pollReview() async {
        while conversation?.status == "analysing", !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(3))
                guard let id = conversation?.id else { return }
                conversation = try await request("sessions/\(id)")
            } catch is CancellationError { return }
            catch { self.error = error.localizedDescription; return }
        }
    }
    func getHint() async {
        guard let conversation else { return }
        await perform {
            let result: Hint = try await request("sessions/\(conversation.id)/hint", body: ["level": 1])
            hint = result.text
        }
    }
    func revealText() async {
        await action("show-text")
        if error == nil { assistantTextShown = true }
    }
    func speak() async {
        guard let conversation, let turn = conversation.turns.last(where: { $0.role == "assistant" }) else { return }
        await perform {
            let speech: Speech = try await request("sessions/\(conversation.id)/speech", body: ["turnId": turn.id])
            let data = try await checked(URLRequest(url: endpoint("audio/\(speech.file)")))
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            player = try AVAudioPlayer(data: data)
            guard player?.play() == true else { throw ClientError.message("Не удалось начать озвучку.") }
            playing = true
            let _: Confirmation = try await request("sessions/\(conversation.id)/played", body: ["turnId": turn.id])
            let duration = player?.duration ?? 0
            Task { try? await Task.sleep(for: .seconds(duration)); self.playing = false }
        }
    }
    func beginRecording() async {
        guard !busy, !recording else { return }
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else { error = "Разреши микрофон в настройках iPhone."; return }
        do {
            player?.stop(); playing = false
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try audio.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
            recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
            guard recorder?.record(forDuration: 590) == true else { throw ClientError.message("Запись не началась.") }
            localRecording = url; recordedAt = Date(); recording = true; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func stopRecording() async {
        recorder?.stop(); recording = false
        await transcribeRecording()
    }
    func transcribeRecording() async {
        guard let url = localRecording else { return }
        await perform {
            let boundary = "English-" + UUID().uuidString
            var data = Data()
            func append(_ value: String) { data.append(Data(value.utf8)) }
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"minutes\"\r\n\r\n\(max(0.01, min(9.9, Date().timeIntervalSince(recordedAt) / 60)))\r\n")
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"speech.mp4\"\r\nContent-Type: audio/mp4\r\n\r\n")
            data.append(try Data(contentsOf: url))
            append("\r\n--\(boundary)--\r\n")
            var upload = URLRequest(url: try endpoint("transcribe"))
            upload.httpMethod = "POST"
            upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            upload.httpBody = data
            let result = try JSONDecoder().decode(Transcription.self, from: await checked(upload))
            draft = result.text; recordedFile = result.audioFile
            try? FileManager.default.removeItem(at: url)
            localRecording = nil
        }
    }
    func remindAt19() async {
        await perform {
            let center = UNUserNotificationCenter.current()
            guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else {
                throw ClientError.message("Уведомления отключены. Их можно разрешить в настройках iPhone.")
            }
            let content = UNMutableNotificationContent()
            content.title = "Твои 15 минут английского"
            content.body = "Один разговор сегодня. Начни с первой реплики."
            content.sound = .default
            try await center.add(UNNotificationRequest(identifier: "daily-practice", content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: 19), repeats: true)))
        }
    }
}
