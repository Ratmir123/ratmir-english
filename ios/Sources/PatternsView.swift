import SwiftUI

/// «Мои паттерны»: weaknesses first by cost, history dots per call (● повторилось ○ удержал ·
/// не было повода ◐ лучше), rounds «Реальные 0–1 · Тренировки 3–1», evidence and related drills.
/// `embedded: true` renders without its own scroll view and backdrop (for a host screen).
struct PatternsView: View {
    let patterns: [CommunicationPattern]
    let drills: [PersonalDrill]
    var embedded: Bool = false
    @EnvironmentObject private var client: TrainingClient
    @State private var overrides: [CommunicationPattern]?
    @State private var busy: Set<String> = []
    @State private var error: String?

    private var current: [CommunicationPattern] { overrides ?? patterns }
    private var signature: String { patterns.map { $0.id + $0.status + String($0.dismissed) + String($0.userConfirmed) }.joined() }
    /// Most expensive first; resolved ones sink to the end.
    private var weaknesses: [CommunicationPattern] {
        current.filter { $0.isWeakness && !$0.dismissed }.sorted { left, right in
            let leftResolved = left.status == "resolved", rightResolved = right.status == "resolved"
            if leftResolved != rightResolved { return !leftResolved }
            if left.costRank != right.costRank { return left.costRank < right.costRank }
            return Self.statusOrder(left.status) < Self.statusOrder(right.status)
        }
    }
    private var strengths: [CommunicationPattern] { current.filter { !$0.isWeakness && !$0.dismissed } }
    private var hidden: [CommunicationPattern] { current.filter { $0.dismissed } }

    var body: some View {
        if embedded {
            content
        } else {
            ScrollView {
                content
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
            }
            .background { FeatureBackdrop() }
            .navigationTitle("Мои паттерны")
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !embedded {
                Text("Что повторяется в твоих звонках и что уже получается. Точки — по звонкам, старые слева.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                PatternLegend()
            }
            if let error {
                FeatureBanner(message: error, onDismiss: { self.error = nil })
            }
            if weaknesses.isEmpty && strengths.isEmpty {
                FeatureEmptyState(icon: "point.3.connected.trianglepath.dotted", title: "Паттернов пока нет",
                                  text: "Они появятся после разбора звонков: что стоило денег и повторяется.")
                    .featureGlass(radius: 24)
            }
            ForEach(Array(weaknesses.enumerated()), id: \.element.id) { entry in
                PatternCard(pattern: entry.element, drills: related(entry.element), busy: busy.contains(entry.element.id),
                            onConfirm: { update(entry.element, confirm: true) },
                            onDismiss: { update(entry.element, dismiss: true) },
                            onRestore: nil)
                    .featureReveal(entry.offset)
            }
            if !strengths.isEmpty {
                FeatureSectionTitle(title: "Сильные стороны", subtitle: "То, что стоит повторять в каждом звонке.")
                ForEach(strengths) { pattern in
                    PatternCard(pattern: pattern, drills: [], busy: busy.contains(pattern.id),
                                onConfirm: { update(pattern, confirm: true) },
                                onDismiss: { update(pattern, dismiss: true) },
                                onRestore: nil)
                }
            }
            if !hidden.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(hidden) { pattern in
                            PatternCard(pattern: pattern, drills: [], busy: busy.contains(pattern.id),
                                        onConfirm: nil, onDismiss: nil,
                                        onRestore: { update(pattern, dismiss: false) })
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("Скрытые · \(hidden.count)").font(.subheadline.weight(.semibold))
                }
                .padding(16)
                .featureGlass(radius: 22)
            }
        }
        .onChange(of: signature) { _, _ in overrides = nil }
    }

    private func related(_ pattern: CommunicationPattern) -> [PersonalDrill] {
        drills.filter { $0.patternIds.contains(pattern.id) || $0.source.patternId == pattern.id }
    }

    private func update(_ pattern: CommunicationPattern, confirm: Bool? = nil, dismiss: Bool? = nil) {
        guard !busy.contains(pattern.id) else { return }
        if client.isFeaturePreview {
            error = "В предпросмотре изменения не сохраняются."
            return
        }
        busy.insert(pattern.id)
        Task {
            var payload: [String: Any] = [:]
            if let confirm { payload["confirm"] = confirm }
            if let dismiss { payload["dismiss"] = dismiss }
            do {
                let envelope: PatternsEnvelope = try await client.request("patterns/\(pattern.id)", body: payload)
                overrides = envelope.patterns
                await client.featureRefresh()
            } catch {
                self.error = FeatureErrorText.describe(error)
            }
            busy.remove(pattern.id)
        }
    }

    static func statusOrder(_ status: String) -> Int {
        switch status {
        case "active": return 0
        case "watch": return 1
        case "improving": return 2
        case "resolved": return 3
        default: return 4
        }
    }
}

struct PatternLegend: View {
    var body: some View {
        HStack(spacing: 14) {
            item("●", "повторилось", "repeated")
            item("○", "удержал", "avoided")
            item("◐", "лучше", "improved")
            item("·", "не было повода", "no-opportunity")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }

    private func item(_ symbol: String, _ title: String, _ status: String) -> some View {
        HStack(spacing: 4) {
            Text(symbol).font(.body.weight(.bold)).foregroundStyle(PatternHistoryDots.color(status))
            Text(title).lineLimit(1)
        }
    }
}

struct PatternCard: View {
    let pattern: CommunicationPattern
    let drills: [PersonalDrill]
    let busy: Bool
    let onConfirm: (() -> Void)?
    let onDismiss: (() -> Void)?
    let onRestore: (() -> Void)?

    private var statusTint: Color {
        switch pattern.status {
        case "active": return FeaturePalette.warning
        case "improving": return FeaturePalette.cyan
        case "resolved": return FeaturePalette.lime
        default: return FeaturePalette.lavender
        }
    }
    private var roundsText: String {
        let practiceLost = max(0, pattern.practice.attempts - pattern.practice.independentSuccesses)
        return "Реальные \(pattern.real.avoided)–\(pattern.real.repeated) · Тренировки \(pattern.practice.independentSuccesses)–\(practiceLost)"
    }
    private var callHistory: [PatternHistoryEntry] { pattern.history.filter { $0.source != "practice" } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if !pattern.description.isEmpty {
                Text(pattern.description).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            if !callHistory.isEmpty || pattern.real.opportunities > 0 || pattern.practice.attempts > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    if !callHistory.isEmpty { PatternHistoryDots(history: callHistory) }
                    if pattern.isWeakness {
                        Text(roundsText).font(.footnote.weight(.semibold)).monospacedDigit()
                            .accessibilityLabel("Раунды: в реальных звонках удержал \(pattern.real.avoided), повторилось \(pattern.real.repeated). В тренировках самостоятельно \(pattern.practice.independentSuccesses)")
                    }
                }
            }
            if !pattern.drillHint.isEmpty {
                Label(pattern.drillHint, systemImage: "figure.run").font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            if !pattern.evidence.isEmpty {
                evidence
            }
            actions
            if !drills.isEmpty {
                DrillsList(drills: drills, limit: 2)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .featureGlass(radius: 26)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(pattern.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    FeatureChip(text: FeatureLabels.patternStatus(pattern.status), tint: statusTint)
                    FeatureChip(text: FeatureLabels.costCategory(pattern.category), tint: FeaturePalette.lavender)
                }
            }
            Spacer(minLength: 6)
            if pattern.isWeakness {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("#\(pattern.costRank)").font(.title3.weight(.bold)).fontDesign(.rounded)
                    Text("по цене").font(.caption2).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Место по цене: \(pattern.costRank) из 5")
            }
        }
    }

    private var evidence: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(FeatureIndexed.list(pattern.evidence)) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        FeatureQuote(text: item.value.quote, timestamp: evidenceMeta(item.value))
                        Text(FeatureLabels.patternOutcome(item.value.status)).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.top, 6)
        } label: {
            Text("Цитаты · \(pattern.evidence.count)").font(.footnote.weight(.semibold))
        }
    }

    private func evidenceMeta(_ item: PatternEvidence) -> String {
        var parts: [String] = []
        switch item.source {
        case "practice": parts.append("тренировка")
        case "placement": parts.append("тест уровня")
        default: parts.append("звонок")
        }
        if let date = FeatureFormat.shortDate(item.date) { parts.append(date) }
        if let at = item.at { parts.append(FeatureFormat.clock(at)) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private var actions: some View {
        if let onRestore {
            Button("Вернуть в работу", action: onRestore).buttonStyle(QuietButton()).disabled(busy)
        } else if pattern.status == "watch" && !pattern.userConfirmed {
            VStack(alignment: .leading, spacing: 8) {
                Text("Замечено один раз. Это про тебя?").font(.footnote).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    if let onConfirm {
                        Button("Да, про меня", action: onConfirm).buttonStyle(SecondaryButton()).disabled(busy)
                    }
                    if let onDismiss {
                        Button("Не про меня", action: onDismiss).buttonStyle(QuietButton()).disabled(busy)
                    }
                }
            }
        } else if let onDismiss, pattern.status != "resolved" {
            Menu {
                Button("Скрыть паттерн", systemImage: "eye.slash", action: onDismiss)
            } label: {
                Label("Ещё", systemImage: "ellipsis.circle").font(.footnote)
            }
            .disabled(busy)
        }
    }
}

/// Per-source outcome dots, oldest first: ● repeated ○ avoided · no-opportunity ◐ improved.
struct PatternHistoryDots: View {
    let history: [PatternHistoryEntry]
    var limit: Int = 12

    var body: some View {
        HStack(spacing: 5) {
            ForEach(FeatureIndexed.list(Array(history.suffix(max(1, limit))))) { item in
                Text(FeatureLabels.patternOutcomeSymbol(item.value.status))
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Self.color(item.value.status))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("История: " + history.suffix(max(1, limit)).map { FeatureLabels.patternOutcome($0.status) }.joined(separator: ", "))
    }

    static func color(_ status: String) -> Color {
        switch status {
        case "repeated", "new": return FeaturePalette.error
        case "avoided": return FeaturePalette.success
        case "improved": return FeaturePalette.violet
        default: return Color.secondary
        }
    }
}
