import SwiftUI
import UIKit

@main struct RatmirEnglishApp: App {
    @StateObject private var client = TrainingClient()
    /// «Оформление» in Profile; nil (system) never overrides the device setting.
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system.rawValue

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(client)
                .environment(\.locale, RuFormat.locale)
                .tint(Theme.violet)
                .disclosureGroupStyle(SoftDisclosureStyle())
                .buttonStyle(PressButton())
                .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
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

/// Manual theme switch (same three choices and default as the web): stored per device.
enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark
    static let storageKey = "smoothTalk.appearance"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: return "Как в системе"
        case .light: return "Светлая"
        case .dark: return "Тёмная"
        }
    }
    var icon: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max"
        case .dark: return "moon"
        }
    }
    /// Applied at the root, so sheets and full-screen covers follow it too.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// The five destinations, identical on iPhone and PC (DESIGN-SYSTEM §3).
enum ShellTab: Hashable {
    case today, practice, calls, progress, profile
}

/// SF Symbols that exist on every supported iOS; falls back when a newer name is missing.
enum ShellSymbol {
    static func first(_ names: [String]) -> String {
        for name in names where UIImage(systemName: name) != nil { return name }
        return names.last ?? "circle"
    }
    static let calls = first(["phone.bubble", "phone.bubble.left", "phone"])
}

struct RootView: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedTab: ShellTab = .today
    @State private var opening = NativeOpeningState()
    @State private var placementPrompted = false
    @State private var rankUpClaimed: Set<String> = []
    @State private var confettiTrigger = 0

    var body: some View {
        rootContent
            .simultaneousGesture(TapGesture().onEnded {
                if opening.animateHome { finishOpening(animated: false) }
            }, including: opening.animateHome ? .all : .subviews)
            .overlay { openingOverlay }
            .task(id: openingReadiness) { await runOpening() }
            .task(id: pollingKey) { await client.pollStateWhileProcessing() }
            .task(id: placementPromptKey) { promptPlacementIfNeeded() }
            .sheet(isPresented: $client.conversationPresented, onDismiss: { client.conversationDidClose() }) {
                conversationSheet
            }
            .fullScreenCover(isPresented: $client.placementPresented, onDismiss: { client.refreshInBackground() }) {
                placementCover
            }
            .onChange(of: client.conversationPresented) { _, presented in
                if presented { finishOpening(animated: false) }
            }
            .onChange(of: client.homeRequest) { _, _ in selectedTab = .today }
            .onChange(of: client.requestedTab) { _, tab in
                guard let tab else { return }
                selectedTab = tab
                client.requestedTab = nil
            }
            .onChange(of: scenePhase) { _, phase in handleScenePhase(phase) }
            .onChange(of: reduceMotion) { _, reduced in if reduced { finishOpening(animated: false) } }
            .onChange(of: voiceOver) { _, enabled in if enabled { finishOpening(animated: false) } }
            .onReceive(NotificationCenter.default.publisher(for: .smoothTalkOpenToday)) { _ in
                if !client.conversationPresented && !client.placementPresented { selectedTab = .today }
            }
            .alert("Не получилось", isPresented: rootErrorPresented) {
                if client.microphoneDenied {
                    Button("Открыть настройки") { client.error = nil; client.openSystemSettings() }
                }
                Button("Понятно", role: .cancel) { client.error = nil }
            } message: { Text(client.error ?? "") }
#if DEBUG
            .task { await previewNavigation() }
#endif
    }

    @ViewBuilder private var rootContent: some View {
        if client.signedIn { shell } else { LoginView() }
    }

    private var shell: some View {
        TabView(selection: $selectedTab) {
            TodayScreen(select: { selectedTab = $0 }, entryVisible: homeEntryVisible, animateEntry: opening.animateHome)
                .tabItem { Label("Сегодня", systemImage: "sun.max") }
                .tag(ShellTab.today)
            PracticeScreen()
                .tabItem { Label("Практика", systemImage: "waveform") }
                .tag(ShellTab.practice)
            CallsScreen()
                .tabItem { Label("Созвоны", systemImage: ShellSymbol.calls) }
                .tag(ShellTab.calls)
            ProgressScreen()
                .tabItem { Label("Прогресс", systemImage: "chart.line.uptrend.xyaxis") }
                .tag(ShellTab.progress)
            ProfileScreen()
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .tag(ShellTab.profile)
        }
        .modifier(TabBarBehavior())
        .mascotConfetti(trigger: confettiTrigger, origin: UnitPoint(x: 0.5, y: 0.12))
        .sensoryFeedback(.success, trigger: confettiTrigger)
        .overlay(alignment: .top) { topOverlay }
        .overlay { rankUpOverlay }
        .animation(reduceMotion ? nil : NativeMotion.standard, value: client.completionMoment?.id)
        .animation(reduceMotion ? nil : NativeMotion.standard, value: client.startingIntent)
    }

    @ViewBuilder private var topOverlay: some View {
        VStack(spacing: 8) {
            if let moment = client.completionMoment, !client.conversationPresented {
                CompletionCelebration(moment: moment) { confettiTrigger += 1 }
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
            if client.startingIntent != nil && !client.conversationPresented {
                StartingCapsule(stage: client.operationStage ?? "Готовлю занятие")
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.top, 6)
    }

    @ViewBuilder private var rankUpOverlay: some View {
        if let moment = client.completionMoment, !client.conversationPresented, let level = client.state?.progression?.level,
           let before = moment.levelBefore, RewardArt.practiceRank(level).id != RewardArt.practiceRank(before).id,
           !rankUpClaimed.contains(moment.sessionId) {
            RankUpOverlay(level: level) { _ = rankUpClaimed.insert(moment.sessionId) }
                .transition(.opacity)
                .zIndex(20)
        }
    }

    @ViewBuilder private var openingOverlay: some View {
        if openingVisible {
            NativeOpeningGreeting(name: client.state?.profile.name ?? "ты", sentence: openingSentence,
                active: opening.phase == .greeting, leaving: opening.phase == .handoff) { finishOpening(animated: false) }
                .transition(.identity)
                .zIndex(10)
        }
    }

    @ViewBuilder private var conversationSheet: some View {
        if let value = client.conversation {
            ConversationView(id: value.id)
                .environmentObject(client)
                .environment(\.locale, RuFormat.locale)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(Radius.sheet)
                .interactiveDismissDisabled(client.recording || client.microphoneStarting)
#if DEBUG
                .modifier(PreviewAccessibility())
#endif
        } else {
            Color.clear.task { client.conversationPresented = false }
        }
    }

    private var placementCover: some View {
        ShellPlacementCover()
            .environmentObject(client)
            .environment(\.locale, RuFormat.locale)
#if DEBUG
            .modifier(PreviewAccessibility())
#endif
    }

    // MARK: State

    private var rootErrorPresented: Binding<Bool> {
        Binding(get: { client.error != nil && !client.conversationPresented && !client.placementPresented },
                set: { if !$0 { client.error = nil } })
    }

    private var pollingKey: String {
        "\(client.signedIn)|\(client.needsBackgroundPolling)|\(client.conversationPresented)"
    }

    private var placementPromptKey: String {
        guard client.signedIn, let signal = client.state?.placementSignal else { return "none" }
        return signal.needsLearner ? "needs" : "done"
    }

    private var placementPending: Bool { client.state?.placementSignal?.needsLearner == true }

    private var openingReadiness: NativeOpeningReadiness {
        let previewAllowsOpening: Bool
#if DEBUG
        previewAllowsOpening = PreviewFixtures.screen == nil || PreviewFixtures.screen == "opening"
#else
        previewAllowsOpening = true
#endif
        let busyElsewhere = client.conversationPresented || client.placementPresented || client.recording || client.microphoneStarting
        let protected = !previewAllowsOpening || busyElsewhere || client.playing || client.hasUnuploadedRecording
            || !client.draft.isEmpty || selectedTab != .today || dynamicTypeSize.isAccessibilitySize
        return NativeOpeningReadiness(signedIn: client.signedIn, stateLoaded: client.state != nil,
            onboardingBlocked: placementPending, protectedActivity: protected, foreground: scenePhase == .active)
    }

    private var openingVisible: Bool { opening.phase != .finished && openingReadiness.displayEligible && !reduceMotion && !voiceOver }
    private var homeEntryVisible: Bool { !openingVisible || opening.phase == .handoff }

    private var openingSentence: String {
        if client.state?.sessions.contains(where: { $0.isResumable }) == true {
            return "Разговор на месте. Давай дожмём мысль."
        }
        let completedToday = client.state?.sessions.contains { session in
            session.status == "completed" && session.latestDate.map { Calendar.current.isDateInToday($0) } == true
        } == true
        return completedToday ? "Сегодня уже потренировался. Дальше — в своём темпе." : "Сначала одна мысль. Потом разговор пойдёт."
    }

    private func runOpening() async {
        guard opening.begin(readiness: openingReadiness, reduceMotion: reduceMotion || voiceOver) else { return }
        do {
            try await Task.sleep(for: .milliseconds(NativeOpeningState.greetingMilliseconds))
            guard opening.beginHandoff() else { return }
            try await Task.sleep(for: .seconds(NativeOpeningState.handoffSeconds))
        } catch {
            finishOpening(animated: false)
            return
        }
        finishOpening(animated: true)
    }

    private func finishOpening(animated: Bool) {
        opening.finish(animated: animated)
    }

    /// First appearance after login: the placement test opens once; «Продолжу позже» leaves Today usable.
    private func promptPlacementIfNeeded() {
        guard !placementPrompted, client.signedIn, placementPending, !client.conversationPresented,
              !client.placementPresented, !client.hasUnuploadedRecording else { return }
#if DEBUG
        // Previews present the flow explicitly (previewNavigation); «placement» shows Today's card.
        if PreviewFixtures.screen != nil { return }
#endif
        placementPrompted = true
        client.placementPresented = true
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            Task { await client.refreshReminderStatus() }
            client.refreshIfStale()
        case .background:
            if opening.phase == .greeting || opening.phase == .handoff { finishOpening(animated: false) }
            Task { await client.handleBackground() }
        default:
            if opening.phase == .greeting || opening.phase == .handoff { finishOpening(animated: false) }
        }
    }

#if DEBUG
    private func previewNavigation() async {
        guard let screen = PreviewFixtures.screen else { return }
        if let tab = PreviewFixtures.tab(for: screen) { selectedTab = tab }
        if FeaturePreviewFixtures.isPlacementScreen(screen) && screen != "placement-result" {
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            client.placementPresented = true
            return
        }
        guard screen == "tab-history-round-trip" else { return }
        let order: [ShellTab] = [.progress, .today, .practice, .calls, .progress, .profile, .today, .progress, .practice, .profile, .today, .progress]
        for tab in order {
            do { try await Task.sleep(for: .milliseconds(650)) } catch { return }
            selectedTab = tab
        }
    }
#endif
}

/// iOS 26: the glass tab bar tucks away while reading long screens.
private struct TabBarBehavior: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}

/// Global feedback while a lesson is being prepared, wherever the learner tapped.
private struct StartingCapsule: View {
    let stage: String
    var body: some View {
        HStack(spacing: 10) {
            ProgressView().tint(Theme.violet)
            Text(stage).font(.footnote.weight(.semibold)).lineLimit(1)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .modifier(LiquidChrome(radius: 22, tint: nil, interactive: false))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(stage)
    }
}

/// Placement test cover. The flow itself owns its close action («Продолжу позже»).
struct ShellPlacementCover: View {
    var body: some View {
        PlacementFlowView()
    }
}

struct LoginView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var code = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HStack(alignment: .center) {
                        BrandMark(size: 52)
                        Spacer()
                        VoiceOrb(mode: .ready, level: 0, mood: .happy, statusDescription: "Smooth Talk", interactive: true)
                            .frame(width: 104, height: 104)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Говори увереннее.\nНа английском.")
                            .font(TypeScale.hero).tracking(-0.6)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Созвоны, разборы и прогресс — на телефоне и компьютере.")
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    loginCard
                    Text("Доступ сохраняется на этом iPhone. Личная история хранится на твоём сервере.")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary)
                }.padding(24).padding(.top, 20).frame(maxWidth: 600, alignment: .leading).frame(maxWidth: .infinity)
            }
            .modifier(LiquidCanvas())
            .scrollDismissesKeyboard(.interactively)
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var loginCard: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 16) {
                InputLabel(title: "Адрес сервера")
                TextField("https://адрес", text: $client.server)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.body).padding(14)
                    .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                InputLabel(title: "Личный код")
                SecureField("Код доступа", text: $code)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().padding(14)
                    .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                Button {
                    Task {
                        await client.login(code: code)
                        if client.signedIn { code = "" }
                    }
                } label: {
                    HStack {
                        Text(client.busy ? "Подключаю" : "Войти")
                        Spacer()
                        if client.busy { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "arrow.right") }
                    }
                }
                .buttonStyle(PrimaryButton())
                .disabled(client.busy || code.isEmpty || client.server.isEmpty)
            }
        }
    }
}
