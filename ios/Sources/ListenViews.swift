import SwiftUI
import UIKit

// «Послушать» on the iPhone (planning/v05/PASS-0.5.4.md §1.5), inside the capture sheet: the chubrik listens through the
// microphone (TaskRecorder: 24 kHz WAV, at most 3:00) to a video on another screen, a podcast or someone talking nearby;
// the server transcribes it («Расшифровываю…»), Sol explains it («Разбираю…») and the best expressions land in «Мои фразы».
// The same states and result as the PC capture card (components/capture/*): gist, phrases with ×, points, the transcript,
// «Послушать ещё» and «Мои фразы». Words and timing come from ListenLabels / ListenTiming (PhrasesModels.swift).

// MARK: - Model

/// One listen flow of the capture sheet. The upload and the polling outlive the sheet (the phrases still land in
/// «Мои фразы»); a recording never does: closing the sheet throws the take away.
@MainActor final class ListenModel: ObservableObject {
    enum Phase: Equatable {
        /// Not listening: the capture card shows its field.
        case idle
        /// Asking for the microphone.
        case starting
        /// The pill: the time, «Стоп» and ×.
        case recording
        /// «Расшифровываю…»: the server transcribes inside the upload request.
        case uploading
        /// The transcript is in; «Разбираю…» while Sol explains it.
        case analyzing(ListenClip)
        /// Sol is still at it after 90 s: the card stops waiting («Разбор появится в «Моих фразах».»).
        case slow(ListenClip)
        /// «Послушал!», or the clip's own failure note.
        case done(ListenClip)
        /// The Russian reason: a refused or lost upload, a take too short, the microphone off.
        case failed(String)
    }

    @Published private(set) var phase: Phase = .idle
    /// The microphone is off for the app: «Открыть настройки» instead of «Попробовать ещё раз».
    @Published private(set) var microphoneDenied = false
    /// The chubrik's happy hop when new phrases were saved.
    @Published private(set) var celebrate = 0
    /// The microphone; its meter feeds the chubrik while he listens.
    let recorder = TaskRecorder()
    /// Previews show a fixed time (the simulator captures record nothing).
    private(set) var fixedElapsed: Double?
    private var client: TrainingClient?
    /// The take of an upload that never reached the server (no connection, a failing server): sent again on retry.
    private var pending: TaskRecording?
    /// Grows with every flow: answers that belong to an older one never change what the card shows.
    private var generation = 0

    init(preview: String? = nil) {
        recorder.onAutoStop = { [weak self] in self?.recorderStopped() }
#if DEBUG
        if let preview { showPreview(preview) }
#endif
    }

    var isListening: Bool { phase == .starting || phase == .recording }

    /// The transcript or the result is on screen: the sheet grows to full height.
    var showsResult: Bool {
        switch phase {
        case .analyzing, .slow, .done: return true
        default: return false
        }
    }

    /// One word per state, for transitions (a clip update inside a state does not animate the layout).
    var stage: String {
        switch phase {
        case .idle: return "idle"
        case .starting: return "starting"
        case .recording: return "recording"
        case .uploading: return "uploading"
        case .analyzing: return "analyzing"
        case .slow: return "slow"
        case .done: return "done"
        case .failed: return "failed"
        }
    }

    // Actions.

    /// «Послушать», «Послушать ещё», or a new recording after a problem.
    func start(client: TrainingClient) {
        guard phase != .starting, phase != .recording, phase != .uploading else { return }
        generation += 1
        let mine = generation
        self.client = client
        dropPending()
        microphoneDenied = false
        phase = .starting
        Task {
            let started = await recorder.start(maxSeconds: ListenTiming.maxSeconds, client: client)
            guard generation == mine, phase == .starting else {
                if started { recorder.reset() }
                return
            }
            if started {
                phase = .recording
                announce("Слушаю. " + ListenLabels.hint)
            } else if recorder.permissionDenied {
                microphoneDenied = true
                fail(ListenLabels.microphoneDenied)
            } else {
                // A lesson recording in progress («Сначала закончи запись в занятии.») or a microphone problem.
                fail(recorder.message ?? ListenLabels.microphoneFailed)
            }
        }
    }

    /// «Стоп» or a tap on the chubrik: the take goes to the server.
    func stop() {
        guard phase == .recording else { return }
        recorder.stop()
        send()
    }

    /// × in the pill: the take is thrown away and the field is back.
    func cancel() {
        guard isListening else { return }
        generation += 1
        recorder.reset()
        phase = .idle
    }

    /// «Назад» after a failure, «Готово» after a result: back to the field (a take kept for a resend is deleted).
    func dismiss() {
        guard !isListening, phase != .uploading else { return }
        generation += 1
        dropPending()
        microphoneDenied = false
        phase = .idle
    }

    /// «Попробовать ещё раз»: a take that never reached the server is sent again; otherwise a new recording.
    func retry(client: TrainingClient) {
        if let pending, FileManager.default.fileExists(atPath: pending.url.path) {
            self.client = client
            upload(pending)
        } else {
            start(client: client)
        }
    }

    /// The sheet is gone: a recording stops and is thrown away, so does a take kept for a resend; an upload or the analysis
    /// carries on, so the phrases still land in «Мои фразы».
    func leave() {
        cancel()
        if case .failed = phase { dropPending() }
    }

    /// The app went to the background, or a call took the microphone: what was heard so far is sent.
    func interrupt() {
        stop()
    }

    // Flow.

    /// 3:00 (or an audio failure) stopped the recorder by itself; the part recorded so far is kept.
    private func recorderStopped() {
        guard phase == .recording else { return }
        send()
    }

    private func send() {
        guard let take = recorder.take else {
            fail(recorder.message ?? ListenLabels.lost)
            return
        }
        if let problem = ListenLabels.durationProblem(take.duration) {
            recorder.discardTake()
            fail(problem)
            return
        }
        upload(take)
    }

    private func upload(_ take: TaskRecording) {
        guard let client else { return }
        generation += 1
        let mine = generation
        pending = take
        phase = .uploading
        announce("Расшифровываю")
        Task {
            do {
                let clip = try await client.uploadListenClip(url: take.url, seconds: take.duration)
                // The audio is never kept once the server has it.
                forget(take)
                accept(clip, client: client)
                guard generation == mine else { return }
                show(clip)
                if clip.isAnalyzing { poll(clip.id, generation: mine, client: client) }
            } catch {
                if !ListenRequests.canResend(error) { forget(take) }
                guard generation == mine else { return }
                fail(TrainingClient.describe(error))
            }
        }
    }

    /// GET /api/phrases/listen/:id every 1.5 s for up to 90 s while Sol explains the clip (it keeps going after the sheet
    /// closes, so the saved phrases reach «Мои фразы» at once).
    private func poll(_ id: String, generation mine: Int, client: TrainingClient) {
        guard !client.isFeaturePreview else { return }
        Task {
            let deadline = Date().addingTimeInterval(ListenTiming.pollLimit)
            while Date() < deadline {
                do { try await Task.sleep(for: .seconds(ListenTiming.pollInterval)) } catch { return }
                do {
                    let clip = try await client.fetchListenClip(id: id)
                    accept(clip, client: client)
                    if !clip.isAnalyzing {
                        if generation == mine { show(clip) }
                        client.refreshInBackground()
                        return
                    }
                } catch let failure as TrainingHTTPError where failure.status == 404 {
                    if generation == mine { fail(failure.message) }
                    return
                } catch {
                    // Offline for a moment: keep trying until the deadline.
                }
            }
            client.refreshInBackground()
            guard generation == mine, case .analyzing(let clip) = phase else { return }
            phase = .slow(clip)
            announce(ListenLabels.slow)
        }
    }

    /// The phrases a clip saved show in «Мои фразы» before `/api/state` catches up.
    private func accept(_ clip: ListenClip, client: TrainingClient) {
        guard client.signedIn else { return }
        for item in clip.phrases { PhrasesStore.shared.upsert(item.phrase) }
    }

    private func show(_ clip: ListenClip) {
        if clip.isAnalyzing {
            phase = .analyzing(clip)
            announce("Разбираю. Объясню, что тут интересного")
            return
        }
        phase = .done(clip)
        guard clip.isReady else {
            announce(ListenLabels.failure(clip))
            return
        }
        if clip.phrases.contains(where: { !$0.duplicate }) { celebrate += 1 }
        announce(["Послушал", ListenLabels.summary(clip), clip.gist].compactMap { $0 }.joined(separator: ". "))
    }

    private func fail(_ message: String) {
        phase = .failed(message)
        announce(message)
    }

    private func forget(_ take: TaskRecording) {
        try? FileManager.default.removeItem(at: take.url)
        if pending == take { pending = nil }
        if recorder.take == take { recorder.discardTake() }
    }

    private func dropPending() {
        if let pending { forget(pending) }
    }

    private func announce(_ message: String) {
        guard UIAccessibility.isVoiceOverRunning else { return }
        UIAccessibility.post(notification: .announcement, argument: message)
    }

#if DEBUG
    /// `--preview=listen-recording | listen-analysing | listen-ready` (PhrasesViews.swift `PhrasesPreview`).
    private func showPreview(_ screen: String) {
        switch screen {
        case "listen-recording":
            phase = .recording
            fixedElapsed = 12
            recorder.meter.level = 0.55
        case "listen-analysing":
            phase = .analyzing(PhrasesPreview.listenClip(ready: false))
        case "listen-ready":
            phase = .done(PhrasesPreview.listenClip(ready: true))
        default:
            break
        }
    }
#endif
}

// MARK: - Panel

/// Everything under the chubrik while «Послушать» runs: the pill, the transcript, the result or why it failed.
struct ListenPanel: View {
    @ObservedObject var model: ListenModel
    /// «Мои фразы» (pushes the list in the same sheet).
    var openList: (() -> Void)?
    /// «Послушать ещё».
    let again: () -> Void
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        VStack(spacing: 14) {
            switch model.phase {
            case .idle:
                EmptyView()
            case .starting, .recording:
                SpeechBubble(title: "Слушаю", detail: ListenLabels.hint)
                ListenPill(recorder: model.recorder, fixedElapsed: model.fixedElapsed, starting: model.phase == .starting,
                           stop: { model.stop() }, cancel: { model.cancel() })
            case .uploading:
                SpeechBubble(title: "Расшифровываю…", detail: "Отправил запись, сейчас будет текст")
                ProgressView()
                    .tint(Theme.violet)
                    .accessibilityLabel("Расшифровываю запись")
            case .analyzing(let clip):
                SpeechBubble(title: "Разбираю…")
                ListenTranscriptBlock(clip: clip, waiting: true)
            case .slow(let clip):
                SpeechBubble(title: "Разбираю…", detail: ListenLabels.slow)
                ListenTranscriptBlock(clip: clip, waiting: false)
                doneActions
            case .done(let clip):
                if clip.isReady {
                    SpeechBubble(title: "Послушал!", detail: ListenLabels.summary(clip))
                    ListenResultView(clip: clip)
                    doneActions
                } else {
                    SpeechBubble(title: "Не получилось разобрать")
                    ListenTranscriptBlock(clip: clip, waiting: false, note: ListenLabels.failure(clip))
                    failureActions
                }
            case .failed(let message):
                SpeechBubble(title: "Не получилось")
                statusLine(message)
                failureActions
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// «Послушать ещё», «Мои фразы» and «Готово» (back to the field), as on the web card.
    private var doneActions: some View {
        ChipFlow(spacing: 10) {
            Button(action: again) {
                Label("Послушать ещё", systemImage: "ear")
            }
            .buttonStyle(PrimaryButton(compact: true))
            .accessibilityHint(ListenLabels.hint)
            if let openList {
                Button(action: openList) {
                    HStack(spacing: 4) {
                        Text("Мои фразы")
                        Image(systemName: "arrow.right").imageScale(.small).accessibilityHidden(true)
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressButton())
                .foregroundStyle(Theme.violet)
                .accessibilityHint("Открывает все сохранённые фразы")
            }
            Button("Готово") { model.dismiss() }
                .buttonStyle(QuietButton())
                .accessibilityHint("Возвращает поле для фразы")
        }
    }

    /// «Попробовать ещё раз» («Открыть настройки» when the microphone is off) and «Назад» (back to the field).
    private var failureActions: some View {
        HStack(spacing: 10) {
            if model.microphoneDenied {
                Button("Открыть настройки") { client.openSystemSettings() }
                    .buttonStyle(PrimaryButton(compact: true))
                    .accessibilityHint("Там можно разрешить микрофон для Smooth Talk")
            } else {
                Button { model.retry(client: client) } label: {
                    Label("Попробовать ещё раз", systemImage: "arrow.clockwise")
                }
                .buttonStyle(PrimaryButton(compact: true))
            }
            Button("Назад") { model.dismiss() }
                .buttonStyle(QuietButton())
                .accessibilityHint("Возвращает поле для фразы")
        }
    }

    private func statusLine(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.warning).accessibilityHidden(true)
            Text(text).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote.weight(.semibold))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Pill

/// While he listens: a pulsing dot, the time («Подключаюсь…» until the microphone is on), «Стоп» and ×; from 2:50 a line
/// counts down to the stop at 3:00. Content on the sheet, so a solid capsule (glass belongs to chrome). Only this view
/// follows the recorder's ticks.
private struct ListenPill: View {
    @ObservedObject var recorder: TaskRecorder
    let fixedElapsed: Double?
    let starting: Bool
    let stop: () -> Void
    let cancel: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var elapsed: Double { fixedElapsed ?? recorder.elapsed }

    var body: some View {
        let warns = ListenLabels.warns(elapsed)
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(starting ? Theme.inkTertiary : Theme.danger)
                    .symbolEffect(.pulse, options: .repeating, isActive: !starting && !reduceMotion)
                    .accessibilityHidden(true)
                Text(starting ? "Подключаюсь…" : ListenLabels.clock(elapsed))
                    .font(.body.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.ink)
                    .accessibilityLabel(starting ? "Подключаюсь к микрофону" : "Записываю, " + ListenLabels.spoken(elapsed))
                Button(action: stop) { Text("Стоп") }
                    .buttonStyle(PrimaryButton(compact: true))
                    .disabled(starting)
                    .accessibilityHint("Останавливает запись и отправляет её на разбор")
                Button(action: cancel) {
                    Image(systemName: "xmark").font(.footnote.weight(.bold))
                }
                .buttonStyle(SoftIconButton(size: 36))
                .accessibilityLabel("Отменить запись")
                .accessibilityHint("Запись не сохранится")
            }
            .padding(.leading, 18)
            .padding(.trailing, 4)
            .padding(.vertical, 4)
            .background {
                Capsule().fill(Theme.solid).shadow(color: Theme.cardShadow, radius: 8, x: 0, y: 3)
            }
            .overlay { Capsule().strokeBorder(Theme.hairline, lineWidth: 1).allowsHitTesting(false) }
            if warns {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "timer").foregroundStyle(Theme.warning).accessibilityHidden(true)
                    Text(ListenLabels.warning(elapsed)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                }
                .font(.footnote.weight(.semibold))
                .accessibilityElement(children: .combine)
                .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : NativeMotion.standard, value: warns)
        .onChange(of: warns) { _, now in
            guard now, UIAccessibility.isVoiceOverRunning else { return }
            UIAccessibility.post(notification: .announcement, argument: ListenLabels.warning(elapsed))
        }
    }
}

// MARK: - Transcript and result

/// What was heard: the transcript with «Разбираю…» while Sol works, or with the reason the analysis stopped.
private struct ListenTranscriptBlock: View {
    let clip: ListenClip
    let waiting: Bool
    var note: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Текст записи")
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            if !clip.transcript.isEmpty {
                Text(PhraseLabels.english(clip.transcript))
                    .font(.callout)
                    .foregroundStyle(Theme.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if waiting {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(Theme.violet)
                    Text("Объясню, что тут интересного").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            if let note {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .contentSurface(radius: Radius.tile)
    }
}

/// «Послушал!»: what it was about, the saved expressions, what else is worth noticing and the transcript (collapsed).
/// One surface; the phrases are rows inside it, never cards of their own.
private struct ListenResultView: View {
    let clip: ListenClip
    @State private var showTranscript = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let gist = clean(clip.gist) {
                (Text("О чём: ").fontWeight(.semibold) + Text(gist))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !clip.phrases.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(clip.phrases.enumerated()), id: \.offset) { index, item in
                        if index > 0 { RowDivider(inset: 0) }
                        ListenPhraseRow(item: item)
                    }
                }
            }
            if !clip.points.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Что ещё заметил")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    ForEach(Array(clip.points.enumerated()), id: \.offset) { _, point in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("•").foregroundStyle(Theme.violet).accessibilityHidden(true)
                            Text(point).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.footnote)
                    }
                }
            }
            if !clip.transcript.isEmpty {
                DisclosureGroup(isExpanded: $showTranscript) {
                    Text(PhraseLabels.english(clip.transcript))
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                } label: {
                    Text("Текст записи · " + ListenLabels.clock(Double(clip.seconds))).font(.subheadline.weight(.semibold))
                }
                .disclosureGroupStyle(SoftDisclosureStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .contentSurface(radius: Radius.tile)
    }

    private func clean(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
}

/// One expression from the clip: English (bold), the Russian meaning, «Услышал: “…”»; × removes it from «Мои фразы» (the
/// usual «Вернуть» window), «Уже в копилке» when it was saved before (never removed from here).
private struct ListenPhraseRow: View {
    let item: ListenPhrase
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore

    init(item: ListenPhrase) {
        self.item = item
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
    }

    private var phrase: SavedPhrase { item.phrase }
    private var target: String { PhraseSchedule.target(phrase) ?? PhraseLabels.headline(phrase) }
    private var removed: Bool { store.undo.hidden.contains(phrase.id) || store.removed.contains(phrase.id) }
    private var meaning: String? {
        guard let text = phrase.meaning?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    var body: some View {
        Group {
            if removed { removedRow } else { row }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var row: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(PhraseLabels.english(target))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let meaning {
                    Text(meaning)
                        .font(.footnote)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let heard = PhraseLabels.heard(phrase) {
                    HeardLine(text: heard)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            if item.duplicate {
                Text("Уже в копилке")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.limeInk)
                    .padding(.top, 2)
            } else {
                Button { store.remove(phrase, client: client) } label: {
                    Image(systemName: "xmark").font(.footnote.weight(.bold))
                }
                .buttonStyle(SoftIconButton(size: 32))
                .accessibilityLabel("Убрать «" + target + "» из «Моих фраз»")
                .accessibilityHint("Шесть секунд её можно вернуть")
            }
        }
    }

    private var removedRow: some View {
        HStack(spacing: 12) {
            (Text("«") + Text(PhraseLabels.english(target)) + Text("» убрал из «Моих фраз»"))
                .font(.footnote)
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if store.undo.undoable == phrase.id {
                Button("Вернуть") { store.undoRemoval() }
                    .buttonStyle(QuietButton())
                    .accessibilityHint("Возвращает фразу в «Мои фразы»")
            }
        }
    }
}

/// «Услышал: «…»» under a phrase saved from a clip (the quote is read with an English voice): the listen result and
/// «Мои фразы».
struct HeardLine: View {
    let text: String
    var lineLimit: Int? = nil

    var body: some View {
        (Text("Услышал: «") + Text(PhraseLabels.english(text)).italic() + Text("»"))
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
            .lineLimit(lineLimit)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}
