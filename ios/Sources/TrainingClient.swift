import Foundation
import Security
import AVFoundation
import UserNotifications
import UIKit

enum ClientError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct PracticeReminder: Codable, Identifiable, Equatable {
    var id: String
    var hour: Int
    var minute: Int
    var enabled: Bool
    init(id: String = "smooth-practice-" + UUID().uuidString.lowercased(), hour: Int, minute: Int, enabled: Bool = true) {
        self.id = id; self.hour = hour; self.minute = minute; self.enabled = enabled
    }
    var minuteOfDay: Int { hour * 60 + minute }
    var timeLabel: String { String(format: "%02d:%02d", hour, minute) }
    static let storageKey = "practice-reminder-schedule-v2"
    static func owns(_ identifier: String) -> Bool { identifier == "daily-practice" || identifier.hasPrefix("smooth-practice-") }
    static func ordered(_ values: [PracticeReminder]) -> [PracticeReminder] {
        values.sorted { $0.minuteOfDay == $1.minuteOfDay ? $0.id < $1.id : $0.minuteOfDay < $1.minuteOfDay }
    }
    static func checked(_ values: [PracticeReminder]) throws -> [PracticeReminder] {
        guard values.count <= 12, Set(values.map(\.id)).count == values.count,
              values.allSatisfy({ owns($0.id) && (0...23).contains($0.hour) && (0...59).contains($0.minute) }) else {
            throw ClientError.message("Выбери корректное время. Можно сохранить до 12 напоминаний.")
        }
        guard Set(values.map(\.minuteOfDay)).count == values.count else {
            throw ClientError.message("Это время уже есть. Выбери другое или измени существующее напоминание.")
        }
        return ordered(values)
    }
    func request() -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "Smooth English"
        content.body = "Есть 15 минут? Давай одну ситуацию на английском."
        content.sound = .default
        content.threadIdentifier = "ratmir-practice"
        content.userInfo = ["appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"]
        return UNNotificationRequest(identifier: id, content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: DateComponents(hour: hour, minute: minute), repeats: true))
    }
}

/// The OS queue is the source of actual delivery readiness; persisted times are
/// kept even if authorization is revoked. Tests inject a private in-memory queue.
protocol PracticeReminderCenter {
    func authorization() async -> String
    func requestAuthorization() async throws
    func pending() async -> [UNNotificationRequest]
    func add(_ request: UNNotificationRequest) async throws
    func remove(_ identifiers: [String]) async
}

struct SystemPracticeReminderCenter: PracticeReminderCenter {
    func authorization() async -> String {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional, .ephemeral: return "provisional"
        @unknown default: return "unavailable"
        }
    }
    func requestAuthorization() async throws { _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) }
    func pending() async -> [UNNotificationRequest] { await UNUserNotificationCenter.current().pendingNotificationRequests() }
    func add(_ request: UNNotificationRequest) async throws { try await UNUserNotificationCenter.current().add(request) }
    func remove(_ identifiers: [String]) async { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: identifiers) }
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
    var previewResponses: [String: Data] = [:]
    private(set) var previewRequests: [String] = []
    private(set) var previewRequestBodies: [String: [String: Any]] = [:]
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
    @Published private(set) var audioOutput = "Звук пока не запущен"
    @Published private(set) var audioRouteMessage: String?
    @Published var draft = ""
    @Published var recordedFile: String?
    @Published var pendingMessageID: String?
    @Published var assistantTextShown = true
    @Published var conversationPresented = false
    @Published private(set) var homeRequest = 0
    @Published var completionMoment: CompletionMoment?
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
    @Published var reminders: [PracticeReminder] = []
    @Published var reminderDiagnostic: String?
    private let reminderCenter: any PracticeReminderCenter
    private let reminderDefaults: UserDefaults
    @Published var hasUnuploadedRecording = false
    @Published var orphanedRecording = false
    @Published var originalTranscript = ""
    @Published var server = UserDefaults.standard.string(forKey: "training-server") ?? ""
    private var capture: VoiceCapture?
    private var liveTranscriber: LiveTranscriber?
    private var liveConnection: Task<Void, Never>?
    private var recordingLimit: Task<Void, Never>?
    private var player: AVAudioPlayer?
    private var playbackAudioOwner: Int?
    private var playbackDelegate: PlaybackDelegate?
    private var recordedMinutes = 0.01
    private var localRecording: URL?
    private var pendingSpeechTurn: String?
    private var heardTurns = Set<String>()
    private var pendingPlaybackAcknowledgements: [String: String] = [:]
    private var voiceGeneration = UUID()
    private var speechTask: Task<Void, Never>?
    private var meterTask: Task<Void, Never>?
    private var playbackEndTime: Double?
    private var interrupted: NSObjectProtocol?
    private var routeChanged: NSObjectProtocol?
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

    init(reminderCenter: any PracticeReminderCenter = SystemPracticeReminderCenter(), reminderDefaults: UserDefaults = .standard) {
        self.reminderCenter = reminderCenter
        self.reminderDefaults = reminderDefaults
        if let data = reminderDefaults.data(forKey: PracticeReminder.storageKey),
           let stored = try? JSONDecoder().decode([PracticeReminder].self, from: data),
           let checked = try? PracticeReminder.checked(stored) { reminders = checked }
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
        routeChanged = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification,
            object: nil, queue: .main) { [weak self] notification in
                let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
                let previous = notification.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
                let removedExternal = NativeAudioRoute.hasExternalOutput(previous ?? AVAudioSession.sharedInstance().currentRoute)
                Task { @MainActor [weak self] in
                    await self?.handleAudioRouteChange(reason: raw, previousWasExternal: removedExternal)
                }
            }
    }

    private func handleAudioRouteChange(reason raw: UInt, previousWasExternal: Bool) async {
        guard let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        if playing || recording { audioOutput = NativeAudioRoute.outputLabel() }
        if reason == .oldDeviceUnavailable && previousWasExternal {
            if playing || voiceLoading {
                stopSpeaking()
                audioRouteMessage = "Наушники отключены. Озвучка остановлена, чтобы не включиться вслух без тебя."
            }
            if recording {
                audioRouteMessage = "Источник звука отключён. Сохраняем уже записанный ответ."
                await stopRecording()
            }
            return
        }
        if recording, reason == .newDeviceAvailable, NativeAudioRoute.hasExternalOutput(AVAudioSession.sharedInstance().currentRoute) {
            audioRouteMessage = "Подключён новый источник звука. Сохраняем ответ перед переключением."
            await stopRecording()
            return
        }
        if playing {
            let generation = voiceGeneration
            do { try await NativeAudioRoute.repairReceiverIfNeeded() }
            catch is CancellationError { return }
            catch {
                guard generation == voiceGeneration, playing, !recording else { return }
                audioRouteMessage = "Не удалось переключить звук. Останови озвучку и включи её снова."
            }
            guard generation == voiceGeneration, playing, !recording else { return }
            audioOutput = NativeAudioRoute.outputLabel()
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
#if DEBUG
        if previewMode {
            previewRequests.append(path)
            if let body { previewRequestBodies[path] = body }
            guard let data = previewResponses[path] else {
                throw ClientError.message("Предпросмотр не отправляет запросы к серверу.")
            }
            return try JSONDecoder().decode(T.self, from: data)
        }
#endif
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
        completionMoment = nil
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
        completionMoment = nil
    }
    func returnToHome() {
        guard !recording, !microphoneStarting else { return }
        minimizeConversation()
        homeRequest += 1
    }
    func start(mode: String, context: String, forceNew: Bool = false, familyId: String? = nil) async {
        guard !hasUnuploadedRecording else {
            error = "Сначала сохрани текущую запись: вернись к занятию и повтори распознавание. Или явно удали запись, если она больше не нужна."; return
        }
        await perform(stage: "Выбираю ситуацию для разговора") {
            let shouldResume = !forceNew && conversation != nil
            let intent = "\(mode)|\(context)|\(familyId ?? "automatic")|\(shouldResume)|\(shouldResume ? conversation?.id ?? "" : "")"
            if startRequestID == nil || startRequestIntent != intent {
                startRequestID = UUID().uuidString.lowercased(); startRequestIntent = intent
            }
            var body: [String: Any] = ["mode": mode, "context": context,
                "intent": shouldResume ? "resume" : "new", "minutes": state?.profile.dailyMinutes ?? 15,
                "requestId": startRequestID!]
            if shouldResume, let id = conversation?.id { body["sessionId"] = id }
            if let familyId { body["familyId"] = familyId }
            let value: Conversation = try await request("sessions", body: body)
            startRequestID = nil
            resume(value)
            try await refresh()
        }
    }
    func startTrack(_ track: String, activity: String = "speaking", mode: String = "learning") async {
        if let onboarding = state?.onboarding, onboarding.status != "ready" {
            error = "Сначала закончим три стартовые пробы. Они помогут подобрать дальнейшую практику."; return
        }
        if track == "ielts-foundation" {
            guard ["speaking", "listening", "reading", "writing"].contains(activity) else { return }
            await start(mode: activity == "listening" ? "call" : "learning", context: "life", forceNew: true, familyId: "ielts-" + activity)
        } else if ["life", "work", "relocation"].contains(track) {
            await start(mode: mode, context: track, forceNew: true)
        }
    }
    func dismissCompletionMoment() { completionMoment = nil }
    private func acknowledgeCompletion(_ value: Conversation) {
        guard value.status == "completed" else { return }
        let key = "shown-completion-sessions"
        var seen = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
        guard !seen.contains(value.id) else { return }
        seen.insert(value.id)
        UserDefaults.standard.set(Array(seen), forKey: key)
        guard conversationPresented, conversation?.id == value.id else { return }
        completionMoment = CompletionMoment(sessionId: value.id, deferred: value.retryDeferred == true, baseline: value.baseline != nil,
            unlockedBefore: state?.progression?.achievements.filter { $0.unlocked }.map { $0.id } ?? [])
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
            let updated: Conversation = try await request("sessions/\(conversation.id)/\(retry ? "retry" : "message")", body: body)
            savedDrafts.removeValue(forKey: conversation.id)
            guard self.conversation?.id == conversation.id else {
                try await refresh()
                return
            }
            self.conversation = updated
            draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil; originalTranscript = ""; liveTranscript = ""
            assistantTextShown = conversation.mode == "learning"
            // Speech has its own task and safeguards. Start it from the accepted
            // reply without waiting for profile, service status or quota reads.
            autoSpeakLatest()
            try await refresh()
        }
    }
    func action(_ name: String, deferRetry: Bool = false, returnHome: Bool = false) async {
        guard let conversation else { return }
        if name == "finish" || name == "complete" {
            guard !recording, !microphoneStarting else { return }
            if hasUnuploadedRecording {
                error = "Сначала сохрани последнюю запись: повтори распознавание или явно удали её, если она не нужна."; return
            }
            if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || recordedFile != nil || pendingMessageID != nil {
                error = "Последний ответ ещё не отправлен. Отправь его или явно удали черновик перед завершением."; return
            }
        }
        stopSpeaking()
        await perform(stage: name == "complete" ? "Сохраняю результат" : name == "finish" ? "Передаю разговор на разбор" : "Обновляю занятие") {
            let value: Conversation = try await request("sessions/\(conversation.id)/\(name)", body: deferRetry ? ["deferRetry": true] : [:])
            if self.conversation?.id == conversation.id { self.conversation = value }
            if name == "complete" { acknowledgeCompletion(value) }
            // The accepted receipt is enough to leave the review. Profile/quota reads
            // happen afterwards and never hold the user's navigation hostage.
            if name == "complete", returnHome, value.status == "completed" { returnToHome() }
            do { try await refresh() }
            catch {
                if name == "complete", returnHome, value.status == "completed" {
                    self.error = "Занятие сохранено. Главная пока не обновилась из-за связи с сервером. Потяни её вниз, чтобы обновить."
                    return
                }
                throw error
            }
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
              conversation.lesson.activity != "reading", conversation.lesson.activity != "writing",
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
            guard generation == voiceGeneration, !recording, !microphoneStarting,
                  self.conversation?.id == conversation.id, !Task.isCancelled else { return }
            let data = try await checked(URLRequest(url: endpoint("audio/\(speech.file)")))
            guard generation == voiceGeneration, !recording, !microphoneStarting,
                  self.conversation?.id == conversation.id, !Task.isCancelled else { return }
            let owner = try await NativeAudioRoute.preparePlayback()
            guard generation == voiceGeneration, !recording, !microphoneStarting, self.conversation?.id == conversation.id, !Task.isCancelled else {
                NativeAudioRoute.deactivate(ifOwnedBy: owner); return
            }
            playbackAudioOwner = owner
            audioOutput = NativeAudioRoute.outputLabel(); audioRouteMessage = nil
            player = try AVAudioPlayer(data: data)
            player?.isMeteringEnabled = true
            playbackDelegate = PlaybackDelegate { [weak self] completed in
                guard let client = self else { return }
                Task { @MainActor [client] in
                    guard generation == client.voiceGeneration else { return }
                    client.playing = false; client.playingLearnerRecording = false; client.audioLevel = 0; client.pendingSpeechTurn = nil
                    client.meterTask?.cancel(); client.meterTask = nil
                    NativeAudioRoute.deactivate(ifOwnedBy: owner); client.playbackAudioOwner = nil
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
            resetPlayback(cancelLoading: false)
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
        let owner = playbackAudioOwner; playbackAudioOwner = nil
        playbackEndTime = nil
        playing = false; playingLearnerRecording = false; voiceLoading = false; audioLevel = 0; pendingSpeechTurn = nil
        if !recording && !microphoneStarting { NativeAudioRoute.deactivate(ifOwnedBy: owner) }
    }
    private func startPlaybackMeter() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.playing, let player = self.player else { return }
                if let end = self.playbackEndTime, player.currentTime >= end {
                    self.stopSpeaking()
                    return
                }
                player.updateMeters()
                self.audioLevel = min(1, max(0, Double((player.averagePower(forChannel: 0) + 55) / 55)))
                do { try await Task.sleep(for: .milliseconds(40)) } catch { return }
            }
        }
    }
    func playRecording(audioFile: String? = nil, startSeconds: Double? = nil, endSeconds: Double? = nil) async {
        guard !recording, !microphoneStarting else { return }
        if let audioFile {
            let knownRecording = conversation?.turns.contains { $0.role == "user" && $0.audioFile == audioFile }
                ?? false
            let knownRetry = conversation?.retries.contains { $0.audioFile == audioFile } ?? false
            guard knownRecording || knownRetry,
                  audioFile.range(of: "^[a-f0-9-]+\\.(webm|mp4|ogg|wav|mp3)$", options: .regularExpression) != nil else { return }
        }
        stopSpeaking()
        let generation = voiceGeneration
        voiceLoading = true
        defer { if generation == voiceGeneration { voiceLoading = false } }
        do {
            let data: Data
            if let audioFile { data = try await checked(URLRequest(url: endpoint("audio/\(audioFile)"))) }
            else if let url = localRecording { data = try Data(contentsOf: url) }
            else if let recordedFile { data = try await checked(URLRequest(url: endpoint("audio/\(recordedFile)"))) }
            else { return }
            guard generation == voiceGeneration, !recording, !microphoneStarting, !Task.isCancelled else { return }
            let owner = try await NativeAudioRoute.preparePlayback()
            guard generation == voiceGeneration, !recording, !microphoneStarting, !Task.isCancelled else {
                NativeAudioRoute.deactivate(ifOwnedBy: owner); return
            }
            playbackAudioOwner = owner
            audioOutput = NativeAudioRoute.outputLabel(); audioRouteMessage = nil
            player = try AVAudioPlayer(data: data); player?.isMeteringEnabled = true
            if let startSeconds, startSeconds.isFinite {
                player?.currentTime = max(0, min(player?.duration ?? 0, startSeconds))
            }
            if let endSeconds, endSeconds.isFinite, let player, endSeconds > player.currentTime {
                playbackEndTime = min(player.duration, endSeconds)
            }
            playbackDelegate = PlaybackDelegate { [weak self] _ in
                guard let client = self else { return }
                Task { @MainActor [client] in
                    guard generation == client.voiceGeneration else { return }
                    client.playing = false; client.playingLearnerRecording = false; client.audioLevel = 0; client.meterTask?.cancel()
                    NativeAudioRoute.deactivate(ifOwnedBy: owner); client.playbackAudioOwner = nil
                }
            }
            player?.delegate = playbackDelegate
            guard player?.play() == true else { throw ClientError.message("Не удалось прослушать запись.") }
            playing = true; playingLearnerRecording = true; startPlaybackMeter()
        } catch is CancellationError { }
        catch {
            guard generation == voiceGeneration else { return }
            resetPlayback(cancelLoading: false)
            self.error = error.localizedDescription
        }
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
        guard allowed else { error = "Микрофон отключён. Открой настройки Smooth English и разреши доступ."; return }
        guard !busy, conversationPresented, conversation?.id == currentSession, !Task.isCancelled else { return }
        do {
            stopSpeaking()
            let captureGeneration = voiceGeneration
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
            try await capture.start(at: url)
            guard recordingID == identifier, captureGeneration == voiceGeneration,
                  !busy, conversationPresented, conversation?.id == currentSession, !Task.isCancelled else {
                _ = capture.stop()
                live.close()
                try? FileManager.default.removeItem(at: url)
                return
            }
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
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
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

    var remindersAuthorized: Bool { notificationState == "authorized" || notificationState == "provisional" }
    func refreshReminderStatus() async {
        guard !reminderBusy else { return }
#if DEBUG
        if previewMode && PreviewFixtures.screen != nil {
            if reminders.isEmpty {
                reminders = [PracticeReminder(id: "daily-practice", hour: 9, minute: 30),
                             PracticeReminder(id: "smooth-practice-preview-evening", hour: 19, minute: 0)]
            }
            notificationState = PreviewFixtures.screen == "reminder-denied" ? "denied" : "authorized"
            reminderEnabled = remindersAuthorized && reminders.contains(where: \.enabled)
            return
        }
#endif
        await reloadReminderStatus()
    }
    private func reloadReminderStatus() async {
        notificationState = await reminderCenter.authorization()
        let pending = await reminderCenter.pending()
        if reminderDefaults.data(forKey: PracticeReminder.storageKey) == nil {
            // Keep the legacy request identifier. Updating the app does not lose
            // a previously configured daily time or the user's authorization.
            let migrated = pending.compactMap { request -> PracticeReminder? in
                guard PracticeReminder.owns(request.identifier),
                      let trigger = request.trigger as? UNCalendarNotificationTrigger,
                      trigger.repeats, let hour = trigger.dateComponents.hour,
                      let minute = trigger.dateComponents.minute else { return nil }
                return PracticeReminder(id: request.identifier, hour: hour, minute: minute)
            }
            if let checked = try? PracticeReminder.checked(migrated), !checked.isEmpty { persistReminders(checked) }
        }
        reminderEnabled = remindersAuthorized && reminders.contains { value in
            value.enabled && pending.contains { request in
                guard request.identifier == value.id, let trigger = request.trigger as? UNCalendarNotificationTrigger else { return false }
                return trigger.repeats && trigger.dateComponents.hour == value.hour && trigger.dateComponents.minute == value.minute
            }
        }
        if let first = reminders.first { reminderHour = first.hour; reminderMinute = first.minute }
    }
    private func persistReminders(_ values: [PracticeReminder]) {
        reminders = PracticeReminder.ordered(values)
#if DEBUG
        if previewMode && PreviewFixtures.screen != nil { return }
#endif
        if let data = try? JSONEncoder().encode(reminders) { reminderDefaults.set(data, forKey: PracticeReminder.storageKey) }
    }
    private func requireReminderAuthorization() async throws {
        var authorization = await reminderCenter.authorization()
        if authorization == "notDetermined" {
            try await reminderCenter.requestAuthorization()
            authorization = await reminderCenter.authorization()
        }
        notificationState = authorization
        guard authorization == "authorized" || authorization == "provisional" else {
            throw ClientError.message("Уведомления выключены в iPhone. Открой настройки Smooth English и включи «Допуск уведомлений».")
        }
    }
    @discardableResult func saveReminder(id: String? = nil, hour: Int, minute: Int) async -> Bool {
        guard !reminderBusy else { return false }
        reminderBusy = true; error = nil
        defer { reminderBusy = false }
        let existing = id.flatMap { identifier in reminders.first { $0.id == identifier } }
        guard id == nil || existing != nil else { error = "Это напоминание уже удалено."; return false }
        let updated = PracticeReminder(id: existing?.id ?? "smooth-practice-" + UUID().uuidString.lowercased(),
                                       hour: hour, minute: minute, enabled: existing?.enabled ?? true)
        var attemptedScheduling = false
        do {
            let desired = try PracticeReminder.checked(reminders.filter { $0.id != updated.id } + [updated])
#if DEBUG
            if previewMode && PreviewFixtures.screen != nil {
                persistReminders(desired); reminderEnabled = remindersAuthorized && desired.contains(where: \.enabled)
                return true
            }
#endif
            if updated.enabled {
                try await requireReminderAuthorization()
                attemptedScheduling = true
                try await reminderCenter.add(updated.request())
                let pending = await reminderCenter.pending()
                guard pending.contains(where: { request in
                    guard request.identifier == updated.id, let trigger = request.trigger as? UNCalendarNotificationTrigger else { return false }
                    return trigger.repeats && trigger.dateComponents.hour == hour && trigger.dateComponents.minute == minute
                }) else {
                    throw ClientError.message("iPhone не сохранил новое время. Прежние напоминания остаются на месте. Попробуй ещё раз.")
                }
            }
            persistReminders(desired)
            reminderDiagnostic = nil
            await reloadReminderStatus()
            return true
        } catch {
            if attemptedScheduling {
                if let existing, existing.enabled { try? await reminderCenter.add(existing.request()) }
                else { await reminderCenter.remove([updated.id]) }
            }
            self.error = (error as? ClientError)?.localizedDescription ?? "iPhone отклонил напоминание. Проверь «Уведомления» в настройках Smooth English и попробуй ещё раз."
            return false
        }
    }
    func setReminderEnabled(id: String, enabled: Bool) async {
        guard !reminderBusy, let index = reminders.firstIndex(where: { $0.id == id }), reminders[index].enabled != enabled else { return }
        reminderBusy = true; error = nil
        defer { reminderBusy = false }
        var updated = reminders[index]; updated.enabled = enabled
        var attemptedScheduling = false
        do {
#if DEBUG
            if previewMode && PreviewFixtures.screen != nil {
                var desired = reminders; desired[index] = updated; persistReminders(desired)
                reminderEnabled = remindersAuthorized && desired.contains(where: \.enabled)
                return
            }
#endif
            if enabled {
                try await requireReminderAuthorization()
                attemptedScheduling = true
                try await reminderCenter.add(updated.request())
                guard await reminderCenter.pending().contains(where: { $0.identifier == id }) else {
                    throw ClientError.message("iPhone не сохранил напоминание. Попробуй включить его ещё раз.")
                }
            } else { await reminderCenter.remove([id]) }
            var desired = reminders; desired[index] = updated; persistReminders(desired)
            await reloadReminderStatus()
        } catch {
            if attemptedScheduling { await reminderCenter.remove([id]) }
            self.error = (error as? ClientError)?.localizedDescription ?? "Не удалось изменить напоминание. Прежнее состояние сохранено."
        }
    }
    func deleteReminder(id: String) async {
        guard !reminderBusy, reminders.contains(where: { $0.id == id }) else { return }
        reminderBusy = true
        defer { reminderBusy = false }
#if DEBUG
        if previewMode && PreviewFixtures.screen != nil {
            persistReminders(reminders.filter { $0.id != id })
            reminderEnabled = remindersAuthorized && reminders.contains(where: \.enabled)
            return
        }
#endif
        await reminderCenter.remove([id])
        persistReminders(reminders.filter { $0.id != id })
        await reloadReminderStatus()
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
