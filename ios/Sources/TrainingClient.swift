import Foundation
import Security
import AVFoundation
import UserNotifications
import UIKit

enum ClientError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

private final class PlaybackDelegate: NSObject, AVAudioPlayerDelegate {
    let finished: (Bool) -> Void
    init(finished: @escaping (Bool) -> Void) { self.finished = finished }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { finished(flag) }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) { finished(false) }
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

@MainActor final class VoiceMeter: ObservableObject {
    @Published var level = 0.0
}

@MainActor final class TrainingClient: ObservableObject {
#if DEBUG
    var previewMode = false
#endif
    @Published var state: TrainingState?
    @Published var conversation: Conversation?
    @Published var status: ServerStatus?
    @Published var subscriptionUsage: SubscriptionUsage?
    @Published var busy = false
    @Published var error: String?
    @Published var hint: String?
    @Published var signedIn = false
    @Published var recording = false
    @Published var microphoneStarting = false
    @Published var playing = false
    @Published var playingLearnerRecording = false
    @Published var draft = ""
    @Published var recordedFile: String?
    @Published var pendingMessageID: String?
    @Published var assistantTextShown = true
    @Published var conversationPresented = false
    let voiceMeter = VoiceMeter()
    var audioLevel: Double {
        get { voiceMeter.level }
        set { voiceMeter.level = newValue }
    }
    @Published var liveTranscript = ""
    @Published var liveTranscriptStatus = ""
    @Published var voiceLoading = false
    @Published private(set) var playbackAcknowledgementTurn: String?
    @Published var operationStage: String?
    @Published var operationStartedAt: Date?
    @Published var reviewStartedAt: Date?
    @Published var notificationState = "notDetermined"
    @Published var reminderEnabled = false
    @Published var reminderHour = 19
    @Published var reminderMinute = 0
    @Published var reminderBusy = false
    @Published var reminderTestMessage: String?
    @Published var reminderDiagnostic: String?
    @Published var hasUnuploadedRecording = false
    @Published var orphanedRecording = false
    @Published var originalTranscript = ""
    @Published var server = UserDefaults.standard.string(forKey: "training-server") ?? ""
    private var capture: VoiceCapture?
    private var liveTranscriber: LiveTranscriber?
    private var liveConnection: Task<Void, Never>?
    private var recordingLimit: Task<Void, Never>?
    private var player: AVAudioPlayer?
    private var playbackDelegate: PlaybackDelegate?
    private var recordedMinutes = 0.01
    private var localRecording: URL?
    private var pendingSpeechTurn: String?
    private var heardTurns = Set<String>()
    private var pendingPlaybackAcknowledgements: [String: String] = [:]
    private var voiceGeneration = UUID()
    private var speechTask: Task<Void, Never>?
    private var meterTask: Task<Void, Never>?
    private var interrupted: NSObjectProtocol?
    private var liveFinalText: String?
    private var liveSessionID: String?
    private var liveMinutes = 0.0
    private var recordingID = UUID()
    private var startRequestID: String?
    private var startRequestIntent: String?
    private struct DraftSnapshot {
        let text: String
        let file: String?
        let pendingID: String?
        let transcript: String
        let liveText: String
    }
    private var savedDrafts: [String: DraftSnapshot] = [:]
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 240
        config.httpCookieStorage = HTTPCookieStorage.shared
        return URLSession(configuration: config)
    }()

    init() {
        UNUserNotificationCenter.current().delegate = ReminderPresentation.shared
        interrupted = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
            object: nil, queue: .main) { [weak self] notification in
                guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      type == AVAudioSession.InterruptionType.began.rawValue else { return }
                guard let client = self else { return }
                Task { @MainActor [client] in
                    client.stopSpeaking()
                    if client.recording { await client.stopRecording() }
                }
            }
    }

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
    func perform(stage: String? = nil, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true; error = nil; operationStage = stage; operationStartedAt = Date()
        defer { busy = false; operationStage = nil; operationStartedAt = nil }
        do { try await action() } catch { self.error = error.localizedDescription }
    }
    func login(code: String) async {
        await perform(stage: "Подключаю твой профиль") {
            let _: Confirmation = try await request("login", body: ["code": code])
            try AccessKey.save(code)
            UserDefaults.standard.set(server, forKey: "training-server")
            try await refresh()
            signedIn = true
            recoverPendingRecording()
            await refreshReminderStatus()
        }
    }
    func restore() async {
        guard !server.isEmpty, let code = AccessKey.read() else { return }
        await login(code: code)
    }
    private func recoverPendingRecording() {
        guard localRecording == nil, let path = UserDefaults.standard.string(forKey: "pending-recording-path"),
              let folder = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                  appropriateFor: nil, create: false).appendingPathComponent("Recordings", isDirectory: true) else { return }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.deletingLastPathComponent() == folder.standardizedFileURL,
              FileManager.default.fileExists(atPath: url.path) else { return }
        localRecording = url; hasUnuploadedRecording = true
        if let audio = try? AVAudioFile(forReading: url) {
            recordedMinutes = max(0.01, min(8, Double(audio.length) / audio.processingFormat.sampleRate / 60))
        } else {
            recordedMinutes = max(0.01, UserDefaults.standard.double(forKey: "pending-recording-minutes"))
        }
        if let id = UserDefaults.standard.string(forKey: "pending-recording-session"), conversation == nil {
            conversation = state?.sessions.first { $0.id == id }
        }
        orphanedRecording = conversation == nil
        liveTranscriptStatus = orphanedRecording
            ? "На iPhone осталась запись старого занятия. Она не попадёт в новую диагностику."
            : "На iPhone сохранилась предыдущая запись. Можно повторить распознавание."
    }
    private func clearPendingRecording() {
        for key in ["pending-recording-path", "pending-recording-session", "pending-recording-minutes"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
    func refresh() async throws {
        async let updatedState: TrainingState = request("state")
        async let updatedStatus: ServerStatus = request("status")
        async let updatedUsage: SubscriptionUsage? = try? request("usage")
        (state, status, subscriptionUsage) = try await (updatedState, updatedStatus, updatedUsage)
        if let id = conversation?.id {
            let updated = state?.sessions.first { $0.id == id }
            if updated == nil {
                stopSpeaking(); conversationPresented = false
                savedDrafts.removeAll(); draft = ""; recordedFile = nil; pendingMessageID = nil
                originalTranscript = ""; liveTranscript = ""
                orphanedRecording = hasUnuploadedRecording
            }
            conversation = updated
        }
    }
    func resume(_ value: Conversation) {
        if hasUnuploadedRecording, orphanedRecording {
            error = "Старая запись не связана с доступным занятием. Прослушай её и явно удали перед переходом к другому разговору."; return
        }
        if hasUnuploadedRecording, let currentID = conversation?.id, currentID != value.id {
            error = "В текущем занятии есть несохранённая запись. Сначала повтори её распознавание или явно удали запись."; return
        }
        stopSpeaking()
        if let id = conversation?.id {
            savedDrafts[id] = DraftSnapshot(text: draft, file: recordedFile, pendingID: pendingMessageID,
                transcript: originalTranscript, liveText: liveTranscript)
        }
        conversation = value
        playbackAcknowledgementTurn = pendingPlaybackAcknowledgements[value.id]
        conversationPresented = true
        assistantTextShown = value.mode == "learning"
        hint = nil
        let saved = savedDrafts[value.id]
        draft = saved?.text ?? ""; pendingMessageID = saved?.pendingID; recordedFile = saved?.file
        originalTranscript = saved?.transcript ?? ""; liveTranscript = saved?.liveText ?? ""
        if draft.isEmpty, pendingMessageID == nil, value.status == "active" || value.status == "error",
           let last = value.turns.last, last.role == "user" {
            draft = last.text; pendingMessageID = last.id; recordedFile = last.audioFile
        }
        autoSpeakLatest()
    }
    func minimizeConversation() {
        guard !recording else { return }
        stopSpeaking()
        conversationPresented = false
    }
    func start(mode: String, context: String, forceNew: Bool = false) async {
        guard !hasUnuploadedRecording else {
            error = "Сначала сохрани текущую запись: вернись к занятию и повтори распознавание. Или явно удали запись, если она больше не нужна."; return
        }
        await perform(stage: "Выбираю ситуацию для разговора") {
            let shouldResume = !forceNew && conversation != nil
            let intent = "\(mode)|\(context)|\(shouldResume)|\(shouldResume ? conversation?.id ?? "" : "")"
            if startRequestID == nil || startRequestIntent != intent {
                startRequestID = UUID().uuidString.lowercased(); startRequestIntent = intent
            }
            var body: [String: Any] = ["mode": mode, "context": context,
                "intent": shouldResume ? "resume" : "new", "minutes": state?.profile.dailyMinutes ?? 15,
                "requestId": startRequestID!]
            if shouldResume, let id = conversation?.id { body["sessionId"] = id }
            let value: Conversation = try await request("sessions", body: body)
            startRequestID = nil
            resume(value)
            try await refresh()
        }
    }
    func completeIntroduction(russianControl: String) async {
        await perform(stage: "Сохраняю знакомство") {
            let _: OnboardingState = try await request("onboarding/intro", body: ["confirmed": true, "russianControl": russianControl])
            try await refresh()
        }
    }
    func startBaseline(_ step: BaselineStep, retake: Bool = false) async {
        guard !hasUnuploadedRecording else {
            error = "На iPhone осталась несохранённая запись. Сначала прослушай и явно удали её, если она больше не нужна."; return
        }
        if !retake, let id = step.sessionId, let saved = state?.sessions.first(where: { $0.id == id }) {
            resume(saved); return
        }
        await perform(stage: "Готовлю первую пробу") {
            let intent = "baseline|\(step.id)|\(retake)"
            if startRequestID == nil || startRequestIntent != intent {
                startRequestID = UUID().uuidString.lowercased(); startRequestIntent = intent
            }
            let value: Conversation = try await request("sessions", body: ["baselineStepId": step.id, "mode": "call", "intent": "new", "requestId": startRequestID!])
            startRequestID = nil; startRequestIntent = nil
            resume(value)
            try await refresh()
        }
    }
    func buildBaselineReport() async {
        await perform(stage: "Собираю твой стартовый профиль") {
            let _: OnboardingState = try await request("onboarding/report", body: [:])
            try await refresh()
        }
    }
    func send(retry: Bool = false) async {
        guard let conversation, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        stopSpeaking()
        await perform(stage: retry ? "Проверяю твою новую попытку" : "Собеседник отвечает") {
            let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
            var body: [String: Any] = ["text": text]
            if let recordedFile { body["audioFile"] = recordedFile }
            if !originalTranscript.isEmpty { body["originalTranscript"] = originalTranscript }
            if retry {
                let id = pendingMessageID ?? UUID().uuidString.lowercased()
                pendingMessageID = id; body["id"] = id
            }
            if !retry {
                let id = pendingMessageID ?? UUID().uuidString.lowercased()
                pendingMessageID = id
                body["id"] = id
                body["source"] = recordedFile == nil ? "text" : "audio"
                body["textVisible"] = assistantTextShown
            }
            self.conversation = try await request("sessions/\(conversation.id)/\(retry ? "retry" : "message")", body: body)
            draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil; originalTranscript = ""; liveTranscript = ""
            savedDrafts.removeValue(forKey: conversation.id)
            assistantTextShown = conversation.mode == "learning"
            try await refresh()
            autoSpeakLatest()
        }
    }
    func action(_ name: String, deferRetry: Bool = false) async {
        guard let conversation else { return }
        if name == "finish" || name == "complete" {
            if hasUnuploadedRecording {
                error = "Сначала сохрани последнюю запись: повтори распознавание или явно удали её, если она не нужна."; return
            }
            if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || recordedFile != nil {
                error = "Последний ответ ещё не отправлен. Отправь его или явно удали черновик перед завершением."; return
            }
        }
        stopSpeaking()
        await perform(stage: name == "complete" ? "Сохраняю результат" : name == "finish" ? "Передаю разговор на разбор" : "Обновляю занятие") {
            self.conversation = try await request("sessions/\(conversation.id)/\(name)", body: deferRetry ? ["deferRetry": true] : [:])
            try await refresh()
            if self.conversation?.status == "analysing" { reviewStartedAt = Date() }
        }
    }
    func pollReview() async {
#if DEBUG
        if previewMode { return }
#endif
        while conversation?.status == "analysing" || conversation?.processing != nil, !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(3))
                guard let id = conversation?.id else { return }
                let value: Conversation = try await request("sessions/\(id)")
                guard conversation?.id == id else { return }
                conversation = value
                if value.processing == nil, value.status != "analysing" {
                    try? await refresh()
                    autoSpeakLatest()
                }
            } catch is CancellationError { return }
            catch { self.error = error.localizedDescription; return }
        }
    }
    func getHint() async {
        guard let conversation else { return }
        await perform(stage: "Подбираю опору для ответа") {
            let result: Hint = try await request("sessions/\(conversation.id)/hint", body: ["level": 1])
            hint = result.text
        }
    }
    func revealText() async {
        await action("show-text")
        if error == nil { assistantTextShown = true }
    }
    private func autoSpeakLatest() {
        guard conversationPresented, let conversation, conversation.status == "active",
              let turn = conversation.turns.last, turn.role == "assistant",
              !heardTurns.contains(turn.id), pendingSpeechTurn != turn.id, !recording, !microphoneStarting,
              !hasUnuploadedRecording, recordedFile == nil,
              draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        speechTask = Task { [weak self] in
            guard let self else { return }
            await self.speak()
        }
    }

    /// Playback has its own loading state. Speech fetching never locks the record/finish buttons.
    func speak() async {
        guard !recording, !microphoneStarting, !hasUnuploadedRecording,
              let conversation, let turn = conversation.turns.last(where: { $0.role == "assistant" }) else { return }
        if pendingPlaybackAcknowledgements[conversation.id] == turn.id {
            await retryPlaybackAcknowledgement(); return
        }
        if pendingSpeechTurn == turn.id, voiceLoading || playing { return }
        resetPlayback(cancelLoading: false)
        let generation = voiceGeneration
        pendingSpeechTurn = turn.id; voiceLoading = true
        defer { if generation == voiceGeneration { voiceLoading = false } }
        do {
            let speech: Speech = try await request("sessions/\(conversation.id)/speech", body: ["turnId": turn.id])
            let data = try await checked(URLRequest(url: endpoint("audio/\(speech.file)")))
            guard generation == voiceGeneration, !recording, self.conversation?.id == conversation.id, !Task.isCancelled else { return }
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            player = try AVAudioPlayer(data: data)
            player?.isMeteringEnabled = true
            playbackDelegate = PlaybackDelegate { [weak self] completed in
                guard let client = self else { return }
                Task { @MainActor [client] in
                    guard generation == client.voiceGeneration else { return }
                    client.playing = false; client.playingLearnerRecording = false; client.audioLevel = 0; client.pendingSpeechTurn = nil
                    client.meterTask?.cancel(); client.meterTask = nil
                    guard completed else { client.error = "Озвучка прервалась. Нажми «Слушать» ещё раз."; return }
                    client.heardTurns.insert(turn.id)
                    await client.savePlaybackAcknowledgement(sessionID: conversation.id, turnID: turn.id)
                }
            }
            player?.delegate = playbackDelegate
            player?.prepareToPlay()
            guard player?.play() == true else { throw ClientError.message("Не удалось начать озвучку. Проверь громкость и попробуй снова.") }
            playing = true; playingLearnerRecording = false
            startPlaybackMeter()
        } catch is CancellationError { }
        catch {
            guard generation == voiceGeneration else { return }
            pendingSpeechTurn = nil
            self.error = "Не удалось озвучить реплику. Текст сохранён; можно повторить кнопкой «Слушать». " + error.localizedDescription
        }
    }

    var needsPlaybackAcknowledgement: Bool {
        guard let conversation, let turn = conversation.turns.last(where: { $0.role == "assistant" }) else { return false }
        return pendingPlaybackAcknowledgements[conversation.id] == turn.id
    }
    func retryPlaybackAcknowledgement() async {
        guard !recording, !microphoneStarting, !voiceLoading, let conversation,
              let turnID = pendingPlaybackAcknowledgements[conversation.id] else { return }
        let generation = voiceGeneration
        voiceLoading = true
        defer { if generation == voiceGeneration { voiceLoading = false } }
        await savePlaybackAcknowledgement(sessionID: conversation.id, turnID: turnID)
    }
    private func savePlaybackAcknowledgement(sessionID: String, turnID: String) async {
        do {
            let response: Confirmation = try await request("sessions/\(sessionID)/played", body: ["turnId": turnID])
            guard response.ok else { throw ClientError.message("Сервер не подтвердил прослушивание.") }
            if pendingPlaybackAcknowledgements[sessionID] == turnID { pendingPlaybackAcknowledgements.removeValue(forKey: sessionID) }
            if conversation?.id == sessionID { playbackAcknowledgementTurn = nil }
        } catch {
            pendingPlaybackAcknowledgements[sessionID] = turnID
            if conversation?.id == sessionID {
                playbackAcknowledgementTurn = turnID
                self.error = "Реплика прозвучала, но отметка не сохранилась. Нажми «Сохранить прослушивание»: повторная озвучка не нужна."
            }
        }
    }

    func stopSpeaking() {
        resetPlayback(cancelLoading: true)
    }
    private func resetPlayback(cancelLoading: Bool) {
        voiceGeneration = UUID()
        if cancelLoading { speechTask?.cancel(); speechTask = nil }
        meterTask?.cancel(); meterTask = nil
        player?.stop(); player = nil; playbackDelegate = nil
        playing = false; playingLearnerRecording = false; voiceLoading = false; audioLevel = 0; pendingSpeechTurn = nil
    }
    private func startPlaybackMeter() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.playing, let player = self.player else { return }
                player.updateMeters()
                self.audioLevel = min(1, max(0, Double((player.averagePower(forChannel: 0) + 55) / 55)))
                do { try await Task.sleep(for: .milliseconds(40)) } catch { return }
            }
        }
    }
    func playRecording() async {
        guard !recording else { return }
        stopSpeaking()
        let generation = voiceGeneration
        voiceLoading = true
        defer { if generation == voiceGeneration { voiceLoading = false } }
        do {
            let data: Data
            if let url = localRecording { data = try Data(contentsOf: url) }
            else if let recordedFile { data = try await checked(URLRequest(url: endpoint("audio/\(recordedFile)"))) }
            else { return }
            guard generation == voiceGeneration, !recording else { return }
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio); try audio.setActive(true)
            player = try AVAudioPlayer(data: data); player?.isMeteringEnabled = true
            playbackDelegate = PlaybackDelegate { [weak self] _ in
                guard let client = self else { return }
                Task { @MainActor [client] in
                    guard generation == client.voiceGeneration else { return }
                    client.playing = false; client.playingLearnerRecording = false; client.audioLevel = 0; client.meterTask?.cancel()
                }
            }
            player?.delegate = playbackDelegate
            guard player?.play() == true else { throw ClientError.message("Не удалось прослушать запись.") }
            playing = true; playingLearnerRecording = true; startPlaybackMeter()
        } catch { if generation == voiceGeneration { self.error = error.localizedDescription } }
    }

    func beginRecording() async {
        guard !busy, !recording, !microphoneStarting else { return }
        guard localRecording == nil else {
            error = "Предыдущая запись ещё не сохранилась на сервере. Повтори распознавание или явно удали её перед новой записью."; return
        }
        guard recordedFile == nil, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Последний ответ ещё не отправлен. Отправь его или явно очисти черновик перед новой записью."; return
        }
        microphoneStarting = true
        let currentSession = conversation?.id
        defer { microphoneStarting = false }
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else { error = "Микрофон отключён. Открой настройки Ratmir English и разреши доступ."; return }
        guard !busy, conversationPresented, conversation?.id == currentSession else { return }
        do {
            stopSpeaking()
            let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true).appendingPathComponent("Recordings", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(UUID().uuidString + ".wav")
            let identifier = UUID(); recordingID = identifier
            let live = LiveTranscriber(serverOrigin: server)
            live.onTranscript = { [weak self] text in
                guard self?.recordingID == identifier else { return }
                self?.liveTranscript = text
            }
            live.onState = { [weak self] text in
                guard self?.recordingID == identifier else { return }
                self?.liveTranscriptStatus = text
            }
            let capture = VoiceCapture()
            capture.onChunk = { [weak self, weak live] sequence, bytes, level in
                guard let client = self, let transcriber = live else { return }
                Task { @MainActor [client, transcriber] in
                    guard client.recordingID == identifier else { return }
                    if client.recording { client.audioLevel = client.audioLevel * 0.35 + level * 0.65 }
                    transcriber.append(sequence: sequence, data: bytes)
                }
            }
            capture.onFailure = { [weak self] message in
                guard let client = self else { return }
                Task { @MainActor [client] in
                    guard client.recordingID == identifier, client.recording else { return }
                    await client.stopRecording(); client.error = message
                }
            }
            try capture.start(at: url)
            self.capture = capture; liveTranscriber = live
            localRecording = url; recording = true; error = nil
            UserDefaults.standard.set(url.path, forKey: "pending-recording-path")
            UserDefaults.standard.set(conversation?.id, forKey: "pending-recording-session")
            UserDefaults.standard.set(0.01, forKey: "pending-recording-minutes")
            hasUnuploadedRecording = true; liveTranscript = ""; originalTranscript = ""; liveFinalText = nil; liveSessionID = nil; liveMinutes = 0
            liveTranscriptStatus = "Запись идёт. Подключаю живой текст…"
            liveConnection = Task { [weak self, weak live] in
                guard let self, let live else { return }
                do {
                    let credential: LiveSpeechCredential = try await self.request("audio/live-session", body: [:])
                    guard self.recordingID == identifier, !Task.isCancelled, !live.isClosed else {
                        if let ticket = credential.ticket {
                            let _: Confirmation? = try? await self.request("audio/live-session-close", body: ["ticket": ticket, "minutes": 0])
                        }
                        return
                    }
                    self.liveSessionID = credential.ticket
                    try await live.connect(credential)
                } catch {
                    guard self.recordingID == identifier, !Task.isCancelled else { return }
                    self.liveTranscriptStatus = "Живой текст недоступен. После остановки распознаю полную запись."
                    live.close()
                }
            }
            recordingLimit = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(480)) } catch { return }
                guard let self, self.recordingID == identifier, self.recording else { return }
                self.recordingLimit = nil
                await self.stopRecording()
            }
        } catch { self.error = error.localizedDescription }
    }
    func stopRecording() async {
        guard recording, let capture else { return }
        let result = capture.stop(); self.capture = nil
        recording = false; audioLevel = 0; recordingLimit?.cancel(); recordingLimit = nil
        recordedMinutes = max(0.01, min(8, result.duration / 60))
        UserDefaults.standard.set(recordedMinutes, forKey: "pending-recording-minutes")
        await perform(stage: "Сохраняю запись и проверяю текст") {
            liveFinalText = await liveTranscriber?.finish(expectedChunks: result.chunks)
            liveMinutes = liveTranscriber?.streamedMinutes ?? 0
            // A short credential response may still arrive after live fallback. Let it
            // finish so its known reservation is released, rather than losing the ticket.
            liveConnection = nil; liveTranscriber = nil
            operationStage = liveFinalText == nil ? "Распознаю полную запись" : "Сохраняю оригинал записи"
            try await uploadRecording()
        }
    }
    func transcribeRecording() async {
        guard !orphanedRecording else { error = "Запись относится к удалённому занятию. Прослушай её и удали перед новой диагностикой."; return }
        guard localRecording != nil, !recording else { return }
        await perform(stage: "Повторяю распознавание записи") { try await uploadRecording() }
    }
    private func uploadRecording() async throws {
        guard let url = localRecording else { return }
        let boundary = "English-" + UUID().uuidString
        var data = Data()
        func append(_ value: String) { data.append(Data(value.utf8)) }
        func field(_ name: String, _ value: String) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        field("minutes", String(recordedMinutes))
        if let liveFinalText, !liveFinalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            field("liveText", liveFinalText); field("liveFinal", "true")
        }
        if let liveSessionID { field("liveSessionId", liveSessionID); field("liveMinutes", String(liveMinutes)) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
        data.append(try Data(contentsOf: url)); append("\r\n--\(boundary)--\r\n")
        var upload = URLRequest(url: try endpoint("transcribe"))
        upload.httpMethod = "POST"
        upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        upload.httpBody = data
        let result = try JSONDecoder().decode(Transcription.self, from: await checked(upload))
        draft = result.text; originalTranscript = result.text; recordedFile = result.audioFile
        try? FileManager.default.removeItem(at: url)
        localRecording = nil; hasUnuploadedRecording = false
        clearPendingRecording()
        liveTranscriptStatus = "Проверь текст по оригинальной записи перед отправкой."
    }
    func discardRecording() {
        guard !busy, !recording else { return }
        if let ticket = liveSessionID {
            let minutes = liveMinutes
            Task { [weak self] in
                guard let self else { return }
                let _: Confirmation? = try? await self.request("audio/live-session-close", body: ["ticket": ticket, "minutes": minutes])
            }
        }
        if let url = localRecording { try? FileManager.default.removeItem(at: url) }
        localRecording = nil; hasUnuploadedRecording = false; orphanedRecording = false; recordedFile = nil
        clearPendingRecording()
        liveFinalText = nil; liveSessionID = nil; liveTranscript = ""; originalTranscript = ""; draft = ""
    }

    func refreshReminderStatus() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: notificationState = "notDetermined"
        case .denied: notificationState = "denied"
        case .authorized: notificationState = "authorized"
        case .provisional: notificationState = "provisional"
        case .ephemeral: notificationState = "provisional"
        @unknown default: notificationState = "unavailable"
        }
        let pending = await center.pendingNotificationRequests()
        let reminder = pending.first { $0.identifier == "daily-practice" }
        reminderEnabled = reminder != nil && (settings.authorizationStatus == .authorized
            || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral)
        if let calendar = reminder?.trigger as? UNCalendarNotificationTrigger {
            reminderHour = calendar.dateComponents.hour ?? 19
            reminderMinute = calendar.dateComponents.minute ?? 0
        }
    }
    func remindAt19() async { await scheduleReminder(hour: 19, minute: 0) }
    func scheduleReminder(hour: Int, minute: Int) async {
        guard !reminderBusy else { return }
        reminderBusy = true; error = nil
        defer { reminderBusy = false }
        let center = UNUserNotificationCenter.current()
        do {
            var settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = try await center.requestAuthorization(options: [.alert, .sound])
                settings = await center.notificationSettings()
            }
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                await refreshReminderStatus()
                throw ClientError.message("iPhone не разрешил уведомления. Открой настройки Ratmir English, включи «Допуск уведомлений» и вернись сюда.")
            }
            let content = UNMutableNotificationContent()
            content.title = "Есть 15 минут?"
            content.body = "Давай одну ситуацию на английском. Начнём с короткого ответа."
            content.sound = .default
            let hour = min(23, max(0, hour)); let minute = min(59, max(0, minute))
            try await center.add(UNNotificationRequest(identifier: "daily-practice", content: content,
                trigger: UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: hour, minute: minute), repeats: true)))
            await refreshReminderStatus()
            guard reminderEnabled else {
                throw ClientError.message("iPhone не сохранил напоминание. Проверь разрешение на уведомления в настройках приложения и попробуй ещё раз.")
            }
            reminderDiagnostic = nil
        } catch let error as ClientError {
            let authorized = await snapshotReminderFailure(nil, identifier: "daily-practice", kind: "daily-calendar")
            self.error = authorized
                ? "Разрешение включено, но напоминание не появилось в очереди iPhone. Состояние сохранено в диагностике ниже."
                : error.localizedDescription
        }
        catch {
            await refreshReminderStatus()
            let authorized = await snapshotReminderFailure(error, identifier: "daily-practice", kind: "daily-calendar")
            self.error = authorized
                ? "Разрешение на уведомления включено, но iPhone отклонил напоминание. Подробности сохранены в диагностике ниже."
                : "iPhone не разрешил сохранить напоминание. Открой настройки Ratmir English и проверь «Уведомления»."
        }
    }
    func disableReminder() async {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["daily-practice"])
        await refreshReminderStatus()
    }
    func testReminder() async {
        guard !reminderBusy else { return }
        reminderBusy = true; error = nil; reminderTestMessage = nil
        defer { reminderBusy = false }
        let center = UNUserNotificationCenter.current()
        do {
            var settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                _ = try await center.requestAuthorization(options: [.alert, .sound])
                settings = await center.notificationSettings()
            }
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                await refreshReminderStatus()
                _ = await snapshotReminderFailure(nil, identifier: "practice-reminder-test", kind: "test-interval")
                reminderTestMessage = "Уведомления не разрешены. Открой настройки Ratmir English и включи «Допуск уведомлений»."
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "Проверка напоминания"
            content.body = "Если видишь это сообщение, уведомления Ratmir English доходят до iPhone."
            content.sound = .default
            let identifier = "practice-reminder-test"
            try await center.add(UNNotificationRequest(identifier: identifier, content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 10, repeats: false)))
            let pending = await center.pendingNotificationRequests()
            await refreshReminderStatus()
            guard pending.contains(where: { $0.identifier == identifier }) else {
                let authorized = await snapshotReminderFailure(nil, identifier: identifier, kind: "test-interval")
                reminderTestMessage = authorized
                    ? "Разрешение включено, но проверочное уведомление не появилось в очереди iPhone. Открой диагностику ниже и повтори тест."
                    : "iPhone не разрешил проверочное уведомление. Проверь уведомления в настройках приложения."
                return
            }
            reminderDiagnostic = nil
            reminderTestMessage = settings.authorizationStatus == .provisional
                ? "Проверка запланирована на 10 секунд. Сверни приложение и открой Центр уведомлений: при тихом разрешении баннер может не появиться."
                : "Проверка запланирована на 10 секунд. Сверни приложение и проверь уведомление. Его показ зависит от настроек iPhone и режима фокусирования."
        } catch {
            await refreshReminderStatus()
            let authorized = await snapshotReminderFailure(error, identifier: "practice-reminder-test", kind: "test-interval")
            reminderTestMessage = authorized
                ? "Разрешение включено, но iPhone отклонил проверочное уведомление. Открой диагностику ниже: она поможет разобраться с регистрацией приложения."
                : "iPhone не разрешил сохранить проверочное уведомление. Проверь «Уведомления» в настройках Ratmir English."
        }
    }
    /// Local, user-visible diagnostics only. No error descriptions, userInfo dump, keys or remote logging.
    private func snapshotReminderFailure(_ failure: Error?, identifier: String, kind: String) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications()
        let request = pending.first { $0.identifier == identifier }
        func setting(_ value: UNNotificationSetting) -> String {
            switch value {
            case .enabled: return "enabled"
            case .disabled: return "disabled"
            case .notSupported: return "notSupported"
            @unknown default: return "unknown(\(value.rawValue))"
            }
        }
        let authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        var lines = [
            "Checked: \(ISO8601DateFormatter().string(from: Date()))",
            "Bundle: \(Bundle.main.bundleIdentifier ?? "unknown")",
            "App: \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown") / \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown")",
            "iOS: \(UIDevice.current.systemVersion)",
            "Request: \(kind)",
            "Authorization raw value: \(settings.authorizationStatus.rawValue)",
            "Scheduling authorized: \(authorized)",
            "Alert: \(setting(settings.alertSetting)); sound: \(setting(settings.soundSetting)); badge: \(setting(settings.badgeSetting))",
            "Notification center: \(setting(settings.notificationCenterSetting)); lock screen: \(setting(settings.lockScreenSetting))",
            "Pending count: \(pending.count); requested identifier present: \(request != nil)",
            "Delivered and still in Notification Center: \(delivered.count); requested identifier present: \(delivered.contains { $0.request.identifier == identifier })"
        ]
        let next: Date?
        if let trigger = request?.trigger as? UNCalendarNotificationTrigger { next = trigger.nextTriggerDate() }
        else if let trigger = request?.trigger as? UNTimeIntervalNotificationTrigger { next = trigger.nextTriggerDate() }
        else { next = nil }
        if let next {
            lines.append("Saved next trigger: \(ISO8601DateFormatter().string(from: next))")
        } else { lines.append("Saved next trigger: none") }
        if let failure {
            let native = failure as NSError
            lines.append("Error: \(native.domain) / \(native.code)")
            if let underlying = native.userInfo[NSUnderlyingErrorKey] as? NSError {
                lines.append("Underlying: \(underlying.domain) / \(underlying.code)")
            }
        } else { lines.append("Error: no NSError; authorization or pending-request verification failed") }
        reminderDiagnostic = lines.joined(separator: "\n")
        return authorized
    }
    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

private final class ReminderPresentation: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderPresentation()
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
