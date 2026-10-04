import SwiftUI

/// Personal drills (from calls, patterns or the placement result). Due ones first, done ones last.
/// One surface, one row per drill (web: components/calls/drills-list.tsx). `grouped: false` renders
/// bare rows for a host surface (a pattern card), so cards never nest.
/// «Начать» opens the practice conversation through `TrainingClient.startDrill(id:mode:)`:
/// tier 1 starts «С опорами», tiers 2–3 start «Как на созвоне»; the other mode is in the context menu.
struct DrillsList: View {
    let drills: [PersonalDrill]
    var limit: Int? = nil
    var grouped = true
    /// Inside a pattern card the meta line starts with «Тренировка: <тип>».
    var inPattern = false
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
        VStack(alignment: .leading, spacing: 10) {
            if visible.isEmpty {
                Text("Тренировок пока нет — они появятся из разборов звонков и теста уровня.")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else if grouped {
                rows
                    .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                    .contentSurface()
            } else {
                rows
            }
            if let limit, drills.count > limit {
                Text("Ещё " + FeatureFormat.count(drills.count - limit, "тренировка", "тренировки", "тренировок") + " — на вкладке «Практика».")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(visible.enumerated()), id: \.element.id) { index, drill in
                if index > 0 { RowDivider(inset: grouped ? 16 : 0) }
                DrillCard(drill: drill, starting: startingId == drill.id, disabled: startingId != nil, inset: grouped ? 16 : 0,
                          prominent: index == 0, inPattern: inPattern) { mode in
                    start(drill, mode: mode)
                }
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

/// One drill as a row (no surface of its own): title, why, the line to replay, a meta line, one action.
struct DrillCard: View {
    let drill: PersonalDrill
    let starting: Bool
    let disabled: Bool
    var inset: CGFloat = 16
    /// Only the first drill of a list carries the filled button; the rest are secondary.
    var prominent = true
    var inPattern = false
    let onStart: (String) -> Void
    @EnvironmentObject private var client: TrainingClient
    private var lineKey: String { "drill-seed:" + drill.id }
    private var playing: Bool { client.playingModelLine == lineKey || client.loadingModelLine == lineKey }

    private var defaultMode: String { drill.tier >= 2 ? "call" : "learning" }
    private var otherMode: String { defaultMode == "call" ? "learning" : "call" }
    /// Same wording as the web's `dueLabel`: overdue drills are simply «можно сегодня».
    private var dueText: (label: String, due: Bool) {
        guard let due = FeatureFormat.date(drill.dueAt) else { return ("Когда удобно", false) }
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: Date()), to: calendar.startOfDay(for: due)).day ?? 0
        if days <= 0 { return ("Можно сегодня", true) }
        if days == 1 { return ("Завтра", false) }
        return ("Через \(days) " + FeatureFormat.plural(days, "день", "дня", "дней"), false)
    }
    private var stateText: (label: String, color: Color) {
        if drill.isDone { return ("Готово", FeaturePalette.success) }
        if drill.status == "started" { return ("Начата", FeaturePalette.violet) }
        let due = dueText
        return (due.label, due.due ? FeaturePalette.success : Color.secondary)
    }
    private var modeLine: String {
        var parts: [String] = []
        if !drill.isDone { parts.append("Режим: " + (defaultMode == "call" ? "созвон" : "с опорами")) }
        if drill.attempts > 0 { parts.append(FeatureFormat.count(drill.attempts, "попытка", "попытки", "попыток")) }
        return parts.joined(separator: " · ")
    }
    private var typeLine: String {
        var text = (inPattern ? "Тренировка: " + FeatureLabels.drillType(drill.type).lowercased() : FeatureLabels.drillType(drill.type))
        if drill.source.type == "call", let at = drill.source.at { text += ", момент " + FeatureFormat.clock(at) }
        return text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(drill.title).font(.headline).fixedSize(horizontal: false, vertical: true)
            if !drill.why.isEmpty {
                Text(drill.why).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let seed = drill.seedLine, !seed.isEmpty {
                HStack(alignment: .center, spacing: 8) {
                    FeatureQuote(text: seed)
                    Button { Task { await client.speakModelLine(seed, key: lineKey) } } label: {
                        if client.loadingModelLine == lineKey { ProgressView() } else { Image(systemName: playing ? "stop.fill" : "play.fill") }
                    }
                    .buttonStyle(SoftIconButton(size: 40))
                    .disabled(client.recording)
                    .accessibilityLabel(playing ? "Остановить реплику" : "Послушать реплику")
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 12) {
                    meta
                    Spacer(minLength: 8)
                    startButton
                }
                VStack(alignment: .leading, spacing: 10) {
                    meta
                    startButton
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, inset).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(drill.isDone ? 0.75 : 1)
    }

    private var meta: some View {
        VStack(alignment: .leading, spacing: 4) {
            (Text(stateText.label).foregroundColor(stateText.color).fontWeight(.semibold)
             + Text(" · " + typeLine).foregroundColor(.secondary))
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                TierBars(tier: drill.tier)
                Text(modeLine).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private var startButton: some View {
        if !drill.isDone {
            Button {
                onStart(defaultMode)
            } label: {
                HStack(spacing: 6) {
                    if starting { ProgressView() }
                    Text(starting ? "Готовлю…" : drill.status == "started" ? "Продолжить" : "Начать")
                }
                .padding(.horizontal, 4)
            }
            .modifier(DrillStartStyle(prominent: prominent))
            .fixedSize()
            .disabled(disabled)
            .contextMenu {
                Button(otherMode == "call" ? "Как на созвоне" : "С опорами",
                       systemImage: otherMode == "call" ? "phone" : "lightbulb") { onStart(otherMode) }
            }
            .accessibilityLabel((drill.status == "started" ? "Продолжить: " : "Начать: ") + drill.title)
            .accessibilityHint(defaultMode == "call" ? "Без подсказок, как на настоящем звонке" : "С подсказками")
            .accessibilityAction(named: Text(otherMode == "call" ? "Начать как на созвоне" : "Начать с опорами")) { onStart(otherMode) }
        }
    }
}

/// «Давление ▮▮▯»: how hard the counterpart pushes (1–3).
struct TierBars: View {
    let tier: Int
    var body: some View {
        HStack(spacing: 5) {
            Text("Давление").font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 2) {
                ForEach(1...3, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(level <= tier ? FeaturePalette.violet : FeaturePalette.track)
                        .frame(width: 5, height: 11)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Давление \(min(3, max(1, tier))) из 3")
    }
}

/// The start button of a drill row: filled for the first drill of a list, quiet for the rest.
private struct DrillStartStyle: ViewModifier {
    let prominent: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if prominent { content.buttonStyle(PrimaryButton(compact: true)) } else { content.buttonStyle(SecondaryButton(compact: true)) }
    }
}
