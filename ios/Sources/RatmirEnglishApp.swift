import SwiftUI

@main struct RatmirEnglishApp: App {
    @StateObject private var client = TrainingClient()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(client).tint(.primary)
                .disclosureGroupStyle(SoftDisclosureStyle())
                .buttonStyle(PressButton())
#if DEBUG
                .modifier(PreviewAccessibility())
#endif
                .task {
#if DEBUG
                    if PreviewFixtures.install(client) { return }
#endif
                    await client.restore()
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    var body: some View {
        Group {
            if client.signedIn {
                TabView(selection: $selectedTab) {
                    Group {
                        if let onboarding = client.state?.onboarding, onboarding.status != "ready" {
                            OnboardingView(onboarding: onboarding)
                        } else { HomeView(onProgress: { selectedTab = 1 }) }
                    }.background(StableTabBarAppearance(selection: selectedTab))
                        .toolbarColorScheme(.light, for: .tabBar)
                        .tabItem { Label("Сегодня", systemImage: "sun.max") }.tag(0)
                    ProgressViewScreen().background(StableTabBarAppearance(selection: selectedTab)).toolbarColorScheme(.light, for: .tabBar)
                        .tabItem { Label("Прогресс", systemImage: "chart.xyaxis.line") }.tag(1)
                    HistoryView().background(StableTabBarAppearance(selection: selectedTab)).toolbarColorScheme(.light, for: .tabBar)
                        .tabItem { Label("История", systemImage: "clock.arrow.circlepath") }.tag(2)
                    SettingsView().background(StableTabBarAppearance(selection: selectedTab)).toolbarColorScheme(.light, for: .tabBar)
                        .tabItem { Label("Настройки", systemImage: "slider.horizontal.3") }.tag(3)
                }.tint(Theme.charcoal).toolbarColorScheme(.light, for: .tabBar)
            } else { LoginView() }
        }
        .task {
#if DEBUG
            if PreviewFixtures.screen == "settings" { selectedTab = 3 }
            if PreviewFixtures.screen == "progress" || PreviewFixtures.screen == "baseline-report" { selectedTab = 1 }
            if ["curriculum", "achievements", "ielts-track", "ranks", "ranks-bottom"].contains(PreviewFixtures.screen ?? "") { selectedTab = 1 }
            if PreviewFixtures.screen == "history" { selectedTab = 2 }
            if PreviewFixtures.screen == "reminder-editor" || PreviewFixtures.screen == "reminder-denied" { selectedTab = 3 }
            if PreviewFixtures.screen == "tab-history-round-trip" {
                for tab in [2, 0, 1, 2, 3, 0, 2, 1, 3, 2, 0, 2] {
                    try? await Task.sleep(for: .milliseconds(650))
                    selectedTab = tab
                }
            }
#endif
        }
        .sheet(isPresented: $client.conversationPresented) {
            if let value = client.conversation {
                ConversationView(id: value.id).environmentObject(client)
#if DEBUG
                    .modifier(PreviewAccessibility())
#endif
                    .presentationDetents([.large]).presentationDragIndicator(.visible)
                    .interactiveDismissDisabled(client.recording || client.microphoneStarting)
            }
        }
        .onChange(of: client.conversationPresented) { _, presented in
            if !presented { client.minimizeConversation() }
        }
        .onChange(of: client.homeRequest) { _, _ in selectedTab = 0 }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await client.refreshReminderStatus() } }
        }
        .alert(client.error?.hasPrefix("Занятие сохранено.") == true ? "Занятие сохранено" : "Не получилось", isPresented: Binding(get: { client.error != nil && !client.conversationPresented },
            set: { if !$0 { client.error = nil } })) {
            Button("Понятно", role: .cancel) { client.error = nil }
        } message: { Text(client.error ?? "") }
    }
}

struct LoginView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var code = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    BrandMark(size: 58)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Твой английский.\nНа связи.")
                            .font(.system(.largeTitle, design: .rounded).weight(.semibold)).tracking(-0.8)
                        Text("Твоя практика, история и прогресс. На телефоне и компьютере.")
                            .foregroundStyle(Theme.secondary)
                    }
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 18) {
                            InputLabel(title: "Адрес приложения")
                            TextField("https://адрес", text: $client.server)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .font(.subheadline).padding(14)
                                .background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))
                            InputLabel(title: "Личный код")
                            SecureField("Код доступа", text: $code)
                                .textInputAutocapitalization(.never).autocorrectionDisabled().padding(14)
                                .background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 14))
                            Button { Task { await client.login(code: code); if client.signedIn { code = "" } } } label: {
                                HStack { Text("Войти"); Spacer(); if client.busy { ProgressView().tint(Theme.lime) } else { Image(systemName: "arrow.right") } }
                            }.buttonStyle(PrimaryButton()).disabled(client.busy || code.isEmpty)
                        }
                    }
                    Text("Доступ сохраняется на этом iPhone. Личная история хранится на твоём сервере.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }.padding(24).padding(.top, 30).frame(maxWidth: 600, alignment: .leading).frame(maxWidth: .infinity)
            }.modifier(ReadingCanvas()).scrollDismissesKeyboard(.interactively).navigationBarHidden(true)
        }
    }
}

struct HomeView: View {
    var onProgress: () -> Void = {}
    @EnvironmentObject private var client: TrainingClient
    @AppStorage("practice-context") private var context = "life"
    @AppStorage("practice-mode") private var mode = "learning"
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var saved: Conversation? { client.state?.sessions.first { ($0.baseline == nil || client.state?.onboarding?.status != "ready") && ($0.status != "completed" || $0.retryDeferred == true) } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Привет, \(client.state?.profile.name ?? "ты").")
                            .font(.system(.largeTitle, design: .rounded).weight(.semibold)).tracking(-0.7)
                        Text("Давай поговорим \(client.state?.profile.dailyMinutes ?? 15) минут.")
                            .foregroundStyle(Theme.secondary)
                    }
                    if client.state?.onboarding?.status == "ready" {
                        if client.state?.onboarding?.report == nil {
                            NativeBaselineProfile(report: nil)
                        } else {
                            Button(action: onProgress) {
                                HStack(spacing: 8) {
                                    Text("Твой стартовый профиль").font(.subheadline.weight(.medium))
                                    Image(systemName: "arrow.up.right").font(.caption.weight(.semibold))
                                }.foregroundStyle(Theme.charcoal).frame(minHeight: 44)
                            }.buttonStyle(PressButton())
                        }
                    }
                    if let saved {
                        Button { client.resume(saved) } label: {
                            HStack(spacing: 14) {
                                Image(systemName: saved.status == "analysing" ? "hourglass" : saved.status == "review" ? "text.badge.checkmark" : "play.fill")
                                    .font(.body).frame(width: 42, height: 42).background(Theme.lavender.opacity(0.4), in: Circle())
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(sessionLabel(saved)).font(.caption).foregroundStyle(Theme.secondary)
                                    Text(saved.lesson.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "arrow.up.right").font(.subheadline)
                            }.foregroundStyle(Theme.charcoal).padding(18)
                                .background(Color.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 24))
                        }.buttonStyle(PressButton()).disabled(client.busy || client.recording)
                    }
                    if let progression = client.state?.progression {
                        NextPracticeCard(progression: progression)
                        JourneySummary(progression: progression)
                    }
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 20) {
                            HStack { Text("Новый разговор").font(.title3.weight(.semibold)); Spacer(); Image(systemName: "waveform").foregroundStyle(Theme.secondary) }
                            VStack(alignment: .leading, spacing: 10) {
                                InputLabel(title: "О чём поговорим")
                                SelectionRow(selection: $context, options: [
                                    SelectionOption(id: "life", title: "Жизнь", icon: "bubble.left.and.bubble.right"),
                                    SelectionOption(id: "work", title: "Работа", icon: "briefcase"),
                                    SelectionOption(id: "relocation", title: "Переезд", icon: "airplane")])
                            }
                            VStack(alignment: .leading, spacing: 10) {
                                InputLabel(title: "Как тренируемся")
                                SelectionRow(selection: $mode, options: [
                                    SelectionOption(id: "learning", title: "С опорами", icon: "lightbulb"),
                                    SelectionOption(id: "call", title: "Созвон", icon: "phone")])
                                Text(mode == "call" ? "Слушай и отвечай. Текст можно открыть, если понадобится." : "Собеседник говорит вслух. Текст и подсказки рядом, когда нужны.")
                                    .font(.footnote).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                            Button { Task { await client.start(mode: mode, context: context, forceNew: true) } } label: {
                                HStack { Text(client.busy ? "Готовим разговор" : "Поехали"); Spacer(); if client.busy { ProgressView().tint(Theme.lime) } else { Image(systemName: "arrow.up.right") } }
                            }.buttonStyle(PrimaryButton()).disabled(client.busy)
                        }
                    }
                    if client.busy {
                        ActivityPanel(title: client.operationStage ?? "Готовим разговор", detail: "Подбираем ситуацию под твою практику.", startedAt: client.operationStartedAt)
                            .transition(reduceMotion ? .identity : NativeMotion.insertion)
                    }
                    if client.state?.progression == nil {
                        HStack(spacing: 12) {
                            Metric(value: "\(client.state?.completed ?? 0)", title: "Завершено", color: Theme.lavender)
                            Metric(value: "\(client.state?.xp ?? 0)", title: "Опыт XP", color: Theme.lime)
                        }
                    }
                    Text("Новый разговор откроется отдельно. К прежнему можно вернуться в истории.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
                    .animation(reduceMotion ? nil : NativeMotion.reveal, value: client.busy)
            }.modifier(ReadingCanvas()).navigationBarHidden(true)
                .refreshable { await client.perform { try await client.refresh() } }
        }
    }
    private func sessionLabel(_ value: Conversation) -> String {
        if value.retryDeferred == true { return "Одна попытка ждёт тебя" }
        if value.status == "review" { return "Разбор готов" }
        if value.status == "analysing" { return "Разбор ещё готовится" }
        return "Продолжить разговор"
    }
}

struct ConversationView: View {
    let id: String
    @EnvironmentObject private var client: TrainingClient
    @State private var showBrief = false
    @State private var showConversation = false
    @State private var showListeningCheck = false
    @State private var analysisStartedAt = Date()
    private enum EndingAction: Equatable { case review, complete, deferRetry }
    @State private var pendingEnding: EndingAction?
    @FocusState private var draftFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var conversation: Conversation? { client.conversation }
    private var textActivity: Bool { conversation?.lesson.material != nil }
    private var readingActivity: Bool { conversation?.lesson.material?.type == "reading-passage" }
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var active: Bool { conversation?.status == "active" || conversation?.status == "error" }
    private var hasReview: Bool { conversation?.analysis != nil }
    private var baselineReplies: Int {
        conversation?.turns.filter { $0.role == "user" && $0.source == "audio" && $0.audioFile != nil && ($0.support ?? 0) == 0 && $0.transcriptEdited != true && $0.disputed != true }.count ?? 0
    }
    private var baselineHasEnoughReplies: Bool { conversation?.baseline == nil || baselineReplies >= 2 }
    private var hasPendingAnswer: Bool {
        !client.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || client.recordedFile != nil || client.pendingMessageID != nil || client.hasUnuploadedRecording
    }
    private var canSaveCompletion: Bool {
        conversation?.id == id && !client.busy && !client.recording && !client.microphoneStarting && !hasPendingAnswer && conversation?.analysis != nil
    }
    private var canRequestReview: Bool {
        conversation?.id == id && !client.busy && !client.recording && !client.microphoneStarting && !hasPendingAnswer && active && conversation?.processing == nil
            && baselineHasEnoughReplies && conversation?.turns.contains(where: { $0.role == "user" }) == true
    }
    private var mayComplete: Bool {
        guard let value = conversation, let analysis = value.analysis else { return false }
        return value.completion?.canComplete ?? (analysis.priorities.isEmpty || hasConfirmedImprovement(value))
    }
    private func hasConfirmedImprovement(_ value: Conversation) -> Bool {
        guard let analysis = value.analysis else { return false }
        if let completion = value.completion, !completion.canComplete || completion.needsRetry { return false }
        return value.retries.contains {
            $0.improved == true && ($0.analysisVersion == nil || $0.analysisVersion == analysis.version)
        }
    }
    private var orbMode: VoiceOrbMode {
        if client.recording { return .listening }
        if client.playing { return .speaking }
        if client.voiceLoading || client.busy || conversation?.processing != nil || conversation?.status == "analysing" { return .thinking }
        return .ready
    }
    private var orbMood: VoiceOrbMood {
        if client.recording || client.playingLearnerRecording { return .attentive }
        if client.error != nil { return .supportive }
        if client.playing { return .friendly }
        if client.busy || client.voiceLoading || conversation?.processing != nil { return .curious }
        return .calm
    }
    private var playbackControlLabel: String {
        client.playing ? "Стоп" : client.needsPlaybackAcknowledgement ? "Сохранить прослушивание" : "Ещё раз"
    }
    var body: some View {
        NavigationStack {
            decoratedConversation
                .toolbar { conversationToolbar }
                .task(id: pollingKey) {
                    if conversation?.status == "analysing" { analysisStartedAt = processingStart ?? client.operationStartedAt ?? Date() }
                    await client.pollReview()
                }
                .alert("Не получилось", isPresented: errorPresented) {
                    Button("Понятно", role: .cancel) { client.error = nil }
                } message: { Text(client.error ?? "") }
                .confirmationDialog(endingTitle, isPresented: endingPresented, titleVisibility: .visible) {
                    if let ending = pendingEnding {
                        Button(ending == .review ? "Получить разбор" : ending == .complete ? "Завершить и вернуться на главную" : "Сохранить и вернуться на главную") {
                            confirmEnding(ending)
                        }
                        Button("Остаться в занятии", role: .cancel) { }
                    }
                } message: { Text(endingMessage) }
        }
    }
    private var endingPresented: Binding<Bool> {
        Binding(get: { pendingEnding != nil }, set: { if !$0 { pendingEnding = nil } })
    }
    private var endingTitle: String {
        switch pendingEnding {
        case .review: return textActivity ? "Передать задание на разбор?" : "Закончить разговор?"
        case .complete: return "Завершить занятие?"
        case .deferRetry: return "На сегодня всё?"
        case nil: return ""
        }
    }
    private var endingMessage: String {
        switch pendingEnding {
        case .review: return "Отправленные ответы сохранены. После разбора можно сделать улучшенную попытку."
        case .complete: return "Результат и разбор останутся в истории."
        case .deferRetry: return "Разбор сохранится. Улучшенная попытка останется на потом и не будет засчитана как выполненная."
        case nil: return ""
        }
    }
    private func confirmEnding(_ ending: EndingAction) {
        if ending == .review {
            guard canRequestReview else { return }
            draftFocused = false
            Task { await client.action("finish") }
        } else {
            guard canSaveCompletion else { return }
            Task { await client.action("complete", deferRetry: ending == .deferRetry, returnHome: true) }
        }
    }
    private var pollingKey: String { (conversation?.status ?? "") + "|" + (conversation?.processing?.stage ?? "") }
    private var errorPresented: Binding<Bool> {
        Binding(get: { client.error != nil }, set: { if !$0 { client.error = nil } })
    }
    private var decoratedConversation: some View {
        conversationScroll
            .modifier(ConversationDock { bottomDock })
            .navigationTitle(hasReview ? "Твой разбор" : textActivity ? (readingActivity ? "Чтение" : "Письмо") : "Разговор")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.light, for: .navigationBar)
    }
    private var conversationScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                conversationContent.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(Theme.surface).foregroundStyle(Theme.charcoal)
                .environment(\.colorScheme, .light).scrollDismissesKeyboard(.interactively)
                .onChange(of: conversation?.turns.count) { _, _ in
                    draftFocused = false
                    if showConversation { proxy.scrollTo("end", anchor: .bottom) }
                }
#if DEBUG
                .task {
                    if PreviewFixtures.screen == "preview-timing" {
                        try? await Task.sleep(for: .milliseconds(150))
                        proxy.scrollTo("speech-timing", anchor: .top)
                    }
                }
#endif
        }
    }
    private var conversationContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let value = conversation {
                Text(textActivity ? (readingActivity ? "ЧТЕНИЕ" : "ПИСЬМО") : value.mode == "call" ? "СОЗВОН" : "С ОПОРАМИ")
                    .font(.caption2.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.charcoal)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Theme.lavender.opacity(0.3), in: Capsule())
                conversationHeader(value)
                if value.status == "completed", let result = client.state?.progression?.recentResults.first(where: { $0.sessionId == value.id }) {
                    PracticeOutcomeView(result: result)
                }
                if let analysis = value.analysis { reviewContent(analysis, conversation: value) }
                if (client.busy || value.processing != nil) && !client.recording && value.status != "analysing" {
                    ActivityPanel(title: client.operationStage ?? "Собеседник готовит ответ", detail: "Твой ответ сохранён. Можно немного выдохнуть.", startedAt: client.operationStartedAt ?? processingStart)
                }
                Color.clear.frame(height: 1).id("end")
            }
        }.animation(reduceMotion ? nil : NativeMotion.reveal, value: hasReview)
            .animation(reduceMotion ? nil : NativeMotion.reveal, value: conversation?.status)
    }
    @ViewBuilder private func conversationHeader(_ value: Conversation) -> some View {
        if hasReview { reviewHeader(value).transition(reduceMotion ? .identity : NativeMotion.insertion) }
        else if value.status == "analysing" { analysisWaiting.transition(reduceMotion ? .identity : NativeMotion.insertion) }
        else { liveConversation(value).transition(reduceMotion ? .identity : NativeMotion.insertion) }
    }
    @ViewBuilder private var bottomDock: some View {
        if let value = conversation {
            if active { composer }
            else if hasReview && (value.status != "completed" || value.retryDeferred == true) { reviewDock }
            else if value.status == "completed" {
                Button { client.returnToHome() } label: { Label("На главную", systemImage: "house") }
                    .buttonStyle(PrimaryButton()).padding(.horizontal, 20).padding(.vertical, 14)
            }
        }
    }
    @ToolbarContentBuilder private var conversationToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { draftFocused = false; client.minimizeConversation() } label: {
                Image(systemName: "chevron.down").font(.subheadline.weight(.semibold))
                    .frame(width: 44, height: 44)
            }.buttonStyle(PressButton()).accessibilityLabel("Свернуть занятие").disabled(client.recording || client.microphoneStarting)
        }
    }
    private var processingStart: Date? {
        guard let value = conversation?.processing?.startedAt else { return nil }
        return NativeDate.parse(value)
    }
    private func liveConversation(_ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                Text(value.lesson.title).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                if value.baseline != nil {
                    Text("Стартовая проверка. Попросить повторить или пояснить сказанное можно. Текст собеседника появится после разбора.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }
                DisclosureGroup(isExpanded: $showBrief) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(value.lesson.goal).font(.subheadline)
                        Text(value.lesson.why).font(.footnote).foregroundStyle(Theme.secondary)
                    }.padding(.top, 10)
                } label: { Text("Твоя задача").font(.footnote.weight(.medium)) }
            }
            if let material = value.lesson.material { lessonMaterial(material) }
            VStack(spacing: 8) {
                MeasuredVoiceOrb(meter: client.voiceMeter, mode: orbMode, mood: orbMood, statusDescription: voiceLabel)
                    .frame(width: value.lesson.material == nil ? 214 : 112, height: value.lesson.material == nil ? 214 : 112)
                HStack(spacing: 7) {
                    Circle().fill(client.recording ? Theme.lime : client.playing ? Theme.lavender : Theme.charcoal.opacity(0.45)).frame(width: 6, height: 6)
                    Text(voiceLabel).font(.footnote.weight(.medium)).foregroundStyle(Theme.secondary)
                }
            }.frame(maxWidth: .infinity).padding(.vertical, 4)
            if let turn = value.turns.last(where: { $0.role == "assistant" }), value.mode == "learning" || client.assistantTextShown { TranscriptCard(turn: turn) }
            HStack(spacing: 10) {
                Button {
                    if client.playing { client.stopSpeaking() } else { Task { if client.needsPlaybackAcknowledgement { await client.retryPlaybackAcknowledgement() } else { await client.speak() } } }
                } label: { Label(playbackControlLabel, systemImage: client.playing ? "stop.fill" : client.needsPlaybackAcknowledgement ? "checkmark" : "speaker.wave.2") }
                    .buttonStyle(QuietButton()).disabled(!client.playing && (client.busy || client.voiceLoading || client.recording))
                if value.mode == "call" && value.baseline == nil && !client.assistantTextShown {
                    Button { Task { await client.revealText() } } label: { Label("Текст", systemImage: "text.alignleft") }
                        .buttonStyle(QuietButton()).disabled(client.busy || client.recording)
                } else if value.mode == "learning" {
                    Button { Task { await client.getHint() } } label: { Label("Подсказка", systemImage: "lightbulb") }
                        .buttonStyle(QuietButton()).disabled(client.busy || client.recording)
                }
            }.frame(maxWidth: .infinity)
            if client.playing { Text(client.audioOutput).font(.caption).foregroundStyle(Theme.secondary).frame(maxWidth: .infinity) }
            if let routeMessage = client.audioRouteMessage { Text(routeMessage).font(.footnote).foregroundStyle(Theme.secondary) }
            if let hint = client.hint {
                SurfaceCard(color: Theme.lime.opacity(0.4)) {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Опора", systemImage: "lightbulb").font(.caption.weight(.semibold))
                        Text(hint).font(.subheadline)
                    }
                }
            }
            if !client.recording, let last = value.turns.last(where: { $0.role == "user" }) { TranscriptCard(turn: last) }
            if value.turns.count > 2 {
                DisclosureGroup(isExpanded: $showConversation) {
                    VStack(spacing: 12) {
                        ForEach(value.turns) { turn in
                            if turn.role == "user" || value.mode == "learning" || client.assistantTextShown { TranscriptCard(turn: turn) }
                        }
                    }.padding(.top, 12)
                } label: { Text(textActivity ? "Все ответы" : "Весь разговор").font(.footnote.weight(.medium)) }
            }
        }
    }
    private func lessonMaterial(_ material: Lesson.Material) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                Label(material.type == "reading-passage" ? "Текст для чтения" : "Задание для письма", systemImage: material.type == "reading-passage" ? "text.book.closed" : "square.and.pencil")
                    .font(.caption.weight(.semibold))
                Text(material.text).font(.subheadline).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                Divider().opacity(0.5)
                Text(material.instruction).font(.footnote.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                Text("Оригинальный учебный материал. Это не задание официального экзамена.").font(.caption).foregroundStyle(Theme.secondary)
            }
        }
    }
    private var voiceLabel: String {
        if client.recording { return "Слушаю тебя" }
        if client.playing { return client.playingLearnerRecording ? "Слушаем твою запись" : "Собеседник говорит" }
        if client.voiceLoading { return "Готовим голос" }
        if client.busy { return client.operationStage ?? "Готовим ответ" }
        if conversation?.status == "analysing" { return textActivity ? "Разбираем задание" : "Разбираем разговор" }
        if conversation?.processing != nil { return "Собеседник готовит ответ" }
        return "Твой ход"
    }
    private var analysisWaiting: some View {
        VStack(spacing: 22) {
            MeasuredVoiceOrb(meter: client.voiceMeter, mode: orbMode, mood: orbMood, statusDescription: voiceLabel).frame(width: 200, height: 200)
            ActivityPanel(title: conversation?.processing?.stage == "waiting-retry" ? "Сервис задержал разбор" : textActivity ? "Разбираем задание" : "Разбираем разговор", detail: textActivity ? (readingActivity ? "Сверяем твои ответы с текстом и проверяем английский." : "Проверяем ясность мысли, структуру и английский в твоём тексте.") : "Проверяем смысл, английский и то, как ты использовал ответы собеседника.", startedAt: analysisStartedAt)
            if let turn = conversation?.turns.last(where: { $0.role == "assistant" }) {
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 14) {
                        InputLabel(title: "Пока ждём")
                        Text(textActivity ? (readingActivity ? "Какая деталь текста подтверждает твой ответ?" : "Какую мысль ты хотел донести? Найди её в своём тексте.") : "Что было важно собеседнику? Вспомни одну конкретную деталь.")
                            .font(.subheadline.weight(.medium))
                        HStack(spacing: 10) {
                            Button { showListeningCheck.toggle() } label: {
                                Label(showListeningCheck ? "Скрыть ответ" : "Проверить себя", systemImage: "text.alignleft")
                            }.buttonStyle(QuietButton())
                            if !textActivity {
                                Button {
                                    if client.playing { client.stopSpeaking() } else { Task { if client.needsPlaybackAcknowledgement { await client.retryPlaybackAcknowledgement() } else { await client.speak() } } }
                                } label: { Image(systemName: client.playing ? "stop.fill" : client.needsPlaybackAcknowledgement ? "checkmark" : "speaker.wave.2") }
                                    .buttonStyle(QuietButton()).disabled(!client.playing && (client.busy || client.voiceLoading))
                                    .accessibilityLabel(playbackControlLabel)
                            }
                        }
                        if showListeningCheck {
                            Text(textActivity ? (readingActivity ? conversation?.lesson.material?.text ?? turn.text : conversation?.turns.last(where: { $0.role == "user" })?.text ?? turn.text) : turn.text)
                                .font(.subheadline).foregroundStyle(Theme.secondary).textSelection(.enabled)
                        }
                    }
                }
            }
            Text("Можно свернуть занятие. Когда разбор будет готов, он останется в истории.")
                .font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
            Button { client.minimizeConversation() } label: { Label("Вернусь чуть позже", systemImage: "chevron.down") }
                .buttonStyle(PrimaryButton())
            Button("Проверить сейчас") { Task { await client.perform { try await client.refresh() } } }
                .font(.footnote).disabled(client.busy)
        }.frame(maxWidth: .infinity).padding(.vertical, 20)
    }
    private func reviewHeader(_ value: Conversation) -> some View {
        let improved = hasConfirmedImprovement(value)
        let orbStatus = improved ? "Твоя улучшенная попытка подтверждена" : value.retryDeferred == true ? "Улучшенная попытка отложена" : "Разбор готов"
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VoiceOrb(mode: .ready, level: 0, mood: improved ? .pleased : .calm, statusDescription: orbStatus)
                    .frame(width: 78, height: 78)
                Spacer()
                Text(value.retryDeferred == true ? "ПОПЫТКА НА ПОТОМ" : value.status == "completed" ? "ЗАВЕРШЕНО" : improved ? "ЕСТЬ УЛУЧШЕНИЕ" : "СЛЕДУЮЩИЙ ШАГ")
                    .font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(Theme.secondary)
            }
            Text(value.retryDeferred == true ? "Осталась одна попытка." : improved ? "Вот, уже сильнее." : value.status == "completed" ? "Практика сохранена." : "Одна реплика.\nСделаем её сильнее.")
                .font(.system(.title, design: .rounded).weight(.semibold)).tracking(-0.5)
            Text(value.lesson.title).font(.subheadline).foregroundStyle(Theme.secondary)
            if value.retryDeferred == true { Text("К улучшенной попытке вернёмся позже. Навык пока не считается закреплённым.").font(.footnote).foregroundStyle(Theme.secondary) }
        }
    }
    private func reviewContent(_ analysis: Review, conversation value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            SurfaceCard { Text(analysis.summary).font(.subheadline).fixedSize(horizontal: false, vertical: true) }
            SpeechTimingView(conversation: value).id("speech-timing")
            if !analysis.strengths.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    InputLabel(title: "Что получилось")
                    ForEach(analysis.strengths, id: \.self) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.charcoal).padding(.top, 2)
                            Text(item).font(.subheadline)
                        }
                    }
                }
            }
            if !analysis.priorities.isEmpty {
                InputLabel(title: "Что меняем в следующей попытке")
                ForEach(Array(analysis.priorities.enumerated()), id: \.element.id) { index, priority in PriorityCard(priority: priority, number: index + 1) }
            }
            ForEach(Array(value.retries.enumerated()), id: \.offset) { index, attempt in
                SurfaceCard(color: attempt.improved == true ? Theme.lime.opacity(0.45) : Theme.lavender.opacity(0.35)) {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(attempt.improved == true ? "Стало лучше" : "Попытка \(index + 1)", systemImage: attempt.improved == true ? "checkmark.circle" : "arrow.clockwise")
                            .font(.subheadline.weight(.semibold))
                        Text(attempt.text).font(.subheadline).foregroundStyle(Theme.secondary)
                        Text(attempt.feedback).font(.subheadline)
                    }
                }
            }
            if !analysis.limitations.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(analysis.limitations, id: \.self) { Text($0).font(.footnote).foregroundStyle(Theme.secondary) }
                    }.padding(.top, 8)
                } label: { Text("Что пока нельзя оценить").font(.footnote.weight(.medium)) }
            }
            DisclosureGroup {
                VStack(spacing: 12) {
                    if let material = value.lesson.material { lessonMaterial(material) }
                    ForEach(value.turns) { TranscriptCard(turn: $0) }
                }.padding(.top, 12)
            } label: { Text(textActivity ? "Задание и твои ответы" : "Текст разговора").font(.footnote.weight(.medium)) }
        }
    }
    private var reviewDock: some View {
        NativeGlassGroup { VStack(spacing: 12) {
            if mayComplete && conversation?.retryDeferred != true {
                Label("Всё сохранено. Можно завершать.", systemImage: "checkmark.circle.fill").font(.footnote).foregroundStyle(Theme.secondary)
                Button { pendingEnding = .complete } label: {
                    HStack { Text(client.busy ? "Сохраняем" : "Завершить занятие"); Spacer(); if client.busy { ProgressView().tint(Theme.lime) } else { Image(systemName: "checkmark") } }
                }.buttonStyle(PrimaryButton()).disabled(!canSaveCompletion)
            } else {
                Text("Ответь ещё раз своими словами. Проверим, что стало лучше.")
                    .font(.footnote).foregroundStyle(Theme.secondary).frame(maxWidth: .infinity, alignment: .leading)
                composerContent(retry: true)
                Button { pendingEnding = .deferRetry } label: {
                    HStack { Text("На сегодня всё"); Spacer(); Image(systemName: "house") }.frame(maxWidth: .infinity)
                }.buttonStyle(QuietButton()).disabled(!canSaveCompletion)
            }
        }}.padding(.horizontal, 20).padding(.vertical, 14)
            .animation(reduceMotion ? nil : NativeMotion.reveal, value: mayComplete)
    }
    private var composer: some View {
        NativeGlassGroup { VStack(spacing: 12) {
            composerContent(retry: false)
            Button { pendingEnding = .review } label: {
                HStack { Text("Завершить и получить разбор"); Spacer(); Image(systemName: "checkmark.circle") }
            }.buttonStyle(SecondaryButton()).disabled(!canRequestReview)
            if !client.recording && !client.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("Перед разбором отправь черновик или очисти текст.").font(.caption).foregroundStyle(Theme.secondary)
            }
            if conversation?.baseline != nil {
                Text("Своих ответов голосом без опоры: \(baselineReplies)/2. Хорошая оценка не обязательна.").font(.caption).foregroundStyle(Theme.secondary)
            }
        }}.padding(.horizontal, 20).padding(.vertical, 14)
    }
    private func composerContent(retry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if client.recording {
                LiveTranscriptView(text: client.liveTranscript, status: client.liveTranscriptStatus)
                    .transition(reduceMotion ? .identity : .opacity)
            } else {
                TextField(retry ? "Новая попытка на английском" : writingActivity ? "Напиши ответ на английском" : "Ответ на английском", text: $client.draft, axis: .vertical)
                    .lineLimit(writingActivity ? 3...6 : 1...3).focused($draftFocused).font(.subheadline).padding(14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 18))
                    .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(draftFocused ? Theme.lavender : Color.clear, lineWidth: 2).allowsHitTesting(false) }
                    .animation(reduceMotion ? nil : NativeMotion.feedback, value: draftFocused)
                    .disabled(client.busy || conversation?.processing != nil || client.pendingMessageID != nil)
            }
            if writingActivity {
                Text("Проверяем письмо. Ответ здесь вводим с клавиатуры.").font(.caption).foregroundStyle(Theme.secondary)
                sendButton(retry: retry)
            } else if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 10) { recordingButton; sendButton(retry: retry) }
            } else { HStack(spacing: 10) { recordingButton; sendButton(retry: retry) } }
            if !client.recording && (client.recordedFile != nil || client.hasUnuploadedRecording) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { recordingActions }.fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: .leading, spacing: 8) { recordingActions }
                }.font(.caption).buttonStyle(QuietButton())
                Text(client.hasUnuploadedRecording ? "Запись осталась на iPhone. Повтори распознавание или удали её перед новой записью." : "Проверь текст по оригинальной записи перед отправкой.")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }
        }.animation(reduceMotion ? nil : NativeMotion.reveal, value: client.recording)
    }
    private var writingActivity: Bool { conversation?.lesson.activity == "writing" || conversation?.lesson.material?.type == "writing-prompt" }
    private var recordingButton: some View {
        Button {
            draftFocused = false
            Task { if client.recording { await client.stopRecording() } else { await client.beginRecording() } }
        } label: {
            HStack {
                Image(systemName: client.recording ? "stop.fill" : "mic.fill")
                    .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
                Text(client.recording ? "Стоп" : client.microphoneStarting ? "Включаем" : "Говорить")
            }
        }.buttonStyle(PrimaryButton()).disabled(!client.recording && (client.busy || conversation?.processing != nil || client.pendingMessageID != nil || client.hasUnuploadedRecording || client.microphoneStarting))
    }
    private func sendButton(retry: Bool) -> some View {
        Button { draftFocused = false; Task { await client.send(retry: retry) } } label: {
            HStack { Text(client.pendingMessageID != nil ? "Повторить" : "Отправить"); if client.busy { ProgressView().tint(Theme.charcoal) } else { Image(systemName: "arrow.up") } }
        }.buttonStyle(SecondaryButton()).disabled(client.busy || conversation?.processing != nil || client.recording || client.hasUnuploadedRecording || client.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    @ViewBuilder private var recordingActions: some View {
        Button { Task { await client.playRecording() } } label: { Label("Моя запись", systemImage: "play.circle") }
            .disabled(client.busy || client.voiceLoading)
        if client.hasUnuploadedRecording {
            Button("Повторить распознавание") { Task { await client.transcribeRecording() } }.disabled(client.busy)
        }
        Button("Удалить", role: .destructive) { client.discardRecording() }.disabled(client.busy)
    }
}

struct ProgressViewScreen: View {
    @EnvironmentObject private var client: TrainingClient
    private let labels = ["listening": "Понимать на слух", "vocabulary": "Находить слова", "grammar": "Строить фразы", "clarity": "Выражаться понятно", "coherence": "Держать мысль", "reciprocity": "Учитывать собеседника", "initiative": "Развивать разговор", "repair": "Уточнять и исправляться"]
    private let states = ["unknown": "Нужна первая проверка", "supported": "Получается с опорой", "provisional": "Первые самостоятельные успехи", "independent": "Получается самостоятельно", "recheck": "Пора проверить ещё раз"]
    var body: some View {
        NavigationStack {
            progressScreen
        }
    }
    @ViewBuilder private var progressScreen: some View {
#if DEBUG
        if PreviewFixtures.screen == "curriculum" { CurriculumView() }
        else if PreviewFixtures.screen == "achievements" { AchievementsView() }
        else if ["ranks", "ranks-bottom"].contains(PreviewFixtures.screen ?? "") { RankLadderView() }
        else if PreviewFixtures.screen == "ielts-track" { PracticeTrackView(trackID: "ielts-foundation") }
        else { progressScroll }
#else
        progressScroll
#endif
    }
    private var progressScroll: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeading(title: "Твой прогресс", subtitle: "Смотрим на то, что получается в твоих попытках.")
                    if let progression = client.state?.progression { JourneySummary(progression: progression) }
                    if client.state?.onboarding?.status == "ready" {
                        NativeBaselineProfile(report: client.state?.onboarding?.report)
                    }
                    if let progression = client.state?.progression {
                        HStack(spacing: 12) {
                            Metric(value: "\(progression.completedPractice)", title: "Практик с разбором", color: Theme.lavender)
                            Metric(value: "\(progression.practiceDays)", title: "Дней практики", color: Theme.lime)
                        }
                        Text("Наблюдения есть по \(progression.evidenceCoverage.observedSkills) из \(progression.evidenceCoverage.observableSkills) доступных навыков. Это охват примеров, а не уровень владения.")
                            .font(.footnote).foregroundStyle(Theme.secondary)
                        Text("Дни практики считаются по \(progression.practiceDayTimezone ?? "UTC"). Это не обязательная серия посещений.")
                            .font(.caption).foregroundStyle(Theme.secondary)
                    } else {
                        HStack(spacing: 12) {
                            Metric(value: "\(client.state?.completed ?? 0)", title: "Занятий", color: Theme.lavender)
                            Metric(value: "\(client.state?.xp ?? 0)", title: "Опыт XP", color: Theme.lime)
                        }
                    }
                    ForEach(client.state?.skills ?? []) { skill in
                        SurfaceCard {
                            VStack(alignment: .leading, spacing: 16) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(labels[skill.id] ?? skill.id).font(.headline)
                                        Text(skill.id == "clarity" ? "Акустическая оценка пока недоступна" : states[skill.state] ?? skill.state).font(.footnote).foregroundStyle(Theme.secondary)
                                    }
                                    Spacer()
                                    if skill.id != "clarity" {
                                        VStack(alignment: .trailing, spacing: 4) {
                                            Text("\(skill.independentSuccesses)").font(.system(.title2, design: .rounded).weight(.semibold)).monospacedDigit()
                                            Text(successLabel(skill.independentSuccesses)).font(.caption2).foregroundStyle(Theme.secondary).multilineTextAlignment(.trailing)
                                        }.accessibilityElement(children: .combine)
                                    }
                                }
                                Divider().opacity(0.5)
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 14) { EvidenceLabel(title: "В новой ситуации", confirmed: skill.transfer); EvidenceLabel(title: "После паузы", confirmed: skill.retention) }
                                    VStack(alignment: .leading, spacing: 8) { EvidenceLabel(title: "В новой ситуации", confirmed: skill.transfer); EvidenceLabel(title: "После паузы", confirmed: skill.retention) }
                                }
                                if skill.id == "clarity" {
                                    Text("По расшифровке нельзя надёжно оценить произношение. Этот навык пока не получает баллы.").font(.caption).foregroundStyle(Theme.secondary)
                                }
                                if let checked = skill.lastChecked, let date = NativeDate.parse(checked) {
                                    Text("Последняя проверка: " + date.formatted(.dateTime.day().month(.abbreviated))).font(.caption).foregroundStyle(Theme.secondary)
                                }
                                if let examples = skill.examples, !examples.isEmpty {
                                    DisclosureGroup {
                                        VStack(alignment: .leading, spacing: 12) {
                                            ForEach(Array(examples.enumerated()), id: \.offset) { _, example in
                                                Button {
                                                    if let source = client.state?.sessions.first(where: { $0.id == example.sessionId }) { client.resume(source) }
                                                } label: {
                                                    VStack(alignment: .leading, spacing: 8) {
                                                        Text(example.quote).font(.subheadline).multilineTextAlignment(.leading)
                                                        Text(example.reason).font(.caption).foregroundStyle(Theme.secondary).multilineTextAlignment(.leading)
                                                        Label("Открыть свою попытку", systemImage: "arrow.up.right").font(.caption)
                                                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8)
                                                }.buttonStyle(PressButton()).disabled(client.busy || client.recording)
                                            }
                                        }.padding(.top, 8)
                                    } label: { Text("На чём основана оценка").font(.footnote.weight(.medium)) }
                                }
                            }
                        }
                    }
                    Text("Число справа показывает самостоятельные успехи. Уровень закрепляется, когда навык срабатывает в новой ситуации и после паузы.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.modifier(ReadingCanvas()).navigationBarHidden(true).refreshable { await client.perform { try await client.refresh() } }
    }
    private func successLabel(_ count: Int) -> String {
        if count % 100 >= 11 && count % 100 <= 14 { return "самостоятельных\nуспехов" }
        if count % 10 == 1 { return "самостоятельный\nуспех" }
        if (2...4).contains(count % 10) { return "самостоятельных\nуспеха" }
        return "самостоятельных\nуспехов"
    }
}

struct HistoryView: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeading(title: "Твои занятия", subtitle: "Вернись к ответам, разбору или незавершённой практике.")
                    if client.state?.sessions.isEmpty != false {
                        SurfaceCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Image(systemName: "bubble.left.and.bubble.right").font(.title2).foregroundStyle(Theme.secondary)
                                Text("Первая практика ещё впереди.").font(.headline)
                                Text("Начни на вкладке «Сегодня». Здесь останутся запись и разбор.").font(.subheadline).foregroundStyle(Theme.secondary)
                            }
                        }
                    }
                    ForEach(client.state?.sessions ?? []) { value in
                        Button { client.resume(value) } label: {
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: value.retryDeferred == true ? "arrow.clockwise" : historyIcon(value.status)).font(.body).frame(width: 40, height: 40)
                                    .background(value.status == "completed" && value.retryDeferred != true ? Theme.lime : Theme.lavender.opacity(0.45), in: Circle())
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(value.lesson.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                                    HStack(spacing: 6) { Text(value.retryDeferred == true ? "Осталась попытка" : historyLabel(value.status)); Text("·"); Text(value.mode == "call" ? "Созвон" : "С опорами") }
                                        .font(.caption).foregroundStyle(Theme.secondary)
                                    Text("Твоих реплик: \(value.turns.filter { $0.role == "user" }.count)").font(.caption).foregroundStyle(Theme.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.secondary).padding(.top, 12)
                            }.foregroundStyle(Theme.charcoal).padding(18).frame(maxWidth: .infinity, alignment: .leading)
                                .background(.white, in: RoundedRectangle(cornerRadius: 24))
                        }.buttonStyle(PressButton()).disabled(client.busy || client.recording)
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.modifier(ReadingCanvas()).navigationBarHidden(true).refreshable { await client.perform { try await client.refresh() } }
        }
    }
    private func historyLabel(_ status: String) -> String {
        switch status { case "completed": return "Завершено"; case "review": return "Разбор готов"; case "analysing": return "Разбор готовится"; case "error": return "Можно повторить"; default: return "Можно продолжить" }
    }
    private func historyIcon(_ status: String) -> String {
        switch status { case "completed": return "checkmark"; case "review": return "text.badge.checkmark"; case "analysing": return "hourglass"; default: return "play.fill" }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var reminderEditor: ReminderEditorSelection?
    @State private var reminderToDelete: PracticeReminder?
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ScreenHeading(title: "Настройки", subtitle: "Голос, напоминания и доступ к твоей практике.")
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 18) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 6) { InputLabel(title: "Твой тренер"); Text("GPT-6.1 Sol").font(.title3.weight(.semibold)) }
                                Spacer()
                                StatusPill(title: client.status?.brain.verified == true ? "На связи" : "Проверяем", color: client.status?.brain.verified == true ? Theme.lime : Theme.surface)
                            }
                            Divider().opacity(0.5)
                            quotaContent
                        }
                    }
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 14) {
                            HStack {
                                Label("Голос собеседника", systemImage: "speaker.wave.2").font(.headline)
                                Spacer()
                                Circle().fill(client.status?.audio.configured == true ? Theme.lime : Theme.lavender).frame(width: 10, height: 10)
                            }
                            Text(client.status?.audio.configured == true ? "Включён. Реплики звучат автоматически. Пока ты говоришь, собеседник ждёт." : "Голос ещё не подключён. Добавь API-ключ в настройках приложения на компьютере.")
                                .font(.footnote).foregroundStyle(Theme.secondary)
                            Text("Выход звука: " + client.audioOutput).font(.caption).foregroundStyle(Theme.secondary)
                            if let routeMessage = client.audioRouteMessage { Text(routeMessage).font(.footnote).foregroundStyle(Theme.secondary) }
                            if let usage = client.state?.audioUsage {
                                Divider().opacity(0.5)
                                HStack {
                                    Text(usage.estimated ? "Оценка расходов" : "Расходы на голос").font(.caption).foregroundStyle(Theme.secondary)
                                    Spacer()
                                    Text(usage.usedUsd, format: .currency(code: "USD")).font(.subheadline.weight(.semibold)).monospacedDigit()
                                    Text("/ " + usage.budgetUsd.formatted(.currency(code: "USD"))).font(.caption).foregroundStyle(Theme.secondary)
                                }
                                Text("Записано \(usage.recordedMinutes.formatted(.number.precision(.fractionLength(1)))) мин. Оценка по данным приложения, итоговый счёт у OpenAI.")
                                    .font(.caption).foregroundStyle(Theme.secondary)
                            }
                        }
                    }
                    reminders
                    VStack(alignment: .leading, spacing: 10) {
                        InputLabel(title: "Установка через AltStore")
                        Text("Обновляй подпись до истечения 7 дней, когда iPhone связан с компьютером. Занятия и история останутся на сервере.")
                            .font(.footnote).foregroundStyle(Theme.secondary)
                    }.padding(.horizontal, 4)
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.modifier(ReadingCanvas()).navigationBarHidden(true)
                .task {
                    await client.refreshReminderStatus()
#if DEBUG
                    if PreviewFixtures.screen == "reminder-editor" {
                        reminderEditor = ReminderEditorSelection(reminder: client.reminders.first)
                    }
#endif
                }
                .sheet(item: $reminderEditor) { selection in
                    ReminderTimeEditor(reminder: selection.reminder).environmentObject(client)
                        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(500), .large]).presentationDragIndicator(.visible)
                }
                .confirmationDialog("Удалить напоминание?", isPresented: Binding(get: { reminderToDelete != nil }, set: { if !$0 { reminderToDelete = nil } }), titleVisibility: .visible) {
                    if let reminderToDelete {
                        Button("Удалить время \(reminderToDelete.timeLabel)", role: .destructive) {
                            let id = reminderToDelete.id; self.reminderToDelete = nil
                            Task { await client.deleteReminder(id: id) }
                        }
                    }
                    Button("Оставить", role: .cancel) { reminderToDelete = nil }
                } message: { Text("Другие времена останутся без изменений.") }
        }
    }
    private var quotaContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Лимиты подписки").font(.subheadline.weight(.semibold))
            if let usage = client.subscriptionUsage, usage.available && !usage.windows.isEmpty {
                ForEach(usage.windows) { window in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(window.bucketName ?? (window.kind == "weekly" ? "На неделю" : "Текущее окно")).font(.footnote)
                            Spacer()
                            if let remaining = window.remainingPercent {
                                Text("\(remaining.formatted(.number.precision(.fractionLength(0))))% осталось").font(.footnote.weight(.semibold)).monospacedDigit()
                            }
                        }
                        if let remaining = window.remainingPercent { Capsule().fill(Theme.surface).frame(height: 6).overlay(alignment: .leading) { GeometryReader { geometry in Capsule().fill(Theme.lavender).frame(width: geometry.size.width * min(1, max(0, remaining / 100))) } } }
                        if let reset = window.resetsAt, let date = NativeDate.parse(reset) {
                            Text("Обновится " + date.formatted(.dateTime.day().month(.abbreviated).hour().minute())).font(.caption).foregroundStyle(Theme.secondary)
                        }
                    }
                }
                if usage.stale { Text("Данные с последней проверки. Сейчас обновить их не удалось.").font(.caption).foregroundStyle(Theme.secondary) }
            } else {
                Text("Точный остаток сейчас недоступен. Его можно проверить в ChatGPT.")
                    .font(.footnote).foregroundStyle(Theme.secondary)
            }
            Text("Лимит общий с ChatGPT и Codex.").font(.caption).foregroundStyle(Theme.secondary)
            if let activity = client.subscriptionUsage?.activity {
                Text("Только запросы этого приложения").font(.caption.weight(.medium)).foregroundStyle(Theme.secondary)
                HStack {
                    Text("Запросов за \(activity.periodDays) дн.").font(.caption).foregroundStyle(Theme.secondary)
                    Spacer()
                    Text(String(activity.requests)).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
                HStack {
                    Text("Успешно: \(activity.successful)")
                    Spacer()
                    Text("С ошибкой: \(activity.failed)")
                }.font(.caption).foregroundStyle(Theme.secondary)
                if let limit = activity.lastLimitAt, let date = NativeDate.parse(limit) {
                    Text("Последнее ограничение: " + date.formatted(.dateTime.day().month(.abbreviated).hour().minute())).font(.caption).foregroundStyle(Theme.secondary)
                }
                if let retry = activity.retryAt, let date = NativeDate.parse(retry), date > Date() {
                    Text("Повторить после " + date.formatted(.dateTime.hour().minute())).font(.caption).foregroundStyle(Theme.secondary)
                }
            }
            Link(destination: URL(string: client.subscriptionUsage?.manageUrl ?? "https://chatgpt.com/settings/usage") ?? URL(string: "https://chatgpt.com/settings/usage")!) {
                HStack { Text("Открыть лимиты ChatGPT"); Spacer(); Image(systemName: "arrow.up.right") }
                    .font(.subheadline.weight(.medium)).padding(.top, 3)
            }
        }
    }
    private var reminders: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Label("Время для английского", systemImage: "bell").font(.headline)
                    Spacer()
                    if client.reminderBusy { ProgressView().tint(Theme.charcoal) }
                }
                if client.notificationState == "denied" {
                    Text("Уведомления выключены в iPhone. Твои времена сохранены.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                    Button { client.openSystemSettings() } label: { Label("Разрешить уведомления", systemImage: "arrow.up.right") }
                        .buttonStyle(SecondaryButton())
                } else if client.notificationState == "unavailable" {
                    Text("iPhone не передал состояние уведомлений. Попробуй открыть настройки приложения.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                    Button { client.openSystemSettings() } label: { Label("Настройки iPhone", systemImage: "arrow.up.right") }.buttonStyle(QuietButton())
                } else if client.notificationState == "provisional" {
                    Text("Разрешена тихая доставка. Чтобы видеть баннеры, включи их в настройках iPhone.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                    Button { client.openSystemSettings() } label: { Label("Настройки iPhone", systemImage: "arrow.up.right") }.buttonStyle(QuietButton())
                }
                if client.reminders.isEmpty {
                    Text("Выбери одно или несколько удобных времён. Напоминания приходят по местному времени этого iPhone.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }
                ForEach(client.reminders) { reminder in
                    HStack(spacing: 12) {
                        Button { reminderEditor = ReminderEditorSelection(reminder: reminder) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 8) {
                                    Text(reminder.timeLabel).font(.system(.title2, design: .rounded).weight(.semibold)).monospacedDigit()
                                    Image(systemName: "pencil").font(.caption.weight(.medium)).foregroundStyle(Theme.secondary)
                                }
                                Text(reminder.enabled ? "Каждый день" : "На паузе").font(.caption).foregroundStyle(Theme.secondary)
                            }.foregroundStyle(Theme.charcoal).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        }.buttonStyle(PressButton()).accessibilityLabel("Изменить напоминание в " + reminder.timeLabel)
                        Toggle("Напоминание в " + reminder.timeLabel, isOn: Binding(get: { reminder.enabled }, set: { value in
                            Task { await client.setReminderEnabled(id: reminder.id, enabled: value) }
                        })).labelsHidden().tint(Theme.charcoal).fixedSize()
                        Button { reminderToDelete = reminder } label: {
                            Image(systemName: "trash").font(.subheadline).frame(width: 44, height: 44)
                                .foregroundStyle(Theme.secondary).modifier(LiquidChrome(radius: 16, interactive: true))
                        }.buttonStyle(PressButton()).accessibilityLabel("Удалить напоминание в " + reminder.timeLabel)
                    }.disabled(client.reminderBusy)
                    if reminder.id != client.reminders.last?.id { Divider().opacity(0.45) }
                }
                Button { reminderEditor = ReminderEditorSelection(reminder: nil) } label: {
                    Label("Добавить время", systemImage: "plus").frame(maxWidth: .infinity)
                }.buttonStyle(SecondaryButton()).disabled(client.reminderBusy || client.reminders.count >= 12)
                if !client.reminders.isEmpty {
                    Text("Время следует часовому поясу iPhone. Можно менять, отключать или удалять каждое напоминание отдельно.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }
            }
        }
    }
}

private struct ReminderEditorSelection: Identifiable {
    let id = UUID()
    let reminder: PracticeReminder?
}

private struct ReminderTimeEditor: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    let reminder: PracticeReminder?
    @State private var date: Date
    @State private var saveError: String?
    init(reminder: PracticeReminder?) {
        self.reminder = reminder
        _date = State(initialValue: Calendar.current.date(from: DateComponents(hour: reminder?.hour ?? 19, minute: reminder?.minute ?? 0)) ?? Date())
    }
    var body: some View {
        NavigationStack {
            ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                DatePicker("Каждый день в", selection: $date, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel).labelsHidden().frame(maxWidth: .infinity).frame(height: 180)
                    .accessibilityLabel("Время ежедневного напоминания")
                Text("По местному времени iPhone. После переезда напоминание останется в это же время.")
                    .font(.footnote).foregroundStyle(Theme.secondary)
                if let saveError { Text(saveError).font(.footnote).foregroundStyle(Theme.charcoal).accessibilityLabel("Не сохранено. " + saveError) }
                Button {
                    saveError = nil
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                    Task {
                        let accepted = await client.saveReminder(id: reminder?.id, hour: parts.hour ?? 19, minute: parts.minute ?? 0)
                        if accepted { dismiss() }
                        else { saveError = client.error ?? "Не удалось сохранить время."; client.error = nil }
                    }
                } label: {
                    HStack { Text(client.reminderBusy ? "Сохраняем" : "Сохранить время"); Spacer(); if client.reminderBusy { ProgressView().tint(Theme.lime) } else { Image(systemName: "checkmark") } }
                }.buttonStyle(PrimaryButton()).disabled(client.reminderBusy)
            }.padding(24)
            }.modifier(ReadingCanvas())
                .navigationTitle(reminder == nil ? "Новое напоминание" : "Изменить время")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Отмена") { dismiss() }.disabled(client.reminderBusy) } }
                .interactiveDismissDisabled(client.reminderBusy)
        }
    }
}
