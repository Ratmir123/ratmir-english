import Foundation
import SwiftUI

// Stores for the 0.5 placement test and real calls. Both talk to the server only through
// TrainingClient (request / endpoint / checked / session) and refresh TrainingState after
// mutations so Today, Progress and Profile stay consistent with what these screens show.

extension TrainingClient {
    /// True while synthetic preview fixtures drive the app (DEBUG builds only).
    var isFeaturePreview: Bool {
#if DEBUG
        return previewMode
#else
        return false
#endif
    }

    /// PUT/DELETE/binary requests that `request()` does not cover. Never throws on HTTP status,
    /// so callers can read resume points from 409 bodies.
    func featureRaw(_ path: String, method: String, body: Data? = nil, contentType: String? = nil,
                    headers: [String: String] = [:]) async throws -> (data: Data, status: Int) {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.httpBody = body
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ClientError.message("Нет ответа сервера.") }
        return (data, http.statusCode)
    }

    /// GET binary content (audio clips, TTS files, processed call audio).
    func featureDownload(_ path: String) async throws -> Data {
        try await checked(URLRequest(url: endpoint(path)))
    }

    /// Refreshes TrainingState after a feature mutation. A failed refresh never turns a
    /// successful action into an error: the screen already shows the server's answer.
    func featureRefresh() async {
        if isFeaturePreview { return }
        do { try await refresh() } catch { }
    }

    static func featureServerMessage(_ data: Data, status: Int) -> String {
        if let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let text = object["error"] as? String, !text.isEmpty { return text }
        return "Ошибка сервера (\(status)). Повтори чуть позже."
    }
}

// MARK: - Placement

@MainActor final class PlacementStore: ObservableObject {
    let client: TrainingClient
    @Published private(set) var view: PlacementView?
    @Published private(set) var loading = false
    @Published private(set) var working = false
    @Published private(set) var workingStage: String?
    @Published var error: String?
    @Published private(set) var pollFailures = 0
    /// Section intros already shown in this attempt ("attempt|section").
    @Published private(set) var seenIntros: Set<String> = []
    /// Attempts whose sitting break was acknowledged («Продолжить сейчас»).
    @Published private(set) var acknowledgedBreaks: Set<String> = []
    private var clipCache: [String: Data] = [:]

    init(client: TrainingClient) {
        self.client = client
        self.view = client.state?.placement
#if DEBUG
        if let fixture = FeaturePreviewFixtures.placementView(for: PreviewFixtures.screen) { self.view = fixture }
#endif
    }

    var isPreview: Bool { client.isFeaturePreview }

    func introKey(_ section: PlacementSectionView) -> String { (view?.attemptId ?? "attempt") + "|" + section.id }
    func markIntroSeen(_ section: PlacementSectionView) { seenIntros.insert(introKey(section)) }
    func acknowledgeBreak() { acknowledgedBreaks.insert(view?.attemptId ?? "attempt") }

    func load() async {
        if isPreview { return }
        loading = view == nil
        defer { loading = false }
        do {
            let value: PlacementView = try await client.request("placement")
            view = value
            if value.phase != .error { error = nil }
        } catch {
            if view == nil { self.error = FeatureErrorText.describe(error) }
        }
    }

    @discardableResult func start(retake: Bool) async -> Bool {
        await mutate("placement/start", body: ["retake": retake], stage: retake ? "Готовлю новую попытку" : "Готовлю тест", refresh: true)
    }

    @discardableResult func answer(taskId: String, choice: Int, plays: Int?, elapsedMs: Int) async -> Bool {
        var body: [String: Any] = ["taskId": taskId, "choice": choice, "elapsedMs": max(0, elapsedMs)]
        if let plays { body["plays"] = plays }
        return await mutate("placement/answer", body: body, stage: nil, refresh: false)
    }

    @discardableResult func speak(taskId: String, transcription: FeatureTranscription) async -> Bool {
        // The test never edits transcripts: the original recognition is also the submitted text.
        await mutate("placement/speak", body: ["taskId": taskId, "text": transcription.text,
                                              "audioFile": transcription.audioFile, "originalTranscript": transcription.text],
                     stage: "Сохраняю ответ", refresh: false)
    }

    @discardableResult func skip(section: String, reason: String) async -> Bool {
        await mutate("placement/skip", body: ["section": section, "reason": reason], stage: "Пропускаю раздел", refresh: true)
    }

    @discardableResult func rescore() async -> Bool {
        await mutate("placement/rescore", body: [:], stage: "Запускаю подсчёт", refresh: true)
    }

    @discardableResult func abandon() async -> Bool {
        await mutate("placement/abandon", body: [:], stage: "Сбрасываю попытку", refresh: true)
    }

    private func mutate(_ path: String, body: [String: Any], stage: String?, refresh: Bool) async -> Bool {
        guard !working else { return false }
        if isPreview { return false }
        working = true
        workingStage = stage
        error = nil
        defer { working = false; workingStage = nil }
        do {
            let value: PlacementView = try await client.request(path, body: body)
            let finished = value.phase != view?.phase && (value.phase == .scoring || value.phase == .completed)
            view = value
            if refresh || finished { await client.featureRefresh() }
            return true
        } catch {
            self.error = FeatureErrorText.describe(error)
            // A stale task (409) or a lost connection: show whatever the server considers current.
            if let value: PlacementView = try? await client.request("placement") { view = value }
            return false
        }
    }

    /// Polls every 2.5 s while scoring; backs off on errors and reports only after 3 failures in a row.
    func pollWhileScoring() async {
        if isPreview { return }
        var failures = 0
        while !Task.isCancelled, view?.phase == .scoring {
            let delay = failures == 0 ? 2.5 : min(20, 2.5 * pow(2, Double(failures)))
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            do {
                let value: PlacementView = try await client.request("placement")
                failures = 0
                pollFailures = 0
                view = value
                if value.phase != .scoring { await client.featureRefresh() }
            } catch {
                if FeatureErrorText.isCancellation(error) { return }
                failures += 1
                pollFailures = failures
                if failures >= 3 { self.error = "Не получается узнать результат. " + FeatureErrorText.describe(error) }
            }
        }
    }

    /// Listening clips and roleplay lines (relative API paths), cached for this attempt.
    func clip(_ path: String) async throws -> Data {
        if let cached = clipCache[path] { return cached }
        if isPreview { throw ClientError.message("В предпросмотре звук не загружается.") }
        let data = try await client.featureDownload(path)
        if clipCache.count > 24 { clipCache.removeAll() }
        clipCache[path] = data
        return data
    }

    func refreshClientState() async { await client.featureRefresh() }
}

// MARK: - Calls

@MainActor final class CallsStore: ObservableObject {
    let client: TrainingClient
    @Published private(set) var calls: [CallSummary] = []
    @Published private(set) var details: [String: CallDetail] = [:]
    @Published private(set) var loadingDetails: Set<String> = []
    /// Call id (or "fact:<id>", "pattern:<id>", "segment:<id>") with an action in flight.
    @Published private(set) var busyKeys: Set<String> = []
    @Published var error: String?
    @Published var notice: String?
    @Published private(set) var patternsOverride: [CommunicationPattern]?
    @Published private(set) var factsOverride: [ProfileFact]?
    @Published private(set) var drillsOverride: [PersonalDrill]?
    private var audioFiles: [String: URL] = [:]
    private var speechCache: [String: Data] = [:]

    init(client: TrainingClient) {
        self.client = client
        calls = client.state?.calls ?? []
#if DEBUG
        let screen = PreviewFixtures.screen
        if let fixture = FeaturePreviewFixtures.calls(for: screen) { calls = fixture }
        details = FeaturePreviewFixtures.callDetails(for: screen)
        if client.state?.patterns == nil { patternsOverride = FeaturePreviewFixtures.patterns(for: screen) }
        if client.state?.profileFacts == nil { factsOverride = FeaturePreviewFixtures.facts(for: screen) }
        if client.state?.drills == nil { drillsOverride = FeaturePreviewFixtures.drills(for: screen) }
#endif
    }

    var isPreview: Bool { client.isFeaturePreview }
    var isAnyProcessing: Bool { calls.contains { $0.isProcessing } }
    /// Changes only when the set of processing calls changes (not on every progress tick).
    var pollKey: String { calls.filter { $0.isProcessing }.map { $0.id }.joined(separator: ",") }
    var patterns: [CommunicationPattern] { patternsOverride ?? client.state?.patterns ?? [] }
    var drills: [PersonalDrill] { drillsOverride ?? client.state?.drills ?? [] }
    var facts: [ProfileFact] { factsOverride ?? client.state?.profileFacts ?? [] }

    func isBusy(_ key: String) -> Bool { busyKeys.contains(key) }

    /// Adopts the list from the latest TrainingState (after any refresh elsewhere in the app).
    func adoptState() {
        if isPreview { return }
        if let fromState = client.state?.calls { calls = fromState }
        patternsOverride = nil
        factsOverride = nil
    }

    func reload() async {
        if isPreview { return }
        do {
            let envelope: CallsEnvelope = try await client.request("calls")
            calls = envelope.calls
        } catch {
            if calls.isEmpty, !FeatureErrorText.isCancellation(error) { self.error = FeatureErrorText.describe(error) }
        }
    }

    func summary(_ id: String) -> CallSummary? {
        details[id]?.summary ?? calls.first { $0.id == id }
    }

    func loadDetail(_ id: String) async {
        if isPreview { return }
        loadingDetails.insert(id)
        defer { loadingDetails.remove(id) }
        do {
            let detail: CallDetail = try await client.request("calls/\(id)")
            store(detail)
        } catch {
            if !FeatureErrorText.isCancellation(error) { self.error = FeatureErrorText.describe(error) }
        }
    }

    private func store(_ detail: CallDetail) {
        details[detail.id] = detail
        if let index = calls.firstIndex(where: { $0.id == detail.id }) { calls[index] = detail.summary }
        else { calls.insert(detail.summary, at: 0) }
    }

    /// Every 3 s while any call is processing and the list is visible. A call leaving processing
    /// refreshes TrainingState once (new patterns, drills and facts).
    func pollProcessing() async {
        if isPreview { return }
        var failures = 0
        while !Task.isCancelled, isAnyProcessing {
            let delay = failures == 0 ? 3 : min(30, 3 * pow(2, Double(failures)))
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            let before = Set(calls.filter { $0.isProcessing }.map { $0.id })
            do {
                let envelope: CallsEnvelope = try await client.request("calls")
                failures = 0
                calls = envelope.calls
                let still = Set(calls.filter { $0.isProcessing }.map { $0.id })
                if !before.subtracting(still).isEmpty {
                    await client.featureRefresh()
                    patternsOverride = nil
                    factsOverride = nil
                }
            } catch {
                if FeatureErrorText.isCancellation(error) { return }
                failures += 1
            }
        }
    }

    /// Every 3 s while this call is processing (detail screen).
    func pollDetail(_ id: String) async {
        if isPreview { return }
        var failures = 0
        while !Task.isCancelled, let current = summary(id), current.isProcessing {
            let delay = failures == 0 ? 3 : min(30, 3 * pow(2, Double(failures)))
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            do {
                let detail: CallDetail = try await client.request("calls/\(id)")
                failures = 0
                store(detail)
                if !detail.summary.isProcessing {
                    await client.featureRefresh()
                    patternsOverride = nil
                    factsOverride = nil
                }
            } catch {
                if FeatureErrorText.isCancellation(error) { return }
                failures += 1
            }
        }
    }

    private func perform(_ key: String, _ action: () async throws -> Void) async -> Bool {
        guard !busyKeys.contains(key) else { return false }
        if isPreview {
            notice = "В предпросмотре изменения не сохраняются."
            return false
        }
        busyKeys.insert(key)
        error = nil
        defer { busyKeys.remove(key) }
        do {
            try await action()
            return true
        } catch {
            if !FeatureErrorText.isCancellation(error) { self.error = FeatureErrorText.describe(error) }
            return false
        }
    }

    @discardableResult func confirmSpeakers(callId: String, me: String, labels: [String: String]) async -> Bool {
        await perform(callId) {
            var body: [String: Any] = ["me": me]
            let clean = labels.compactMapValues { value -> String? in
                let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return text.isEmpty ? nil : String(text.prefix(60))
            }
            if !clean.isEmpty { body["labels"] = clean }
            let detail: CallDetail = try await client.request("calls/\(callId)/speakers", body: body)
            store(detail)
            await client.featureRefresh()
        }
    }

    @discardableResult func updateDetails(callId: String, title: String, counterpart: String, context: String) async -> Bool {
        await perform(callId) {
            let body: [String: Any] = ["title": String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)),
                                       "counterpart": String(counterpart.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)),
                                       "context": context]
            let detail: CallDetail = try await client.request("calls/\(callId)/details", body: body)
            store(detail)
            await client.featureRefresh()
        }
    }

    @discardableResult func retry(callId: String) async -> Bool {
        await perform(callId) {
            let detail: CallDetail = try await client.request("calls/\(callId)/retry", body: [:])
            store(detail)
            await client.featureRefresh()
        }
    }

    @discardableResult func reanalyse(callId: String, notes: String?) async -> Bool {
        await perform(callId) {
            var body: [String: Any] = [:]
            if let notes, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { body["notes"] = String(notes.prefix(4000)) }
            let detail: CallDetail = try await client.request("calls/\(callId)/reanalyse", body: body)
            store(detail)
            await client.featureRefresh()
        }
    }

    @discardableResult func delete(callId: String) async -> Bool {
        let succeeded = await perform(callId) {
            let response = try await client.featureRaw("calls/\(callId)", method: "DELETE")
            guard (200..<300).contains(response.status) || response.status == 404 else {
                throw ClientError.message(TrainingClient.featureServerMessage(response.data, status: response.status))
            }
            details.removeValue(forKey: callId)
            calls.removeAll { $0.id == callId }
            if let url = audioFiles.removeValue(forKey: callId) { try? FileManager.default.removeItem(at: url) }
            CallUploadCenter.shared.forgetLocalFile(callId)
            await client.featureRefresh()
            patternsOverride = nil
            factsOverride = nil
        }
        return succeeded
    }

    @discardableResult func setDisputed(callId: String, segmentId: String, disputed: Bool) async -> Bool {
        await perform("segment:" + segmentId) {
            let detail: CallDetail = try await client.request("calls/\(callId)/segments",
                                                              body: ["segmentId": segmentId, "disputed": disputed])
            store(detail)
        }
    }

    @discardableResult func decideFact(factId: String, accept: Bool) async -> Bool {
        await perform("fact:" + factId) {
            let envelope: FactsEnvelope = try await client.request("facts", body: ["factId": factId, "decision": accept ? "accept" : "reject"])
            factsOverride = envelope.profileFacts
            await client.featureRefresh()
            factsOverride = nil
            if client.state?.profileFacts == nil { factsOverride = envelope.profileFacts }
            // Facts suggested by a call also live in its detail; reload the open ones lazily.
            for id in details.keys where details[id]?.facts.contains(where: { $0.id == factId }) == true {
                if let detail: CallDetail = try? await client.request("calls/\(id)") { store(detail) }
            }
        }
    }

    @discardableResult func updatePattern(id: String, confirm: Bool? = nil, dismiss: Bool? = nil, note: String? = nil) async -> Bool {
        await perform("pattern:" + id) {
            var body: [String: Any] = [:]
            if let confirm { body["confirm"] = confirm }
            if let dismiss { body["dismiss"] = dismiss }
            if let note { body["note"] = note }
            let envelope: PatternsEnvelope = try await client.request("patterns/\(id)", body: body)
            patternsOverride = envelope.patterns
            await client.featureRefresh()
            if client.state?.patterns != nil { patternsOverride = nil }
        }
    }

    /// TTS of a model line («Как сказать сильнее»). Returns audio bytes, cached per text.
    func speech(for text: String) async throws -> Data {
        let clean = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(600))
        guard !clean.isEmpty else { throw ClientError.message("Нечего озвучить.") }
        if let cached = speechCache[clean] { return cached }
        if isPreview { throw ClientError.message("В предпросмотре озвучка выключена.") }
        let file: FeatureSpeechFile = try await client.request("tts", body: ["text": clean])
        let data = try await client.featureDownload("audio/\(file.file)")
        if speechCache.count > 30 { speechCache.removeAll() }
        speechCache[clean] = data
        return data
    }

    /// Processed call audio, downloaded once into Caches and reused for every seek.
    func callAudio(callId: String, path: String) async throws -> URL {
        if let url = audioFiles[callId], FileManager.default.fileExists(atPath: url.path) { return url }
        if isPreview { throw ClientError.message("В предпросмотре аудио звонка не загружается.") }
        let data = try await client.featureDownload(path)
        let folder = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("CallAudio", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(callId.replacingOccurrences(of: "/", with: "-") + ".mp3")
        try data.write(to: url, options: .atomic)
        audioFiles[callId] = url
        return url
    }

    func refreshClientState() async {
        if isPreview { return }
        await client.featureRefresh()
        patternsOverride = nil
        factsOverride = nil
    }
}
