import SwiftUI
import AVFoundation
import Combine

enum CallDetailTab: String, CaseIterable, Identifiable {
    case review, drills, transcript
    var id: String { rawValue }
    var title: String {
        switch self {
        case .review: return "Разбор"
        case .drills: return "Тренировки"
        case .transcript: return "Транскрипт"
        }
    }
}

/// One call: header, processing states, then «Разбор · Тренировки · Транскрипт».
struct CallDetailScreen: View {
    let callId: String
    @ObservedObject var store: CallsStore
    @ObservedObject private var uploads: CallUploadCenter
    @EnvironmentObject private var client: TrainingClient
    @StateObject private var player = FeatureAudioPlayer()
    @State private var tab: CallDetailTab = .review
    @State private var showSpeakers = false
    @State private var askedSpeakers = false
    @State private var showEdit = false
    @State private var showReanalyse = false
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(callId: String, store: CallsStore) {
        self.callId = callId
        _store = ObservedObject(wrappedValue: store)
        _uploads = ObservedObject(wrappedValue: CallUploadCenter.shared)
    }

    private var summary: CallSummary? { store.summary(callId) }
    private var detail: CallDetail? { store.details[callId] }
    private var audioKey: String { "call-" + callId }
    private var pollIdentity: String {
        (summary?.isProcessing == true ? "processing" : "idle") + "|" + (scenePhase == .active ? "active" : "inactive")
    }
    private var audioAvailable: Bool {
        guard let detail, detail.audioUrl != nil else { return false }
        if let expiry = FeatureFormat.date(detail.audioExpiresAt), expiry < Date() { return false }
        return true
    }
    private var availableTabs: [CallDetailTab] {
        var tabs: [CallDetailTab] = [.review, .drills]
        if !(detail?.segments.isEmpty ?? true) { tabs.append(.transcript) }
        return tabs
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let summary {
                    CallDetailHeader(summary: summary, detail: detail)
                    statusBlock(summary)
                    if showsTabs(summary) {
                        tabPicker
                        tabContent
                    }
                } else if store.loadingDetails.contains(callId) {
                    PlacementWaitingView(text: "Загружаю звонок…", retry: nil)
                } else {
                    FeatureEmptyState(icon: "phone.down", title: "Звонок не найден", text: "Возможно, его удалили на другом устройстве.")
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background { FeatureBackdrop() }
        .safeAreaInset(edge: .bottom) {
            if player.activeKey == audioKey || player.loadingKey == audioKey {
                CallAudioBar(player: player, onStop: { player.stop() })
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .navigationTitle(summary?.title ?? "Звонок")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .task {
            player.client = client
            await store.loadDetail(callId)
#if DEBUG
            if let preset = FeaturePreviewFixtures.initialCallTab(for: PreviewFixtures.screen) { tab = preset }
#endif
            // Opening a call that waits for «кто есть кто» asks right away.
            if summary?.kind == .needsSpeaker, detail?.speakers.isEmpty == false, !askedSpeakers {
                askedSpeakers = true
                showSpeakers = true
            }
        }
        .task(id: pollIdentity) {
            guard scenePhase == .active, summary?.isProcessing == true else { return }
            await store.pollDetail(callId)
        }
        .onChange(of: summary?.status ?? "") { _, status in
            if status == CallStatusKind.needsSpeaker.rawValue, !askedSpeakers, detail != nil {
                askedSpeakers = true
                showSpeakers = true
            }
        }
        .onChange(of: detail?.speakers.count ?? 0) { _, count in
            if count > 0, summary?.kind == .needsSpeaker, !askedSpeakers {
                askedSpeakers = true
                showSpeakers = true
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            if PlacementVoiceActions.interruptionBegan(note) { player.stop() }
        }
        .onDisappear { player.stop() }
        .sensoryFeedback(.selection, trigger: tab)
        .sheet(isPresented: $showSpeakers) {
            if let detail {
                CallSpeakerSheet(detail: detail) { me, labels in
                    await store.confirmSpeakers(callId: callId, me: me, labels: labels)
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let summary {
                CallEditSheet(summary: summary) { title, counterpart, context in
                    await store.updateDetails(callId: callId, title: title, counterpart: counterpart, context: context)
                }
            }
        }
        .sheet(isPresented: $showReanalyse) {
            CallReanalyseSheet(disputed: detail?.segments.filter { $0.disputed }.count ?? 0) { notes in
                await store.reanalyse(callId: callId, notes: notes)
            }
        }
        .confirmationDialog("Удалить звонок?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                Task {
                    if await store.delete(callId: callId) { dismiss() }
                }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Удалятся запись, расшифровка, разбор и тренировки из этого звонка. Паттерны пересчитаются.")
        }
    }

    // MARK: Status

    private func showsTabs(_ summary: CallSummary) -> Bool {
        summary.kind == .ready || detail?.review != nil
    }

    @ViewBuilder private func statusBlock(_ summary: CallSummary) -> some View {
        if let error = store.error {
            FeatureBanner(message: error, onDismiss: { store.error = nil })
        }
        if let notice = store.notice {
            FeatureBanner(message: notice, tone: .info, onDismiss: { store.notice = nil })
        }
        switch summary.kind {
        case .awaitingUpload:
            awaitingUpload(summary)
        case .queued, .processing, .analysing:
            CallProcessingCard(summary: summary)
        case .needsSpeaker:
            needsSpeaker
        case .error:
            failed(summary)
        case .ready, .unknown:
            EmptyView()
        }
    }

    @ViewBuilder private func awaitingUpload(_ summary: CallSummary) -> some View {
        if let job = uploads.job, job.callId == callId {
            CallUploadJobView(job: job, onCancel: { uploads.cancel(client: client) },
                              onResume: { uploads.resume(callId: callId, title: summary.title, uploadedBytes: nil, client: client) },
                              onDismiss: { uploads.dismissJob() })
                .padding(18)
                .featureGlass(radius: 26)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Label("Загрузка не закончена", systemImage: "arrow.up.circle").font(.headline)
                if uploads.hasLocalFile(callId) {
                    Text("Файл сохранён на iPhone. Загрузка продолжится с места остановки.")
                        .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Продолжить загрузку") {
                        uploads.resume(callId: callId, title: summary.title, uploadedBytes: summary.uploadedBytes, client: client)
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(uploads.isActive)
                } else {
                    Text("Файла больше нет на этом iPhone. Удали звонок и загрузи запись заново.")
                        .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Button("Удалить звонок", role: .destructive) { confirmDelete = true }
                        .buttonStyle(SecondaryButton())
                }
            }
            .padding(18)
            .featureGlass(radius: 26)
        }
    }

    private var needsSpeaker: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Кто из собеседников ты?", systemImage: "person.2.wave.2").font(.headline)
            Text("Расшифровка готова. Выбери себя по репликам — после этого начнётся разбор.")
                .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Выбрать себя") { showSpeakers = true }
                .buttonStyle(PrimaryButton())
                .disabled(detail == nil)
        }
        .padding(18)
        .featureGlass(radius: 26, tint: FeaturePalette.warning.opacity(0.35))
    }

    private func failed(_ summary: CallSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                VoiceOrb(mode: .ready, level: 0, mood: .sad, statusDescription: "Разбор не получился", interactive: false)
                    .frame(width: 56, height: 60)
                    .accessibilityHidden(true)
                Text("Разбор не получился").font(.headline)
            }
            Text((summary.error ?? "Что-то пошло не так на сервере.") + " Запись и расшифровка сохранены — можно повторить.")
                .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await store.retry(callId: callId) }
            } label: {
                HStack(spacing: 8) {
                    if store.isBusy(callId) { ProgressView() }
                    Text("Повторить")
                }
            }
            .buttonStyle(PrimaryButton())
            .disabled(store.isBusy(callId))
            Button("Удалить звонок", role: .destructive) { confirmDelete = true }
                .buttonStyle(QuietButton())
        }
        .padding(18)
        .featureGlass(radius: 26)
    }

    // MARK: Tabs

    private var tabPicker: some View {
        Picker("Раздел", selection: $tab) {
            ForEach(availableTabs) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .onChange(of: availableTabs.count) { _, _ in
            if !availableTabs.contains(tab) { tab = .review }
        }
    }

    @ViewBuilder private var tabContent: some View {
        switch tab {
        case .review:
            if let detail, let review = detail.review {
                CallReviewView(detail: detail, review: review, store: store, player: player,
                               onSeek: audioAvailable ? { seconds in seek(seconds) } : nil)
            } else {
                FeatureEmptyState(icon: "doc.text.magnifyingglass", title: "Разбор пока не готов", text: "Он появится здесь, как только сервер закончит.")
            }
        case .drills:
            VStack(alignment: .leading, spacing: 12) {
                FeatureSectionTitle(title: "Тренировки из этого звонка",
                                    subtitle: "Переиграй моменты, которые стоили денег. Начни с первой — она важнее.")
                DrillsList(drills: detail?.drills ?? [])
            }
        case .transcript:
            if let detail {
                CallTranscriptView(detail: detail, store: store, player: player, audioKey: audioKey,
                                   onSeek: audioAvailable ? { seconds in seek(seconds) } : nil,
                                   onReanalyse: { showReanalyse = true })
            }
        }
    }

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("Изменить название и собеседника", systemImage: "pencil") { showEdit = true }
                if summary?.kind == .ready {
                    Button("Пересобрать разбор", systemImage: "arrow.triangle.2.circlepath") { showReanalyse = true }
                }
                if !(detail?.speakers.isEmpty ?? true) {
                    Button("Кто есть кто", systemImage: "person.2") { showSpeakers = true }
                }
                Button("Удалить звонок", systemImage: "trash", role: .destructive) { confirmDelete = true }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("Действия со звонком")
        }
    }

    /// Plays the processed call audio from a moment (one second earlier for context).
    private func seek(_ seconds: Double) {
        guard let detail, let path = detail.audioUrl else { return }
        let start = max(0, seconds - 1)
        if player.activeKey == audioKey, player.isPlaying {
            player.seek(to: start)
            return
        }
        player.beginLoading(audioKey)
        Task {
            do {
                let url = try await store.callAudio(callId: callId, path: path)
                guard player.loadingKey == audioKey else { return }
                await player.play(fileURL: url, key: audioKey, from: start)
            } catch {
                player.cancelLoading(audioKey)
                store.error = FeatureErrorText.describe(error)
            }
        }
    }
}

// MARK: - Header and processing

struct CallDetailHeader: View {
    let summary: CallSummary
    let detail: CallDetail?

    private var meta: String {
        var parts: [String] = []
        if let counterpart = summary.counterpart, !counterpart.isEmpty { parts.append(counterpart) }
        if let date = FeatureFormat.longDate(summary.occurredAt ?? summary.createdAt) { parts.append(date) }
        if let duration = FeatureFormat.duration(summary.durationSeconds) { parts.append(duration) }
        return parts.joined(separator: " · ")
    }
    private var kindLine: String {
        var parts = [FeatureLabels.context(summary.context)]
        if let kind = detail?.review?.kind, !kind.isEmpty { parts.append(kind) }
        parts.append(FeatureLabels.callSource(summary.source).lowercased())
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(summary.title)
                .font(.title.weight(.bold))
                .fontDesign(.rounded)
                .fixedSize(horizontal: false, vertical: true)
            if !meta.isEmpty {
                Text(meta).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            // Context, kind and source as one plain meta line (no pills: they never change).
            Text(kindLine).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let outcome = detail?.review?.outcome ?? summary.outcome, !outcome.isEmpty {
                Text(outcome).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct CallProcessingCard: View {
    let summary: CallSummary

    private var stage: String {
        if let stage = summary.progress?.stage, !stage.isEmpty { return stage }
        switch summary.kind {
        case .queued: return "В очереди на расшифровку"
        case .analysing: return "Пишу разбор"
        default: return "Расшифровываю запись"
        }
    }

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VoiceOrb(mode: .thinking, level: 0, mood: .thinking, statusDescription: stage, interactive: false)
                .frame(width: 84, height: 88)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(stage).font(.headline).fixedSize(horizontal: false, vertical: true)
                if let percent = summary.progress?.percent, percent > 0 {
                    FeatureProgressBar(value: percent / 100, tint: FeaturePalette.violet,
                                       accessibilityText: stage)
                } else {
                    ProgressView().frame(maxWidth: .infinity, alignment: .leading)
                }
                Text("Можно закрыть экран — разбор продолжится на сервере.")
                    .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .featureGlass(radius: 26)
        .accessibilityElement(children: .combine)
    }
}

struct CallAudioBar: View {
    @ObservedObject var player: FeatureAudioPlayer
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            if player.loadingKey != nil && !player.isPlaying {
                ProgressView()
                Text("Загружаю запись звонка…").font(.subheadline)
            } else {
                Image(systemName: "waveform").foregroundStyle(FeaturePalette.violet).symbolEffect(.variableColor.iterative, isActive: player.isPlaying)
                Text(FeatureFormat.clock(player.currentTime) + " / " + FeatureFormat.clock(player.duration))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            Spacer(minLength: 8)
            Button(action: onStop) {
                Image(systemName: "stop.fill").frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Остановить запись звонка")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .featureGlass(radius: 26, interactive: true)
    }
}

// MARK: - Sheets

/// «Кто есть кто» (web: SpeakerConfirm / SpeakerSheet in components/calls/call-detail.tsx): pick yourself by the lines,
/// name the others if you like. While the call waits for it, confirming the pre-selected voice is enough; later the
/// action stays off until the choice really changes, because the server rebuilds the review from it.
struct CallSpeakerSheet: View {
    let detail: CallDetail
    let onConfirm: (String, [String: String]) async -> Bool
    @State private var me: String?
    @State private var labels: [String: String] = [:]
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    init(detail: CallDetail, onConfirm: @escaping (String, [String: String]) async -> Bool) {
        self.detail = detail
        self.onConfirm = onConfirm
        _me = State(initialValue: detail.meSpeakerId)
    }

    private var waitsForChoice: Bool { detail.kind == .needsSpeaker }
    /// A review exists: confirming rebuilds it.
    private var rebuilds: Bool { detail.review != nil }
    private var named: Bool {
        labels.contains { $0.key != me && !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    /// Nothing new → nothing to rebuild.
    private var changed: Bool {
        guard let me else { return false }
        return waitsForChoice || me != detail.meSpeakerId || named
    }
    private var intro: String {
        waitsForChoice
            ? "Я не узнал твой голос уверенно. Посмотри на реплики и выбери себя — разбор будет про твои слова."
            : "Выбери себя по репликам — разбор будет про твои слова. Остальным можно дать имена."
    }
    private var note: String {
        if rebuilds {
            return "После подтверждения разбор соберётся заново — это займёт пару минут. Паттерны пересчитаются, а тренировки из этого звонка, которые ты ещё не начинал, заменятся новыми. Начатые и пройденные тренировки и принятые факты останутся."
        }
        return waitsForChoice ? "Разбор начнётся с этим выбором — это займёт пару минут."
            : "Разбор начнётся заново с этим выбором — это займёт пару минут."
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(intro)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(detail.speakers) { speaker in
                        speakerCard(speaker)
                    }
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
            }
            .background { FeatureBackdrop() }
            .safeAreaInset(edge: .bottom, spacing: 0) { confirmBar }
            .navigationTitle("Кто есть кто")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton(title: "Позже") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(working)
    }

    /// The long action label does not fit a navigation bar, so it sits pinned under the list on the system bar material.
    private var confirmBar: some View {
        Button { confirm() } label: {
            HStack(spacing: 10) {
                if working { ProgressView().tint(Theme.ctaLabel) }
                Text(rebuilds ? "Пересобрать разбор" : "Подтвердить и разобрать")
            }
        }
        .buttonStyle(PrimaryButton())
        .disabled(!changed || working)
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
        .background(.bar)
    }

    private func speakerCard(_ speaker: CallSpeaker) -> some View {
        let selected = me == speaker.id
        // The voice marked as yours so far reads «Был отмечен как ты» while another one is picked (as on the web).
        let name = speaker.isMe && speaker.label == "Ты" ? "Был отмечен как ты" : speaker.label
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                me = speaker.id
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? FeaturePalette.violet : Color.secondary)
                        .font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(selected ? "Это я" : name).font(.headline)
                        if let talk = FeatureFormat.duration(speaker.talkSeconds) {
                            Text("Говорит " + talk).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
            ForEach(speaker.sample.prefix(3), id: \.self) { line in
                FeatureQuote(text: line)
            }
            if !selected {
                TextField("Имя собеседника", text: labelBinding(speaker))
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.words)
            }
        }
        .padding(16)
        .featureGlass(radius: 24, tint: selected ? FeaturePalette.lavender.opacity(0.4) : nil, interactive: true)
    }

    private func labelBinding(_ speaker: CallSpeaker) -> Binding<String> {
        Binding(get: { labels[speaker.id] ?? "" }, set: { labels[speaker.id] = $0 })
    }

    private func confirm() {
        guard let me, changed, !working else { return }
        working = true
        Task {
            let accepted = await onConfirm(me, labels.filter { $0.key != me })
            working = false
            if accepted { dismiss() }
        }
    }
}

struct CallEditSheet: View {
    let summary: CallSummary
    let onSave: (String, String, String) async -> Bool
    @State private var title: String
    @State private var counterpart: String
    @State private var context: String
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    init(summary: CallSummary, onSave: @escaping (String, String, String) async -> Bool) {
        self.summary = summary
        self.onSave = onSave
        _title = State(initialValue: summary.title)
        _counterpart = State(initialValue: summary.counterpart ?? "")
        _context = State(initialValue: summary.context)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("О звонке") {
                    TextField("Название", text: $title)
                    TextField("Собеседник", text: $counterpart)
                    Picker("Контекст", selection: $context) {
                        Text("Работа").tag("work")
                        Text("Жизнь").tag("life")
                        Text("Переезд").tag("relocation")
                        Text("Другое").tag("other")
                    }
                }
            }
            .navigationTitle("Звонок")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") {
                        working = true
                        Task {
                            let saved = await onSave(title, counterpart, context)
                            working = false
                            if saved { dismiss() }
                        }
                    }
                    .disabled(working || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

struct CallReanalyseSheet: View {
    let disputed: Int
    let onStart: (String?) async -> Bool
    @State private var notes = ""
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Например: на 12:40 я шутил, это не уступка", text: $notes, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    Text("Что учесть")
                } footer: {
                    Text(disputed > 0
                         ? "Строки «не так расслышано» (\(disputed)) не попадут в разбор. Расшифровка сохранится."
                         : "Разбор соберётся заново по той же расшифровке. Тренировки обновятся.")
                }
            }
            .navigationTitle("Пересобрать разбор")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Пересобрать") {
                        working = true
                        Task {
                            let started = await onStart(notes)
                            working = false
                            if started { dismiss() }
                        }
                    }
                    .disabled(working)
                }
            }
        }
    }
}
