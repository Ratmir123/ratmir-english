import SwiftUI

/// «Практика»: personal drills first, then the server catalog (`GET /api/families` → `catalog`).
/// A tile opens its detail sheet; the sheet closes before the lesson starts, so the
/// conversation sheet can always present.
struct PracticeScreen: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var selected: CatalogFamily? = nil
    @State private var pendingStart: PracticeStartRequest? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    forYouSection
                    catalogContent
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 32)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
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
#if DEBUG
            .task {
                guard PreviewFixtures.screen == "practice-detail" else { return }
                try? await Task.sleep(for: .milliseconds(400))
                selected = client.catalogFamily("strategy-pitch-30") ?? client.catalog.first?.families.first
            }
#endif
        }
    }

    @ViewBuilder private var forYouSection: some View {
        let drills = client.state?.drills ?? []
        VStack(alignment: .leading, spacing: 12) {
            LiquidSectionHeader(title: "Для тебя", systemImage: "sparkles")
            if drills.isEmpty {
                LiquidCard(radius: Radius.tile, padding: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Здесь появятся тренировки из твоих созвонов: моменты, которые стоили денег, и спорные места.")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                        Button { client.requestedTab = .calls } label: {
                            Label("Загрузить созвон", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(QuietButton())
                    }
                }
            } else {
                Text("Переиграй реальные моменты — по одному за раз.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
                DrillsList(drills: drills)
            }
        }
    }

    @ViewBuilder private var catalogContent: some View {
        if client.catalog.isEmpty {
            if let message = client.catalogError {
                InlineBanner(tone: .error, title: "Каталог не загрузился", message: message, actionTitle: "Повторить",
                             action: { Task { await client.loadCatalog(force: true) } })
            } else {
                HStack(spacing: 10) {
                    ProgressView().tint(Theme.violet)
                    Text("Загружаю сценарии…").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
            }
        } else {
            ForEach(client.catalog) { section in
                CatalogSectionView(section: section) { family in selected = family }
            }
        }
    }

    private func startPending() {
        guard let request = pendingStart else { return }
        pendingStart = nil
        Task { await client.startFamily(familyId: request.familyID, mode: request.mode, topic: request.topic) }
    }
}

struct PracticeStartRequest {
    let familyID: String
    let mode: String
    let topic: String
}

private struct CatalogSectionView: View {
    let section: CatalogSection
    let onSelect: (CatalogFamily) -> Void
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                LiquidSectionHeader(title: section.title, systemImage: CatalogFamily.categorySymbol(section.id))
                if !section.description.isEmpty {
                    Text(section.description).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            ForEach(Array(section.families.enumerated()), id: \.element.id) { index, family in
                Button { onSelect(family) } label: {
                    FamilyTile(family: family, starting: client.isStarting(TrainingClient.familyKey(family.id)))
                }
                .buttonStyle(PressButton())
                .staggeredReveal(index)
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
    static func modeTitle(_ mode: String) -> String { mode == "call" ? "Созвон" : "С опорами" }
}

private struct FamilyTile: View {
    let family: CatalogFamily
    let starting: Bool
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: family.symbol).font(.title3.weight(.semibold)).foregroundStyle(Theme.onAccent)
                .frame(width: 46, height: 46)
                .background(FamilyAccent.color(family.category), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(family.title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if family.isNew {
                        Text("НОВОЕ").font(.caption2.weight(.bold)).foregroundStyle(Theme.onAccent)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Theme.lime, in: Capsule())
                    }
                }
                Text(family.description).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1)
                HStack(spacing: 10) {
                    Label("\(family.minutes) мин", systemImage: "clock")
                    Label(FamilyAccent.modeTitle(family.fixedLearningMode ? "learning" : family.preferredMode),
                          systemImage: family.preferredMode == "call" && !family.fixedLearningMode ? "phone" : "lightbulb")
                }
                .font(.caption2.weight(.medium)).foregroundStyle(Theme.inkSecondary)
            }
            Spacer(minLength: 0)
            if starting {
                ProgressView().tint(Theme.violet)
            } else {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
            }
        }
        .foregroundStyle(Theme.ink)
        .padding(14)
        .modifier(LiquidChrome(radius: Radius.tile, tint: nil, interactive: false))
        .contentShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
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
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: family.symbol).font(.title2.weight(.semibold)).foregroundStyle(Theme.onAccent)
                .frame(width: 56, height: 56)
                .background(FamilyAccent.color(family.category), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(family.title).font(TypeScale.title3).fixedSize(horizontal: false, vertical: true)
                Text("Около \(family.minutes) мин").font(.subheadline).foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    private var skills: some View {
        VStack(alignment: .leading, spacing: 8) {
            InputLabel(title: "Что тренируем")
            ChipFlow(spacing: 6) {
                ForEach(family.skills, id: \.self) { skill in
                    Text(SkillCopy.title(skill)).font(.caption.weight(.semibold))
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Theme.lavender.opacity(0.28), in: Capsule())
                }
            }
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
                    SelectionOption(id: "learning", title: "С опорами", icon: "lightbulb"),
                    SelectionOption(id: "call", title: "Созвон", icon: "phone")])
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
