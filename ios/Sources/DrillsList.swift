import SwiftUI

/// Personal drills (from calls, patterns or the placement result). Due ones first, done ones last.
/// «Начать» opens the practice conversation through `TrainingClient.startDrill(id:mode:)`:
/// tier 1 starts «С опорами», tiers 2–3 start «Как на созвоне»; the other mode is in the context menu.
struct DrillsList: View {
    let drills: [PersonalDrill]
    var limit: Int? = nil
    @EnvironmentObject private var client: TrainingClient
    @State private var startingId: String?

    private var sorted: [PersonalDrill] {
        drills.sorted { left, right in
            if left.isDone != right.isDone { return !left.isDone }
            let leftDue = FeatureFormat.date(left.dueAt) ?? .distantFuture
            let rightDue = FeatureFormat.date(right.dueAt) ?? .distantFuture
            if leftDue != rightDue { return leftDue < rightDue }
            return left.createdAt > right.createdAt
        }
    }
    private var visible: [PersonalDrill] {
        guard let limit else { return sorted }
        return Array(sorted.prefix(max(0, limit)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if visible.isEmpty {
                FeatureEmptyState(icon: "figure.run", title: "Тренировок пока нет",
                                  text: "Они появятся после разбора звонка: из моментов, которые стоили денег, и спорных мест.")
            }
            ForEach(visible) { drill in
                DrillCard(drill: drill, starting: startingId == drill.id, disabled: startingId != nil) { mode in
                    start(drill, mode: mode)
                }
            }
            if let limit, drills.count > limit {
                Text("Ещё " + FeatureFormat.count(drills.count - limit, "тренировка", "тренировки", "тренировок") + " — на вкладке «Практика».")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func start(_ drill: PersonalDrill, mode: String) {
        guard startingId == nil else { return }
        startingId = drill.id
        Task {
            await client.startDrill(id: drill.id, mode: mode)
            startingId = nil
        }
    }
}

struct DrillCard: View {
    let drill: PersonalDrill
    let starting: Bool
    let disabled: Bool
    let onStart: (String) -> Void

    private var defaultMode: String { drill.tier >= 2 ? "call" : "learning" }
    private var otherMode: String { defaultMode == "call" ? "learning" : "call" }
    private var dueText: String? {
        guard !drill.isDone, let due = FeatureFormat.date(drill.dueAt) else { return nil }
        if due <= Date() || Calendar.current.isDateInToday(due) { return "на сегодня" }
        return "с " + (FeatureFormat.shortDate(drill.dueAt) ?? "")
    }
    private var statusText: String {
        switch drill.status {
        case "done": return "Готово"
        case "started": return "Начата"
        default: return "Новая"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if !drill.why.isEmpty {
                Text(drill.why).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let seed = drill.seedLine, !seed.isEmpty {
                FeatureQuote(text: seed)
            }
            if !drill.goal.isEmpty {
                Label(drill.goal, systemImage: "target")
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !drill.successCriteria.isEmpty || !drill.mustAvoid.isEmpty {
                criteria
            }
            footer
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .featureGlass(radius: 24)
        .opacity(drill.isDone ? 0.75 : 1)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: FeatureLabels.drillTypeIcon(drill.type))
                .font(.body.weight(.semibold))
                .foregroundStyle(FeaturePalette.violet)
                .frame(width: 40, height: 40)
                .background(FeaturePalette.lavender.opacity(0.35), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(FeatureLabels.drillType(drill.type)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(drill.title).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            FeatureChip(text: statusText, icon: drill.isDone ? "checkmark" : nil,
                        tint: drill.isDone ? FeaturePalette.lime : FeaturePalette.lavender)
        }
    }

    private var criteria: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(drill.successCriteria, id: \.self) { item in
                    Label(item, systemImage: "checkmark.circle").font(.footnote).fixedSize(horizontal: false, vertical: true)
                }
                if !drill.mustAvoid.isEmpty {
                    Text("Не говорить: " + drill.mustAvoid.map { "«" + $0 + "»" }.joined(separator: ", "))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 6)
        } label: {
            Text("Что засчитаем").font(.footnote.weight(.semibold))
        }
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Нажим \(drill.tier) из 3").font(.caption.weight(.semibold))
                if let dueText {
                    Text(dueText).font(.caption).foregroundStyle(.secondary)
                } else if drill.attempts > 0 {
                    Text("Попыток: \(drill.attempts)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if !drill.isDone {
                Button {
                    onStart(defaultMode)
                } label: {
                    HStack(spacing: 6) {
                        if starting { ProgressView() }
                        Text(starting ? "Готовлю…" : drill.status == "started" ? "Продолжить" : "Начать")
                    }
                    .padding(.horizontal, 6)
                }
                .buttonStyle(PrimaryButton())
                .fixedSize()
                .disabled(disabled)
                .contextMenu {
                    Button(otherMode == "call" ? "Как на созвоне" : "С опорами",
                           systemImage: otherMode == "call" ? "phone" : "lightbulb") { onStart(otherMode) }
                }
                .accessibilityHint(defaultMode == "call" ? "Без подсказок, как на настоящем звонке" : "С подсказками")
                .accessibilityAction(named: Text(otherMode == "call" ? "Начать как на созвоне" : "Начать с опорами")) { onStart(otherMode) }
            }
        }
    }
}
