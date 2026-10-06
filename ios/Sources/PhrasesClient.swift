import Foundation
import SwiftUI

// «Запомнить» → «Мои фразы» on the iPhone (planning/v05/PASS-0.5.3.md §1.2, §1.6): the API calls on TrainingClient (the same
// requests as the web client), the phrase round start, the «Вернуть» window of «Удалить», enrichment polling and one shared
// store the phrases screens observe. The store lives outside TrainingClient, so polling never re-renders every screen.

enum PhraseTiming {
    /// Sol's take-apart is polled every 1.5 s for at most 30 s after a save (§1.6).
    static let pollInterval: Double = 1.5
    static let pollLimit: Double = 30
    /// «Вернуть» stays this long; only then the delete goes out (the 0.5.2 undo queue, web `UNDO_MS`).
    static let undoSeconds: Double = 6
    /// A queued entry (quick action, App Intent) waits this long after the shell settles, so a closing sheet has finished.
    static let settleMilliseconds = 550
}

/// Request bodies exactly as PASS-0.5.3 §1.2 lists them (pure, unit-tested).
enum PhraseRequests {
    /// `«С опорами»` is where a phrase round starts by default (§1.5).
    static let defaultRoundMode = "learning"

    static func path(_ id: String) -> String { "phrases/" + id }

    /// POST /api/phrases { text, origin }.
    static func create(_ text: String) -> [String: Any] { ["text": text, "origin": "iphone"] }

    /// POST /api/phrases/:id { archived?, relearn?: true, retryEnrichment?: true }: only what changes is sent.
    static func update(archived: Bool? = nil, relearn: Bool = false, retryEnrichment: Bool = false) -> [String: Any] {
        var body: [String: Any] = [:]
        if let archived { body["archived"] = archived }
        if relearn { body["relearn"] = true }
        if retryEnrichment { body["retryEnrichment"] = true }
        return body
    }

    /// POST /api/sessions: the usual start body with `phraseRound: true` (never with drillId, familyId or topic).
    static func round(mode: String, minutes: Int, requestId: String) -> [String: Any] {
        ["mode": mode, "phraseRound": true, "intent": "new", "minutes": minutes, "requestId": requestId]
    }
}

/// `{ phrase, duplicate }`: the same normalised text already saved comes back with `duplicate: true`.
struct PhraseCreateResult: Decodable {
    let phrase: SavedPhrase
    let duplicate: Bool

    init(phrase: SavedPhrase, duplicate: Bool) {
        self.phrase = phrase
        self.duplicate = duplicate
    }

    private enum CodingKeys: String, CodingKey { case phrase, duplicate }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        phrase = try c.decode(SavedPhrase.self, forKey: .phrase)
        duplicate = ((try? c.decodeIfPresent(Bool.self, forKey: .duplicate)) ?? nil) ?? false
    }
}

private struct PhraseEnvelope: Decodable { let phrase: SavedPhrase }
private struct PhraseDeletion: Decodable { let deleted: Bool? }
/// `ListenResponse { clip }`.
private struct ListenEnvelope: Decodable { let clip: ListenClip }

/// «Послушать» requests (PASS-0.5.4 §1.2), pure and unit-tested: the multipart body the iPhone uploads.
enum ListenRequests {
    /// POST /api/phrases/listen.
    static let upload = "phrases/listen"

    /// GET /api/phrases/listen/:id.
    static func path(_ id: String) -> String { upload + "/" + id }

    /// Whole seconds 1–180, as the server rounds them.
    static func seconds(_ duration: Double) -> Int {
        guard duration.isFinite else { return 1 }
        return min(ListenTiming.maxSeconds, max(1, Int(duration.rounded())))
    }

    /// The text fields next to the audio: `seconds`, `origin: 'iphone'`, `source: 'microphone'`.
    static func fields(seconds: Int) -> [(name: String, value: String)] {
        [(name: "seconds", value: String(seconds)), (name: "origin", value: "iphone"), (name: "source", value: "microphone")]
    }

    /// multipart/form-data: the fields, then `audio` (the WAV take from TaskRecorder).
    static func body(audio: Data, seconds: Int, boundary: String) -> Data {
        var data = Data()
        func append(_ value: String) { data.append(Data(value.utf8)) }
        for field in fields(seconds: seconds) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field.name)\"\r\n\r\n\(field.value)\r\n")
        }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"listen.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
        data.append(audio)
        append("\r\n--\(boundary)--\r\n")
        return data
    }

    /// A lost connection or a failing server: the same take can be sent again. A refusal (4xx) needs a new recording.
    static func canResend(_ error: Error) -> Bool {
        if let failure = error as? TrainingHTTPError { return failure.status >= 500 }
        return error is URLError
    }
}

// MARK: - API

extension TrainingClient {
    /// POST /api/phrases { text, origin: 'iphone' } → { phrase, duplicate }.
    func createPhrase(text: String) async throws -> PhraseCreateResult {
        guard let clean = PhraseLabels.captureText(text) else {
            throw ClientError.message(PhraseLabels.captureProblem(text) ?? "Напиши, что запомнить.")
        }
        return try await request("phrases", body: PhraseRequests.create(clean))
    }

    /// GET /api/phrases/:id → { phrase }.
    func fetchPhrase(id: String) async throws -> SavedPhrase {
        let envelope: PhraseEnvelope = try await request(PhraseRequests.path(id))
        return envelope.phrase
    }

    /// POST /api/phrases/:id { archived?, relearn?, retryEnrichment? } → { phrase }.
    func updatePhrase(id: String, archived: Bool? = nil, relearn: Bool = false, retryEnrichment: Bool = false) async throws -> SavedPhrase {
        let body = PhraseRequests.update(archived: archived, relearn: relearn, retryEnrichment: retryEnrichment)
        let envelope: PhraseEnvelope = try await request(PhraseRequests.path(id), body: body)
        return envelope.phrase
    }

    /// POST /api/phrases/:id/delete {} → { deleted: true }.
    func deletePhrase(id: String) async throws {
        let _: PhraseDeletion = try await request(PhraseRequests.path(id) + "/delete", body: [:])
    }

    /// «Послушать»: POST /api/phrases/listen (multipart: audio, seconds, origin 'iphone', source 'microphone') → { clip }.
    /// The server transcribes inside the request (a few seconds) and answers with the transcript while Sol explains it;
    /// refusals carry its Russian `{ error }` (400/402/412/413/422/429). An expired access cookie signs in again once.
    func uploadListenClip(url: URL, seconds: Double) async throws -> ListenClip {
        let audio = try Data(contentsOf: url)
#if DEBUG
        if previewMode {
            guard let fixture = previewResponses[ListenRequests.upload] else {
                throw ClientError.message("Предпросмотр не отправляет запросы к серверу.")
            }
            return try JSONDecoder().decode(ListenEnvelope.self, from: fixture).clip
        }
#endif
        let boundary = "SmoothTalk-" + UUID().uuidString
        let payload = ListenRequests.body(audio: audio, seconds: ListenRequests.seconds(seconds), boundary: boundary)
        let target = try endpoint(ListenRequests.upload)
        var upload = URLRequest(url: target)
        upload.httpMethod = "POST"
        upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        upload.httpBody = payload
        let data: Data
        do {
            data = try await checked(upload)
        } catch let failure as TrainingHTTPError where failure.status == 401 {
            guard await reauthenticate() else { throw failure }
            data = try await checked(upload)
        }
        return try JSONDecoder().decode(ListenEnvelope.self, from: data).clip
    }

    /// GET /api/phrases/listen/:id → { clip } (404 «Запись не найдена.»).
    func fetchListenClip(id: String) async throws -> ListenClip {
        let envelope: ListenEnvelope = try await request(ListenRequests.path(id))
        return envelope.clip
    }

    /// «Повторить»: a «Мои фразы» round, started like a drill (POST /api/sessions with the usual start body plus
    /// `phraseRound: true`). A retry after a failed start reuses its `requestId`, so the server never opens two rounds.
    /// 409 «Сейчас нечего повторять…» arrives as the usual «Не получилось» message.
    func startPhraseRound(mode: String = PhraseRequests.defaultRoundMode) async {
        guard !hasUnuploadedRecording else { error = TrainingClient.pendingRecordingGuidance; return }
        let store = PhrasesStore.shared
        guard startingIntent == nil, !busy, !recording, !microphoneStarting, !store.roundStarting else { return }
        store.roundStarting = true
        defer { store.roundStarting = false }
        let minutes = min(30, max(5, state?.profile.dailyMinutes ?? 15))
        let requestId = store.roundRequestID(mode: mode)
        var opened: Conversation?
        await perform(stage: "Собираю твои фразы") {
            let value: Conversation = try await request("sessions", body: PhraseRequests.round(mode: mode, minutes: minutes, requestId: requestId))
            store.roundAccepted()
            opened = value
        }
        guard let opened else { return }
        resume(opened)
        refreshInBackground()
    }
}

// MARK: - «Удалить» with «Вернуть»

/// The «Вернуть» window (MOTION-PASS 0.5.2 §8.4): a removed phrase leaves the list at once and the delete goes out only after
/// `PhraseTiming.undoSeconds`. Only the newest removal can be undone (one capsule, as on Today): scheduling another one sends
/// the older at once. Pure, unit-tested; `PhrasesStore` drives it with timers.
struct PhraseUndoWindow: Equatable {
    struct Entry: Equatable {
        let id: String
        let deadline: Date
        var committing: Bool
    }

    private(set) var entries: [Entry] = []

    /// Ids the list shows as gone: waiting for their window, or being deleted until the request settles.
    var hidden: Set<String> { Set(entries.map { $0.id }) }
    /// The removal «Вернуть» brings back.
    var undoable: String? { entries.last(where: { !$0.committing })?.id }

    /// Starts the window for `id`; returns the older waiting removals to commit right away, or nil when `id` is pending.
    mutating func schedule(_ id: String, now: Date) -> [String]? {
        guard !entries.contains(where: { $0.id == id }) else { return nil }
        let older = entries.filter { !$0.committing }.map { $0.id }
        entries.append(Entry(id: id, deadline: now.addingTimeInterval(PhraseTiming.undoSeconds), committing: false))
        return older
    }

    /// «Вернуть»: false once the delete is on its way (or `id` is unknown).
    mutating func cancel(_ id: String) -> Bool {
        guard let index = entries.firstIndex(where: { $0.id == id }), !entries[index].committing else { return false }
        entries.remove(at: index)
        return true
    }

    /// Removals whose window has ended.
    func expired(at now: Date) -> [String] {
        entries.filter { !$0.committing && $0.deadline <= now }.map { $0.id }
    }

    /// The delete request starts: «Вернуть» is no longer possible.
    mutating func beginCommit(_ id: String) -> Bool {
        guard let index = entries.firstIndex(where: { $0.id == id }), !entries[index].committing else { return false }
        entries[index].committing = true
        return true
    }

    /// The delete request settled (a failure brings the phrase back; the caller reports it).
    mutating func settle(_ id: String) {
        entries.removeAll { $0.id == id }
    }
}

// MARK: - Sheet route

/// What the one phrases sheet shows: the capture card first (Practice «Запомнить», the quick action, the App Intent) or
/// «Мои фразы» (Practice «Все», Today, «Мои фразы» after a save). Every capture request is a new sheet.
enum PhraseSheetRoute: Identifiable, Equatable {
    case capture(prefill: String?, token: UUID)
    case list

    static func captureSheet(_ prefill: String? = nil) -> PhraseSheetRoute { .capture(prefill: prefill, token: UUID()) }

    var id: String {
        switch self {
        case .capture(_, let token): return "capture-" + token.uuidString
        case .list: return "list"
        }
    }

    var isList: Bool {
        if case .list = self { return true }
        return false
    }
}

// MARK: - Store

/// Shared «Мои фразы» state for every screen: the sheet route, newer copies of phrases than the last `/api/state`, removals in
/// their «Вернуть» window, actions in flight and enrichment polling. Signing out resets it.
@MainActor final class PhrasesStore: ObservableObject {
    static let shared = PhrasesStore()

    @Published var route: PhraseSheetRoute?
    /// The last failed action, shown in the phrases sheet («Не получилось …»).
    @Published var notice: String?
    @Published private(set) var undo = PhraseUndoWindow()
    @Published private(set) var removed: Set<String> = []
    @Published private(set) var working: Set<String> = []
    @Published private(set) var polling: Set<String> = []
    @Published fileprivate(set) var roundStarting = false
    @Published private var fresh: [String: FreshPhrase] = [:]
#if DEBUG
    /// Previews: the row «Мои фразы» opens expanded, and the capture card that starts saved.
    var previewExpanded: String?
    var previewSavedID: String?
    /// Previews: the capture card that starts in a «Послушать» state (`listen-recording`, `listen-analysing`, `listen-ready`).
    var previewListen: String?
#endif
    private var pendingRound: String?
    private var roundRequest: (mode: String, id: String)?
    /// The phrase «Мои фразы» opens in place (a chip on Practice); the list takes it once.
    private var focusPhrase: String?
    private var undoTimers: [String: Task<Void, Never>] = [:]
    private var pollers: [String: Task<Void, Never>] = [:]

    init() {}

    // Opening.

    /// «Все», the Today row, a chip (`focus`: that phrase opens in place).
    func openList(focus: String? = nil) {
        focusPhrase = focus
        route = .list
    }

    /// «Запомнить» inside the app.
    func openCapture(_ prefill: String? = nil) {
        route = .captureSheet(prefill)
    }

    func takeFocus() -> String? {
        defer { focusPhrase = nil }
        return focusPhrase
    }

    // Reading.

    /// Every phrase the screens show (newest first): the server list, newer local copies, minus removals.
    func phrases(in state: TrainingState?, lastRefresh: Date?) -> [SavedPhrase] {
        PhraseLabels.merge(server: state?.phrases ?? [], fresh: Array(fresh.values), lastRefresh: lastRefresh,
                           hidden: undo.hidden.union(removed))
    }

    func overview(in state: TrainingState?, lastRefresh: Date?, now: Date = Date()) -> PhrasesOverview {
        PhraseLabels.overview(phrases(in: state, lastRefresh: lastRefresh), now: now)
    }

    /// The newest copy of one phrase (the capture card follows it while Sol works), removals included.
    func latest(_ id: String, in state: TrainingState?) -> SavedPhrase? {
        let server = state?.phrases?.first { $0.id == id }
        let local = fresh[id]?.phrase
        if let server, let local {
            return PhraseClock.date(local.updatedAt) >= PhraseClock.date(server.updatedAt) ? local : server
        }
        return local ?? server
    }

    // Writing.

    /// A copy the server returned (create, GET, an action). An older copy never replaces a newer one.
    func upsert(_ phrase: SavedPhrase) {
        if let current = fresh[phrase.id]?.phrase {
            if current == phrase { return }
            if PhraseClock.date(current.updatedAt) > PhraseClock.date(phrase.updatedAt) { return }
        }
        fresh[phrase.id] = FreshPhrase(phrase: phrase, receivedAt: Date())
    }

    /// «Запомнить»: POST /api/phrases. The card already said «Запомнил!»; a phrase Sol still works on is polled.
    func create(_ text: String, client: TrainingClient) async throws -> PhraseCreateResult {
        let result = try await client.createPhrase(text: text)
        upsert(result.phrase)
        if result.phrase.enrichment == .pending { poll(result.phrase.id, client: client) }
        client.refreshInBackground()
        return result
    }

    /// «Уже знаю», «Вернуть в повторение», «Повторить разбор». A refusal shows the server's words; anything else `failure`
    /// with the reason (web: «Не удалось отметить фразу.» and so on).
    func update(_ phrase: SavedPhrase, archived: Bool? = nil, relearn: Bool = false, retryEnrichment: Bool = false,
                failure: String = "Не удалось выполнить действие.", client: TrainingClient) async {
        guard !working.contains(phrase.id) else { return }
        working.insert(phrase.id)
        notice = nil
        defer { working.remove(phrase.id) }
        do {
            let updated = try await client.updatePhrase(id: phrase.id, archived: archived, relearn: relearn, retryEnrichment: retryEnrichment)
            upsert(updated)
            if updated.enrichment == .pending { poll(updated.id, client: client) }
            client.refreshInBackground()
        } catch let refusal as TrainingHTTPError where !refusal.message.isEmpty {
            notice = refusal.message
        } catch {
            notice = failure + " " + TrainingClient.describe(error)
        }
    }

    /// «Удалить»: the phrase leaves at once; «Вернуть» stays for six seconds, then POST …/delete.
    func remove(_ phrase: SavedPhrase, client: TrainingClient) {
        guard let older = undo.schedule(phrase.id, now: Date()) else { return }
        for id in older { commitRemoval(id, client: client) }
        let id = phrase.id
        undoTimers[id] = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(PhraseTiming.undoSeconds)) } catch { return }
            self?.commitRemoval(id, client: client)
        }
    }

    /// «Вернуть»: the newest removal comes back (never once its delete is on its way).
    func undoRemoval() {
        guard let id = undo.undoable, undo.cancel(id) else { return }
        undoTimers.removeValue(forKey: id)?.cancel()
    }

    private func commitRemoval(_ id: String, client: TrainingClient) {
        guard undo.beginCommit(id) else { return }
        undoTimers.removeValue(forKey: id)?.cancel()
        Task { [weak self] in
            var failure: String?
            do {
                try await client.deletePhrase(id: id)
            } catch let error as TrainingHTTPError where error.status == 404 {
                // Already gone (deleted on the PC): the same result.
            } catch {
                failure = "Не удалось удалить фразу. Она вернулась в список."
            }
            guard let self else { return }
            if let failure {
                self.notice = failure
            } else {
                self.removed.insert(id)
                self.fresh.removeValue(forKey: id)
                client.refreshInBackground()
            }
            self.undo.settle(id)
        }
    }

    /// GET /api/phrases/:id every 1.5 s for up to 30 s while Sol works on it (one poller per phrase, whatever screen is open).
    func poll(_ id: String, client: TrainingClient) {
        guard pollers[id] == nil, !client.isFeaturePreview else { return }
        polling.insert(id)
        pollers[id] = Task { [weak self] in
            let deadline = Date().addingTimeInterval(PhraseTiming.pollLimit)
            while !Task.isCancelled, Date() < deadline {
                do { try await Task.sleep(for: .seconds(PhraseTiming.pollInterval)) } catch { break }
                do {
                    let phrase = try await client.fetchPhrase(id: id)
                    self?.upsert(phrase)
                    if phrase.enrichment != .pending { break }
                } catch let error as TrainingHTTPError where error.status == 404 {
                    break
                } catch {
                    // Offline for a moment: keep trying until the deadline.
                }
            }
            guard let self, !Task.isCancelled else { return }
            self.pollers[id] = nil
            self.polling.remove(id)
            // Today and Practice counts follow a phrase that just became usable.
            client.refreshInBackground()
        }
    }

    // Phrase round.

    /// «Повторить» inside the sheet: the round starts once the sheet is gone (two sheets never present at once).
    func requestRound(mode: String = PhraseRequests.defaultRoundMode) {
        pendingRound = mode
        route = nil
    }

    func takePendingRound() -> String? {
        defer { pendingRound = nil }
        return pendingRound
    }

    fileprivate func roundRequestID(mode: String) -> String {
        if let current = roundRequest, current.mode == mode { return current.id }
        let id = UUID().uuidString.lowercased()
        roundRequest = (mode: mode, id: id)
        return id
    }

    fileprivate func roundAccepted() { roundRequest = nil }

    /// Signing out: nothing of this account stays on screen and no timer sends anything later.
    func reset() {
        for task in undoTimers.values { task.cancel() }
        for task in pollers.values { task.cancel() }
        undoTimers.removeAll()
        pollers.removeAll()
        undo = PhraseUndoWindow()
        removed.removeAll()
        working.removeAll()
        polling.removeAll()
        fresh.removeAll()
        route = nil
        notice = nil
        pendingRound = nil
        roundRequest = nil
        focusPhrase = nil
        roundStarting = false
    }
}
