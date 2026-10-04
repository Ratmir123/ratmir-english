import SwiftUI

// MARK: - Decision order (DESIGN-SYSTEM §3 Today)

/// Exactly one primary card: pending recording → placement test → unfinished session or review →
/// call waiting for the speaker → personal drill → the server's plan.
enum TodayHero: Equatable {
    case pendingRecording
    case placement(status: String)
    case resume(sessionID: String)
    case confirmSpeaker(callID: String)
    case drill(id: String)
    case recommendation
    case empty
}

enum TodayPlanner {
    static func hero(state: TrainingState?, hasPendingRecording: Bool) -> TodayHero {
        if hasPendingRecording { return .pendingRecording }
        guard let state else { return .empty }
        if let placement = state.placementSignal, !placement.hasResult, placement.status != "scoring" {
            return .placement(status: placement.status)
        }
        if let session = resumableSession(state) { return .resume(sessionID: session.id) }
        if let call = state.callSignals.first(where: { $0.status == "needs-speaker" }) { return .confirmSpeaker(callID: call.id) }
        if let drill = pendingDrill(state) { return .drill(id: drill.id) }
        if state.progression?.recommendation != nil { return .recommendation }
        return .empty
    }

    static func resumableSession(_ state: TrainingState) -> Conversation? {
        let candidates = state.sessions.filter { $0.isResumable }
        return candidates.max { ($0.latestDate ?? .distantPast) < ($1.latestDate ?? .distantPast) }
    }

    /// The newest unfinished drill that is not already open as a session.
    static func pendingDrill(_ state: TrainingState) -> TodayDrillSignal? {
        let open = Set(state.sessions.filter { $0.isResumable }.map(\.id))
        return state.drillSignals.first { drill in
            guard drill.status != "done" else { return false }
            if let id = drill.sessionId, open.contains(id) { return false }
            return true
        }
    }

    /// Top active weaknesses for «Над чем работаем».
    static func focusPatterns(_ state: TrainingState?, limit: Int = 2) -> [TodayPatternSignal] {
        guard let state else { return [] }
        let relevant = state.patternSignals.filter { $0.kind != "strength" && !$0.dismissed && $0.status != "resolved" }
        let sorted = relevant.sorted { left, right in
            let leftActive = left.status == "active" ? 0 : 1
            let rightActive = right.status == "active" ? 0 : 1
            if leftActive != rightActive { return leftActive < rightActive }
            return left.costRank < right.costRank
        }
        return Array(sorted.prefix(limit))
    }
}

/// Seven informational dots, today last. Nothing decays and a missed day is just empty.
struct RhythmDay: Identifiable {
    let id: Int
    let date: Date
    let practiced: Bool
}

enum PracticeRhythm {
    static func lastWeek(_ state: TrainingState?, now: Date = Date()) -> [RhythmDay] {
        let calendar = Calendar.current
        var practiced = Set<Date>()
        for session in state?.sessions ?? [] where session.status == "completed" {
            if let date = session.latestDate { practiced.insert(calendar.startOfDay(for: date)) }
        }
        for result in state?.progression?.recentResults ?? [] {
            if let date = NativeDate.parse(result.completedAt) { practiced.insert(calendar.startOfDay(for: date)) }
        }
        let today = calendar.startOfDay(for: now)
        return (0..<7).compactMap { offset -> RhythmDay? in
            guard let day = calendar.date(byAdding: .day, value: offset - 6, to: today) else { return nil }
            return RhythmDay(id: offset, date: day, practiced: practiced.contains(day))
        }
    }
}

struct RhythmDots: View {
    let days: [RhythmDay]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(days) { day in
                VStack(spacing: 6) {
                    Circle()
                        .fill(day.practiced ? Theme.lime : Theme.ink.opacity(0.08))
                        .overlay { Circle().strokeBorder(day.practiced ? Theme.limeInk.opacity(0.35) : Theme.hairline, lineWidth: 1) }
                        .frame(width: 22, height: 22)
                    Text(RuFormat.weekday(day.date)).font(.caption2).foregroundStyle(Theme.inkSecondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Дней с практикой за неделю: \(days.filter { $0.practiced }.count) из 7")
    }
}

// MARK: - Today

struct TodayScreen: View {
    var select: (ShellTab) -> Void = { _ in }
    var entryVisible = true
    var animateEntry = false
    @EnvironmentObject private var client: TrainingClient
    @State private var showFreeTopic = false
    @State private var pendingFree: FreeTopicRequest? = nil
    @State private var showPlacementResult = false

    private var state: TrainingState? { client.state }
    private var hero: TodayHero { TodayPlanner.hero(state: state, hasPendingRecording: client.hasUnuploadedRecording) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    TodayHeader(completedToday: completedToday)
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 0))
                    heroSection
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 1))
                    TodayStatusRows(select: select)
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 2))
                    TodayUploadProgress()
                    TodayQuickActions(select: select, openFreeTopic: { showFreeTopic = true })
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 3))
                    levelSection
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 4))
                    TodayFocusSection(select: select)
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 5))
                    rhythmSection
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 5))
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 32)
                .frame(maxWidth: 640).frame(maxWidth: .infinity)
            }
            .modifier(LiquidCanvas())
            .refreshable { await client.refreshQuietly() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(isPresented: $showPlacementResult) { placementResultDestination }
            .sheet(isPresented: $showFreeTopic, onDismiss: startPendingFree) {
                FreeTopicSheet { request in
                    pendingFree = request
                    showFreeTopic = false
                }
                .environmentObject(client)
            }
        }
    }

    private var completedToday: Bool {
        state?.sessions.contains { session in
            session.status == "completed" && session.latestDate.map { Calendar.current.isDateInToday($0) } == true
        } == true
    }

    @ViewBuilder private var heroSection: some View {
        switch hero {
        case .pendingRecording:
            PendingRecordingCard()
        case .placement(let status):
            if let signal = state?.placementSignal { TodayPlacementCard(signal: signal, status: status) }
        case .resume(let id):
            if let session = state?.session(id) { ResumeHeroCard(session: session) }
        case .confirmSpeaker(let id):
            if let call = state?.callSignals.first(where: { $0.id == id }) {
                TodayHeroCard(eyebrow: "Созвон", icon: "person.2.fill", title: call.title,
                              detail: "Подтверди, кто из собеседников ты, — и разбор продолжится.", accent: Theme.cyan) {
                    Button { openCalls(.call(id)) } label: {
                        HStack { Text("Подтвердить"); Spacer(); Image(systemName: "arrow.right") }
                    }.buttonStyle(PrimaryButton())
                }
            }
        case .drill(let id):
            if let drill = state?.drillSignals.first(where: { $0.id == id }) { DrillHeroCard(drill: drill) }
        case .recommendation:
            if let recommendation = state?.progression?.recommendation { RecommendationHeroCard(recommendation: recommendation) }
        case .empty:
            TodayHeroCard(eyebrow: "Свободная тема", icon: "sparkles", title: "О чём поговорим сегодня?",
                          detail: "Выбери тему и формат — собеседник подстроится.") {
                Button { showFreeTopic = true } label: {
                    HStack { Text("Выбрать тему"); Spacer(); Image(systemName: "arrow.right") }
                }.buttonStyle(PrimaryButton())
            }
        }
    }

    @ViewBuilder private var levelSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let placement = state?.placement, state?.placementSignal?.hasResult == true {
                PlacementLevelCard(view: placement, onOpen: { showPlacementResult = true }, onStart: { client.placementPresented = true })
            }
            if let progression = state?.progression {
                Button { select(.progress) } label: { RankStrip(progression: progression) }
                    .buttonStyle(PressButton())
                    .accessibilityHint("Открывает вкладку «Прогресс»")
            }
        }
    }

    @ViewBuilder private var rhythmSection: some View {
        let days = PracticeRhythm.lastWeek(state)
        LiquidCard(radius: Radius.tile, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Ритм недели").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(days.filter { $0.practiced }.count) из 7").font(.footnote.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(Theme.inkSecondary)
                }
                RhythmDots(days: days)
            }
        }
    }

    @ViewBuilder private var placementResultDestination: some View {
        if let placement = state?.placement {
            PlacementResultView(view: placement, onStartPractice: { showPlacementResult = false })
                .navigationTitle("Твой уровень")
                .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// Deep link into «Созвоны»: the tab opens the call or the patterns screen when it appears.
    private func openCalls(_ route: CallsRoute) {
        CallsNavigator.shared.open(route)
        select(.calls)
    }

    private func startPendingFree() {
        guard let request = pendingFree else { return }
        pendingFree = nil
        Task { await client.startFree(mode: request.mode, context: request.context, topic: request.topic) }
    }
}

private struct TodayHeader: View {
    let completedToday: Bool
    @EnvironmentObject private var client: TrainingClient
    private var minutes: Int { client.state?.profile.dailyMinutes ?? 15 }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Привет, \(client.state?.profile.name ?? "ты").")
                    .font(TypeScale.hero).tracking(-0.6)
                    .fixedSize(horizontal: false, vertical: true)
                Text(completedToday ? "Сегодня уже потренировался. Дальше — в своём темпе." : "Давай поговорим \(RuFormat.minutes(minutes)).")
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            VoiceOrb(mode: .ready, level: 0, mood: completedToday ? .proud : .calm, statusDescription: "Твой собеседник")
                .frame(width: 104, height: 104)
        }
        .padding(.top, 12)
    }
}

// MARK: - Hero cards

struct TodayHeroCard<Actions: View>: View {
    let eyebrow: String
    let icon: String
    let title: String
    let detail: String?
    let accent: Color
    let actions: Actions

    init(eyebrow: String, icon: String, title: String, detail: String?, accent: Color = Theme.lavender, @ViewBuilder actions: () -> Actions) {
        self.eyebrow = eyebrow
        self.icon = icon
        self.title = title
        self.detail = detail
        self.accent = accent
        self.actions = actions()
    }

    var body: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: icon).font(.body.weight(.semibold)).foregroundStyle(Theme.onAccent)
                        .frame(width: 38, height: 38).background(accent, in: Circle())
                    Text(eyebrow.uppercased()).font(.caption.weight(.bold)).tracking(0.9).foregroundStyle(Theme.inkSecondary)
                    Spacer(minLength: 0)
                }
                Text(title).font(TypeScale.title2).fixedSize(horizontal: false, vertical: true)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
                actions
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Primary start button with the spinner next to the tap (L-21).
struct StartButtonLabel: View {
    let title: String
    let starting: Bool
    var body: some View {
        HStack {
            Text(starting ? "Готовим…" : title)
            Spacer()
            if starting { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "arrow.right") }
        }
    }
}

private struct TodayPlacementCard: View {
    let signal: TodayPlacementSignal
    let status: String
    @EnvironmentObject private var client: TrainingClient
    private var title: String {
        if status == "error" { return "Результат теста не посчитался" }
        return signal.started ? "Тест уровня: продолжим" : "Узнаем твой настоящий уровень"
    }
    private var detail: String {
        if status == "error" { return signal.error ?? "Ответы сохранены — результат можно пересчитать." }
        if signal.started {
            let remaining = signal.remainingMinutes.map { " · осталось около \(RuFormat.minutes($0))" } ?? ""
            return "Пройдено частей: \(signal.completedSections) из \(max(signal.totalSections, signal.completedSections))" + remaining
        }
        return "Около 25 минут, можно в два захода. Ответы не оцениваются по ходу — результат в конце."
    }
    var body: some View {
        TodayHeroCard(eyebrow: "Тест уровня", icon: "chart.bar.xaxis", title: title, detail: detail, accent: Theme.lime) {
            if signal.started && signal.totalSections > 0 {
                LiquidProgressBar(value: Double(signal.completedSections) / Double(max(1, signal.totalSections)), color: Theme.violet)
            }
            if !signal.audioAvailable {
                Label("Голос не подключён: аудио и речь пропустим. Подключается на компьютере в настройках.", systemImage: "speaker.slash")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            Button { client.placementPresented = true } label: {
                HStack {
                    Text(status == "error" ? "Открыть тест" : signal.started ? "Продолжить тест" : "Начать тест")
                    Spacer()
                    Image(systemName: "arrow.right")
                }
            }
            .buttonStyle(PrimaryButton())
        }
    }
}

private struct ResumeHeroCard: View {
    let session: Conversation
    @EnvironmentObject private var client: TrainingClient
    private var detail: String {
        if session.analysisFailed { return "Разбор не получился — его можно повторить в занятии." }
        if session.status == "review" { return "Разбор готов — сделай улучшенную попытку." }
        if session.awaitsRetry { return "Улучшенная попытка ждёт тебя. Разбор сохранён." }
        let count = session.userTurnCount
        if count == 0 { return "Собеседник ждёт твоего первого ответа." }
        return "Твоих ответов: \(count). Продолжим с того же места."
    }
    private var buttonTitle: String {
        if session.status == "review" || session.awaitsRetry { return "Открыть разбор" }
        return "Продолжить разговор"
    }
    var body: some View {
        TodayHeroCard(eyebrow: "Продолжить", icon: session.analysis != nil ? "text.badge.checkmark" : "play.fill",
                      title: session.lesson.title, detail: detail, accent: Theme.lavender) {
            Button { client.resume(session) } label: {
                HStack { Text(buttonTitle); Spacer(); Image(systemName: "arrow.right") }
            }
            .buttonStyle(PrimaryButton())
            .disabled(client.recording || client.startingIntent != nil)
        }
    }
}

private struct DrillHeroCard: View {
    let drill: TodayDrillSignal
    @EnvironmentObject private var client: TrainingClient
    private var starting: Bool { client.isStarting(TrainingClient.drillKey(drill.id)) }
    var body: some View {
        TodayHeroCard(eyebrow: drill.sourceCallId != nil ? "Тренировка из созвона" : "Твоя тренировка", icon: "arrow.triangle.2.circlepath",
                      title: drill.title, detail: drill.why, accent: Theme.cyan) {
            Button { Task { await client.startDrill(id: drill.id, mode: drill.preferredMode) } } label: {
                StartButtonLabel(title: "Переиграть момент", starting: starting)
            }
            .buttonStyle(PrimaryButton())
            .disabled(client.busy || client.startingIntent != nil || client.recording)
        }
    }
}

private struct RecommendationHeroCard: View {
    let recommendation: PracticeRecommendation
    @EnvironmentObject private var client: TrainingClient
    private var key: String {
        if let drillId = recommendation.drillId, !drillId.isEmpty { return TrainingClient.drillKey(drillId) }
        return TrainingClient.familyKey(recommendation.familyId)
    }
    private var eyebrow: String {
        switch recommendation.source ?? "" {
        case "drill": return "Тренировка"
        case "review": return "Повторение"
        case "pattern": return "Над чем работаем"
        default: return "План на сегодня"
        }
    }
    private var icon: String {
        switch recommendation.activity {
        case "listening": return "ear"
        case "reading": return "text.book.closed"
        case "writing": return "square.and.pencil"
        default: return recommendation.track == "work" ? "briefcase" : recommendation.track == "relocation" ? "airplane" : "waveform"
        }
    }
    var body: some View {
        TodayHeroCard(eyebrow: eyebrow, icon: icon, title: recommendation.title, detail: recommendation.why, accent: Theme.lime) {
            Text(recommendation.preferredMode == "call" ? "Формат: созвон — слушаешь и отвечаешь." : "Формат: с опорами — текст и подсказки рядом.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary)
            Button { Task { await client.startRecommendation(recommendation) } } label: {
                StartButtonLabel(title: "Начать", starting: client.isStarting(key))
            }
            .buttonStyle(PrimaryButton())
            .disabled(client.busy || client.startingIntent != nil || client.recording)
        }
    }
}

/// Global recovery for a recording that never reached the server (L-01, P0).
struct PendingRecordingCard: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var confirmDelete = false
    private var owner: Conversation? { client.pendingRecordingSession }
    private var openable: Conversation? {
        guard !client.orphanedRecording, let owner, owner.isResumable else { return nil }
        return owner
    }
    private var title: String { client.orphanedRecording ? "Запись осталась только на iPhone" : "Ответ ещё не отправлен" }
    private var detail: String {
        if client.orphanedRecording {
            return "Занятия, к которому она относится, уже нет. Прослушай её, если нужно, и удали — практика сразу продолжится."
        }
        if let owner { return "Запись к занятию «\(owner.lesson.title)». Открой занятие и повтори распознавание или удали запись." }
        return "Открой занятие и повтори распознавание или удали запись."
    }
    var body: some View {
        LiquidCard(tint: Theme.warning.opacity(0.16)) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.circle.fill").font(.title3).foregroundStyle(Theme.warning)
                    Text("ЗАПИСЬ НЕ ОТПРАВЛЕНА").font(.caption.weight(.bold)).tracking(0.9).foregroundStyle(Theme.inkSecondary)
                }
                Text(title).font(TypeScale.title2).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                if let openable {
                    Button { client.resume(openable) } label: {
                        HStack { Text("Открыть занятие"); Spacer(); Image(systemName: "arrow.right") }
                    }
                    .buttonStyle(PrimaryButton())
                }
                HStack(spacing: 10) {
                    Button {
                        if client.playingLearnerRecording { client.stopSpeaking() } else { Task { await client.playRecording() } }
                    } label: {
                        Label(client.playingLearnerRecording ? "Стоп" : "Прослушать", systemImage: client.playingLearnerRecording ? "stop.fill" : "play.fill")
                    }
                    .buttonStyle(QuietButton())
                    .disabled(client.busy || client.recording)
                    Button { confirmDelete = true } label: { Label("Удалить запись", systemImage: "trash") }
                        .buttonStyle(DestructiveQuietButton())
                        .disabled(client.busy || client.recording)
                }
            }
        }
        .confirmationDialog("Удалить запись?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить запись", role: .destructive) {
                client.stopSpeaking()
                client.discardRecording()
            }
            Button("Оставить", role: .cancel) {}
        } message: {
            Text("Она есть только на этом iPhone и не попала на сервер.")
        }
    }
}

// MARK: - Secondary rows

/// Informational rows that never compete with the primary card.
private struct TodayStatusRows: View {
    let select: (ShellTab) -> Void
    @EnvironmentObject private var client: TrainingClient
    private var analysing: [Conversation] {
        (client.state?.sessions ?? []).filter { $0.status == "analysing" }
    }
    private var processingCalls: [TodayCallSignal] {
        (client.state?.callSignals ?? []).filter { $0.isProcessing }
    }
    private var placementScoring: Bool { client.state?.placementSignal?.status == "scoring" }
    var body: some View {
        if placementScoring || !analysing.isEmpty || !processingCalls.isEmpty {
            VStack(spacing: 8) {
                if placementScoring {
                    Button { client.placementPresented = true } label: {
                        StatusRowLabel(icon: "chart.bar.xaxis", title: "Тест уровня", detail: "Считаем результат — около двух минут")
                    }.buttonStyle(PressButton())
                }
                ForEach(analysing.prefix(2)) { session in
                    Button { client.resume(session) } label: {
                        StatusRowLabel(icon: "hourglass", title: session.lesson.title, detail: "Разбор готовится")
                    }.buttonStyle(PressButton())
                }
                ForEach(processingCalls.prefix(2)) { call in
                    Button { CallsNavigator.shared.open(.call(call.id)); select(.calls) } label: {
                        StatusRowLabel(icon: "waveform.path", title: call.title, detail: callDetail(call))
                    }.buttonStyle(PressButton())
                }
            }
        }
    }
    private func callDetail(_ call: TodayCallSignal) -> String {
        let stage = call.progressStage.flatMap { $0.isEmpty ? nil : $0 } ?? "Разбираем созвон"
        if let percent = call.progressPercent { return stage + " · \(Int(percent.rounded()))%" }
        return stage
    }
}

/// A call upload that is still running (or failed and can resume) stays visible on Today.
private struct TodayUploadProgress: View {
    @ObservedObject private var uploads: CallUploadCenter

    init() {
        _uploads = ObservedObject(wrappedValue: CallUploadCenter.shared)
    }

    var body: some View {
        if uploads.job != nil {
            CallUploadCard(compact: true)
        }
    }
}

private struct StatusRowLabel: View {
    let icon: String
    let title: String
    let detail: String
    var body: some View {
        HStack(spacing: 12) {
            ProgressView().tint(Theme.violet).frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(detail).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: icon).font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .modifier(LiquidChrome(radius: Radius.tile, tint: nil, interactive: false))
        .accessibilityElement(children: .combine)
    }
}

private struct TodayQuickActions: View {
    let select: (ShellTab) -> Void
    let openFreeTopic: () -> Void
    @EnvironmentObject private var client: TrainingClient
    private var pitch: CatalogFamily? { client.catalogFamily("strategy-pitch-30") }
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            NativeGlassGroup(spacing: 8) {
                HStack(spacing: 8) {
                    Button { select(.calls) } label: { Label("Загрузить созвон", systemImage: "square.and.arrow.up") }
                        .buttonStyle(QuietButton())
                    if let pitch {
                        Button { Task { await client.startFamily(familyId: pitch.id, mode: pitch.preferredMode) } } label: {
                            if client.isStarting(TrainingClient.familyKey(pitch.id)) {
                                HStack(spacing: 6) { ProgressView(); Text("Готовим…") }
                            } else {
                                Label("Питч за 30 секунд", systemImage: "timer")
                            }
                        }
                        .buttonStyle(QuietButton())
                        .disabled(client.busy || client.startingIntent != nil || client.hasUnuploadedRecording)
                    }
                    Button(action: openFreeTopic) { Label("Свободная тема", systemImage: "sparkles") }
                        .buttonStyle(QuietButton())
                        .disabled(client.hasUnuploadedRecording)
                }
                .padding(.vertical, 2)
            }
        }
        .scrollClipDisabled()
        .task { await client.loadCatalog() }
    }
}

private struct TodayFocusSection: View {
    let select: (ShellTab) -> Void
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        let patterns = TodayPlanner.focusPatterns(client.state)
        if !patterns.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    LiquidSectionHeader(title: "Над чем работаем")
                    Button { openPatterns() } label: {
                        HStack(spacing: 4) { Text("Все"); Image(systemName: "chevron.right") }.font(.footnote.weight(.semibold))
                    }
                    .buttonStyle(PressButton())
                    .foregroundStyle(Theme.violet)
                }
                ForEach(patterns) { pattern in
                    Button { openPatterns() } label: { TodayFocusRow(pattern: pattern) }
                        .buttonStyle(PressButton())
                }
            }
        }
    }

    private func openPatterns() {
        CallsNavigator.shared.open(.patterns)
        select(.calls)
    }
}

private struct TodayFocusRow: View {
    let pattern: TodayPatternSignal
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(pattern.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                FocusHistoryDots(history: pattern.history)
            }
            Spacer(minLength: 0)
            StatusPill(title: pattern.statusTitle, color: pattern.status == "improving" ? Theme.lime : pattern.status == "active" ? Theme.pink : Theme.lavender)
        }
        .padding(14)
        .modifier(LiquidChrome(radius: Radius.tile, tint: nil, interactive: false))
        .accessibilityElement(children: .combine)
    }
}

/// ● repeated ○ avoided · no opportunity ◐ improved (oldest first, last eight).
struct FocusHistoryDots: View {
    let history: [String]
    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(history.suffix(8).enumerated()), id: \.offset) { _, status in
                dot(status)
            }
            if history.isEmpty {
                Text("Пока без истории").font(.caption2).foregroundStyle(Theme.inkTertiary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
    @ViewBuilder private func dot(_ status: String) -> some View {
        switch status {
        case "avoided":
            Circle().strokeBorder(Theme.limeInk, lineWidth: 2).frame(width: 10, height: 10)
        case "improved":
            Circle().fill(LinearGradient(colors: [Theme.limeInk, Theme.limeInk, Color.clear, Color.clear], startPoint: .leading, endPoint: .trailing))
                .overlay { Circle().strokeBorder(Theme.limeInk, lineWidth: 1.5) }
                .frame(width: 10, height: 10)
        case "no-opportunity":
            Circle().fill(Theme.inkTertiary).frame(width: 4, height: 4).frame(width: 10, height: 10)
        default:
            Circle().fill(Theme.pink).frame(width: 10, height: 10)
        }
    }
    private var accessibilityText: String {
        let repeated = history.filter { $0 == "repeated" || $0 == "new" }.count
        let avoided = history.filter { $0 == "avoided" || $0 == "improved" }.count
        return "Повторялось: \(repeated). Удалось избежать: \(avoided)."
    }
}

// MARK: - Free topic

struct FreeTopicRequest {
    let mode: String
    let context: String
    let topic: String
}

/// «Свободная тема»: context, mode and an optional topic. The sheet closes before the lesson starts.
struct FreeTopicSheet: View {
    let onStart: (FreeTopicRequest) -> Void
    @Environment(\.dismiss) private var dismiss
    @AppStorage("practice-context") private var context = "life"
    @AppStorage("practice-mode") private var mode = "learning"
    @State private var topic = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
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
                        Text(ModeCopy.explanation(mode)).font(.footnote).foregroundStyle(Theme.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        InputLabel(title: "Тема (необязательно)")
                        TextField("Например: обсудить сроки проекта", text: $topic, axis: .vertical)
                            .lineLimit(1...3).padding(14)
                            .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                            .onChange(of: topic) { _, value in if value.count > 300 { topic = String(value.prefix(300)) } }
                    }
                    Button {
                        onStart(FreeTopicRequest(mode: mode, context: context, topic: topic))
                    } label: {
                        HStack { Text("Начать"); Spacer(); Image(systemName: "arrow.right") }
                    }
                    .buttonStyle(PrimaryButton())
                }
                .padding(20)
            }
            .modifier(LiquidCanvas(intensity: 0.6))
            .navigationTitle("Свободная тема")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

enum ModeCopy {
    static func explanation(_ mode: String) -> String {
        mode == "call"
            ? "Как настоящий созвон: слушаешь и отвечаешь. Текст можно открыть, если понадобится."
            : "Собеседник говорит вслух, текст и подсказки рядом, когда нужны."
    }
}
