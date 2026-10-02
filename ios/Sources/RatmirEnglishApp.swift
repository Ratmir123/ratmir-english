import SwiftUI

@main struct RatmirEnglishApp: App {
    @StateObject private var client = TrainingClient()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(client).tint(Theme.charcoal)
                .preferredColorScheme(.light).task {
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
                    HomeView().tabItem { Label("Сегодня", systemImage: "sun.max") }.tag(0)
                    ProgressViewScreen().tabItem { Label("Прогресс", systemImage: "chart.xyaxis.line") }.tag(1)
                    HistoryView().tabItem { Label("История", systemImage: "clock.arrow.circlepath") }.tag(2)
                    SettingsView().tabItem { Label("Настройки", systemImage: "slider.horizontal.3") }.tag(3)
                }.toolbarBackground(Theme.surface, for: .tabBar).toolbarBackground(.visible, for: .tabBar)
            } else { LoginView() }
        }
        .task {
#if DEBUG
            if PreviewFixtures.screen == "settings" { selectedTab = 3 }
#endif
        }
        .sheet(isPresented: $client.conversationPresented) {
            if let value = client.conversation {
                ConversationView(id: value.id).environmentObject(client)
                    .presentationDetents([.large]).presentationDragIndicator(.visible)
                    .interactiveDismissDisabled(client.recording)
            }
        }
        .onChange(of: client.conversationPresented) { _, presented in
            if !presented { client.minimizeConversation() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await client.refreshReminderStatus() } }
        }
        .alert("Не получилось", isPresented: Binding(get: { client.error != nil && !client.conversationPresented },
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
            }.background(Theme.surface).scrollDismissesKeyboard(.interactively).navigationBarHidden(true)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject private var client: TrainingClient
    @AppStorage("practice-context") private var context = "life"
    @AppStorage("practice-mode") private var mode = "learning"
    private var saved: Conversation? { client.state?.sessions.first { $0.status != "completed" || $0.retryDeferred == true } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack {
                        BrandMark(size: 38)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("ratmir english").font(.headline)
                            Text("Личная практика").font(.caption).foregroundStyle(Theme.secondary)
                        }
                        Spacer()
                        Text(Date(), format: .dateTime.day().month(.abbreviated)).font(.caption).foregroundStyle(Theme.secondary)
                    }.padding(.bottom, 4)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Привет, \(client.state?.profile.name ?? "ты").")
                            .font(.system(.largeTitle, design: .rounded).weight(.semibold)).tracking(-0.7)
                        Text("Давай поговорим \(client.state?.profile.dailyMinutes ?? 15) минут.")
                            .foregroundStyle(Theme.secondary)
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
                    }
                    HStack(spacing: 12) {
                        Metric(value: "\(client.state?.completed ?? 0)", title: "Завершено", color: Theme.lavender)
                        Metric(value: "\(client.state?.xp ?? 0)", title: "Опыт XP", color: Theme.lime)
                    }
                    Text("Новый разговор откроется отдельно. К прежнему можно вернуться в истории.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(Theme.surface).navigationBarHidden(true)
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
    @FocusState private var draftFocused: Bool
    private var conversation: Conversation? { client.conversation }
    private var active: Bool { conversation?.status == "active" || conversation?.status == "error" }
    private var hasReview: Bool { conversation?.analysis != nil }
    private var mayComplete: Bool {
        guard let value = conversation, let analysis = value.analysis else { return false }
        return value.completion?.canComplete ?? (analysis.priorities.isEmpty || value.retries.last?.improved == true)
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
        }
    }
    private var pollingKey: String { (conversation?.status ?? "") + "|" + (conversation?.processing?.stage ?? "") }
    private var errorPresented: Binding<Bool> {
        Binding(get: { client.error != nil }, set: { if !$0 { client.error = nil } })
    }
    private var decoratedConversation: some View {
        conversationScroll
            .safeAreaInset(edge: .bottom, spacing: 0) { bottomDock }
            .navigationTitle(hasReview ? "Твой разбор" : "Разговор")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.surface, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
    private var conversationScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                conversationContent.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(Theme.surface).scrollDismissesKeyboard(.interactively)
                .onChange(of: conversation?.turns.count) { _, _ in
                    draftFocused = false
                    if showConversation { proxy.scrollTo("end", anchor: .bottom) }
                }
        }
    }
    private var conversationContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let value = conversation {
                conversationHeader(value)
                if let analysis = value.analysis { reviewContent(analysis, conversation: value) }
                if (client.busy || value.processing != nil) && !client.recording && value.status != "analysing" {
                    ActivityPanel(title: client.operationStage ?? "Собеседник готовит ответ", detail: "Твой ответ сохранён. Можно немного выдохнуть.", startedAt: client.operationStartedAt ?? processingStart)
                }
                Color.clear.frame(height: 1).id("end")
            }
        }
    }
    @ViewBuilder private func conversationHeader(_ value: Conversation) -> some View {
        if hasReview { reviewHeader(value) }
        else if value.status == "analysing" { analysisWaiting }
        else { liveConversation(value) }
    }
    @ViewBuilder private var bottomDock: some View {
        if let value = conversation {
            if active { composer }
            else if hasReview && (value.status != "completed" || value.retryDeferred == true) { reviewDock }
        }
    }
    @ToolbarContentBuilder private var conversationToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Text(conversation?.mode == "call" ? "СОЗВОН" : "С ОПОРАМИ")
                .font(.caption2.weight(.semibold)).tracking(0.8).foregroundStyle(Theme.secondary)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button { draftFocused = false; client.minimizeConversation() } label: {
                Image(systemName: "chevron.down").font(.subheadline.weight(.semibold))
                    .frame(width: 36, height: 36).background(Color.white.opacity(0.7), in: Circle())
            }.accessibilityLabel("Свернуть занятие").disabled(client.recording)
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
                DisclosureGroup(isExpanded: $showBrief) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(value.lesson.goal).font(.subheadline)
                        Text(value.lesson.why).font(.footnote).foregroundStyle(Theme.secondary)
                    }.padding(.top, 10)
                } label: { Text("Твоя задача").font(.footnote.weight(.medium)) }
            }
            VStack(spacing: 8) {
                MeasuredVoiceOrb(meter: client.voiceMeter, mode: orbMode, mood: orbMood).frame(width: 214, height: 214)
                HStack(spacing: 7) {
                    Circle().fill(client.recording ? Theme.lime : client.playing ? Theme.lavender : Theme.charcoal.opacity(0.45)).frame(width: 6, height: 6)
                    Text(voiceLabel).font(.footnote.weight(.medium)).foregroundStyle(Theme.secondary)
                }
            }.frame(maxWidth: .infinity).padding(.vertical, 4)
            if let turn = value.turns.last(where: { $0.role == "assistant" }), value.mode == "learning" || client.assistantTextShown { TranscriptCard(turn: turn) }
            HStack(spacing: 10) {
                Button {
                    if client.playing { client.stopSpeaking() } else { Task { await client.speak() } }
                } label: { Label(client.playing ? "Стоп" : "Ещё раз", systemImage: client.playing ? "stop.fill" : "speaker.wave.2") }
                    .buttonStyle(QuietButton()).disabled(client.busy || client.voiceLoading || client.recording)
                if value.mode == "call" && !client.assistantTextShown {
                    Button { Task { await client.revealText() } } label: { Label("Текст", systemImage: "text.alignleft") }
                        .buttonStyle(QuietButton()).disabled(client.busy || client.recording)
                } else if value.mode == "learning" {
                    Button { Task { await client.getHint() } } label: { Label("Подсказка", systemImage: "lightbulb") }
                        .buttonStyle(QuietButton()).disabled(client.busy || client.recording)
                }
            }.frame(maxWidth: .infinity)
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
                } label: { Text("Весь разговор").font(.footnote.weight(.medium)) }
            }
        }
    }
    private var voiceLabel: String {
        if client.recording { return "Слушаю тебя" }
        if client.playing { return client.playingLearnerRecording ? "Слушаем твою запись" : "Собеседник говорит" }
        if client.voiceLoading { return "Готовим голос" }
        if client.busy { return client.operationStage ?? "Готовим ответ" }
        if conversation?.processing != nil { return "Собеседник готовит ответ" }
        return "Твой ход"
    }
    private var analysisWaiting: some View {
        VStack(spacing: 22) {
            MeasuredVoiceOrb(meter: client.voiceMeter, mode: orbMode, mood: orbMood).frame(width: 200, height: 200)
            ActivityPanel(title: conversation?.processing?.stage == "waiting-retry" ? "Сервис задержал разбор" : "Разбираем разговор", detail: "Проверяем смысл, английский и то, как ты использовал ответы собеседника.", startedAt: analysisStartedAt)
            if let turn = conversation?.turns.last(where: { $0.role == "assistant" }) {
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 14) {
                        InputLabel(title: "Пока ждём")
                        Text("Что было важно собеседнику? Вспомни одну конкретную деталь.")
                            .font(.subheadline.weight(.medium))
                        HStack(spacing: 10) {
                            Button { showListeningCheck.toggle() } label: {
                                Label(showListeningCheck ? "Скрыть ответ" : "Проверить себя", systemImage: "text.alignleft")
                            }.buttonStyle(QuietButton())
                            Button {
                                if client.playing { client.stopSpeaking() } else { Task { await client.speak() } }
                            } label: { Image(systemName: client.playing ? "stop.fill" : "speaker.wave.2") }
                                .buttonStyle(QuietButton()).disabled(client.busy || client.voiceLoading)
                                .accessibilityLabel("Послушать ответ собеседника ещё раз")
                        }
                        if showListeningCheck { Text(turn.text).font(.subheadline).foregroundStyle(Theme.secondary).textSelection(.enabled) }
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
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VoiceOrb(mode: .ready, level: 0, mood: value.retries.last?.improved == true ? .pleased : .calm)
                    .frame(width: 78, height: 78)
                Spacer()
                Text(value.retryDeferred == true ? "ПОПЫТКА НА ПОТОМ" : value.status == "completed" ? "ЗАВЕРШЕНО" : value.retries.last?.improved == true ? "ЕСТЬ УЛУЧШЕНИЕ" : "СЛЕДУЮЩИЙ ШАГ")
                    .font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(Theme.secondary)
            }
            Text(value.retryDeferred == true ? "Осталась одна попытка." : value.retries.last?.improved == true ? "Вот, уже сильнее." : value.status == "completed" ? "Практика сохранена." : "Одна реплика.\nСделаем её сильнее.")
                .font(.system(.title, design: .rounded).weight(.semibold)).tracking(-0.5)
            Text(value.lesson.title).font(.subheadline).foregroundStyle(Theme.secondary)
            if value.retryDeferred == true { Text("К улучшенной попытке вернёмся позже. Навык пока не считается закреплённым.").font(.footnote).foregroundStyle(Theme.secondary) }
        }
    }
    private func reviewContent(_ analysis: Review, conversation value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            SurfaceCard { Text(analysis.summary).font(.subheadline).fixedSize(horizontal: false, vertical: true) }
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
                VStack(spacing: 12) { ForEach(value.turns) { TranscriptCard(turn: $0) } }.padding(.top, 12)
            } label: { Text("Текст разговора").font(.footnote.weight(.medium)) }
        }
    }
    private var reviewDock: some View {
        VStack(spacing: 10) {
            if mayComplete && conversation?.retryDeferred != true {
                Label("Всё сохранено. Можно завершать.", systemImage: "checkmark.circle.fill").font(.footnote).foregroundStyle(Theme.secondary)
                Button { Task { await client.action("complete") } } label: {
                    HStack { Text(client.busy ? "Сохраняем" : "Завершить занятие"); Spacer(); if client.busy { ProgressView().tint(Theme.lime) } else { Image(systemName: "checkmark") } }
                }.buttonStyle(PrimaryButton()).disabled(client.busy || client.recording)
            } else {
                Text("Ответь ещё раз своими словами. Отправь попытку, чтобы закрепить улучшение.")
                    .font(.footnote).foregroundStyle(Theme.secondary).frame(maxWidth: .infinity, alignment: .leading)
                composerContent(retry: true)
                Button { Task { await client.action("complete", deferRetry: true) } } label: {
                    Text("На сегодня всё. Вернёмся к попытке позже.")
                }.font(.caption.weight(.medium)).foregroundStyle(Theme.secondary).disabled(client.busy || client.recording)
            }
        }.padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 10).background(Theme.surface)
            .overlay(alignment: .top) { Divider().opacity(0.6) }
    }
    private var composer: some View {
        VStack(spacing: 12) {
            composerContent(retry: false)
            Button { draftFocused = false; Task { await client.action("finish") } } label: {
                HStack { Text("Закончить разговор и получить разбор"); Image(systemName: "arrow.right") }
            }.font(.footnote.weight(.medium)).foregroundStyle(Theme.secondary)
                .disabled(client.busy || client.recording || conversation?.turns.contains(where: { $0.role == "user" }) != true)
        }.padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8).background(Theme.surface)
            .overlay(alignment: .top) { Divider().opacity(0.6) }
    }
    private func composerContent(retry: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if client.recording {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Сейчас говоришь ты", systemImage: "waveform").font(.caption.weight(.medium)).foregroundStyle(Theme.secondary)
                    Text(client.liveTranscript.isEmpty ? "Текст появится, когда начнёшь говорить…" : client.liveTranscript)
                        .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).lineLimit(5)
                    if !client.liveTranscriptStatus.isEmpty { Text(client.liveTranscriptStatus).font(.caption2).foregroundStyle(Theme.secondary) }
                }.padding(14).background(.white, in: RoundedRectangle(cornerRadius: 18))
            } else {
                TextField(retry ? "Новая попытка на английском" : "Ответ на английском", text: $client.draft, axis: .vertical)
                    .lineLimit(1...3).focused($draftFocused).font(.subheadline).padding(14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 18))
                    .disabled(client.busy || conversation?.processing != nil || client.pendingMessageID != nil)
            }
            HStack(spacing: 10) {
                Button {
                    draftFocused = false
                    Task { if client.recording { await client.stopRecording() } else { await client.beginRecording() } }
                } label: { HStack { Image(systemName: client.recording ? "stop.fill" : "mic.fill"); Text(client.recording ? "Готово" : client.microphoneStarting ? "Включаем" : "Говорить") } }
                    .buttonStyle(PrimaryButton()).disabled(!client.recording && (client.busy || conversation?.processing != nil || client.pendingMessageID != nil || client.hasUnuploadedRecording || client.microphoneStarting))
                Button { draftFocused = false; Task { await client.send(retry: retry) } } label: {
                    HStack { Text(client.pendingMessageID != nil ? "Повторить" : "Отправить"); if client.busy { ProgressView().tint(Theme.charcoal) } else { Image(systemName: "arrow.up") } }
                }.buttonStyle(SecondaryButton()).disabled(client.busy || conversation?.processing != nil || client.recording || client.hasUnuploadedRecording || client.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if !client.recording && (client.recordedFile != nil || client.hasUnuploadedRecording) {
                HStack(spacing: 14) {
                    Button { Task { await client.playRecording() } } label: { Label("Моя запись", systemImage: "play.circle") }
                        .disabled(client.busy || client.voiceLoading)
                    if client.hasUnuploadedRecording {
                        Button("Повторить распознавание") { Task { await client.transcribeRecording() } }.disabled(client.busy)
                    }
                    Button("Удалить", role: .destructive) { client.discardRecording() }.disabled(client.busy)
                }.font(.caption)
                Text(client.hasUnuploadedRecording ? "Запись осталась на iPhone. Повтори распознавание или запиши новую." : "Проверь текст по оригинальной записи перед отправкой.")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }
        }
    }
}

struct ProgressViewScreen: View {
    @EnvironmentObject private var client: TrainingClient
    private let labels = ["listening": "Понимать на слух", "vocabulary": "Находить слова", "grammar": "Строить фразы", "clarity": "Выражаться понятно", "coherence": "Держать мысль", "reciprocity": "Учитывать собеседника", "initiative": "Развивать разговор", "repair": "Уточнять и исправляться"]
    private let states = ["unknown": "Нужна первая проверка", "supported": "Получается с опорой", "provisional": "Первые самостоятельные успехи", "independent": "Получается самостоятельно", "recheck": "Пора проверить ещё раз"]
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeading(title: "Твой прогресс", subtitle: "Смотрим на то, что получается в разговоре.")
                    HStack(spacing: 12) {
                        Metric(value: "\(client.state?.completed ?? 0)", title: "Занятий", color: Theme.lavender)
                        Metric(value: "\(client.state?.xp ?? 0)", title: "Опыт XP", color: Theme.lime)
                    }
                    ForEach(client.state?.skills ?? []) { skill in
                        SurfaceCard {
                            VStack(alignment: .leading, spacing: 16) {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(labels[skill.id] ?? skill.id).font(.headline)
                                        Text(states[skill.state] ?? skill.state).font(.footnote).foregroundStyle(Theme.secondary)
                                    }
                                    Spacer()
                                    Text("\(skill.independentSuccesses)").font(.system(.title2, design: .rounded).weight(.semibold)).monospacedDigit()
                                }
                                Divider().opacity(0.5)
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 14) { EvidenceLabel(title: "В новой ситуации", confirmed: skill.transfer); EvidenceLabel(title: "После паузы", confirmed: skill.retention) }
                                    VStack(alignment: .leading, spacing: 8) { EvidenceLabel(title: "В новой ситуации", confirmed: skill.transfer); EvidenceLabel(title: "После паузы", confirmed: skill.retention) }
                                }
                            }
                        }
                    }
                    Text("Число справа показывает самостоятельные успехи. Уровень закрепляется, когда навык срабатывает в новой ситуации и после паузы.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(Theme.surface).navigationBarHidden(true).refreshable { await client.perform { try await client.refresh() } }
        }
    }
}

struct HistoryView: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeading(title: "Твои разговоры", subtitle: "Вернись к реплике, разбору или незавершённой практике.")
                    if client.state?.sessions.isEmpty != false {
                        SurfaceCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Image(systemName: "bubble.left.and.bubble.right").font(.title2).foregroundStyle(Theme.secondary)
                                Text("Первый разговор ещё впереди.").font(.headline)
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
            }.background(Theme.surface).navigationBarHidden(true).refreshable { await client.perform { try await client.refresh() } }
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
    @State private var reminderDate = Calendar.current.date(from: DateComponents(hour: 19, minute: 0)) ?? Date()
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
            }.background(Theme.surface).navigationBarHidden(true)
                .task {
                    await client.refreshReminderStatus()
                    reminderDate = Calendar.current.date(from: DateComponents(hour: client.reminderHour, minute: client.reminderMinute)) ?? Date()
                }
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
                HStack {
                    Text("Запросов за \(activity.periodDays) дн.").font(.caption).foregroundStyle(Theme.secondary)
                    Spacer()
                    Text(String(activity.requests)).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
                if let limit = activity.lastLimitAt, let date = NativeDate.parse(limit) {
                    Text("Последнее ограничение: " + date.formatted(.dateTime.day().month(.abbreviated).hour().minute())).font(.caption).foregroundStyle(Theme.secondary)
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
            VStack(alignment: .leading, spacing: 16) {
                Label("Твои 15 минут", systemImage: "bell").font(.headline)
                if client.notificationState == "denied" {
                    Text("Уведомления отключены в настройках iPhone.").font(.subheadline).foregroundStyle(Theme.secondary)
                    Button { client.openSystemSettings() } label: { Label("Разрешить уведомления", systemImage: "arrow.up.right") }.buttonStyle(SecondaryButton())
                } else if client.notificationState == "unavailable" || client.notificationState == "unsupported" {
                    Text("Не удалось сохранить напоминание. Проверь разрешение на уведомления и попробуй ещё раз.")
                        .font(.subheadline).foregroundStyle(Theme.secondary)
                    Button { client.openSystemSettings() } label: { Label("Проверить настройки iPhone", systemImage: "arrow.up.right") }.buttonStyle(QuietButton())
                    Button {
                        let parts = Calendar.current.dateComponents([.hour, .minute], from: reminderDate)
                        Task { await client.scheduleReminder(hour: parts.hour ?? 19, minute: parts.minute ?? 0) }
                    } label: { Label("Повторить включение", systemImage: "arrow.clockwise") }
                        .buttonStyle(SecondaryButton()).disabled(client.reminderBusy)
                } else {
                    Toggle("Ежедневное напоминание", isOn: Binding(get: { client.reminderEnabled }, set: { enabled in
                        Task {
                            if enabled {
                                let parts = Calendar.current.dateComponents([.hour, .minute], from: reminderDate)
                                await client.scheduleReminder(hour: parts.hour ?? 19, minute: parts.minute ?? 0)
                            } else { await client.disableReminder() }
                        }
                    })).tint(Theme.charcoal).font(.subheadline).disabled(client.reminderBusy)
                    HStack {
                        Text("Время").font(.subheadline).foregroundStyle(Theme.secondary)
                        Spacer()
                        DatePicker("Время напоминания", selection: $reminderDate, displayedComponents: .hourAndMinute).labelsHidden().tint(Theme.charcoal)
                    }.disabled(client.reminderBusy)
                    .onChange(of: reminderDate) { _, date in
                        guard client.reminderEnabled else { return }
                        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                        Task { await client.scheduleReminder(hour: parts.hour ?? 19, minute: parts.minute ?? 0) }
                    }
                    Text(client.reminderEnabled ? "Напоминание включено. Время местное для этого iPhone." : "Выбери время, когда тебе удобно начать разговор.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }
                Divider().opacity(0.5)
                Button { Task { await client.testReminder() } } label: {
                    HStack {
                        Label("Проверить уведомление", systemImage: "bell.badge")
                        Spacer()
                        if client.reminderBusy { ProgressView().tint(Theme.charcoal) }
                    }
                }.buttonStyle(QuietButton()).disabled(client.reminderBusy)
                Text(client.reminderTestMessage ?? "Тест отправит одно уведомление через 10 секунд.")
                    .font(.footnote).foregroundStyle(Theme.secondary)
                if let diagnostic = client.reminderDiagnostic {
                    DisclosureGroup {
                        Text(diagnostic).font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Theme.secondary).textSelection(.enabled).padding(.top, 8)
                    } label: { Text("Данные для проверки").font(.footnote.weight(.medium)) }
                }
            }
        }
    }
}
