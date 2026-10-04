import Foundation
import Security
import AVFoundation
import UserNotifications
import UIKit

enum ClientError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

/// A non-2xx answer with the server's Russian message (`{ error }`) and HTTP status.
struct TrainingHTTPError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
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
    static let notificationTitle = "Smooth Talk"
    static var notificationVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown" }
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
        content.title = Self.notificationTitle
        content.body = "Есть пара минут? Одна ситуация на английском — и разговор пойдёт легче."
        content.sound = .default
        content.threadIdentifier = "ratmir-practice"
        content.userInfo = ["appVersion": Self.notificationVersion]
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
    static func delete() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "server-access"]
        _ = SecItemDelete(query as CFDictionary)
    }
}

/// Audio levels live outside TrainingClient so 60 Hz updates never re-render screens.
/// `level`: microphone while recording, playback while playing (0–1, (dB + 55) / 55).
/// `speechLevel`: partner speech only, mapped per MASCOT-SPEC §7 (clamp((dB + 50) / 40)).
@MainActor final class VoiceMeter: ObservableObject {
    @Published var level = 0.0
    @Published var speechLevel = 0.0
}

/// What the composer's send button submits.
enum ComposerTarget: Equatable {
    case message
    case retry
    case pushback(retryID: String)
}

extension Notification.Name {
    /// Posted when the learner opens a practice reminder: Today becomes the visible tab.
    static let smoothTalkOpenToday = Notification.Name("smooth-talk-open-today")
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
    @Published var microphoneDenied = false
    @Published var playing = false
    @Published var playingLearnerRecording = false
    /// Key of the model line (TTS example or pushback) that is loading or playing.
    @Published private(set) var playingModelLine: String?
    @Published private(set) var loadingModelLine: String?
    @Published private(set) var audioOutput = "Звук пока не запущен"
    @Published private(set) var audioRouteMessage: String?
    @Published var draft = ""
    @Published var recordedFile: String?
    @Published var pendingMessageID: String?
    @Published var assistantTextShown = true
    @Published var conversationPresented = false
    @Published var placementPresented = false
    /// Deep links from nested screens (e.g. «Как получить» → Созвоны); the shell consumes it.
    @Published var requestedTab: ShellTab?
    @Published private(set) var homeRequest = 0
    @Published var completionMoment: CompletionMoment?
    /// Which start button is preparing a lesson (spinner next to the tap, L-21).
    @Published private(set) var startingIntent: String?
    @Published var catalog: [CatalogSection] = []
    @Published private(set) var catalogLoading = false
    @Published private(set) var catalogError: String?
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var recordingStartedAt: Date?
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
    private let defaults: UserDefaults
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
    private var hintLevels: [String: Int] = [:]
    private var pendingPlaybackAcknowledgements: [String: String] = [:]
    private var voiceGeneration = UUID()
    private var speechTask: Task<Void, Never>?
    private var meterTask: Task<Void, Never>?
    private var playbackEndTime: Double?
    private var interrupted: NSObjectProtocol?
    private var routeChanged: NSObjectProtocol?
    private var mediaReset: NSObjectProtocol?
    private var liveFinalText: String?
    private var liveSessionID: String?
    private var liveMinutes = 0.0
    private var recordingID = UUID()
    private var startRequestID: String?
    private var startRequestIntent: String?
    private var refreshInFlight = false
    private var refreshQueued = false
    private var reauthentication: Task<Bool, Never>?
    private struct DraftSnapshot {
        let text: String
        let file: String?
        let pendingID: String?
        let transcript: String
        let liveText: String
    }
    private var savedDrafts: [String: DraftSnapshot] = [:]
    let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 240
        config.httpCookieStorage = HTTPCookieStorage.shared
        return URLSession(configuration: config)
    }()

    static let pendingRecordingGuidance = "Сначала реши, что делать с несохранённой записью — карточка на вкладке «Сегодня»."

    init(reminderCenter: any PracticeReminderCenter = SystemPracticeReminderCenter(), reminderDefaults: UserDefaults = .standard) {
        self.reminderCenter = reminderCenter
        self.defaults = reminderDefaults
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
        mediaReset = NotificationCenter.default.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification,
            object: nil, queue: .main) { [weak self] _ in
                guard let client = self else { return }
                Task { @MainActor [client] in
                    client.stopSpeaking()
                    if client.recording { await client.stopRecording() }
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

    // MARK: Networking

    func endpoint(_ path: String) throws -> URL {
        guard let base = URL(string: server), base.scheme == "https", base.host != nil,
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              base.path.isEmpty || base.path == "/" else {
            throw ClientError.message("Укажи HTTPS-адрес сервера без пути и параметров.")
        }
        return base.appendingPathComponent("api/" + path)
    }

    func checked(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ClientError.message("Нет ответа сервера.") }
        guard (200..<300).contains(http.statusCode) else {
            let detail = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = detail?["error"] as? String ?? TrainingClient.statusMessage(http.statusCode)
            throw TrainingHTTPError(status: http.statusCode, message: message)
        }
        return data
    }

    nonisolated private static func statusMessage(_ code: Int) -> String {
        switch code {
        case 401: return "Доступ истёк. Войди снова."
        case 404: return "На сервере этого уже нет. Обнови экран."
        case 413: return "Слишком большой запрос."
        case 500...599: return "Сервер временно не отвечает (\(code)). Попробуй ещё раз."
        default: return "Ошибка сервера (\(code))."
        }
    }

    /// Russian text that says what happened and what to do (localised URL and decoding errors).
    nonisolated static func describe(_ error: Error) -> String {
        if let failure = error as? TrainingHTTPError { return failure.message }
        if let failure = error as? ClientError { return failure.localizedDescription }
        if let failure = error as? URLError {
            switch failure.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                return "Нет интернета. Проверь связь и попробуй ещё раз."
            case .timedOut:
                return "Сервер долго не отвечает. Попробуй ещё раз через минуту."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                return "Сервер недоступен. Проверь адрес и что сервер включён."
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
                return "Не удалось установить защищённое соединение с сервером."
            case .cancelled:
                return "Запрос отменён."
            default:
                return "Связь с сервером прервалась. Попробуй ещё раз."
            }
        }
        if error is DecodingError { return "Сервер прислал данные в новом формате. Обнови приложение." }
        let text = error.localizedDescription
        return text.isEmpty ? "Что-то пошло не так. Попробуй ещё раз." : text
    }

    /// Re-logs in once with the saved code when the access cookie expired (C-12).
    private func transmit(path: String, _ build: () throws -> URLRequest) async throws -> Data {
        let first = try build()
        do {
            return try await checked(first)
        } catch let failure as TrainingHTTPError where failure.status == 401 && path != "login" {
            guard await reauthenticate() else { throw failure }
            return try await checked(try build())
        }
    }

    /// Logs in again with the saved access code after a 401. Shared by concurrent callers;
    /// feature requests that bypass `request(_:)` (e.g. `featureRaw`) can call it and retry once.
    func reauthenticate() async -> Bool {
        if let running = reauthentication { return await running.value }
        guard let code = AccessKey.read(), !code.isEmpty else { return false }
        let attempt = Task { [weak self] () -> Bool in
            guard let self else { return false }
            do {
                var login = URLRequest(url: try self.endpoint("login"))
                login.httpMethod = "POST"
                login.setValue("application/json", forHTTPHeaderField: "Content-Type")
                login.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
                _ = try await self.checked(login)
                return true
            } catch { return false }
        }
        reauthentication = attempt
        let result = await attempt.value
        reauthentication = nil
        return result
    }

    func request<T: Decodable>(_ path: String, body: [String: Any]? = nil) async throws -> T {
        try await request(path, method: body == nil ? "GET" : "POST", body: body)
    }

    func request<T: Decodable>(_ path: String, method: String, body: [String: Any]? = nil) async throws -> T {
#if DEBUG
        if previewMode {
            previewRequests.append(path)
            if let body { previewRequestBodies[path] = body }
            var fixture = previewResponses[path]
            if fixture == nil, PreviewFixtures.screen != nil { fixture = FeaturePreviewFixtures.response(for: path) }
            guard let data = fixture else {
                throw ClientError.message("Предпросмотр не отправляет запросы к серверу.")
            }
            return try JSONDecoder().decode(T.self, from: data)
        }
#endif
        let data = try await transmit(path: path) {
            var request = URLRequest(url: try self.endpoint(path))
            request.httpMethod = method
            if let body {
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            return request
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Raw GET (audio files, export) with the same access recovery.
    func fetchData(_ path: String) async throws -> Data {
        try await transmit(path: path) { URLRequest(url: try self.endpoint(path)) }
    }

    func perform(stage: String? = nil, force: Bool = false, _ action: () async throws -> Void) async {
        guard force || !busy else { return }
        busy = true; error = nil; operationStage = stage; operationStartedAt = Date()
        defer { busy = false; operationStage = nil; operationStartedAt = nil }
        do { try await action() }
        catch is CancellationError { }
        catch { self.error = TrainingClient.describe(error) }
    }

    // MARK: Access and refresh

    func login(code: String) async {
        var accepted = false
        await perform(stage: "Подключаю твой профиль") {
            let _: Confirmation = try await request("login", body: ["code": code])
            try AccessKey.save(code)
            UserDefaults.standard.set(server, forKey: "training-server")
            try await refreshState()
            signedIn = true
            recoverPendingRecording()
            accepted = true
        }
        guard accepted else { return }
        Task { [weak self] in
            guard let self else { return }
            await self.refreshMeta()
            await self.refreshReminderStatus()
            await self.loadCatalog()
        }
    }

    func restore() async {
        guard !server.isEmpty, let code = AccessKey.read() else { return }
        await login(code: code)
    }

    /// Leaves this iPhone; practice history stays on the server.
    func signOut() {
        guard !recording, !microphoneStarting, !busy else { return }
        stopSpeaking()
        AccessKey.delete()
        if let url = URL(string: server), let cookies = HTTPCookieStorage.shared.cookies(for: url) {
            for cookie in cookies { HTTPCookieStorage.shared.deleteCookie(cookie) }
        }
        conversationPresented = false
        placementPresented = false
        conversation = nil
        state = nil
        status = nil
        subscriptionUsage = nil
        catalog = []
        savedDrafts.removeAll()
        draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil; originalTranscript = ""; liveTranscript = ""
        completionMoment = nil
        signedIn = false
    }

    /// State + status + usage. Kept for callers that want everything; status and usage never fail it.
    func refresh() async throws {
        try await refreshState()
        await refreshMeta()
    }

    func refreshState() async throws {
        let updated: TrainingState = try await request("state")
        apply(updated)
    }

    /// Service status and subscription usage: informational, never an error for the learner.
    func refreshMeta() async {
        async let statusValue: ServerStatus? = try? request("status")
        async let usageValue: SubscriptionUsage? = try? request("usage")
        let (newStatus, newUsage) = await (statusValue, usageValue)
        if let newStatus { status = newStatus }
        if let newUsage { subscriptionUsage = newUsage }
    }

    /// Runs after accepted actions: the learner's turn never waits for these reads (C-01).
    func refreshInBackground() {
#if DEBUG
        if previewMode && PreviewFixtures.screen != nil { return }
#endif
        guard signedIn else { return }
        if refreshInFlight { refreshQueued = true; return }
        refreshInFlight = true
        Task { [weak self] in
            guard let self else { return }
            try? await self.refreshState()
            await self.refreshMeta()
            self.refreshInFlight = false
            if self.refreshQueued {
                self.refreshQueued = false
                self.refreshInBackground()
            }
        }
    }

    /// Pull to refresh: no busy flag, no start-button relabelling (L-27).
    func refreshQuietly() async {
#if DEBUG
        if previewMode { return }
#endif
        do { try await refreshState() } catch { self.error = TrainingClient.describe(error) }
        await refreshMeta()
    }

    /// Foreground return and sheet closing refresh a stale Today (C-05).
    func refreshIfStale(after seconds: TimeInterval = 60) {
        guard signedIn else { return }
        if let lastRefresh, Date().timeIntervalSince(lastRefresh) < seconds { return }
        refreshInBackground()
    }

    /// Something on the server is still working (analysis, calls, placement scoring).
    var needsBackgroundPolling: Bool {
        guard signedIn, let state else { return false }
        if state.sessions.contains(where: { $0.status == "analysing" || $0.processing != nil }) { return true }
        if state.callSignals.contains(where: { $0.isProcessing }) { return true }
        return state.placementSignal?.status == "scoring"
    }

    /// Today-level polling while the conversation sheet is closed (L-24). Backs off on failures.
    func pollStateWhileProcessing() async {
#if DEBUG
        if previewMode { return }
#endif
        var failures = 0
        while !Task.isCancelled, needsBackgroundPolling, !conversationPresented {
            let delay = failures == 0 ? 10.0 : min(60.0, 10.0 * Double(failures + 1))
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard needsBackgroundPolling, !conversationPresented else { return }
            do {
                try await refreshState()
                failures = 0
            } catch { failures += 1 }
        }
    }

    private func apply(_ updated: TrainingState) {
        state = updated
        lastRefresh = Date()
        if let id = conversation?.id {
            if let fresh = updated.session(id) {
                if let current = conversation, TrainingClient.isNotOlder(fresh, than: current) { conversation = fresh }
            } else if updated.skippedSessions == 0 && !recording && !microphoneStarting {
                // Deleted elsewhere (e.g. on the PC). A local recording stays recoverable on Today.
                stopSpeaking()
                conversationPresented = false
                savedDrafts.removeValue(forKey: id)
                draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil
                originalTranscript = ""; liveTranscript = ""
                conversation = nil
            }
        }
        updateOrphanedRecording()
    }

    private static func isNotOlder(_ fresh: Conversation, than current: Conversation) -> Bool {
        guard let new = fresh.updatedAt.flatMap(NativeDate.parse), let old = current.updatedAt.flatMap(NativeDate.parse) else { return true }
        return new >= old
    }

    func loadCatalog(force: Bool = false) async {
        guard !catalogLoading else { return }
        if !force && !catalog.isEmpty { return }
        catalogLoading = true
        defer { catalogLoading = false }
        do {
            let response: FamiliesResponse = try await request("families")
            catalog = response.catalog
            catalogError = nil
        } catch {
            catalogError = TrainingClient.describe(error)
        }
    }

    func catalogFamily(_ id: String) -> CatalogFamily? {
        for section in catalog {
            if let family = section.families.first(where: { $0.id == id }) { return family }
        }
        return nil
    }

    // MARK: Pending recording (global recovery, L-01)

    var pendingRecordingSessionID: String? {
        guard hasUnuploadedRecording else { return nil }
        return UserDefaults.standard.string(forKey: "pending-recording-session")
    }

    var pendingRecordingSession: Conversation? {
        guard let id = pendingRecordingSessionID else { return nil }
        if let value = state?.session(id) { return value }
        if conversation?.id == id { return conversation }
        return nil
    }

    private func updateOrphanedRecording() {
        guard hasUnuploadedRecording else { orphanedRecording = false; return }
        guard let id = pendingRecordingSessionID else { orphanedRecording = true; return }
        guard let owner = state?.session(id) ?? (conversation?.id == id ? conversation : nil) else {
            orphanedRecording = state != nil && (state?.skippedSessions ?? 0) == 0
            return
        }
        orphanedRecording = owner.status == "completed" && !owner.awaitsRetry
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
            conversation = state?.session(id)
        }
        updateOrphanedRecording()
        liveTranscriptStatus = orphanedRecording
            ? "На iPhone осталась запись занятия, которого уже нет. Её можно прослушать или удалить."
            : "На iPhone сохранилась запись. Можно повторить распознавание."
    }

    private func clearPendingRecording() {
        for key in ["pending-recording-path", "pending-recording-session", "pending-recording-minutes"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }

    // MARK: Presentation

    func resume(_ value: Conversation) {
        if hasUnuploadedRecording && (orphanedRecording || (pendingRecordingSessionID != nil && pendingRecordingSessionID != value.id)) {
            error = TrainingClient.pendingRecordingGuidance; return
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
        if draft.isEmpty, pendingMessageID == nil { adoptUnansweredTurn(value) }
        autoSpeakLatest()
    }

    /// Hides the sheet. `keepMoment` keeps the completion reward for Today (C-02).
    func minimizeConversation(keepMoment: Bool = false) {
        guard !recording else { return }
        stopSpeaking()
        conversationPresented = false
        if !keepMoment { completionMoment = nil }
    }

    /// Called when the sheet is gone (swipe or button). Never clears the reward.
    func conversationDidClose() {
        stopSpeaking()
        refreshInBackground()
    }

    func returnToHome() {
        guard !recording, !microphoneStarting else { return }
        minimizeConversation(keepMoment: true)
        homeRequest += 1
    }

    func dismissCompletionMoment() { completionMoment = nil }

    private func acknowledgeCompletion(_ value: Conversation) {
        guard value.status == "completed" else { return }
        let key = "shown-completion-sessions"
        var seen = defaults.stringArray(forKey: key) ?? []
        guard !seen.contains(value.id) else { return }
        seen.append(value.id)
        defaults.set(Array(seen.suffix(300)), forKey: key)
        guard conversationPresented, conversation?.id == value.id else { return }
        completionMoment = CompletionMoment(sessionId: value.id, deferred: value.retryDeferred == true,
            unlockedBefore: state?.progression?.achievements.filter { $0.unlocked }.map { $0.id } ?? [],
            xpBefore: state?.progression?.xp ?? state?.xp ?? 0,
            levelBefore: state?.progression?.level)
    }

    // MARK: Starting lessons

    static func familyKey(_ id: String) -> String { "family:" + id }
    static func drillKey(_ id: String) -> String { "drill:" + id }
    static let freeKey = "free"
    func isStarting(_ key: String) -> Bool { startingIntent == key }

    private var lessonMinutes: Int { min(30, max(5, state?.profile.dailyMinutes ?? 15)) }

    /// POST sessions { mode, familyId, topic?, intent: 'new', requestId }.
    func startFamily(familyId: String, mode: String, topic: String? = nil) async {
        var body: [String: Any] = ["mode": mode, "familyId": familyId]
        let cleanTopic = topic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !cleanTopic.isEmpty { body["topic"] = String(cleanTopic.prefix(300)) }
        await startSession(intentKey: TrainingClient.familyKey(familyId), requestKey: "family|\(familyId)|\(mode)|\(cleanTopic)",
            stage: "Готовлю занятие", body: body)
    }

    /// POST sessions { mode, drillId, intent: 'new', requestId } — instant template plan.
    func startDrill(id: String, mode: String) async {
        await startSession(intentKey: TrainingClient.drillKey(id), requestKey: "drill|\(id)|\(mode)",
            stage: "Готовлю тренировку", body: ["mode": mode, "drillId": id])
    }

    /// «Свободная тема»: a context, a mode and an optional topic.
    func startFree(mode: String, context: String, topic: String? = nil) async {
        var body: [String: Any] = ["mode": mode, "context": context]
        let cleanTopic = topic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !cleanTopic.isEmpty { body["topic"] = String(cleanTopic.prefix(300)) }
        await startSession(intentKey: TrainingClient.freeKey, requestKey: "free|\(mode)|\(context)|\(cleanTopic)",
            stage: "Подбираю ситуацию", body: body)
    }

    /// Today's plan: a drill when the server names one, otherwise its family.
    func startRecommendation(_ recommendation: PracticeRecommendation) async {
        if let drillId = recommendation.drillId, !drillId.isEmpty {
            await startDrill(id: drillId, mode: recommendation.preferredMode)
        } else {
            await startFamily(familyId: recommendation.familyId, mode: recommendation.preferredMode)
        }
    }

    /// v0.4 entry point kept for compatibility.
    func start(mode: String, context: String, forceNew: Bool = false, familyId: String? = nil) async {
        if !forceNew, let current = conversation, current.isResumable { resume(current); return }
        if let familyId { await startFamily(familyId: familyId, mode: mode) }
        else { await startFree(mode: mode, context: context) }
    }

    private func startSession(intentKey: String, requestKey: String, stage: String, body base: [String: Any]) async {
        guard !hasUnuploadedRecording else { error = TrainingClient.pendingRecordingGuidance; return }
        guard startingIntent == nil, !busy else { return }
        startingIntent = intentKey
        defer { startingIntent = nil }
        var opened: Conversation?
        await perform(stage: stage) {
            if startRequestID == nil || startRequestIntent != requestKey {
                startRequestID = UUID().uuidString.lowercased(); startRequestIntent = requestKey
            }
            var body = base
            body["intent"] = "new"
            body["minutes"] = lessonMinutes
            body["requestId"] = startRequestID ?? UUID().uuidString.lowercased()
            let value: Conversation = try await request("sessions", body: body)
            startRequestID = nil; startRequestIntent = nil
            opened = value
        }
        guard let opened else { return }
        resume(opened)
        refreshInBackground()
    }

    // MARK: Composer

    var hasUnsentAnswer: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || recordedFile != nil || pendingMessageID != nil
    }

    private func serverHolds(_ id: String) -> Bool {
        guard let conversation else { return false }
        return conversation.turns.contains { $0.id == id } || conversation.retries.contains { $0.id == id }
    }

    /// A failed send whose text never reached the server: the learner may edit it (L-02).
    var pendingIsLocalOnly: Bool {
        guard let id = pendingMessageID else { return false }
        return !serverHolds(id)
    }

    /// The server holds the learner's reply but the partner has not answered it yet.
    var unansweredTurn: Turn? {
        guard let conversation, conversation.isLive, conversation.processing == nil,
              let last = conversation.turns.last, last.role == "user" else { return nil }
        return last
    }

    private func adoptUnansweredTurn(_ value: Conversation) {
        guard value.isLive, value.processing == nil, let last = value.turns.last, last.role == "user" else { return }
        draft = last.text; pendingMessageID = last.id; recordedFile = last.audioFile; originalTranscript = ""
    }

    func editPendingAnswer() {
        guard !busy, let id = pendingMessageID, !serverHolds(id) else { return }
        pendingMessageID = nil
    }

    /// Drops an unsent text draft (never a recording or an answer the server already holds).
    func clearDraft() {
        guard !busy, !recording, recordedFile == nil, !hasUnuploadedRecording else { return }
        if let id = pendingMessageID, serverHolds(id) { return }
        draft = ""; pendingMessageID = nil; originalTranscript = ""
    }

    func resendUnanswered() async {
        guard let turn = unansweredTurn else { return }
        draft = turn.text; pendingMessageID = turn.id; recordedFile = turn.audioFile
        await submit(.message)
    }

    func send(retry: Bool = false) async { await submit(retry ? .retry : .message) }

    func sendPushback(retryId: String, text: String, audioFile: String?) async {
        draft = text
        recordedFile = audioFile
        await submit(.pushback(retryID: retryId))
    }

    func submit(_ target: ComposerTarget) async {
        guard let conversation else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        stopSpeaking()
        let stage: String
        switch target {
        case .message: stage = "Собеседник отвечает"
        case .retry: stage = "Проверяю твою новую попытку"
        case .pushback: stage = "Смотрю, удержал ли ты позицию"
        }
        var accepted = false
        await perform(stage: stage) {
            var body: [String: Any] = ["text": text]
            if let recordedFile { body["audioFile"] = recordedFile }
            if !originalTranscript.isEmpty { body["originalTranscript"] = originalTranscript }
            let path: String
            switch target {
            case .message:
                let id = pendingMessageID ?? UUID().uuidString.lowercased()
                pendingMessageID = id
                body["id"] = id
                body["source"] = recordedFile == nil ? "text" : "audio"
                body["textVisible"] = assistantTextShown
                path = "sessions/\(conversation.id)/message"
            case .retry:
                let id = pendingMessageID ?? UUID().uuidString.lowercased()
                pendingMessageID = id
                body["id"] = id
                path = "sessions/\(conversation.id)/retry"
            case .pushback(let retryID):
                body["retryId"] = retryID
                path = "sessions/\(conversation.id)/pushback"
            }
            let updated: Conversation
            do {
                updated = try await request(path, body: body)
            } catch let failure as TrainingHTTPError where failure.status == 409 && target == .message {
                // The server already holds an unanswered reply from this device: show it with a resend.
                guard let latest: Conversation = try? await request("sessions/\(conversation.id)"),
                      self.conversation?.id == conversation.id else { throw failure }
                self.conversation = latest
                adoptUnansweredTurn(latest)
                return
            }
            savedDrafts.removeValue(forKey: conversation.id)
            guard self.conversation?.id == conversation.id else { return }
            self.conversation = updated
            draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil; originalTranscript = ""; liveTranscript = ""
            assistantTextShown = conversation.mode == "learning"
            accepted = true
        }
        guard accepted else { return }
        // Speech has its own task; profile, status and quota reads run afterwards (C-01).
        autoSpeakLatest()
        refreshInBackground()
    }

    func action(_ name: String, deferRetry: Bool = false, returnHome: Bool = false) async {
        guard let conversation else { return }
        if name == "finish" || name == "complete" {
            guard !recording, !microphoneStarting else { return }
            if hasUnuploadedRecording {
                error = "Сначала сохрани последнюю запись: повтори распознавание или удали её."; return
            }
            if hasUnsentAnswer {
                error = "Последний ответ ещё не отправлен. Отправь его или удали черновик перед завершением."; return
            }
        }
        stopSpeaking()
        let stage = name == "complete" ? "Сохраняю результат" : name == "finish" ? "Передаю разговор на разбор" : "Обновляю занятие"
        var accepted: Conversation?
        await perform(stage: stage) {
            let value: Conversation = try await request("sessions/\(conversation.id)/\(name)", body: deferRetry ? ["deferRetry": true] : [:])
            if self.conversation?.id == conversation.id { self.conversation = value }
            accepted = value
        }
        guard let value = accepted else { return }
        if name == "complete" { acknowledgeCompletion(value) }
        if value.status == "analysing" { reviewStartedAt = Date() }
        // The accepted receipt is enough to leave the review; reads follow in the background.
        if name == "complete", returnHome, value.status == "completed" { returnToHome() }
        refreshInBackground()
    }

    /// «Повторить разбор» after a failed analysis (only when no review exists, so nothing is lost).
    func retryAnalysis() async {
        guard let conversation, conversation.analysis == nil else { return }
        var accepted: Conversation?
        await perform(stage: "Повторяю разбор") {
            let value: Conversation = try await request("sessions/\(conversation.id)/reanalyse", body: [:])
            accepted = value
        }
        guard let value = accepted, self.conversation?.id == value.id else { return }
        self.conversation = value
        reviewStartedAt = Date()
        refreshInBackground()
    }

    func reloadConversation() async {
        guard let id = conversation?.id else { return }
        do {
            let value: Conversation = try await request("sessions/\(id)")
            if conversation?.id == id { conversation = value }
        } catch { self.error = TrainingClient.describe(error) }
    }

    nonisolated static func pollDelay(failures: Int) -> Double {
        guard failures > 0 else { return 3 }
        return min(30, 3 * pow(2, Double(min(failures, 4))))
    }

    /// Keeps polling through transient errors with backoff; reports only after three in a row (C-04).
    func pollReview() async {
#if DEBUG
        if previewMode { return }
#endif
        var failures = 0
        while !Task.isCancelled, let current = conversation, current.status == "analysing" || current.processing != nil {
            do { try await Task.sleep(for: .seconds(TrainingClient.pollDelay(failures: failures))) } catch { return }
            guard let id = conversation?.id, id == current.id else { return }
            do {
                let value: Conversation = try await request("sessions/\(id)")
                guard conversation?.id == id else { return }
                failures = 0
                conversation = value
                if value.processing == nil, value.status != "analysing" {
                    refreshInBackground()
                    autoSpeakLatest()
                }
            } catch is CancellationError {
                return
            } catch {
                failures += 1
                if failures == 3 {
                    self.error = "Не удаётся проверить разбор: " + TrainingClient.describe(error) + " Продолжаю пробовать сам."
                }
            }
        }
    }

    func getHint() async {
        guard let conversation, let turn = conversation.turns.last(where: { $0.role == "assistant" }) else { return }
        let level = min(3, (hintLevels[turn.id] ?? 0) + 1)
        await perform(stage: "Подбираю опору для ответа") {
            let result: Hint = try await request("sessions/\(conversation.id)/hint", body: ["level": level])
            hint = result.text
            hintLevels[turn.id] = level
        }
    }

    /// The level the next hint request would ask for (1–3).
    var nextHintLevel: Int {
        guard let turn = conversation?.turns.last(where: { $0.role == "assistant" }) else { return 1 }
        return min(3, (hintLevels[turn.id] ?? 0) + 1)
    }

    /// Shows the partner's text without stopping speech or refreshing everything (C-06).
    func revealText() async {
        guard let conversation else { return }
        assistantTextShown = true
#if DEBUG
        if previewMode { return }
#endif
        if let value: Conversation = try? await request("sessions/\(conversation.id)/show-text", body: [:]),
           self.conversation?.id == value.id {
            self.conversation = value
        }
    }

    // MARK: Partner speech

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

    /// The latest partner line has been heard completely at least once.
    var latestPartnerLineHeard: Bool {
        guard let turn = conversation?.turns.last(where: { $0.role == "assistant" }) else { return false }
        return heardTurns.contains(turn.id)
    }

    /// Playback has its own loading state. Speech fetching never locks the record/finish buttons.
    func speak() async {
        guard !recording, !microphoneStarting, !hasUnuploadedRecording,
              let conversation, let turn = conversation.turns.last(where: { $0.role == "assistant" }) else { return }
#if DEBUG
        if previewMode { return }
#endif
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
            let data = try await fetchData("audio/\(speech.file)")
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
                    client.playing = false; client.playingLearnerRecording = false; client.audioLevel = 0
                    client.voiceMeter.speechLevel = 0; client.pendingSpeechTurn = nil
                    client.meterTask?.cancel(); client.meterTask = nil
                    NativeAudioRoute.deactivate(ifOwnedBy: owner); client.playbackAudioOwner = nil
                    guard completed else { client.error = "Озвучка прервалась. Нажми «Слушать», чтобы повторить."; return }
                    client.heardTurns.insert(turn.id)
                    await client.savePlaybackAcknowledgement(sessionID: conversation.id, turnID: turn.id)
                }
            }
            player?.delegate = playbackDelegate
            player?.prepareToPlay()
            guard player?.play() == true else { throw ClientError.message("Не удалось начать озвучку. Проверь громкость и попробуй снова.") }
            playing = true; playingLearnerRecording = false
            startPlaybackMeter(partner: true)
        } catch is CancellationError { }
        catch {
            guard generation == voiceGeneration else { return }
            resetPlayback(cancelLoading: false)
            self.error = "Не удалось озвучить реплику. Текст сохранён; нажми «Слушать», чтобы повторить. " + TrainingClient.describe(error)
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

    /// Plays a model line through POST /api/tts (better answers, examples). Tapping again stops it.
    func speakModelLine(_ text: String, key: String) async {
        if playingModelLine == key || loadingModelLine == key { stopSpeaking(); return }
        guard !recording, !microphoneStarting else { return }
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty else { return }
#if DEBUG
        if previewMode { return }
#endif
        stopSpeaking()
        let generation = voiceGeneration
        voiceLoading = true; loadingModelLine = key
        defer { if generation == voiceGeneration { voiceLoading = false; loadingModelLine = nil } }
        do {
            let speech: Speech = try await request("tts", body: ["text": String(line.prefix(600))])
            guard generation == voiceGeneration else { return }
            let data = try await fetchData("audio/\(speech.file)")
            guard generation == voiceGeneration, !recording, !microphoneStarting, !Task.isCancelled else { return }
            try await playLine(data: data, key: key)
        } catch is CancellationError {
        } catch {
            guard generation == voiceGeneration else { return }
            resetPlayback(cancelLoading: false)
            self.error = "Не удалось озвучить пример. " + TrainingClient.describe(error)
        }
    }

    /// Plays the partner's objection after an improved retry (POST sessions/:id/pushback-speech).
    func pushbackSpeech(retryId: String) async {
        guard let conversation else { return }
        let key = "pushback:" + retryId
        if playingModelLine == key || loadingModelLine == key { stopSpeaking(); return }
        guard !recording, !microphoneStarting else { return }
#if DEBUG
        if previewMode { return }
#endif
        stopSpeaking()
        let generation = voiceGeneration
        voiceLoading = true; loadingModelLine = key
        defer { if generation == voiceGeneration { voiceLoading = false; loadingModelLine = nil } }
        do {
            let speech: Speech = try await request("sessions/\(conversation.id)/pushback-speech", body: ["retryId": retryId])
            guard generation == voiceGeneration, self.conversation?.id == conversation.id else { return }
            let data = try await fetchData("audio/\(speech.file)")
            guard generation == voiceGeneration, !recording, !microphoneStarting, !Task.isCancelled else { return }
            try await playLine(data: data, key: key)
        } catch is CancellationError {
        } catch {
            guard generation == voiceGeneration else { return }
            resetPlayback(cancelLoading: false)
            self.error = "Не удалось озвучить возражение. Текст на экране. " + TrainingClient.describe(error)
        }
    }

    private func playLine(data: Data, key: String) async throws {
        let generation = voiceGeneration
        let owner = try await NativeAudioRoute.preparePlayback()
        guard generation == voiceGeneration, !recording, !microphoneStarting, !Task.isCancelled else {
            NativeAudioRoute.deactivate(ifOwnedBy: owner); return
        }
        playbackAudioOwner = owner
        audioOutput = NativeAudioRoute.outputLabel(); audioRouteMessage = nil
        let audio = try AVAudioPlayer(data: data)
        audio.isMeteringEnabled = true
        playbackDelegate = PlaybackDelegate { [weak self] _ in
            guard let client = self else { return }
            Task { @MainActor [client] in
                guard generation == client.voiceGeneration else { return }
                client.finishLinePlayback(owner: owner)
            }
        }
        audio.delegate = playbackDelegate
        player = audio
        audio.prepareToPlay()
        guard audio.play() else { throw ClientError.message("Не удалось включить звук. Проверь громкость и попробуй снова.") }
        playing = true; playingLearnerRecording = false; playingModelLine = key
        startPlaybackMeter(partner: true)
    }

    private func finishLinePlayback(owner: Int) {
        playing = false; playingLearnerRecording = false; playingModelLine = nil
        audioLevel = 0; voiceMeter.speechLevel = 0
        meterTask?.cancel(); meterTask = nil
        player = nil; playbackDelegate = nil
        NativeAudioRoute.deactivate(ifOwnedBy: owner); playbackAudioOwner = nil
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
        playing = false; playingLearnerRecording = false; voiceLoading = false; audioLevel = 0; voiceMeter.speechLevel = 0
        pendingSpeechTurn = nil; playingModelLine = nil; loadingModelLine = nil
        if !recording && !microphoneStarting { NativeAudioRoute.deactivate(ifOwnedBy: owner) }
    }
    /// Samples the player every 20 ms; the mascot reads `voiceMeter.level` per frame for lip-sync.
    private func startPlaybackMeter(partner: Bool) {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.playing, let player = self.player else { return }
                if let end = self.playbackEndTime, player.currentTime >= end {
                    self.stopSpeaking()
                    return
                }
                player.updateMeters()
                let power = Double(player.averagePower(forChannel: 0))
                self.audioLevel = min(1, max(0, (power + 55) / 55))
                if partner { self.voiceMeter.speechLevel = min(1, max(0, (power + 50) / 40)) }
                do { try await Task.sleep(for: .milliseconds(20)) } catch { return }
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
#if DEBUG
        if previewMode { return }
#endif
        stopSpeaking()
        let generation = voiceGeneration
        voiceLoading = true
        defer { if generation == voiceGeneration { voiceLoading = false } }
        do {
            let data: Data
            if let audioFile { data = try await fetchData("audio/\(audioFile)") }
            else if let url = localRecording { data = try Data(contentsOf: url) }
            else if let recordedFile { data = try await fetchData("audio/\(recordedFile)") }
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
            playing = true; playingLearnerRecording = true; startPlaybackMeter(partner: false)
        } catch is CancellationError { }
        catch {
            guard generation == voiceGeneration else { return }
            resetPlayback(cancelLoading: false)
            self.error = TrainingClient.describe(error)
        }
    }

    // MARK: Recording

    func beginRecording() async {
        guard !busy, !recording, !microphoneStarting else { return }
        guard localRecording == nil else {
            error = "Предыдущая запись ещё не сохранилась на сервере. Повтори распознавание или удали её перед новой записью."; return
        }
        guard recordedFile == nil, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "Последний ответ ещё не отправлен. Отправь его или очисти черновик перед новой записью."; return
        }
        microphoneStarting = true
        let currentSession = conversation?.id
        defer { microphoneStarting = false }
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else {
            microphoneDenied = true
            error = "Микрофон выключен для Smooth Talk. Разреши доступ в настройках iPhone."
            return
        }
        microphoneDenied = false
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
            localRecording = url; recording = true; recordingStartedAt = Date(); error = nil
            UserDefaults.standard.set(url.path, forKey: "pending-recording-path")
            UserDefaults.standard.set(conversation?.id, forKey: "pending-recording-session")
            UserDefaults.standard.set(0.01, forKey: "pending-recording-minutes")
            hasUnuploadedRecording = true; orphanedRecording = false
            liveTranscript = ""; originalTranscript = ""; liveFinalText = nil; liveSessionID = nil; liveMinutes = 0
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
                self.audioRouteMessage = "Прошло 8 минут — запись остановлена и сохранена."
                await self.stopRecording()
            }
        } catch is CancellationError { }
        catch { self.error = TrainingClient.describe(error) }
    }

    func stopRecording() async {
        guard recording, let capture else { return }
        let result = capture.stop(); self.capture = nil
        recording = false; recordingStartedAt = nil; audioLevel = 0; recordingLimit?.cancel(); recordingLimit = nil
        recordedMinutes = max(0.01, min(8, result.duration / 60))
        UserDefaults.standard.set(recordedMinutes, forKey: "pending-recording-minutes")
        // Forced: a busy flag must never drop the saved answer or leave the live socket open (C-09).
        await perform(stage: "Сохраняю запись и проверяю текст", force: true) {
            liveFinalText = await liveTranscriber?.finish(expectedChunks: result.chunks)
            liveMinutes = liveTranscriber?.streamedMinutes ?? 0
            // A short credential response may still arrive after live fallback. Let it
            // finish so its known reservation is released, rather than losing the ticket.
            liveConnection = nil; liveTranscriber = nil
            operationStage = liveFinalText == nil ? "Распознаю полную запись" : "Сохраняю оригинал записи"
            try await uploadRecording()
        }
    }

    /// The app went to the background mid-answer: keep what was said (C-10).
    func handleBackground() async {
        guard recording else { return }
        audioRouteMessage = "Приложение ушло в фон. Сохраняем уже записанный ответ."
        await stopRecording()
    }

    func transcribeRecording() async {
        guard !orphanedRecording else {
            error = "Запись относится к занятию, которого уже нет. Прослушай её и удали."; return
        }
        guard localRecording != nil, !recording else { return }
        await perform(stage: "Повторяю распознавание записи") { try await uploadRecording() }
    }

    private func uploadRecording() async throws {
        guard let url = localRecording else { return }
        let boundary = "SmoothTalk-" + UUID().uuidString
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
        let payload = data
        let response = try await transmit(path: "transcribe") {
            var upload = URLRequest(url: try self.endpoint("transcribe"))
            upload.httpMethod = "POST"
            upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            upload.httpBody = payload
            return upload
        }
        let result = try JSONDecoder().decode(Transcription.self, from: response)
        draft = result.text; originalTranscript = result.text; recordedFile = result.audioFile
        try? FileManager.default.removeItem(at: url)
        localRecording = nil; hasUnuploadedRecording = false; orphanedRecording = false
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
        // A local-only pending answer must not keep the composer disabled (L-02).
        if let id = pendingMessageID, !serverHolds(id) { pendingMessageID = nil }
        liveTranscriptStatus = ""
    }

    // MARK: History, profile and data

    @discardableResult func deleteSession(id: String) async -> Bool {
        guard conversation?.id != id || !recording else { return false }
        var deleted = false
        await perform(stage: "Удаляю занятие") {
            let _: Confirmation = try await request("sessions/\(id)", method: "DELETE")
            deleted = true
        }
        guard deleted else { return false }
        if conversation?.id == id {
            stopSpeaking()
            conversationPresented = false
            conversation = nil
            draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil
        }
        savedDrafts.removeValue(forKey: id)
        if completionMoment?.sessionId == id { completionMoment = nil }
        refreshInBackground()
        return true
    }

    /// POST profile with every field the server requires; unchanged values are passed through.
    @discardableResult func saveProfile(name: String, goals: String, interests: [String], professionalContext: String,
                                        relocation: String, dailyMinutes: Int, feedback: String) async -> Bool {
        guard let current = state?.profile else { return false }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanGoals = goals.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallbackGoals = current.goals.isEmpty ? "Говорить увереннее" : current.goals
        let finalName: String = String((cleanName.isEmpty ? current.name : cleanName).prefix(80))
        let finalGoals: String = String((cleanGoals.isEmpty ? fallbackGoals : cleanGoals).prefix(3000))
        var finalInterests: [String] = []
        for interest in interests {
            let value = String(interest.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
            if !value.isEmpty && finalInterests.count < 20 { finalInterests.append(value) }
        }
        let minutes: Int = min(60, max(5, dailyMinutes))
        let retention: Int = min(180, max(7, current.audioRetentionDays))
        let budget: Double = min(50, max(1, current.budgetUsd))
        var body: [String: Any] = [:]
        body["name"] = finalName
        body["goals"] = finalGoals
        body["interests"] = finalInterests
        body["professionalContext"] = String(professionalContext.prefix(2000))
        body["relocation"] = String(relocation.prefix(1000))
        body["dailyMinutes"] = minutes
        body["feedback"] = String(feedback.prefix(1000))
        body["audioRetentionDays"] = retention
        body["budgetUsd"] = budget
        var saved = false
        await perform(stage: "Сохраняю профиль") {
            let updated: TrainingState = try await request("profile", body: body)
            apply(updated)
            saved = true
        }
        return saved
    }

    /// GET export → a JSON file in the temporary folder, ready for the share sheet.
    func exportData() async -> URL? {
        var file: URL?
        await perform(stage: "Готовлю файл с данными") {
            let data = try await fetchData("export")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("smooth-talk-export.json")
            try data.write(to: url, options: .atomic)
            file = url
        }
        return file
    }

    /// POST reset { confirmation: 'DELETE' } — removes all practice on the server.
    @discardableResult func resetAllTraining(confirmation: String) async -> Bool {
        guard confirmation == "DELETE", !recording, !microphoneStarting else { return false }
        var done = false
        await perform(stage: "Удаляю данные практики") {
            let updated: TrainingState = try await request("reset", body: ["confirmation": "DELETE"])
            stopSpeaking()
            conversationPresented = false
            conversation = nil
            savedDrafts.removeAll()
            draft = ""; recordedFile = nil; pendingMessageID = nil; hint = nil; completionMoment = nil
            apply(updated)
            done = true
        }
        return done
    }

    // MARK: Reminders

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
        reminderBusy = true
        defer { reminderBusy = false }
        await reloadReminderStatus()
    }
    private func reloadReminderStatus() async {
        notificationState = await reminderCenter.authorization()
        var pending = await reminderCenter.pending()
        if defaults.data(forKey: PracticeReminder.storageKey) == nil {
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
        pending = await refreshReminderBranding(in: pending)
        reminderEnabled = remindersAuthorized && reminders.contains { value in
            value.enabled && pending.contains { request in
                guard request.identifier == value.id, let trigger = request.trigger as? UNCalendarNotificationTrigger else { return false }
                return trigger.repeats && trigger.dateComponents.hour == value.hour && trigger.dateComponents.minute == value.minute
            }
        }
        if let first = reminders.first { reminderHour = first.hour; reminderMinute = first.minute }
    }
    private func refreshReminderBranding(in requests: [UNNotificationRequest]) async -> [UNNotificationRequest] {
        // A renamed app does not update the content of an already queued request.
        // Refresh only enabled, owned, matching requests; never prompt for permission
        // or recreate a missing schedule while passively opening Settings.
        guard remindersAuthorized else { return requests }
        var pending = requests
        for original in requests {
            guard PracticeReminder.owns(original.identifier),
                  let reminder = reminders.first(where: { $0.id == original.identifier && $0.enabled }),
                  let originalTrigger = original.trigger as? UNCalendarNotificationTrigger,
                  originalTrigger.repeats,
                  originalTrigger.dateComponents.hour == reminder.hour,
                  originalTrigger.dateComponents.minute == reminder.minute,
                  original.content.title != PracticeReminder.notificationTitle ||
                    original.content.userInfo["appVersion"] as? String != PracticeReminder.notificationVersion,
                  let content = original.content.mutableCopy() as? UNMutableNotificationContent else { continue }
            content.title = PracticeReminder.notificationTitle
            content.userInfo["appVersion"] = PracticeReminder.notificationVersion
            let replacement = UNNotificationRequest(identifier: original.identifier, content: content, trigger: original.trigger)
            do {
                // Reusing the identifier replaces one entry, including the exact
                // trigger/time zone, sound, body and custom metadata from its copy.
                try await reminderCenter.add(replacement)
                pending = await reminderCenter.pending()
                guard pending.contains(where: { request in
                    guard request.identifier == original.identifier,
                          let trigger = request.trigger as? UNCalendarNotificationTrigger else { return false }
                    return request.content.title == PracticeReminder.notificationTitle &&
                        request.content.userInfo["appVersion"] as? String == PracticeReminder.notificationVersion &&
                        trigger.repeats == originalTrigger.repeats && trigger.dateComponents == originalTrigger.dateComponents
                }) else { throw ClientError.message("iPhone не подтвердил обновление названия напоминания.") }
            } catch {
                // An add error can be ambiguous. Restore the exact previous request,
                // rather than canceling it or constructing a new default schedule.
                do { try await reminderCenter.add(original) }
                catch { reminderDiagnostic = "iPhone не подтвердил прежнее напоминание после обновления названия." }
                pending = await reminderCenter.pending()
            }
        }
        return pending
    }
    private func persistReminders(_ values: [PracticeReminder]) {
        reminders = PracticeReminder.ordered(values)
#if DEBUG
        if previewMode && PreviewFixtures.screen != nil { return }
#endif
        if let data = try? JSONEncoder().encode(reminders) { defaults.set(data, forKey: PracticeReminder.storageKey) }
    }
    private func requireReminderAuthorization() async throws {
        var authorization = await reminderCenter.authorization()
        if authorization == "notDetermined" {
            try await reminderCenter.requestAuthorization()
            authorization = await reminderCenter.authorization()
        }
        notificationState = authorization
        guard authorization == "authorized" || authorization == "provisional" else {
            throw ClientError.message("Уведомления выключены в iPhone. Открой настройки Smooth Talk и включи «Допуск уведомлений».")
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
            self.error = (error as? ClientError)?.localizedDescription ?? "iPhone отклонил напоминание. Проверь «Уведомления» в настройках Smooth Talk и попробуй ещё раз."
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
    /// Opening a practice reminder shows Today with its one next step (L-36).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard PracticeReminder.owns(response.notification.request.identifier) else { return }
        await MainActor.run {
            NotificationCenter.default.post(name: .smoothTalkOpenToday, object: nil)
        }
    }
}
