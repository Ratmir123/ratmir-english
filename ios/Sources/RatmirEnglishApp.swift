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
                    if PreviewFixtures.install(client) {
                        client.finishPreviewLaunch()
                        return
                    }
#endif
                    await client.restore()
                }
        }
    }
}

/// Why a saved access key did not open the server at launch (MOTION-PASS 0.5.2 §4). Never an alert.
enum RestoreFailure: Equatable {
    /// 401/403: the code changed on the server. The login card says «Код больше не подходит — введи его заново».
    case codeRefused
    /// No answer from a working server (offline, timeout, 5xx, unexpected data): the launch layer offers «Повторить».
    case unreachable(String)

    var isUnreachable: Bool {
        if case .unreachable = self { return true }
        return false
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

/// Launch state machine (MOTION-PASS 0.5.2 §4):
/// signed in → shell (the launch layer may still cover it while it greets or fades);
/// a saved key being checked, or the server unreachable → the launch layer over the bare background;
/// otherwise → the login card (with «Код больше не подходит» after a refused code).
struct RootView: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var selectedTab: ShellTab = .today
    @State private var opening = NativeOpeningState()
    @State private var launchHold = LaunchHold.idle
    @State private var placementPrompted = false
    @State private var rankUpClaimed: Set<String> = []
    @State private var confettiTrigger = 0
    /// Calls whose review became ready while the learner was on another tab: the «Созвоны» badge until he looks.
    @State private var unseenReadyCalls: Set<String> = []
    @State private var callReady: CallReadyNotice? = nil

    /// The launch layer keeps covering once the saved key is answered, until the greeting takes it over (`idle`)
    /// or it has faded out (`fading`): it never disappears in a single frame.
    private enum LaunchHold { case idle, covering, fading }

    var body: some View {
        rootContent
            .simultaneousGesture(TapGesture().onEnded {
                if opening.animateHome { finishOpening(animated: false) }
            }, including: opening.animateHome ? .all : .subviews)
            .overlay { launchLayer }
            .task(id: openingReadiness) { await runOpening() }
            .task(id: pollingKey) { await client.pollStateWhileProcessing() }
            .task(id: placementPromptKey) { promptPlacementIfNeeded() }
            .task(id: callReady?.id) { await expireCallReady() }
            .sheet(isPresented: $client.conversationPresented, onDismiss: { client.conversationDidClose() }) {
                conversationSheet
            }
            .fullScreenCover(isPresented: $client.placementPresented, onDismiss: { client.refreshInBackground() }) {
                placementCover
            }
            .onChange(of: launchWaiting, initial: true) { _, waiting in launchWaitingChanged(waiting) }
            .onChange(of: client.conversationPresented) { _, presented in
                if presented { finishOpening(animated: false) }
            }
            .onChange(of: callStatuses) { old, new in noticeFinishedCalls(old: old, new: new) }
            .onChange(of: selectedTab) { _, tab in
                if tab == .calls { unseenReadyCalls.removeAll() }
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
        if client.signedIn {
            shell
        } else if launchWaiting {
            // The launch layer covers this: the login card never shows while a saved key is being checked.
            Theme.base.ignoresSafeArea()
        } else {
            LoginView()
        }
    }

    private var shell: some View {
        TabView(selection: $selectedTab) {
            TodayScreen(select: { selectedTab = $0 }, entryVisible: homeEntryVisible, animateEntry: homeEntryAnimated)
                .modifier(CurrentLessonInset(session: lessonCapsule(on: .today), open: { client.resume($0) }))
                .tabItem { Label("Сегодня", systemImage: "sun.max") }
                .badge(todayBadge)
                .tag(ShellTab.today)
            PracticeScreen()
                .modifier(CurrentLessonInset(session: lessonCapsule(on: .practice), open: { client.resume($0) }))
                .tabItem { Label("Практика", systemImage: "waveform") }
                .tag(ShellTab.practice)
            CallsScreen()
                .modifier(CurrentLessonInset(session: lessonCapsule(on: .calls), open: { client.resume($0) }))
                .tabItem { Label("Созвоны", systemImage: ShellSymbol.calls) }
                .badge(callsBadge)
                .tag(ShellTab.calls)
            ProgressScreen()
                .modifier(CurrentLessonInset(session: lessonCapsule(on: .progress), open: { client.resume($0) }))
                .tabItem { Label("Прогресс", systemImage: "chart.line.uptrend.xyaxis") }
                .tag(ShellTab.progress)
            ProfileScreen()
                .modifier(CurrentLessonInset(session: lessonCapsule(on: .profile), open: { client.resume($0) }))
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .tag(ShellTab.profile)
        }
        .modifier(TabBarBehavior())
        .mascotConfetti(trigger: confettiTrigger, origin: UnitPoint(x: 0.5, y: 0.12))
        .sensoryFeedback(.success, trigger: confettiTrigger)
        .overlay(alignment: .top) { topOverlay }
        .overlay { rankUpOverlay }
        .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: client.completionMoment?.id)
        .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: client.startingIntent)
        .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: callReady?.id)
    }

    @ViewBuilder private var topOverlay: some View {
        VStack(spacing: 8) {
            if let moment = client.completionMoment, !client.conversationPresented {
                CompletionCelebration(moment: moment) { confettiTrigger += 1 }
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .top).combined(with: .opacity))
            }
            if client.startingIntent != nil && !client.conversationPresented {
                StartingCapsule(stage: client.operationStage ?? "Готовлю занятие")
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .top).combined(with: .opacity))
            }
            if let notice = callReady, !client.conversationPresented, !client.placementPresented {
                CallReadyCapsule(notice: notice) { openReadyCall(notice) }
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .top).combined(with: .opacity))
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

    /// One layer from the first frame to the hand-off: launch wait, offline, greeting (the same companion throughout).
    @ViewBuilder private var launchLayer: some View {
        if launchLayerVisible {
            let copy = OpeningGreeting(state: client.state)
            LaunchView(stage: launchStage, greeting: copy.greeting, sentence: copy.motivation,
                       leaving: launchLeaving, leaveSeconds: launchLeaveSeconds,
                       skip: { finishOpening(animated: false) },
                       retry: { Task { await client.restore() } },
                       enterCode: { client.dismissRestoreFailure() })
                // A fading cover never blocks the screen underneath (input is never blocked by motion).
                .allowsHitTesting(launchHold != .fading)
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

    // MARK: Launch

    /// The saved key is being checked, or the server could not be reached: the launch layer owns the screen.
    private var launchWaiting: Bool {
        !client.signedIn && (client.restoring || client.restoreFailure?.isUnreachable == true)
    }

    private var launchLayerVisible: Bool { launchWaiting || launchHold != .idle || openingVisible }

    private var launchStage: LaunchStage {
        if !client.signedIn, case .unreachable(let detail)? = client.restoreFailure {
            return .offline(detail: detail, retrying: client.restoring)
        }
        if opening.phase == .greeting || opening.phase == .handoff { return .greeting }
        return .waiting
    }

    private var launchLeaving: Bool { launchHold == .fading || opening.phase == .handoff }
    private var launchLeaveSeconds: Double {
        launchHold == .fading ? NativeLaunch.coverFadeSeconds : NativeOpeningState.handoffSeconds
    }

    /// The key was answered: the greeting continues on the same layer, or the layer cross-fades out while the
    /// screen underneath (Home's staircase, or the login card) appears.
    private func launchWaitingChanged(_ waiting: Bool) {
        if waiting {
            launchHold = .covering
            return
        }
        guard launchHold == .covering else { return }
        if openingVisible {
            launchHold = .idle
            return
        }
        launchHold = .fading
        Task {
            do { try await Task.sleep(for: .seconds(NativeLaunch.coverFadeSeconds)) } catch {}
            if launchHold == .fading { launchHold = .idle }
        }
    }

    // MARK: State

    private var rootErrorPresented: Binding<Bool> {
        Binding(get: { client.error != nil && !client.conversationPresented && !client.placementPresented && !client.restoring },
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
    /// Skipping the greeting reveals Home at once; after the hand-off (or with no greeting at all) the staircase runs.
    private var homeEntryAnimated: Bool { !opening.greeted || opening.animateHome }

    private func runOpening() async {
        guard opening.begin(readiness: openingReadiness, reduceMotion: reduceMotion || voiceOver) else { return }
        launchHold = .idle
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

    // MARK: Badges and capsules (MOTION-PASS 0.5.2 §8.9)

    /// «Сегодня»: a lesson review waits for the improved attempt.
    private var todayBadge: Int {
        (client.state?.sessions ?? []).filter { $0.status == "review" && $0.isInProgress && $0.isFresh() }.count
    }

    /// «Созвоны»: calls that need «кто есть кто», plus reviews that became ready while the learner was elsewhere.
    private var callsBadge: Int {
        let calls = client.state?.callSignals ?? []
        let speakers = calls.filter { $0.status == "needs-speaker" }.count
        let ready = calls.filter { $0.status == "ready" && unseenReadyCalls.contains($0.id) }.count
        return speakers + ready
    }

    /// id → status of every call: the moment a review becomes ready is noticed here.
    private var callStatuses: [String: String] {
        var statuses: [String: String] = [:]
        for call in client.state?.callSignals ?? [] { statuses[call.id] = call.status }
        return statuses
    }

    private func noticeFinishedCalls(old: [String: String], new: [String: String]) {
        let working: Set<String> = ["awaiting-upload", "queued", "processing", "analysing"]
        let finished = new.keys.filter { id in
            new[id] == "ready" && old[id].map { working.contains($0) } == true
        }.sorted()
        guard client.signedIn, !finished.isEmpty, selectedTab != .calls else { return }
        unseenReadyCalls.formUnion(finished)
        if let id = finished.first, let call = client.state?.callSignals.first(where: { $0.id == id }) {
            callReady = CallReadyNotice(id: call.id, title: call.title)
        }
    }

    private func openReadyCall(_ notice: CallReadyNotice) {
        unseenReadyCalls.remove(notice.id)
        callReady = nil
        CallsNavigator.shared.open(.call(notice.id))
        selectedTab = .calls
    }

    private func expireCallReady() async {
        guard callReady != nil else { return }
        do { try await Task.sleep(for: .seconds(6)) } catch { return }
        callReady = nil
    }

    /// A lesson minimised with «Свернуть» stays one tap away above the tab bar (the PC has the session pill).
    private func lessonCapsule(on tab: ShellTab) -> Conversation? {
        guard client.signedIn, !client.conversationPresented, !client.placementPresented,
              let current = client.conversation else { return nil }
        let session = client.state?.session(current.id) ?? current
        guard session.isInProgress else { return nil }
        // Today's own card already continues this lesson.
        if tab == .today,
           TodayPlanner.hero(state: client.state, hasPendingRecording: client.hasUnuploadedRecording) == .resume(sessionID: session.id) {
            return nil
        }
        return session
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

/// A call review that just became ready while the learner was on another tab.
private struct CallReadyNotice: Equatable {
    let id: String
    let title: String
}

/// «Разбор созвона готов · Открыть»: floating chrome for a few seconds, the badge on «Созвоны» stays.
private struct CallReadyCapsule: View {
    let notice: CallReadyNotice
    let open: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill").font(.body.weight(.semibold)).foregroundStyle(Theme.limeInk)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("Разбор созвона готов").font(.footnote.weight(.semibold))
                Text(notice.title).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("Открыть", action: open)
                .buttonStyle(QuietButton())
                .accessibilityLabel("Открыть разбор созвона «\(notice.title)»")
        }
        .foregroundStyle(Theme.ink)
        .padding(.leading, 16).padding(.trailing, 6).padding(.vertical, 6)
        .modifier(LiquidChrome(radius: 28, tint: nil, interactive: false))
        .padding(.horizontal, 14)
        .frame(maxWidth: 560)
        .accessibilityElement(children: .contain)
    }
}

/// Puts «Текущее занятие · Открыть» above the tab bar of one tab while a lesson is minimised.
private struct CurrentLessonInset: ViewModifier {
    let session: Conversation?
    let open: (Conversation) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let session {
                    CurrentLessonCapsule(title: session.lesson.title) { open(session) }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: session?.id)
    }
}

private struct CurrentLessonCapsule: View {
    let title: String
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Image(systemName: "waveform").font(.body.weight(.semibold)).foregroundStyle(Theme.violet)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Текущее занятие").font(.footnote.weight(.semibold))
                    Text(title).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text("Открыть").font(.footnote.weight(.semibold)).foregroundStyle(Theme.violet)
            }
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 18).padding(.vertical, 10)
            .frame(maxWidth: 560, minHeight: 52)
            .contentShape(Capsule())
        }
        .buttonStyle(PressButton())
        .modifier(LiquidChrome(radius: 26, tint: nil, interactive: true))
        .accessibilityLabel("Текущее занятие: " + title)
        .accessibilityHint("Открывает свёрнутое занятие")
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
                    BrandMark(size: 64, mood: .happy, interactive: true)
                        .entrance(0)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Говори увереннее.\nНа английском.")
                            .font(TypeScale.hero).tracking(-0.6)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Созвоны, разборы и прогресс — на телефоне и компьютере.")
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    .entrance(1)
                    loginCard
                        .entrance(2)
                    Text("Доступ сохраняется на этом iPhone. Личная история хранится на твоём сервере.")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .entrance(3)
                }
                .padding(24).padding(.top, 20).frame(maxWidth: 600, alignment: .leading).frame(maxWidth: .infinity)
                .entranceStage()
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
                if client.restoreFailure == .codeRefused {
                    // The saved code was refused at launch: say so here, no alert.
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.warning)
                            .accessibilityHidden(true)
                        Text("Код больше не подходит — введи его заново")
                            .font(.footnote.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                }
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
