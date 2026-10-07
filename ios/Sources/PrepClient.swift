import Foundation
import SwiftUI
import UIKit
import ImageIO
import UniformTypeIdentifiers

// «Подготовка к созвону» on the iPhone (planning/v05/PASS-0.5.5.md §2): the API calls on TrainingClient (the same requests as
// the web client), screenshots scaled for the upload, and one shared store the screens observe (the newest copies of preps,
// polling while Sol reads a chat, retry and delete). The store lives outside TrainingClient, so polling never re-renders
// every screen.

// MARK: - Screenshots

/// A screenshot ready for `POST /api/preps`: JPEG 0.86 (or the original PNG when that is smaller), long side ≤ 2048 px.
struct PrepUpload: Equatable {
    let data: Data
    /// `image/jpeg` or `image/png`.
    let mime: String
    let pixelWidth: Int
    let pixelHeight: Int

    var fileExtension: String { mime == "image/png" ? "png" : "jpg" }
}

/// Turns whatever the learner picked (HEIC, PNG, JPEG, a pasted image…) into an upload and a small thumbnail. Pure and
/// thread-safe: the sheet runs it off the main thread.
enum PrepImages {
    enum Problem: LocalizedError, Equatable {
        case unreadable
        case tooLarge
        var errorDescription: String? {
            switch self {
            case .unreadable: return "Не получилось открыть картинку. Попробуй другой скриншот."
            case .tooLarge: return "Скриншот слишком большой: до 8 МБ."
            }
        }
    }

    /// Long side of the thumbnails in the sheet.
    static let thumbnailSide = 320

    /// Scales the long side down to `PrepLimits.imageLongSide` (never up), applies the EXIF orientation, flattens transparency
    /// on white and encodes JPEG 0.86; an original PNG that already fits and is smaller is sent as it is.
    static func prepare(_ data: Data, longSide: Int = PrepLimits.imageLongSide) throws -> PrepUpload {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) > 0 else { throw Problem.unreadable }
        let size = pixelSize(source)
        let longest = max(size.width, size.height)
        let target = longest > 0 ? min(longSide, longest) : longSide
        guard let image = thumbnail(source, maxPixel: target) else { throw Problem.unreadable }
        let width = image.width
        let height = image.height
        var quality = PrepLimits.jpegQuality
        var jpeg = try encodeJPEG(image, quality: quality)
        while jpeg.count > PrepLimits.maxImageBytes && quality > 0.5 {
            quality -= 0.12
            jpeg = try encodeJPEG(image, quality: quality)
        }
        let type = CGImageSourceGetType(source) as String?
        let isPNG = type == UTType.png.identifier
        let orientation = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])?[kCGImagePropertyOrientation] as? Int ?? 1
        if isPNG, orientation == 1, longest > 0, longest <= longSide, data.count <= jpeg.count, data.count <= PrepLimits.maxImageBytes {
            return PrepUpload(data: data, mime: "image/png", pixelWidth: size.width, pixelHeight: size.height)
        }
        guard jpeg.count <= PrepLimits.maxImageBytes else { throw Problem.tooLarge }
        return PrepUpload(data: jpeg, mime: "image/jpeg", pixelWidth: width, pixelHeight: height)
    }

    /// The sheet's thumbnail (decoded once, small).
    static func thumbnail(_ data: Data, side: Int = thumbnailSide) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = thumbnail(source, maxPixel: side) else { return nil }
        return UIImage(cgImage: image)
    }

    /// Pixel width and height of the first image (before orientation).
    static func pixelSize(_ data: Data) -> (width: Int, height: Int)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let size = pixelSize(source)
        return size.width > 0 && size.height > 0 ? size : nil
    }

    private static func pixelSize(_ source: CGImageSource) -> (width: Int, height: Int) {
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = properties?[kCGImagePropertyPixelWidth] as? Int ?? 0
        let height = properties?[kCGImagePropertyPixelHeight] as? Int ?? 0
        return (width, height)
    }

    private static func thumbnail(_ source: CGImageSource, maxPixel: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixel),
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    /// JPEG has no alpha: the screenshot is drawn on white first, so a transparent area never turns black.
    private static func encodeJPEG(_ image: CGImage, quality: Double) throws -> Data {
        let size = CGSize(width: image.width, height: image.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let data = renderer.jpegData(withCompressionQuality: CGFloat(quality)) { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIImage(cgImage: image).draw(in: CGRect(origin: .zero, size: size))
        }
        guard !data.isEmpty else { throw Problem.unreadable }
        return data
    }
}

// MARK: - Requests

/// Request paths and bodies exactly as PASS-0.5.5 §2 lists them (pure, unit-tested).
enum PrepRequests {
    /// POST (multipart) creates, GET lists.
    static let collection = "preps"

    static func path(_ id: String) -> String { collection + "/" + id }
    static func retry(_ id: String) -> String { path(id) + "/retry" }
    static func delete(_ id: String) -> String { path(id) + "/delete" }

    /// `callAt` as the server reads it (ISO 8601, UTC).
    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// The text fields next to the screenshots: only what he filled in (trimmed and clipped to the server limits), then
    /// `origin: 'ios'`.
    static func fields(text: String, goal: String, callAt: Date?) -> [(name: String, value: String)] {
        var fields: [(name: String, value: String)] = []
        let cleanText = PhraseLabels.prefix(text.trimmingCharacters(in: .whitespacesAndNewlines), utf16: PrepLimits.textLimit)
        let cleanGoal = PhraseLabels.prefix(goal.trimmingCharacters(in: .whitespacesAndNewlines), utf16: PrepLimits.goalLimit)
        if !cleanText.isEmpty { fields.append((name: "text", value: cleanText)) }
        if !cleanGoal.isEmpty { fields.append((name: "goal", value: cleanGoal)) }
        if let callAt { fields.append((name: "callAt", value: iso(callAt))) }
        fields.append((name: "origin", value: "ios"))
        return fields
    }

    /// multipart/form-data: the fields, then one `images` part per screenshot (`screenshot-1.jpg`, …).
    static func body(images: [PrepUpload], text: String, goal: String, callAt: Date?, boundary: String) -> Data {
        var data = Data()
        func append(_ value: String) { data.append(Data(value.utf8)) }
        for field in fields(text: text, goal: goal, callAt: callAt) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field.name)\"\r\n\r\n\(field.value)\r\n")
        }
        for (index, image) in images.prefix(PrepLimits.maxImages).enumerated() {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"screenshot-\(index + 1).\(image.fileExtension)\"\r\n")
            append("Content-Type: \(image.mime)\r\n\r\n")
            data.append(image.data)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        return data
    }

    /// POST /api/sessions: the rehearsal is started like a drill (`TrainingClient.startPrepRehearsal` adds the usual
    /// `intent`, `minutes` and `requestId`).
    static func rehearsal(prepId: String, mode: String) -> [String: Any] {
        ["prepId": prepId, "mode": mode == "learning" ? "learning" : "call"]
    }
}

/// `{ prep }`.
struct PrepEnvelope: Decodable { let prep: CallPrep }
/// `{ preps }`, newest first, up to 30; one prep in a newer format never hides the others.
struct PrepListEnvelope: Decodable {
    let preps: [CallPrep]
    private enum CodingKeys: String, CodingKey { case preps }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        preps = ((try? c.decodeIfPresent(TolerantList<CallPrep>.self, forKey: .preps)) ?? nil)?.values ?? []
    }
}
private struct PrepDeletion: Decodable { let ok: Bool? }

// MARK: - API

extension TrainingClient {
    /// POST /api/preps (multipart: images, text, goal, callAt, origin 'ios') → 201 { prep } with status 'reading'.
    /// Refusals carry the server's Russian `{ error }` (400 nothing to read, 413 too large, 429 the daily limit).
    func createPrep(images: [PrepUpload], text: String, goal: String, callAt: Date?) async throws -> CallPrep {
        guard PrepLabels.canSubmit(images: images.count, text: text) else { throw ClientError.message(PrepCopy.empty) }
        guard images.count <= PrepLimits.maxImages else { throw ClientError.message("Можно до 8 скриншотов.") }
        guard images.reduce(0, { $0 + $1.data.count }) <= PrepLimits.maxTotalBytes else {
            throw ClientError.message("Скриншоты слишком большие: вместе до 32 МБ.")
        }
#if DEBUG
        if previewMode {
            guard let fixture = previewResponses[PrepRequests.collection] else {
                throw ClientError.message("Предпросмотр не отправляет запросы к серверу.")
            }
            return try JSONDecoder().decode(PrepEnvelope.self, from: fixture).prep
        }
#endif
        let boundary = "SmoothTalk-" + UUID().uuidString
        let payload = PrepRequests.body(images: images, text: text, goal: goal, callAt: callAt, boundary: boundary)
        var upload = URLRequest(url: try endpoint(PrepRequests.collection))
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
        return try JSONDecoder().decode(PrepEnvelope.self, from: data).prep
    }

    /// GET /api/preps/:id → { prep }.
    func fetchPrep(id: String) async throws -> CallPrep {
        let envelope: PrepEnvelope = try await request(PrepRequests.path(id))
        return envelope.prep
    }

    /// GET /api/preps → { preps } (newest first, up to 30).
    func listPreps() async throws -> [CallPrep] {
        let envelope: PrepListEnvelope = try await request(PrepRequests.collection)
        return envelope.preps
    }

    /// POST /api/preps/:id/retry {} → { prep }, reading again (only a failed prep).
    func retryPrep(id: String) async throws -> CallPrep {
        let envelope: PrepEnvelope = try await request(PrepRequests.retry(id), body: [:])
        return envelope.prep
    }

    /// POST /api/preps/:id/delete {} → { ok: true }. Its rehearsals stay in the lesson history.
    func deletePrep(id: String) async throws {
        let _: PrepDeletion = try await request(PrepRequests.delete(id), body: [:])
    }
}

// MARK: - Store

/// Shared «Подготовка к созвону» state for every screen: newer copies of preps than the last `/api/state`, deletions, actions in
/// flight and the polling while Sol reads a chat. Signing out and «Удалить всю практику» reset it.
@MainActor final class PrepsStore: ObservableObject {
    static let shared = PrepsStore()

    /// The last failed action on a prep screen («Не получилось …»).
    @Published var notice: String?
    @Published private(set) var removed: Set<String> = []
    @Published private(set) var working: Set<String> = []
    @Published private(set) var polling: Set<String> = []
    @Published private(set) var loading: Set<String> = []
    /// Preps the server no longer has (404).
    @Published private(set) var missing: Set<String> = []
    @Published private var fresh: [String: FreshPrep] = [:]
    private var pollers: [String: Task<Void, Never>] = [:]

    init() {}

    // Reading.

    /// Every prep the screens show, newest first: the server list, newer local copies, minus deletions.
    func preps(in state: TrainingState?, lastRefresh: Date?) -> [CallPrep] {
        PrepLabels.merge(server: state?.preps ?? [], fresh: Array(fresh.values), lastRefresh: lastRefresh,
                         hidden: removed.union(missing))
    }

    /// The newest copy of one prep (the detail follows it while Sol reads), nil once deleted.
    func prep(_ id: String, in state: TrainingState?) -> CallPrep? {
        guard !removed.contains(id), !missing.contains(id) else { return nil }
        let server = state?.preps?.first { $0.id == id }
        let local = fresh[id]?.prep
        if let server, let local {
            return PhraseClock.date(local.updatedAt) >= PhraseClock.date(server.updatedAt) ? local : server
        }
        return local ?? server
    }

    // Writing.

    /// A copy the server returned (create, GET, retry, the list). An older copy never replaces a newer one.
    func upsert(_ prep: CallPrep) {
        if let current = fresh[prep.id]?.prep {
            if current == prep { return }
            if PhraseClock.date(current.updatedAt) > PhraseClock.date(prep.updatedAt) { return }
        }
        fresh[prep.id] = FreshPrep(prep: prep, receivedAt: Date())
        missing.remove(prep.id)
    }

    /// «Подготовить»: POST /api/preps, then polling while Sol reads the chat.
    func create(images: [PrepUpload], text: String, goal: String, callAt: Date?, client: TrainingClient) async throws -> CallPrep {
        let prep = try await client.createPrep(images: images, text: text, goal: goal, callAt: callAt)
        upsert(prep)
        if prep.isReading { poll(prep.id, client: client) }
        client.refreshInBackground()
        return prep
    }

    /// GET /api/preps/:id when a prep screen opens (the latest reminders, a status that changed on the PC).
    func load(_ id: String, client: TrainingClient) async {
        guard !client.isFeaturePreview, !loading.contains(id) else { return }
        loading.insert(id)
        defer { loading.remove(id) }
        do {
            let prep = try await client.fetchPrep(id: id)
            upsert(prep)
            if prep.isReading { poll(prep.id, client: client) }
        } catch let failure as TrainingHTTPError where failure.status == 404 {
            missing.insert(id)
        } catch {
            // Offline: the copy from `/api/state` stays on screen.
        }
    }

    /// GET /api/preps (pull to refresh on «Созвоны»).
    func reload(client: TrainingClient) async {
        guard !client.isFeaturePreview else { return }
        guard let list = try? await client.listPreps() else { return }
        for prep in list { upsert(prep) }
        for prep in list where prep.isReading { poll(prep.id, client: client) }
    }

    /// «Повторить» on a failed prep: POST …/retry, then polling again.
    func retry(_ prep: CallPrep, client: TrainingClient) async {
        guard !working.contains(prep.id) else { return }
        if client.isFeaturePreview {
            notice = "В предпросмотре изменения не сохраняются."
            return
        }
        working.insert(prep.id)
        notice = nil
        defer { working.remove(prep.id) }
        do {
            let updated = try await client.retryPrep(id: prep.id)
            upsert(updated)
            if updated.isReading { poll(updated.id, client: client) }
            client.refreshInBackground()
        } catch {
            notice = TrainingClient.describe(error)
        }
    }

    /// «Удалить подготовку»: POST …/delete. Its rehearsals stay in the lesson history.
    @discardableResult func delete(_ prep: CallPrep, client: TrainingClient) async -> Bool {
        guard !working.contains(prep.id) else { return false }
        if client.isFeaturePreview {
            notice = "В предпросмотре изменения не сохраняются."
            return false
        }
        working.insert(prep.id)
        notice = nil
        defer { working.remove(prep.id) }
        do {
            try await client.deletePrep(id: prep.id)
        } catch let failure as TrainingHTTPError where failure.status == 404 {
            // Already gone (deleted on the PC): the same result.
        } catch {
            notice = "Не удалось удалить подготовку. " + TrainingClient.describe(error)
            return false
        }
        pollers.removeValue(forKey: prep.id)?.cancel()
        polling.remove(prep.id)
        removed.insert(prep.id)
        fresh.removeValue(forKey: prep.id)
        client.refreshInBackground()
        return true
    }

    /// GET /api/preps/:id every 2 s for up to 240 s while Sol reads it (one poller per prep, whatever screen is open).
    func poll(_ id: String, client: TrainingClient) {
        guard pollers[id] == nil, !client.isFeaturePreview else { return }
        polling.insert(id)
        pollers[id] = Task { [weak self] in
            let deadline = Date().addingTimeInterval(PrepLimits.pollLimit)
            while !Task.isCancelled, Date() < deadline {
                do { try await Task.sleep(for: .seconds(PrepLimits.pollInterval)) } catch { break }
                do {
                    let prep = try await client.fetchPrep(id: id)
                    self?.upsert(prep)
                    if !prep.isReading { break }
                } catch let failure as TrainingHTTPError where failure.status == 404 {
                    self?.missing.insert(id)
                    break
                } catch {
                    // Offline for a moment: keep trying until the deadline.
                }
            }
            guard let self, !Task.isCancelled else { return }
            self.pollers[id] = nil
            self.polling.remove(id)
            // Today and the list follow a prep that just became ready.
            client.refreshInBackground()
        }
    }

    /// Signing out or «Удалить всю практику»: nothing of this account stays on screen and nothing polls later.
    func reset() {
        for task in pollers.values { task.cancel() }
        pollers.removeAll()
        fresh.removeAll()
        removed.removeAll()
        missing.removeAll()
        working.removeAll()
        polling.removeAll()
        loading.removeAll()
        notice = nil
    }
}
