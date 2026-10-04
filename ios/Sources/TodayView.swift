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

/// Today mirrors the web (components/screens/today-screen.tsx): greeting, the one task of the day on the
/// inverted ink card, status rows, «Быстрый старт» as one list, «Незаконченные занятия», then level,
/// «Над чем работаем» and the weekly rhythm. No kickers, no glass on content.
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
                    TodayHeader(completedToday: completedToday, placementFirst: placementFirst)
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 0))
                    heroSection
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 1))
                    TodayStatusRows(select: select)
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 2))
                    TodayUploadProgress()
                    TodayQuickActions(select: select, openFreeTopic: { showFreeTopic = true })
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 3))
                    TodayLaterList(heroSessionID: heroSessionID)
                        .modifier(NativeHomeEntrance(visible: entryVisible, animated: animateEntry, index: 3))
                    TodayLevelSection(select: select, openPlacementResult: { showPlacementResult = true })
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

    private var placementFirst: Bool {
        if case .placement = hero, state?.placementSignal?.hasResult != true { return true }
        return false
    }

    private var heroSessionID: String? {
        if case .resume(let id) = hero { return id }
        return nil
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
                TodayPrimaryCard(title: call.title, why: "Подтверди, кто из собеседников ты, — и разбор созвона продолжится.",
                                 facts: call.counterpart.map { [$0] } ?? []) {
                    Button { openCalls(.call(id)) } label: {
                        PrimaryActionLabel(title: "Подтвердить", icon: "person.2.fill")
                    }.buttonStyle(PrimaryButton())
                }
            }
        case .drill(let id):
            if let drill = state?.drillSignals.first(where: { $0.id == id }) { DrillHeroCard(drill: drill) }
        case .recommendation:
            if let recommendation = state?.progression?.recommendation { RecommendationHeroCard(recommendation: recommendation) }
        case .empty:
            TodayPrimaryCard(title: "Поговорим о том, что тебе интересно",
                             why: "Выбери тему — собеседник подстроится, а разбор покажет, что усилить.") {
                Button { showFreeTopic = true } label: {
                    PrimaryActionLabel(title: "Выбрать тему", icon: "sparkles")
                }.buttonStyle(PrimaryButton())
            }
        }
    }

    @ViewBuilder private var rhythmSection: some View {
        let days = PracticeRhythm.lastWeek(state)
        LiquidCard(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Ритм недели").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Text("\(days.filter { $0.practiced }.count) из 7").font(.subheadline.weight(.semibold)).monospacedDigit()
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
    let placementFirst: Bool
    @EnvironmentObject private var client: TrainingClient
    private var dateLine: String {
        let text = Date().formatted(.dateTime.weekday(.wide).day().month(.wide).locale(RuFormat.locale))
        return text.prefix(1).uppercased() + text.dropFirst()
    }
    private var tail: String {
        if placementFirst { return "начнём с теста уровня, потом всё подстроится под тебя." }
        if completedToday { return "сегодня уже потренировался, дальше — в своём темпе." }
        return "один шаг на сегодня, остальное — по желанию."
    }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Привет, \(client.state?.profile.name ?? "ты").")
                    .font(TypeScale.hero).tracking(-0.6)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(dateLine + " · " + tail)
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

// MARK: - Primary card

/// The one task of the day on the ink surface: title, why, the few facts that matter, detail, one action.
struct TodayPrimaryCard<Detail: View, Actions: View>: View {
    let title: String
    let why: String?
    let facts: [String]
    let detail: Detail
    let actions: Actions

    init(title: String, why: String?, facts: [String] = [], @ViewBuilder detail: () -> Detail, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.why = why
        self.facts = facts
        self.detail = detail()
        self.actions = actions()
    }

    var body: some View {
        InkCard {
            VStack(alignment: .leading, spacing: 14) {
                Text(title).font(TypeScale.title2).fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let why, !why.isEmpty {
                    Text(why).font(.body).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
                if !visibleFacts.isEmpty {
                    Text(visibleFacts.joined(separator: " · ")).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                detail
                actions.padding(.top, 4)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var visibleFacts: [String] { facts.filter { !$0.isEmpty } }
}

extension TodayPrimaryCard where Detail == EmptyView {
    init(title: String, why: String?, facts: [String] = [], @ViewBuilder actions: () -> Actions) {
        self.init(title: title, why: why, facts: facts, detail: { EmptyView() }, actions: actions)
    }
}

/// Primary CTA label: verb, optional leading symbol, trailing arrow.
struct PrimaryActionLabel: View {
    let title: String
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 10) {
            if let icon { Image(systemName: icon).accessibilityHidden(true) }
            Text(title)
            Spacer(minLength: 8)
            Image(systemName: "arrow.right").accessibilityHidden(true)
        }
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
    private var why: String {
        if status == "error" { return signal.error ?? "Ответы сохранены — результат можно пересчитать." }
        if signal.started {
            return "Пройдено частей: \(signal.completedSections) из \(max(signal.totalSections, signal.completedSections)). Прогресс сохранён."
        }
        return "Слушать, читать, говорить и короткий рабочий разговор. По результату подберём собеседников и тренировки."
    }
    private var facts: [String] {
        if status == "error" { return [] }
        let minutes = signal.remainingMinutes.map { "≈ " + RuFormat.minutes(max(5, $0)) } ?? "≈ 25 минут"
        return [minutes, "можно в два захода", "ответы не оцениваются по ходу"]
    }
    var body: some View {
        TodayPrimaryCard(title: title, why: why, facts: facts) {
            if signal.started && signal.totalSections > 0 {
                LiquidProgressBar(value: Double(signal.completedSections) / Double(max(1, signal.totalSections)), color: Theme.lime, height: 6)
            }
            if !signal.audioAvailable {
                Label("Голос не подключён: аудио и речь пропустим. Подключается на компьютере в настройках.", systemImage: "speaker.slash")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
        } actions: {
            Button { client.placementPresented = true } label: {
                PrimaryActionLabel(title: status == "error" ? "Открыть тест" : signal.started ? "Продолжить тест" : "Начать тест",
                                   icon: "play.fill")
            }
            .buttonStyle(PrimaryButton())
        }
    }
}

private struct ResumeHeroCard: View {
    let session: Conversation
    @EnvironmentObject private var client: TrainingClient
    private var why: String {
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
    private var facts: [String] {
        var parts = [session.mode == "call" ? "Созвон" : "С опорами"]
        if let date = session.latestDate { parts.append(RuFormat.relativeDay(date)) }
        return parts
    }
    var body: some View {
        TodayPrimaryCard(title: session.lesson.title, why: why, facts: facts) {
            Button { client.resume(session) } label: {
                PrimaryActionLabel(title: buttonTitle, icon: session.analysis != nil ? "text.badge.checkmark" : "play.fill")
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
    private var source: String {
        guard let callID = drill.sourceCallId else { return "Тренировка по твоим паттернам" }
        if let call = client.state?.callSignals.first(where: { $0.id == callID }) { return "Из созвона «" + call.title + "»" }
        return "Из твоего созвона"
    }
    var body: some View {
        TodayPrimaryCard(title: drill.title, why: drill.why, facts: [source]) {
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
    private var minutes: Int { client.state?.profile.dailyMinutes ?? 15 }
    private var facts: [String] {
        ["≈ " + RuFormat.minutes(minutes),
         recommendation.preferredMode == "call" ? "созвон: слушаешь и отвечаешь" : "с опорами: текст и подсказки рядом"]
    }
    var body: some View {
        TodayPrimaryCard(title: recommendation.title, why: recommendation.why, facts: facts) {
            Button { Task { await client.startRecommendation(recommendation) } } label: {
                StartButtonLabel(title: "Начать", starting: client.isStarting(key))
            }
            .buttonStyle(PrimaryButton())
            .disabled(client.busy || client.startingIntent != nil || client.recording)
        }
    }
}

/// Global recovery for a recording that never reached the server (L-01, P0). A status card, not the ink task.
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
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "exclamationmark.circle.fill").font(.title3).foregroundStyle(Theme.warning)
                        .accessibilityHidden(true)
                    Text(title).font(TypeScale.title3).fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                Text(detail).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                if let openable {
                    Button { client.resume(openable) } label: {
                        PrimaryActionLabel(title: "Открыть занятие")
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

/// Informational rows that never compete with the primary card: one surface, one row each.
private struct TodayStatusRows: View {
    let select: (ShellTab) -> Void
    @EnvironmentObject private var client: TrainingClient
    private var analysing: [Conversation] {
        Array((client.state?.sessions ?? []).filter { $0.status == "analysing" }.prefix(2))
    }
    private var processingCalls: [TodayCallSignal] {
        Array((client.state?.callSignals ?? []).filter { $0.isProcessing }.prefix(2))
    }
    private var placementScoring: Bool { client.state?.placementSignal?.status == "scoring" }
    var body: some View {
        if placementScoring || !analysing.isEmpty || !processingCalls.isEmpty {
            GroupedRows {
                if placementScoring {
                    Button { client.placementPresented = true } label: {
                        StatusRowLabel(title: "Тест уровня", detail: "Считаем результат — около двух минут")
                    }.buttonStyle(RowButtonStyle())
                }
                ForEach(Array(analysing.enumerated()), id: \.element.id) { index, session in
                    if index > 0 || placementScoring { RowDivider(inset: 56) }
                    Button { client.resume(session) } label: {
                        StatusRowLabel(title: session.lesson.title, detail: "Разбор готовится")
                    }.buttonStyle(RowButtonStyle())
                }
                ForEach(Array(processingCalls.enumerated()), id: \.element.id) { index, call in
                    if index > 0 || placementScoring || !analysing.isEmpty { RowDivider(inset: 56) }
                    Button { CallsNavigator.shared.open(.call(call.id)); select(.calls) } label: {
                        StatusRowLabel(title: call.title, detail: callDetail(call))
                    }.buttonStyle(RowButtonStyle())
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
    let title: String
    let detail: String
    var body: some View {
        HStack(spacing: 14) {
            ProgressView().tint(Theme.violet).frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                Text(detail).font(.footnote).foregroundStyle(Theme.inkSecondary).lineLimit(2).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// «Быстрый старт»: everything else you can start right now, as one list (no clipped chip row).
private struct TodayQuickActions: View {
    let select: (ShellTab) -> Void
    let openFreeTopic: () -> Void
    @EnvironmentObject private var client: TrainingClient
    private var pitch: CatalogFamily? { client.catalogFamily("strategy-pitch-30") }
    var body: some View {
        GroupedRows("Быстрый старт") {
            Button { select(.calls) } label: {
                ListRowLabel(icon: "square.and.arrow.up", title: "Загрузить созвон", detail: "Запись, видео или текст звонка")
            }
            .buttonStyle(RowButtonStyle())
            .accessibilityHint("Открывает вкладку «Созвоны»")
            if let pitch {
                let starting = client.isStarting(TrainingClient.familyKey(pitch.id))
                RowDivider(inset: 56)
                Button { Task { await client.startFamily(familyId: pitch.id, mode: pitch.preferredMode) } } label: {
                    ListRowLabel(icon: "megaphone", title: starting ? "Готовим…" : "Питч за 30 секунд",
                                 detail: "Кто ты и почему именно ты", showsChevron: !starting) {
                        if starting { ProgressView().tint(Theme.violet) }
                    }
                }
                .buttonStyle(RowButtonStyle())
                .disabled(client.busy || client.startingIntent != nil || client.hasUnuploadedRecording)
            }
            RowDivider(inset: 56)
            Button(action: openFreeTopic) {
                ListRowLabel(icon: "sparkles", title: "Свободная тема", detail: "Разговор о том, что интересно")
            }
            .buttonStyle(RowButtonStyle())
            .disabled(client.hasUnuploadedRecording)
        }
        .task { await client.loadCatalog() }
    }
}

/// «Незаконченные занятия»: other sessions that can be resumed (the newest one is the primary card).
private struct TodayLaterList: View {
    let heroSessionID: String?
    @EnvironmentObject private var client: TrainingClient
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var later: [Conversation] {
        (client.state?.sessions ?? []).filter { $0.isResumable && $0.id != heroSessionID }
            .sorted { ($0.latestDate ?? .distantPast) > ($1.latestDate ?? .distantPast) }
    }
    var body: some View {
        let sessions = later
        if !sessions.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Button { expanded.toggle() } label: {
                    ListRowLabel(title: "Незаконченные занятия",
                                 detail: "\(sessions.count) — можно вернуться в любой момент", showsChevron: false) {
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                            .animation(reduceMotion ? nil : NativeMotion.standard, value: expanded)
                    }
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityValue(expanded ? "Развёрнуто" : "Свёрнуто")
                if expanded {
                    ForEach(Array(sessions.prefix(8))) { session in
                        RowDivider()
                        Button { client.resume(session) } label: {
                            ListRowLabel(title: session.lesson.title,
                                         detail: Self.status(session) + (session.latestDate.map { " · " + RuFormat.relativeDay($0) } ?? ""))
                        }
                        .buttonStyle(RowButtonStyle())
                        .disabled(client.recording || client.startingIntent != nil)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .contentSurface()
        }
    }
    /// Same wording as the web's `sessionStatusLabel`.
    static func status(_ session: Conversation) -> String {
        if session.retryDeferred == true { return "Попытка на потом" }
        if session.status == "completed" { return "Завершено" }
        if session.status == "analysing" { return "Готовится разбор" }
        if session.status == "review" { return "Разбор готов" }
        if session.status == "error" { return session.analysis != nil ? "Можно повторить разбор" : "Разбор не получился" }
        return "Можно продолжить"
    }
}

/// «Уровень»: the language level from the test and the practice rank in one surface.
private struct TodayLevelSection: View {
    let select: (ShellTab) -> Void
    let openPlacementResult: () -> Void
    @EnvironmentObject private var client: TrainingClient
    private var placement: PlacementView? {
        client.state?.placementSignal?.hasResult == true ? client.state?.placement : nil
    }
    var body: some View {
        let progression = client.state?.progression
        if placement != nil || progression != nil {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Уровень").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button { select(.progress) } label: {
                        HStack(spacing: 4) { Text("Прогресс"); Image(systemName: "chevron.right") }
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressButton())
                    .foregroundStyle(Theme.violet)
                }
                if let placement {
                    PlacementLevelCard(view: placement, onOpen: openPlacementResult,
                                       onStart: { client.placementPresented = true }, embedded: true)
                }
                if let progression {
                    if placement != nil { RowDivider(inset: 0) }
                    Button { select(.progress) } label: { RankStrip(progression: progression) }
                        .buttonStyle(PressButton())
                        .accessibilityHint("Открывает вкладку «Прогресс»")
                    Text("Опыт — за практику, не за язык. Языковой уровень меняет только тест.")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentSurface()
        }
    }
}

/// «Над чем работаем»: the top two weaknesses as rows of one surface.
private struct TodayFocusSection: View {
    let select: (ShellTab) -> Void
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        let patterns = TodayPlanner.focusPatterns(client.state)
        if !patterns.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Над чем работаем").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button { openPatterns() } label: {
                        HStack(spacing: 4) { Text("Все"); Image(systemName: "chevron.right") }
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressButton())
                    .foregroundStyle(Theme.violet)
                    .accessibilityLabel("Все паттерны")
                }
                .padding(.leading, 20).padding(.trailing, 16).padding(.top, 8)
                ForEach(Array(patterns.enumerated()), id: \.element.id) { index, pattern in
                    if index > 0 { RowDivider(inset: 20) }
                    Button { openPatterns() } label: { TodayFocusRow(pattern: pattern) }
                        .buttonStyle(RowButtonStyle())
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .contentSurface()
        }
    }

    private func openPatterns() {
        CallsNavigator.shared.open(.patterns)
        select(.calls)
    }
}

private struct TodayFocusRow: View {
    let pattern: TodayPatternSignal
    private var tint: Color {
        switch pattern.status {
        case "active": return Theme.warning
        case "improving": return Theme.violet
        case "resolved": return Theme.lime
        default: return Theme.lavender
        }
    }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text(pattern.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                FocusHistoryDots(history: pattern.history)
            }
            Spacer(minLength: 8)
            StatusPill(title: pattern.statusTitle, color: tint)
        }
        .foregroundStyle(Theme.ink)
        .padding(.leading, 20).padding(.trailing, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Outcome marks, oldest first (last eight): drawn symbols whose shape carries the meaning.
struct FocusHistoryDots: View {
    let history: [String]
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(history.suffix(8).enumerated()), id: \.offset) { _, status in
                OutcomeMark(status: status)
            }
            if history.isEmpty {
                Text("Пока без истории").font(.caption).foregroundStyle(Theme.inkTertiary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
    private var accessibilityText: String {
        let repeated = history.filter { $0 == "repeated" || $0 == "new" }.count
        let avoided = history.filter { $0 == "avoided" || $0 == "improved" }.count
        return "Повторялось: \(repeated). Удалось избежать: \(avoided)."
    }
}

/// One outcome of a pattern (same marks as the web's OUTCOME_ICON, in status colour): ✕ repeated,
/// ✓ held, ◐ partly better, – no occasion. Practice outcomes draw the repeated mark outlined.
struct OutcomeMark: View {
    let status: String
    var filled = true
    var body: some View {
        Image(systemName: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Self.color(status))
            .accessibilityHidden(true)
    }
    private var symbol: String {
        switch status {
        case "repeated", "new": return filled ? "xmark.circle.fill" : "xmark.circle"
        case "avoided": return "checkmark.circle"
        case "improved": return "circle.lefthalf.filled"
        default: return "minus.circle"
        }
    }
    static func color(_ status: String) -> Color {
        switch status {
        case "repeated", "new": return Theme.danger
        case "avoided": return Theme.limeInk
        case "improved": return Theme.violet
        default: return Theme.inkTertiary
        }
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
