import Foundation
import AVFoundation
import UniformTypeIdentifiers
import UIKit

// Real-call upload: picks a file, extracts the sound from video or large audio into a small .m4a,
// creates the call (POST calls) and sends the bytes in resumable 8 MiB chunks
// (PUT calls/:id/upload with X-Upload-Offset, 409 → resume from `received`), then
// POST calls/:id/upload/complete. Text sources (transcript, debrief, memory) are one POST.
// One shared job, so every upload card (Today, Созвоны) shows the same progress.

enum CallTextKind: String, CaseIterable, Identifiable {
    case transcript, debrief
    var id: String { rawValue }
    var title: String { self == .transcript ? "Транскрипт" : "Готовый разбор" }
}

enum CallFileKind: Equatable { case audio, video, text }

/// A picked file, before the learner confirms the details. Media keeps its security scope open
/// until the local copy or the extracted sound exists.
struct CallFileDraft: Identifiable {
    let id = UUID()
    let url: URL
    let fileName: String
    let fileExtension: String
    let bytes: UInt64
    let kind: CallFileKind
    let text: String?
    let scoped: Bool

    var suggestedTitle: String {
        let base = (fileName as NSString).deletingPathExtension
            .replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(base.prefix(80))
    }
}

/// Optional details sent with the call (CreateCallRequest).
struct CallUploadMeta {
    var title = ""
    var counterpart = ""
    var context = "work"
    var hasDate = true
    var occurredAt = Date()
    var notes = ""

    func displayTitle(fallback: String) -> String {
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? fallback : clean
    }

    func body(source: [String: Any]) -> [String: Any] {
        var body: [String: Any] = ["source": source, "context": context]
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanTitle.isEmpty { body["title"] = String(cleanTitle.prefix(200)) }
        let cleanCounterpart = counterpart.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanCounterpart.isEmpty { body["counterpart"] = String(cleanCounterpart.prefix(120)) }
        if hasDate { body["occurredAt"] = ISO8601DateFormatter().string(from: occurredAt) }
        let cleanNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleanNotes.isEmpty { body["notes"] = String(cleanNotes.prefix(4000)) }
        return body
    }
}

struct CallUploadJob: Equatable {
    enum Phase: Equatable { case preparing, extracting, creating, uploading, completing, done, failed }
    var phase: Phase
    var title: String
    var sentBytes: Double = 0
    var totalBytes: Double = 0
    var extractProgress: Double? = nil
    var message: String? = nil
    var callId: String? = nil
    var resumable = false
    var startedAt = Date()

    var fraction: Double { totalBytes > 0 ? min(1, max(0, sentBytes / totalBytes)) : 0 }
    var isRunning: Bool { phase != .done && phase != .failed }
}

private struct CallLocalFile {
    let url: URL
    let fileName: String
    let mime: String
    let bytes: UInt64
}

@MainActor final class CallUploadCenter: ObservableObject {
    static let shared = CallUploadCenter()
    static let chunkSize = 8 * 1024 * 1024
    static let maxBytes: UInt64 = 2 * 1024 * 1024 * 1024
    static let audioExtensions: Set<String> = ["mp3", "m4a", "wav", "webm", "ogg", "oga", "opus", "aac", "flac", "caf", "aif", "aiff"]
    static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "mkv"]
    static let textExtensions: Set<String> = ["txt", "vtt", "sbv", "srt", "md", "markdown"]
    /// Uncompressed or container formats the server does not accept as is: always converted to .m4a.
    private static let convertExtensions: Set<String> = ["wav", "caf", "aif", "aiff", "m4v"]
    private static let registryKey = "call-upload-files-v1"

    @Published private(set) var job: CallUploadJob?
    /// Increments after every successful upload so lists can reload.
    @Published private(set) var completions = 0
    private var worker: Task<Void, Never>?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    var isActive: Bool { job?.isRunning ?? false }

    static var allowedTypes: [UTType] {
        var types: [UTType] = [.audio, .movie, .audiovisualContent, .plainText, .utf8PlainText, .text]
        let extensions = Array(audioExtensions) + Array(videoExtensions) + Array(textExtensions)
        for ext in extensions.sorted() {
            if let type = UTType(filenameExtension: ext), !types.contains(type) { types.append(type) }
        }
        return types
    }

    // MARK: Picking

    /// Classifies a picked file and reads text sources immediately. Throws a Russian message for
    /// unsupported or oversized files.
    func makeDraft(from url: URL) throws -> CallFileDraft {
        let scoped = url.startAccessingSecurityScopedResource()
        do {
            let ext = url.pathExtension.lowercased()
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
            let size = UInt64(max(0, values?.fileSize ?? 0))
            let type = values?.contentType ?? UTType(filenameExtension: ext)
            let isMediaExtension = Self.audioExtensions.contains(ext) || Self.videoExtensions.contains(ext)
            let kind: CallFileKind
            if Self.textExtensions.contains(ext) || ((type?.conforms(to: .text) ?? false) && !isMediaExtension) {
                kind = .text
            } else if Self.videoExtensions.contains(ext) || (type?.conforms(to: .movie) ?? false) {
                kind = .video
            } else if Self.audioExtensions.contains(ext) || (type?.conforms(to: .audio) ?? false) {
                kind = .audio
            } else {
                throw ClientError.message("Этот формат не подходит. Нужна запись (mp3, m4a, wav, mp4, mov) или текст (.txt, .vtt, .srt, .sbv, .md).")
            }
            var text: String? = nil
            if kind == .text {
                guard size <= 1_024 * 1_024 else {
                    throw ClientError.message("Текстовый файл слишком большой. Транскрипт — до 400 КБ, разбор — до 200 КБ.")
                }
                let data = try Data(contentsOf: url)
                let decodedText: String?
                if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]) {
                    decodedText = String(data: data, encoding: .utf16)
                } else {
                    decodedText = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1251)
                }
                guard let readable = decodedText, !readable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw ClientError.message("Не получилось прочитать текст. Сохрани файл в UTF-8 и попробуй снова.")
                }
                text = readable
                if scoped { url.stopAccessingSecurityScopedResource() }
            } else if size > Self.maxBytes {
                throw ClientError.message("Файл больше 2 ГБ. Выгрузи только звук или обрежь запись.")
            }
            return CallFileDraft(url: url, fileName: url.lastPathComponent, fileExtension: ext, bytes: size,
                                 kind: kind, text: text, scoped: kind != .text && scoped)
        } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    func releaseDraft(_ draft: CallFileDraft) {
        if draft.scoped { draft.url.stopAccessingSecurityScopedResource() }
    }

    // MARK: Jobs

    func submit(draft: CallFileDraft, meta: CallUploadMeta, textKind: CallTextKind, client: TrainingClient) {
        guard !isActive else { releaseDraft(draft); return }
        job = CallUploadJob(phase: draft.kind == .text ? .creating : .preparing, title: meta.displayTitle(fallback: draft.suggestedTitle))
        worker = Task { [weak self] in
            guard let self else { return }
            await self.run(draft: draft, meta: meta, textKind: textKind, client: client)
        }
    }

    func submitMemory(text: String, meta: CallUploadMeta, client: TrainingClient) {
        guard !isActive else { return }
        job = CallUploadJob(phase: .creating, title: meta.displayTitle(fallback: "Созвон по памяти"))
        worker = Task { [weak self] in
            guard let self else { return }
            do {
                let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !clean.isEmpty else { throw ClientError.message("Опиши звонок хотя бы в паре предложений.") }
                let source: [String: Any] = ["type": "memory", "text": String(clean.prefix(20_000))]
                let detail: CallDetail = try await client.request("calls", body: meta.body(source: source))
                self.update { $0.callId = detail.id }
                await client.featureRefresh()
                self.finishSuccess()
            } catch {
                if FeatureErrorText.isCancellation(error) { return }
                self.fail(error, resumable: false)
            }
        }
    }

    /// Continues an interrupted audio upload from the server's stored offset.
    func resume(callId: String, title: String, uploadedBytes: Double?, client: TrainingClient) {
        guard !isActive, let file = Self.localFile(for: callId) else { return }
        let total = Self.fileSize(file)
        job = CallUploadJob(phase: .uploading, title: title, sentBytes: uploadedBytes ?? 0, totalBytes: Double(total), callId: callId)
        worker = Task { [weak self] in
            guard let self else { return }
            self.beginBackgroundWork()
            defer { self.endBackgroundWork() }
            do {
                try await self.sendChunks(callId: callId, file: file, total: total,
                                          from: CallUploadCenter.startOffset(uploadedBytes, total: total), client: client)
                self.update { $0.phase = .completing }
                let _: CallSummary = try await client.request("calls/\(callId)/upload/complete", body: [:])
                CallUploadCenter.forget(callId: callId, deleteFile: true)
                await client.featureRefresh()
                self.finishSuccess()
            } catch {
                if FeatureErrorText.isCancellation(error) { return }
                self.fail(error, resumable: CallUploadCenter.localFile(for: callId) != nil)
            }
        }
    }

    /// Stops the running job. A call created for an unfinished audio upload is deleted on the server.
    func cancel(client: TrainingClient) {
        let callId = job?.phase == .done ? nil : job?.callId
        let running = isActive
        worker?.cancel()
        worker = nil
        job = nil
        endBackgroundWork()
        guard running, let callId else { return }
        CallUploadCenter.forget(callId: callId, deleteFile: true)
        Task {
            _ = try? await client.featureRaw("calls/\(callId)", method: "DELETE")
            await client.featureRefresh()
        }
    }

    /// Hides a finished or failed job card.
    func dismissJob() {
        guard !isActive else { return }
        job = nil
    }

    func hasLocalFile(_ callId: String) -> Bool { Self.localFile(for: callId) != nil }
    func forgetLocalFile(_ callId: String) { Self.forget(callId: callId, deleteFile: true) }

    // MARK: Pipeline

    private func run(draft: CallFileDraft, meta: CallUploadMeta, textKind: CallTextKind, client: TrainingClient) async {
        beginBackgroundWork()
        defer { endBackgroundWork() }
        do {
            switch draft.kind {
            case .text:
                try await createText(draft: draft, meta: meta, textKind: textKind, client: client)
            case .audio, .video:
                let local: CallLocalFile
                do {
                    local = try await prepareLocal(draft: draft)
                    releaseDraft(draft)
                } catch {
                    releaseDraft(draft)
                    throw error
                }
                try await uploadMedia(local: local, meta: meta, client: client)
            }
            finishSuccess()
        } catch {
            if FeatureErrorText.isCancellation(error) { return }
            let resumable = job?.callId.map { CallUploadCenter.localFile(for: $0) != nil } ?? false
            fail(error, resumable: resumable)
        }
    }

    private func createText(draft: CallFileDraft, meta: CallUploadMeta, textKind: CallTextKind, client: TrainingClient) async throws {
        let text = (draft.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ClientError.message("Файл пустой. Выбери другой.") }
        let limit = textKind == .debrief ? 200 * 1024 : 400 * 1024
        guard text.utf8.count <= limit else {
            throw ClientError.message(textKind == .debrief
                ? "Разбор длиннее 200 КБ. Сократи его или загрузи как транскрипт."
                : "Транскрипт длиннее 400 КБ. Раздели звонок на части.")
        }
        update { $0.phase = .creating }
        var source: [String: Any] = ["type": textKind.rawValue, "text": text]
        if textKind == .transcript { source["fileName"] = draft.fileName }
        let detail: CallDetail = try await client.request("calls", body: meta.body(source: source))
        update { $0.callId = detail.id }
        await client.featureRefresh()
    }

    private func prepareLocal(draft: CallFileDraft) async throws -> CallLocalFile {
        let folder = try Self.uploadsFolder()
        let base = UUID().uuidString.lowercased()
        let extract = draft.kind == .video || Self.convertExtensions.contains(draft.fileExtension) || draft.bytes > 64 * 1024 * 1024
        if extract {
            update { $0.phase = .extracting; $0.extractProgress = 0 }
            let destination = folder.appendingPathComponent(base + ".m4a")
            do {
                try await extractAudio(from: draft.url, to: destination)
                let size = Self.fileSize(destination)
                if size > 0 {
                    let name = ((draft.fileName as NSString).deletingPathExtension) + ".m4a"
                    return CallLocalFile(url: destination, fileName: name, mime: "audio/mp4", bytes: size)
                }
            } catch {
                try? FileManager.default.removeItem(at: destination)
                if FeatureErrorText.isCancellation(error) { throw error }
                // AVFoundation cannot read every container (webm, mkv, ogg): those go up as they are
                // and the server extracts the sound with ffmpeg.
                if Self.convertExtensions.contains(draft.fileExtension) && draft.fileExtension != "wav" { throw error }
            }
        }
        guard draft.bytes <= Self.maxBytes else { throw ClientError.message("Файл больше 2 ГБ. Выгрузи только звук или обрежь запись.") }
        update { $0.phase = .preparing; $0.extractProgress = nil }
        let ext = draft.fileExtension.isEmpty ? "bin" : draft.fileExtension
        let destination = folder.appendingPathComponent(base + "." + ext)
        try await Self.copy(draft.url, to: destination)
        return CallLocalFile(url: destination, fileName: draft.fileName, mime: Self.mime(for: draft.fileExtension), bytes: Self.fileSize(destination))
    }

    private func extractAudio(from source: URL, to destination: URL) async throws {
        let asset = AVURLAsset(url: source)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        guard !tracks.isEmpty else { throw ClientError.message("В файле нет звуковой дорожки.") }
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw ClientError.message("iPhone не может извлечь звук из этого файла.")
        }
        try? FileManager.default.removeItem(at: destination)
        if #available(iOS 18.0, *) {
            try await session.export(to: destination, as: .m4a)
        } else {
            session.outputURL = destination
            session.outputFileType = .m4a
            let monitor = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    let value = Double(session.progress)
                    self?.update { $0.extractProgress = value }
                    do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
                }
            }
            defer { monitor.cancel() }
            await withTaskCancellationHandler {
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    session.exportAsynchronously { @Sendable in continuation.resume() }
                }
            } onCancel: {
                session.cancelExport()
            }
            switch session.status {
            case .completed:
                break
            case .cancelled:
                throw CancellationError()
            default:
                throw ClientError.message("Не получилось извлечь звук: " + (session.error?.localizedDescription ?? "неизвестная ошибка") + ".")
            }
        }
        update { $0.extractProgress = 1 }
    }

    private func uploadMedia(local: CallLocalFile, meta: CallUploadMeta, client: TrainingClient) async throws {
        update { $0.phase = .creating; $0.totalBytes = Double(local.bytes); $0.sentBytes = 0; $0.extractProgress = nil }
        let source: [String: Any] = ["type": "audio", "fileName": local.fileName, "bytes": local.bytes, "mime": local.mime]
        let detail: CallDetail = try await client.request("calls", body: meta.body(source: source))
        let callId = detail.id
        Self.register(callId: callId, file: local.url)
        update { $0.callId = callId; $0.phase = .uploading }
        try await sendChunks(callId: callId, file: local.url, total: local.bytes,
                             from: CallUploadCenter.startOffset(detail.summary.uploadedBytes, total: local.bytes), client: client)
        update { $0.phase = .completing }
        let _: CallSummary = try await client.request("calls/\(callId)/upload/complete", body: [:])
        Self.forget(callId: callId, deleteFile: true)
        await client.featureRefresh()
    }

    private func sendChunks(callId: String, file: URL, total: UInt64, from start: UInt64, client: TrainingClient) async throws {
        var offset = min(start, total)
        var stalls = 0
        update { $0.sentBytes = Double(offset); $0.totalBytes = Double(total) }
        while offset < total {
            try Task.checkCancellation()
            let count = Int(min(UInt64(Self.chunkSize), total - offset))
            let chunk = try await Self.readChunk(file, offset: offset, count: count)
            guard !chunk.isEmpty else { throw ClientError.message("Файл на iPhone изменился. Выбери его заново.") }
            let response = try await client.featureRaw("calls/\(callId)/upload", method: "PUT", body: chunk,
                                                       contentType: "application/octet-stream",
                                                       headers: ["X-Upload-Offset": String(offset)])
            let receipt = try? JSONDecoder().decode(CallUploadReceipt.self, from: response.data)
            let next: UInt64
            switch response.status {
            case 200..<300:
                next = CallUploadCenter.resumeOffset(receipt?.received, total: total) ?? min(total, offset + UInt64(chunk.count))
            case 409:
                // The server stores a different amount (a retried or lost chunk): resume from there.
                guard let received = CallUploadCenter.resumeOffset(receipt?.received, total: total) else {
                    throw ClientError.message(receipt?.error ?? "Загрузка уже закрыта на сервере.")
                }
                next = received
            case 413:
                throw ClientError.message("Файл больше, чем принимает сервер (2 ГБ). Выгрузи только звук.")
            default:
                throw ClientError.message(TrainingClient.featureServerMessage(response.data, status: response.status))
            }
            if next <= offset {
                stalls += 1
                if stalls >= 5 { throw ClientError.message("Сервер не принимает файл. Попробуй позже.") }
            } else {
                stalls = 0
            }
            offset = next
            update { $0.sentBytes = Double(offset) }
        }
    }

    // MARK: State helpers

    private func update(_ change: (inout CallUploadJob) -> Void) {
        guard var current = job else { return }
        change(&current)
        job = current
    }

    private func finishSuccess() {
        update { $0.phase = .done; $0.message = nil; $0.sentBytes = $0.totalBytes }
        completions += 1
        Task { [weak self] in
            do { try await Task.sleep(for: .seconds(5)) } catch { return }
            if self?.job?.phase == .done { self?.job = nil }
        }
    }

    private func fail(_ error: Error, resumable: Bool) {
        update {
            $0.phase = .failed
            $0.message = FeatureErrorText.describe(error)
            $0.resumable = resumable
        }
    }

    private func beginBackgroundWork() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "call-upload") { [weak self] in
            // Expiration handlers run on the main thread.
            MainActor.assumeIsolated {
                guard let center = self else { return }
                center.endBackgroundWork()
            }
        }
    }

    private func endBackgroundWork() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: Files

    /// Server-reported byte count as a safe resume point (nil when absent or invalid).
    static func resumeOffset(_ value: Double?, total: UInt64) -> UInt64? {
        guard let value, value.isFinite, value >= 0 else { return nil }
        if value >= Double(total) { return total }
        return UInt64(value.rounded(.down))
    }

    static func startOffset(_ value: Double?, total: UInt64) -> UInt64 {
        resumeOffset(value, total: total) ?? 0
    }

    static func mime(for ext: String) -> String {
        switch ext.lowercased() {
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "wav": return "audio/wav"
        case "webm": return "audio/webm"
        case "ogg", "oga", "opus": return "audio/ogg"
        case "aac": return "audio/aac"
        case "flac": return "audio/flac"
        case "mkv": return "video/x-matroska"
        default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    static func fileSize(_ url: URL) -> UInt64 {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        return UInt64(max(0, size))
    }

    private static func uploadsFolder() throws -> URL {
        let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                 appropriateFor: nil, create: true)
            .appendingPathComponent("CallUploads", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private static func registry() -> [String: String] {
        (UserDefaults.standard.dictionary(forKey: registryKey) as? [String: String]) ?? [:]
    }

    private static func register(callId: String, file: URL) {
        var value = registry()
        value[callId] = file.lastPathComponent
        UserDefaults.standard.set(value, forKey: registryKey)
    }

    /// Local copy kept for resuming an interrupted upload (paths are stored relative to the folder).
    static func localFile(for callId: String) -> URL? {
        guard let name = registry()[callId], let folder = try? uploadsFolder() else { return nil }
        let url = folder.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func forget(callId: String, deleteFile: Bool) {
        var value = registry()
        if let name = value.removeValue(forKey: callId), deleteFile, let folder = try? uploadsFolder() {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
        }
        UserDefaults.standard.set(value, forKey: registryKey)
    }

    /// Removes leftovers that no call refers to (an extraction interrupted by the app closing).
    func sweepOrphans() {
        guard !isActive, let folder = try? Self.uploadsFolder(),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let known = Set(Self.registry().values)
        let cutoff = Date().addingTimeInterval(-3_600)
        for file in files where !known.contains(file.lastPathComponent) {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if modified < cutoff { try? FileManager.default.removeItem(at: file) }
        }
    }

    nonisolated private static func readChunk(_ url: URL, offset: UInt64, count: Int) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            try handle.seek(toOffset: offset)
            return try handle.read(upToCount: count) ?? Data()
        }.value
    }

    nonisolated private static func copy(_ source: URL, to destination: URL) async throws {
        try await Task.detached(priority: .userInitiated) {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.copyItem(at: source, to: destination)
        }.value
    }
}
