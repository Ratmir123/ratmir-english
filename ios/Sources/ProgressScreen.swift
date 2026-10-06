import SwiftUI

/// «Прогресс»: Обзор · Навыки · История · Награды (web: components/screens/progress-screen.tsx).
/// The overview holds the level card and the rank card; the week's rhythm is one line in the rank
/// card (the dots live on Today), so no block repeats a neighbouring screen.
struct ProgressScreen: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var segment = "overview"
    @State private var showPlacementResult = false
    @State private var showRanks = false
    private var state: TrainingState? { client.state }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // One companion per screen: in the overview's empty state it moves down into that state.
                    ScreenIntro(text: "Уровень английского меняет только тест, опыт растёт от практики.",
                                mood: hasProgress ? .proud : .sleepy,
                                showsCompanion: hasProgress || segment != "overview")
                        .entrance(0)
                    SelectionRow(selection: $segment, options: [
                        SelectionOption(id: "overview", title: "Обзор", icon: "square.grid.2x2"),
                        SelectionOption(id: "skills", title: "Навыки", icon: "chart.bar"),
                        SelectionOption(id: "history", title: "История", icon: "clock"),
                        SelectionOption(id: "rewards", title: "Награды", icon: "rosette")])
                        .entrance(1)
                    segmentContent
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 32)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
                .entranceStage()
            }
            .modifier(LiquidCanvas())
            .navigationTitle("Прогресс")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await client.refreshQuietly() }
            .navigationDestination(isPresented: $showPlacementResult) { placementResult }
            .navigationDestination(isPresented: $showRanks) { RankLadderView() }
#if DEBUG
            .task { await previewSetup() }
#endif
        }
    }

    @ViewBuilder private var segmentContent: some View {
        switch segment {
        case "skills": SkillsOverview().entrance(2)
        case "history": HistoryList().entrance(2)
        case "rewards": rewards.entrance(2)
        default: overview
        }
    }

    /// Anything to show yet: a practice with a review, experience, or a placement result.
    private var hasProgress: Bool {
        let completed = state?.progression?.completedPractice ?? state?.completed ?? 0
        let xp = state?.progression?.xp ?? state?.xp ?? 0
        return completed > 0 || xp > 0 || state?.placementSignal?.hasResult == true
    }

    /// «12 практик с разбором, 5 дней с практикой. На этой неделе — 3 из 7.»
    private var rankFacts: String {
        let completed = state?.progression?.completedPractice ?? state?.completed ?? 0
        let days = state?.progression?.practiceDays ?? 0
        let week = PracticeRhythm.lastWeek(state).filter { $0.practiced }.count
        guard completed > 0 else {
            return "Опыт растёт за каждую практику с разбором, тест уровня и разобранные созвоны. Пропуск — просто пустой день, серии не сгорают."
        }
        return RuFormat.count(completed, "практика", "практики", "практик") + " с разбором, "
            + RuFormat.count(days, "день", "дня", "дней") + " с практикой. На этой неделе — \(week) из 7."
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !hasProgress {
                FeatureEmptyState(icon: "chart.line.uptrend.xyaxis", title: "Пока тут тихо",
                                  text: "Пройди тест уровня или первое занятие с разбором — здесь появятся уровень, опыт и навыки.",
                                  mood: .sleepy)
                    .contentSurface()
                    .entrance(2)
            }
            if let placement = state?.placement, state?.placementSignal != nil {
                PlacementLevelCard(view: placement, onOpen: { openPlacement() }, onStart: { client.placementPresented = true })
                    .entrance(3)
            }
            if let progression = state?.progression {
                JourneySummary(progression: progression, facts: rankFacts)
                    .entrance(4)
            }
            if let results = state?.progression?.recentResults, let latest = results.first {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Последнее занятие").font(TypeScale.title3).accessibilityAddTraits(.isHeader).padding(.top, 4)
                    PracticeOutcomeView(result: latest)
                }
                .entrance(5)
            }
        }
    }

    private var rewards: some View {
        VStack(alignment: .leading, spacing: 16) {
            let achievements = state?.progression?.achievements ?? []
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Достижения").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                    Text("Открыто \(achievements.filter { $0.unlocked }.count) из \(achievements.count)")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                Spacer()
                Button { showRanks = true } label: {
                    HStack(spacing: 4) { Text("Все ранги"); Image(systemName: "chevron.right") }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(PressButton())
                .foregroundStyle(Theme.violet)
            }
            AchievementsList(achievements: achievements)
        }
    }

    @ViewBuilder private var placementResult: some View {
        if let placement = state?.placement {
            PlacementResultView(view: placement, onStartPractice: {
                showPlacementResult = false
                client.requestedTab = .today
            })
                .navigationTitle("Твой уровень")
                .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// A result opens the profile; anything else opens the test itself.
    private func openPlacement() {
        if state?.placementSignal?.hasResult == true { showPlacementResult = true } else { client.placementPresented = true }
    }

#if DEBUG
    private func previewSetup() async {
        guard let screen = PreviewFixtures.screen else { return }
        switch screen {
        case "skills": segment = "skills"
        case "history": segment = "history"
        case "achievements": segment = "rewards"
        case "ranks", "ranks-bottom":
            try? await Task.sleep(for: .milliseconds(300))
            showRanks = true
        case "placement-result":
            try? await Task.sleep(for: .milliseconds(300))
            showPlacementResult = true
        default: break
        }
    }
#endif
}

/// Skills grouped Английский / Разговор / Стратегия: one surface per group, one row per skill.
private struct SkillsOverview: View {
    @EnvironmentObject private var client: TrainingClient
    private var skills: [Skill] { client.state?.skills ?? [] }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Навык закрепляется, когда срабатывает самостоятельно, в новой ситуации и после паузы. Произношение по расшифровке не оцениваем.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            ForEach(SkillArea.allCases) { area in
                let ids = SkillCopy.order.filter { SkillCopy.area($0) == area }
                GroupedRows(area.title) {
                    ForEach(Array(ids.enumerated()), id: \.element) { index, id in
                        if index > 0 { RowDivider() }
                        SkillCard(id: id, skill: skills.first { $0.id == id })
                    }
                }
            }
        }
    }
}

private struct SkillCard: View {
    let id: String
    let skill: Skill?
    @EnvironmentObject private var client: TrainingClient
    @State private var missingSession = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(SkillCopy.title(id)).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    Text(SkillCopy.state(skill?.state ?? "unknown")).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if let skill, id != "clarity" {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(skill.independentSuccesses)").font(TypeScale.stat)
                        Text(successLabel(skill.independentSuccesses)).font(.caption2).foregroundStyle(Theme.inkSecondary)
                            .multilineTextAlignment(.trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if let skill {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 14) { evidence(skill) }
                    VStack(alignment: .leading, spacing: 8) { evidence(skill) }
                }
                if let checked = skill.lastChecked, let date = NativeDate.parse(checked) {
                    Text("Последняя проверка: " + RuFormat.day(date)).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                if let examples = skill.examples, !examples.isEmpty { examplesDisclosure(examples) }
            }
            if missingSession {
                Text("Этого занятия уже нет в истории.").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    @ViewBuilder private func evidence(_ skill: Skill) -> some View {
        EvidenceLabel(title: "В новой ситуации", confirmed: skill.transfer)
        EvidenceLabel(title: "После паузы", confirmed: skill.retention)
    }
    private func examplesDisclosure(_ examples: [SkillExample]) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(examples.enumerated()), id: \.offset) { _, example in
                    Button { open(example.sessionId) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(example.quote).font(.subheadline).multilineTextAlignment(.leading)
                            Text(example.reason).font(.caption).foregroundStyle(Theme.inkSecondary).multilineTextAlignment(.leading)
                            Label("Открыть свою попытку", systemImage: "chevron.right").font(.caption.weight(.semibold))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
                    }
                    .buttonStyle(PressButton())
                    .disabled(client.busy || client.recording)
                }
            }.padding(.top, 8)
        } label: { Text("На чём основана оценка · \(examples.count)").font(.footnote.weight(.semibold)) }
    }
    /// Missing sessions say so instead of silently doing nothing (L-12).
    private func open(_ sessionID: String) {
        if let source = client.state?.session(sessionID) { client.resume(source) } else { missingSession = true }
    }
    private func successLabel(_ count: Int) -> String {
        RuFormat.plural(count, "самостоятельный\nуспех", "самостоятельных\nуспеха", "самостоятельных\nуспехов")
    }
}

/// Web History's search: the query matches the lesson title or goal, ignoring case and diacritics (ё = е).
enum HistorySearch {
    static func filter(_ sessions: [Conversation], query: String) -> [Conversation] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return sessions }
        return sessions.filter { ($0.lesson.title + " " + $0.lesson.goal).localizedStandardContains(needle) }
    }
}

/// History grouped by day: one surface per day, one row per session (L-32, fix #21). The search field in the navigation
/// bar finds a lesson by title or goal (web History); «…» on each row holds «Удалить занятие» with a confirmation.
private struct HistoryList: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var pendingDelete: Conversation? = nil
    @State private var query = ""
    private var allSessions: [Conversation] {
        (client.state?.sessions ?? []).sorted { ($0.latestDate ?? .distantPast) > ($1.latestDate ?? .distantPast) }
    }
    private func groups(_ sessions: [Conversation]) -> [HistoryGroup] {
        var result: [HistoryGroup] = []
        for session in sessions {
            let title = session.latestDate.map { RuFormat.relativeDay($0) } ?? "Без даты"
            if let index = result.firstIndex(where: { $0.title == title }) {
                result[index].items.append(session)
            } else {
                result.append(HistoryGroup(title: title, items: [session]))
            }
        }
        return result
    }
    var body: some View {
        let all = allSessions
        let found = HistorySearch.filter(all, query: query)
        VStack(alignment: .leading, spacing: 18) {
            if all.isEmpty {
                LiquidCard(padding: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Пока пусто").font(.headline)
                        Text("Твоя попытка, разбор и улучшенная версия сохранятся здесь. Начни на вкладке «Сегодня» или «Практика».")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else if found.isEmpty {
                LiquidCard(padding: 18) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Ничего не нашлось").font(.headline)
                        Text("Поиск идёт по названию и цели занятия.")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                        Button("Показать всё") { query = "" }
                            .buttonStyle(QuietButton())
                    }
                }
            }
            ForEach(groups(found)) { group in
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                        .accessibilityAddTraits(.isHeader)
                    GroupedRows {
                        ForEach(Array(group.items.enumerated()), id: \.element.id) { index, session in
                            if index > 0 { RowDivider() }
                            historyRow(session)
                        }
                    }
                }
            }
            if let skipped = client.state?.skippedSessions, skipped > 0 {
                Text("Ещё \(RuFormat.count(skipped, "занятие", "занятия", "занятий")) в новом формате — обнови приложение, чтобы открыть.")
                    .font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Найти по названию или цели")
        .confirmationDialog("Удалить занятие?", isPresented: deletePresented, titleVisibility: .visible) {
            if let pendingDelete {
                Button("Удалить «\(pendingDelete.lesson.title)»", role: .destructive) {
                    let id = pendingDelete.id
                    self.pendingDelete = nil
                    Task { await client.deleteSession(id: id) }
                }
            }
            Button("Оставить", role: .cancel) { pendingDelete = nil }
        } message: { Text("Разговор, разбор и записи удалятся с сервера. Опыт за завершённое занятие пересчитается.") }
    }

    private var deletePresented: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    /// The row opens the lesson; «…» beside it holds «Удалить занятие» (also on a long press).
    private func historyRow(_ session: Conversation) -> some View {
        HStack(spacing: 0) {
            Button { client.resume(session) } label: {
                HistoryRowLabel(session: session, xp: xp(for: session), showsChevron: false)
            }
            .buttonStyle(RowButtonStyle())
            .disabled(client.busy || client.recording)
            .contextMenu { deleteButton(session) }
            Menu { deleteButton(session) } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .padding(.trailing, 6)
            .disabled(client.recording && client.conversation?.id == session.id)
            .accessibilityLabel("Действия с занятием «\(session.lesson.title)»")
        }
    }

    private func deleteButton(_ session: Conversation) -> some View {
        Button(role: .destructive) { pendingDelete = session } label: { Label("Удалить занятие", systemImage: "trash") }
    }

    private func xp(for session: Conversation) -> Int? {
        client.state?.progression?.recentResults.first { $0.sessionId == session.id }?.xp
    }
}

private struct HistoryGroup: Identifiable {
    let title: String
    var items: [Conversation]
    var id: String { title }
}

/// A finished session reads as plain text; a pill only for a state that still changes (web History, the same
/// words and tones as `sessionStatusLabel` / `sessionTone`).
private struct HistoryRowLabel: View {
    let session: Conversation
    let xp: Int?
    /// Off when the row carries its «…» menu instead.
    var showsChevron = true
    private var status: (title: String, color: Color?) {
        (SessionStatusCopy.label(session), SessionStatusCopy.tone(session))
    }
    private var meta: String {
        var parts = [ModeCopy.title(session.mode)]
        if let date = session.latestDate { parts.append(RuFormat.time(date)) }
        if status.color == nil { parts.append(status.title) }
        return parts.joined(separator: " · ")
    }
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(session.lesson.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(meta).font(.footnote).foregroundStyle(Theme.inkSecondary)
                if let color = status.color { StatusPill(title: status.title, color: color) }
            }
            Spacer(minLength: 8)
            if let xp {
                Text("+\(xp) XP").font(.footnote.weight(.bold)).foregroundStyle(Theme.limeInk).monospacedDigit()
            }
            if showsChevron {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
            }
        }
        .foregroundStyle(Theme.ink)
        .padding(.leading, 16).padding(.trailing, showsChevron ? 16 : 4).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
