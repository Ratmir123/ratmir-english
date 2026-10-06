import SwiftUI

// MARK: - Decision order (DESIGN-SYSTEM §3 Today)

/// Exactly one primary card: pending recording → placement test → unfinished session or review →
/// a retake in progress → call waiting for the speaker → personal drill → the server's plan.
/// The same rules as the web (components/app/today-plan.ts, MOTION-PASS 0.5.2 §8.1).
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
    static func hero(state: TrainingState?, hasPendingRecording: Bool, now: Date = Date()) -> TodayHero {
        if hasPendingRecording { return .pendingRecording }
        guard let state else { return .empty }
        if let placement = state.placementSignal, !placement.hasResult, placement.status != "scoring" {
            return .placement(status: placement.status)
        }
        if let session = resumableSession(state, now: now) { return .resume(sessionID: session.id) }
        if let placement = state.placementSignal, placement.hasResult, placement.status == "in-progress" {
            return .placement(status: placement.status)
        }
        if let call = state.callSignals.first(where: { $0.status == "needs-speaker" }) { return .confirmSpeaker(callID: call.id) }
        if let drill = pendingDrill(state, now: now) { return .drill(id: drill.id) }
        if state.progression?.recommendation != nil { return .recommendation }
        return .empty
    }

    /// Today's «Продолжить»: the newest unfinished lesson touched within 72 h. A retry parked with «Отложить попытку»
    /// never comes back as today's step; older lessons stay in «Незаконченные». A lesson being analysed is a
    /// status row instead.
    static func resumableSession(_ state: TrainingState, now: Date = Date()) -> Conversation? {
        let candidates = state.sessions.filter { $0.isInProgress && $0.status != "analysing" && $0.isFresh(now: now) }
        return candidates.max { ($0.latestDate ?? .distantPast) < ($1.latestDate ?? .distantPast) }
    }

    /// The next drill not already open as a session, in the one shared order (`DrillOrder`, web `pendingDrills`):
    /// due first, then the newest call, then the newest drill.
    static func pendingDrill(_ state: TrainingState, now: Date = Date()) -> TodayDrillSignal? {
        let open = Set(state.sessions.filter { $0.isResumable }.map(\.id))
        let candidates = state.drillSignals.filter { drill in
            guard drill.status != "done" else { return false }
            if let id = drill.sessionId, open.contains(id) { return false }
            return true
        }
        var order: [String: Int] = [:]
        for (index, drill) in DrillOrder.pending(state, now: now).enumerated() where order[drill.id] == nil {
            order[drill.id] = index
        }
        return candidates.min { (order[$0.id] ?? Int.max) < (order[$1.id] ?? Int.max) }
    }

    /// «Незаконченные занятия»: everything unfinished that is not today's card, parked retries and older lessons
    /// included, newest first.
    static func laterSessions(_ state: TrainingState?, heroSessionID: String?) -> [Conversation] {
        (state?.sessions ?? []).filter { $0.isResumable && !$0.isBaseline && $0.id != heroSessionID }
            .sorted { ($0.latestDate ?? .distantPast) > ($1.latestDate ?? .distantPast) }
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
                let today = Calendar.current.isDateInToday(day.date)
                VStack(spacing: 6) {
                    Circle()
                        .fill(day.practiced ? Theme.lime : Theme.ink.opacity(0.08))
                        .frame(width: 24, height: 24)
                        .padding(3)
                        .overlay { if today { Circle().strokeBorder(Theme.violet, lineWidth: 2) } }
                    Text(RuFormat.weekday(day.date)).font(.caption.weight(today ? .semibold : .regular))
                        .foregroundStyle(today ? Theme.ink : Theme.inkSecondary)
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
    /// False while the launch greeting covers Home; the staircase starts with its hand-off.
    var entryVisible = true
    /// False when the learner skipped the greeting: Home appears at once.
    var animateEntry = true
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showFreeTopic = false
    @State private var pendingFree: FreeTopicRequest? = nil
    @State private var showPlacementResult = false
    /// «Убрать» on an unfinished lesson: hidden at once, deleted only when «Вернуть» was not tapped in time.
    @State private var removal: SessionRemoval? = nil
    @State private var removedIDs: Set<String> = []
    @State private var removalTimer: Task<Void, Never>? = nil

    private var state: TrainingState? { client.state }
    private var hero: TodayHero { TodayPlanner.hero(state: state, hasPendingRecording: client.hasUnuploadedRecording) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    TodayHeader(completedToday: completedToday, placementFirst: placementFirst, mood: heroMood)
                        .entrance(0)
                    // PASS-0.5.3 §2: a limit notice (subscription or voice) under the header; a tap opens Profile there.
                    TodayLimitBanner(select: select)
                        .entrance(1)
                    heroSection
                        .entrance(1)
                    // PASS-0.5.3 §1.6: «Мои фразы · N ждут повторения» → «Повторить» under the primary card (hidden when none wait).
                    TodayPhrasesRow()
                        .entrance(2)
                    TodayStatusRows(select: select)
                        .entrance(2)
                    TodayUploadProgress()
                        .entrance(2)
                    TodayQuickActions(openFreeTopic: { showFreeTopic = true })
                        .entrance(3)
                    TodayLaterList(heroSessionID: heroSessionID, hidden: hiddenSessionIDs, remove: remove)
                        .entrance(4)
                    TodayLevelSection(select: select, openPlacementResult: { showPlacementResult = true })
                        .entrance(5)
                    TodayFocusSection(select: select)
                        .entrance(6)
                    rhythmSection
                        .entrance(7)
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 32)
                .frame(maxWidth: 640).frame(maxWidth: .infinity)
                .entranceStage(ready: entryVisible, animated: animateEntry)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { removalCapsule }
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

    /// MOTION-PASS 0.5.2 §3: the test ahead → curious; a drill or the plan ready → determined; a review ready →
    /// excited; trained today → proud; otherwise happy.
    private var heroMood: VoiceOrbMood {
        switch hero {
        case .placement:
            return .curious
        case .drill, .recommendation:
            return .determined
        case .resume(let id):
            if state?.session(id)?.status == "review" { return .excited }
        default:
            break
        }
        return completedToday ? .proud : .happy
    }

    private var hiddenSessionIDs: Set<String> {
        var ids = removedIDs
        if let removal { ids.insert(removal.id) }
        return ids
    }

    @ViewBuilder private var removalCapsule: some View {
        if removal != nil {
            SessionRemovedCapsule(undo: undoRemoval)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// «Убрать» (MOTION-PASS 0.5.2 §8.4): the row disappears at once, «Занятие убрано · Вернуть» stays ≈ 6 s, and only
    /// then DELETE /api/sessions/:id goes out. A second «Убрать» meanwhile confirms the first one right away.
    private func remove(_ session: Conversation) {
        removalTimer?.cancel()
        if let pending = removal { commitRemoval(pending) }
        let item = SessionRemoval(id: session.id, title: session.lesson.title)
        withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard) { removal = item }
        removalTimer = Task {
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            commitRemoval(item)
        }
    }

    private func undoRemoval() {
        removalTimer?.cancel()
        removalTimer = nil
        withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard) { removal = nil }
    }

    private func commitRemoval(_ item: SessionRemoval) {
        removedIDs.insert(item.id)
        if removal?.id == item.id {
            withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.exit) { removal = nil }
        }
        Task {
            // A failed delete (offline, busy) brings the row back; the server's state stays the truth.
            let deleted = await client.deleteSession(id: item.id)
            if !deleted { removedIDs.remove(item.id) }
        }
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
                        PrimaryActionLabel(title: "Выбрать, кто я", icon: "person.2.fill")
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
        let active = days.filter { $0.practiced }.count
        LiquidCard(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Ритм недели").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                RhythmDots(days: days)
                Text(active > 0 ? RuFormat.count(active, "день", "дня", "дней") + " из 7 с практикой. Пропуск — просто пустой день."
                                : "Первая практика появится здесь точкой. Без серий и штрафов.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
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
    /// The companion's mood follows Today's one task (MOTION-PASS 0.5.2 §3).
    let mood: VoiceOrbMood
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
        // Large accessibility text gets the full width: the companion moves above the greeting
        // instead of squeezing the words into a narrow column.
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    orb.frame(width: 80, height: 80)
                    copy
                }
            } else {
                HStack(alignment: .center, spacing: 12) {
                    copy
                    Spacer(minLength: 0)
                    orb.frame(width: 104, height: 104)
                }
            }
        }
        .padding(.top, 12)
    }

    private var copy: some View {
        VStack(alignment: .leading, spacing: 6) {
            // The web Today heading: the time of day and the name, never a placeholder name («Доброе утро, …»).
            Text(OpeningGreeting.dayGreeting(name: client.state?.profile.name))
                .font(TypeScale.hero).tracking(-0.6)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(dateLine + " · " + tail)
                .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var orb: some View {
        VoiceOrb(mode: .ready, level: 0, mood: mood, statusDescription: "Твой собеседник")
    }
}

/// An unfinished lesson removed from Today, still within its «Вернуть» window.
private struct SessionRemoval: Equatable {
    let id: String
    let title: String
}

/// «Занятие убрано · Вернуть»: floating chrome above the tab bar while the delete can still be undone.
private struct SessionRemovedCapsule: View {
    let undo: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle").font(.body.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                .accessibilityHidden(true)
            Text("Занятие убрано").font(.footnote.weight(.semibold))
            Spacer(minLength: 8)
            Button("Вернуть", action: undo)
                .buttonStyle(QuietButton())
                .accessibilityHint("Возвращает занятие в список")
        }
        .foregroundStyle(Theme.ink)
        .padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 6)
        .frame(maxWidth: 560)
        .modifier(LiquidChrome(radius: 28, tint: nil, interactive: false))
        .accessibilityElement(children: .contain)
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
                Label("Голос не подключён: аудио и речь пропустим. Голос подключается на компьютере: Профиль → Голос.", systemImage: "speaker.slash")
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
        var parts = [ModeCopy.title(session.mode)]
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

/// Today's drill (§8.6): «Переиграть момент» starts the default mode, the small «или …» under it starts the other one,
/// in the same words as the Practice tiles and the drill rows.
private struct DrillHeroCard: View {
    let drill: TodayDrillSignal
    @EnvironmentObject private var client: TrainingClient
    private var starting: Bool { client.isStarting(TrainingClient.drillKey(drill.id)) }
    private var blocked: Bool { client.busy || client.startingIntent != nil || client.recording }
    /// The full drill knows its type: a written follow-up always runs with supports and has no second mode.
    private var personal: PersonalDrill? { client.state?.drills?.first(where: { $0.id == drill.id }) }
    private var mode: String { personal.map(DrillOrder.startMode) ?? drill.preferredMode }
    private var otherMode: String? {
        if let personal { return DrillOrder.otherMode(personal) }
        return drill.preferredMode == "call" ? "learning" : "call"
    }
    private var source: String {
        guard let callID = drill.sourceCallId else { return "Тренировка по твоим паттернам" }
        if let call = client.state?.callSignals.first(where: { $0.id == callID }) { return "Из созвона «" + call.title + "»" }
        return "Из твоего созвона"
    }
    /// The same facts as the web card: where it comes from, about how long, and what the button starts.
    private var facts: [String] {
        var parts = [source]
        if let personal {
            parts.append("~\(PracticeForYouPlan.tile(personal, daily: client.state?.profile.dailyMinutes ?? 15).minutes) мин")
        }
        parts.append(otherMode == nil ? "Текст" : ModeCopy.title(mode))
        return parts
    }
    private var goal: String { personal?.goal.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
    var body: some View {
        TodayPrimaryCard(title: drill.title, why: drill.why, facts: facts) {
            if !goal.isEmpty {
                (Text("Цель: ").fontWeight(.semibold) + Text(goal))
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } actions: {
            VStack(spacing: 4) {
                Button { start(mode) } label: {
                    StartButtonLabel(title: "Переиграть момент", starting: starting)
                }
                .buttonStyle(PrimaryButton())
                .disabled(blocked)
                .accessibilityHint(ModeCopy.title(mode) + ". " + ModeCopy.explanation(mode))
                if let otherMode {
                    Button { start(otherMode) } label: {
                        Text("или " + ModeCopy.title(otherMode).lowercased())
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressButton())
                    .foregroundStyle(Theme.violet)
                    .disabled(blocked)
                    .accessibilityLabel("Переиграть момент " + ModeCopy.title(otherMode).lowercased())
                    .accessibilityHint(ModeCopy.explanation(otherMode))
                }
            }
        }
    }

    private func start(_ mode: String) {
        Task { await client.startDrill(id: drill.id, mode: mode) }
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
         ModeCopy.title(recommendation.preferredMode)]
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
/// «Загрузить созвон» opens the file picker with one tap (the same flow as the upload card in «Созвоны»); the upload
/// then runs in the progress card above.
private struct TodayQuickActions: View {
    let openFreeTopic: () -> Void
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var uploads: CallUploadCenter
    @State private var importing = false
    @State private var pickError: String?
    private var pitch: CatalogFamily? { client.catalogFamily("strategy-pitch-30") }

    init(openFreeTopic: @escaping () -> Void) {
        self.openFreeTopic = openFreeTopic
        _uploads = ObservedObject(wrappedValue: CallUploadCenter.shared)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            rows
            if let pickError {
                FeatureBanner(message: pickError, onDismiss: { self.pickError = nil })
            }
        }
        .callFileImport(isPresented: $importing, error: $pickError, client: client)
        .task { await client.loadCatalog() }
    }

    private var rows: some View {
        GroupedRows("Быстрый старт") {
            Button { importing = true } label: {
                ListRowLabel(icon: "square.and.arrow.up", title: "Загрузить созвон",
                             detail: uploads.isActive ? "Сначала дождись текущей загрузки" : "Запись, видео или текст звонка")
            }
            .buttonStyle(RowButtonStyle())
            .disabled(uploads.isActive)
            .accessibilityHint("Открывает выбор файла")
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
                ListRowLabel(icon: "sparkles", title: "Своя тема", detail: "Разговор о том, что интересно")
            }
            .buttonStyle(RowButtonStyle())
            .disabled(client.hasUnuploadedRecording)
        }
    }
}

/// «Незаконченные занятия»: every unfinished lesson that is not today's card (parked retries and lessons older than
/// 72 h included), newest first. Each row has «Убрать»; the undo window lives in TodayScreen.
private struct TodayLaterList: View {
    let heroSessionID: String?
    var hidden: Set<String> = []
    var remove: (Conversation) -> Void = { _ in }
    @EnvironmentObject private var client: TrainingClient
    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var later: [Conversation] {
        TodayPlanner.laterSessions(client.state, heroSessionID: heroSessionID).filter { !hidden.contains($0.id) }
    }
    var body: some View {
        let sessions = later
        if !sessions.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard) { expanded.toggle() }
                } label: {
                    ListRowLabel(title: "Незаконченные занятия",
                                 detail: "\(sessions.count) — можно вернуться в любой момент", showsChevron: false) {
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                    }
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityValue(expanded ? "Развёрнуто" : "Свёрнуто")
                if expanded {
                    ForEach(Array(sessions.prefix(8))) { session in
                        VStack(spacing: 0) {
                            RowDivider()
                            row(session)
                        }
                        .transition(reduceMotion ? AnyTransition.opacity : NativeMotion.insertion)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .contentSurface()
        }
    }

    private func row(_ session: Conversation) -> some View {
        HStack(spacing: 0) {
            Button { client.resume(session) } label: {
                ListRowLabel(title: session.lesson.title,
                             detail: SessionStatusCopy.label(session) + (session.latestDate.map { " · " + RuFormat.relativeDay($0) } ?? ""),
                             showsChevron: false)
            }
            .buttonStyle(RowButtonStyle())
            .disabled(client.recording || client.startingIntent != nil)
            Button("Убрать") { remove(session) }
                .buttonStyle(QuietButton())
                .padding(.trailing, 12)
                .disabled(client.recording && client.conversation?.id == session.id)
                .accessibilityLabel("Убрать «\(session.lesson.title)»")
        }
        .contextMenu {
            Button("Убрать", systemImage: "minus.circle", role: .destructive) { remove(session) }
        }
    }
}

/// Session status words, identical to the web `sessionStatusLabel` / `sessionTone` (components/app/labels.ts).
enum SessionStatusCopy {
    static func label(_ session: Conversation) -> String {
        if session.retryDeferred == true { return "Попытка на потом" }
        if session.status == "completed" { return "Завершено" }
        if session.status == "analysing" { return "Готовится разбор" }
        if session.status == "review" { return "Разбор готов" }
        if session.status == "error" { return session.analysis != nil ? "Можно повторить разбор" : "Разбор не получился" }
        return "Можно продолжить"
    }

    /// A pill colour only for a state that still changes; nil reads as plain text in the meta line.
    static func tone(_ session: Conversation) -> Color? {
        if session.status == "review" && session.retryDeferred != true { return Theme.lime }
        if session.status == "analysing" { return Theme.cyan }
        if session.status == "error" { return Theme.warning }
        if session.status == "active" { return Theme.violet }
        return nil
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
                    // PASS 0.5.3 §8: the medal itself spins (it is not inside a button); its text side opens Progress.
                    RankStrip(progression: progression, open: { select(.progress) })
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

/// «Своя тема»: context, mode and an optional topic. The sheet closes before the lesson starts.
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
                            SelectionOption(id: "learning", title: ModeCopy.title("learning"), icon: "lightbulb"),
                            SelectionOption(id: "call", title: ModeCopy.title("call"), icon: "phone")])
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
            .navigationTitle("Своя тема")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { SheetCloseButton { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// Practice mode names and hints, equal to the web `MODE_LABEL` / `MODE_HINT` (MOTION-PASS 0.5.2 §8).
/// «Созвон» alone is reserved for real calls (the «Созвоны» tab); partner text is hidden in both modes (§6),
/// so the hints speak only of support and pressure.
enum ModeCopy {
    static func title(_ mode: String) -> String {
        mode == "call" ? "Как на созвоне" : "С опорами"
    }
    static func explanation(_ mode: String) -> String {
        mode == "call"
            ? "Без подсказок и поблажек, в темпе настоящего созвона."
            : "Подсказки под рукой, собеседник говорит проще — удобно пробовать новое."
    }
}
