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
            VStack(alignment: .leading, spacing: 4) {
                Text("Для тебя").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                Text(drills.isEmpty ? "Тренировки из твоих созвонов: моменты, которые стоили денег, и спорные места."
                                    : "Переиграй реальные моменты — по одному за раз.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            if drills.isEmpty {
                GroupedRows {
                    Button { client.requestedTab = .calls } label: {
                        ListRowLabel(icon: "square.and.arrow.up", title: "Загрузить созвон",
                                     detail: "После разбора здесь появятся тренировки из твоих моментов")
                    }
                    .buttonStyle(RowButtonStyle())
                }
            } else {
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
                    if index > 0 { RowDivider(inset: 56) }
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
    static func modeTitle(_ mode: String) -> String { mode == "call" ? "Созвон" : "С опорами" }
}

/// A scenario row: stroke icon in the text colour, title, one-line description and a meta line.
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
            Image(systemName: family.symbol).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                .frame(width: 26).accessibilityHidden(true)
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
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
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
