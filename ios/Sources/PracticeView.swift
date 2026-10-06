import SwiftUI

/// «Практика» (MOTION-PASS-0.5.2 §7–§8): the intro with the live companion and «Своя тема», «Для тебя»
/// (PracticeForYou.swift: plan and drill tiles, pattern rows, «Все тренировки · N»), then the server catalog
/// (`GET /api/families` → `catalog`). A sheet closes before its lesson starts, so the conversation sheet can always
/// present. The blocks rise «лесенкой» the first time the tab appears (§2).
struct PracticeScreen: View {
    /// The same lede the web shows under «Практика».
    static let lede = "Выбери ситуацию — задачу и сложность подберёт Sol по твоим последним попыткам."
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selected: CatalogFamily? = nil
    @State private var pendingStart: PracticeStartRequest? = nil
    @State private var showFreeTopic = false
    @State private var pendingFree: FreeTopicRequest? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    intro.entrance(0)
                    PracticeForYou(onOpenFamily: { family in selected = family }).entrance(1)
                    catalogContent
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 32)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
                .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.reveal, value: client.catalog.isEmpty)
                .entranceStage()
            }
            .modifier(LiquidCanvas())
            .navigationTitle("Практика")
            .navigationBarTitleDisplayMode(.large)
            .refreshable {
                await client.loadCatalog(force: true)
                await client.refreshQuietly()
            }
            .task { await client.loadCatalog() }
            .sheet(item: $selected, onDismiss: startPending) { family in
                FamilyDetailSheet(family: family) { mode, topic in
                    pendingStart = PracticeStartRequest(familyID: family.id, mode: mode, topic: topic)
                    selected = nil
                }
                .environmentObject(client)
            }
            .sheet(isPresented: $showFreeTopic, onDismiss: startPendingFreeTopic) {
                FreeTopicSheet { request in
                    pendingFree = request
                    showFreeTopic = false
                }
                .environmentObject(client)
            }
#if DEBUG
            .task {
                guard PreviewFixtures.screen == "practice-detail" else { return }
                try? await Task.sleep(for: .milliseconds(400))
                selected = client.catalogFamily("strategy-pitch-30") ?? client.catalog.first?.families.first
            }
#endif
        }
    }

    /// Header companion (§3): determined while drills wait. With nothing pending the «Для тебя» empty line holds the
    /// (curious) companion instead — one companion per screen, as on the web.
    private var hasPendingDrills: Bool { client.state?.drills?.contains(where: { !$0.isDone }) == true }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScreenIntro(text: Self.lede, mood: hasPendingDrills ? .determined : .curious, showsCompanion: hasPendingDrills)
            Button { showFreeTopic = true } label: {
                Label("Своя тема", systemImage: "sparkles")
            }
            .buttonStyle(QuietButton())
            .disabled(client.hasUnuploadedRecording)
            .accessibilityHint("Разговор на тему, которую выберешь сам")
        }
    }

    @ViewBuilder private var catalogContent: some View {
        if client.catalog.isEmpty {
            if let message = client.catalogError {
                InlineBanner(tone: .error, title: "Каталог не загрузился", message: message, actionTitle: "Повторить",
                             action: { Task { await client.loadCatalog(force: true) } })
                    .entrance(2)
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.violet)
                    Text("Загружаю сценарии…").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
                .entrance(2)
            }
        } else {
            // Sections on screen at the first appearance join the staircase; a catalog that arrives later rises in.
            ForEach(Array(client.catalog.enumerated()), id: \.element.id) { index, section in
                CatalogSectionView(section: section) { family in selected = family }
                    .entrance(2 + index)
                    .transition(reduceMotion ? AnyTransition.opacity : NativeMotion.insertion)
            }
        }
    }

    private func startPending() {
        guard let request = pendingStart else { return }
        pendingStart = nil
        Task { await client.startFamily(familyId: request.familyID, mode: request.mode, topic: request.topic) }
    }

    private func startPendingFreeTopic() {
        guard let request = pendingFree else { return }
        pendingFree = nil
        Task { await client.startFree(mode: request.mode, context: request.context, topic: request.topic) }
    }
}

struct PracticeStartRequest {
    let familyID: String
    let mode: String
    let topic: String
}

/// One catalog group: a title, its description and one surface of scenario rows.
private struct CatalogSectionView: View {
    let section: CatalogSection
    let onSelect: (CatalogFamily) -> Void
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(section.title).font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                if !section.description.isEmpty {
                    Text(section.description).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            GroupedRows {
                ForEach(Array(section.families.enumerated()), id: \.element.id) { index, family in
                    if index > 0 { RowDivider(inset: 74) }
                    Button { onSelect(family) } label: {
                        FamilyTile(family: family, starting: client.isStarting(TrainingClient.familyKey(family.id)))
                    }
                    .buttonStyle(RowButtonStyle())
                }
            }
        }
    }
}

enum FamilyAccent {
    static func color(_ category: String) -> Color {
        switch category {
        case "strategy": return Theme.lime
        case "work": return Theme.lavender
        case "relocation": return Theme.pink
        case "ielts": return Theme.lavender
        default: return Theme.cyan
        }
    }
    /// Mode names (MOTION-PASS-0.5.2 §8): «Созвон» alone clashed with the «Созвоны» tab of real calls.
    static func modeTitle(_ mode: String) -> String { mode == "call" ? "Как на созвоне" : "С опорами" }
}

/// A scenario row: artwork, title, description and a meta line.
private struct FamilyTile: View {
    let family: CatalogFamily
    let starting: Bool
    private var meta: String {
        var parts = ["\(family.minutes) мин", FamilyAccent.modeTitle(family.fixedLearningMode ? "learning" : family.preferredMode)]
        if family.isNew { parts.append("новое") }
        return parts.joined(separator: " · ")
    }
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ScenarioArtwork(familyID: family.id, symbol: family.symbol)
            VStack(alignment: .leading, spacing: 3) {
                Text(family.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if !family.description.isEmpty {
                    Text(family.description).font(.footnote).foregroundStyle(Theme.inkSecondary).lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Text(meta).font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            Spacer(minLength: 8)
            if starting {
                ProgressView().tint(Theme.violet)
            } else {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
            }
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Открывает описание и запуск")
    }
}

/// Goal, skills, mode («С опорами / Созвон») and an optional topic, then «Начать».
struct FamilyDetailSheet: View {
    let family: CatalogFamily
    let onStart: (String, String) -> Void
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    @State private var mode: String
    @State private var topic = ""

    init(family: CatalogFamily, onStart: @escaping (String, String) -> Void) {
        self.family = family
        self.onStart = onStart
        _mode = State(initialValue: family.fixedLearningMode ? "learning" : family.preferredMode)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    Text(family.goal ?? family.description).font(.body).fixedSize(horizontal: false, vertical: true)
                    if !family.skills.isEmpty { skills }
                    modeSection
                    topicSection
                    startButton
                }
                .padding(20)
            }
            .modifier(LiquidCanvas(intensity: 0.6))
            .navigationTitle(family.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { SheetCloseButton { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(family.title).font(TypeScale.title2).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("Около \(family.minutes) мин" + (family.isNew ? " · новое" : "")).font(.subheadline).foregroundStyle(Theme.inkSecondary)
        }
    }

    private var skills: some View {
        VStack(alignment: .leading, spacing: 8) {
            InputLabel(title: "Что тренируем")
            Text(family.skills.map(SkillCopy.title).joined(separator: " · "))
                .font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var modeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            InputLabel(title: "Как тренируемся")
            if family.fixedLearningMode {
                Text("Чтение и письмо идут с опорами: текст всё время рядом.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
            } else {
                SelectionRow(selection: $mode, options: [
                    SelectionOption(id: "learning", title: FamilyAccent.modeTitle("learning"), icon: "lightbulb"),
                    SelectionOption(id: "call", title: FamilyAccent.modeTitle("call"), icon: "phone")])
                Text(ModeCopy.explanation(mode)).font(.footnote).foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var topicSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            InputLabel(title: "Тема (необязательно)")
            TextField("Например: проект для бренда кроссовок", text: $topic, axis: .vertical)
                .lineLimit(1...3).padding(14)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                .onChange(of: topic) { _, value in if value.count > 300 { topic = String(value.prefix(300)) } }
        }
    }

    @ViewBuilder private var startButton: some View {
        Button { onStart(mode, topic) } label: {
            HStack { Text("Начать"); Spacer(); Image(systemName: "arrow.right") }
        }
        .buttonStyle(PrimaryButton())
        .disabled(client.hasUnuploadedRecording || client.busy || client.startingIntent != nil)
        if client.hasUnuploadedRecording {
            Text(TrainingClient.pendingRecordingGuidance).font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
    }
}
