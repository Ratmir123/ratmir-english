import SwiftUI

/// «Мои паттерны»: weaknesses first by cost, one card per pattern with plain sections (web:
/// components/calls/patterns-panel.tsx): history in words («В звонках: … · В тренировках: …»), the
/// latest outcomes, an inline confirmation question, attached drills as rows, description and quotes
/// on demand. `embedded: true` renders without its own scroll view and backdrop (for a host screen).
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
                    .entranceStage()
            }
            .background { FeatureBackdrop() }
            .navigationTitle("Мои паттерны")
        }
    }

    /// Blocks carry their staircase step; embedded in a host without a stage they simply show.
    private var content: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !embedded {
                Text("Что повторяется от звонка к звонку и сколько это стоит. Закрывается только реальными звонками — тренировки готовят к ним.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .entrance(0)
            }
            if let error {
                FeatureBanner(message: error, onDismiss: { self.error = nil })
            }
            if weaknesses.isEmpty && strengths.isEmpty {
                FeatureEmptyState(icon: "point.3.connected.trianglepath.dotted", title: "Паттернов пока нет",
                                  text: "Они появятся после первого разобранного звонка: например, «называешь чужой гонорар» или «соглашаешься на первую цифру».")
                    .featureGlass(radius: 24)
                    .entrance(1)
            }
            ForEach(Array(weaknesses.enumerated()), id: \.element.id) { index, pattern in
                PatternCard(pattern: pattern, drills: related(pattern), busy: busy.contains(pattern.id),
                            onConfirm: { update(pattern, confirm: true) },
                            onDismiss: { update(pattern, dismiss: true) },
                            onRestore: nil)
                    .entrance(1 + index)
            }
            if !strengths.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Сильные стороны").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                    GroupedRows {
                        ForEach(Array(strengths.enumerated()), id: \.element.id) { index, pattern in
                            if index > 0 { RowDivider(inset: 50) }
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "checkmark.seal.fill").foregroundStyle(FeaturePalette.success)
                                    .frame(width: 22).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(pattern.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                                    if !pattern.description.isEmpty {
                                        Text(pattern.description).font(.footnote).foregroundStyle(.secondary)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
                .entrance(1 + weaknesses.count)
            }
            if !hidden.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(hidden.enumerated()), id: \.element.id) { index, pattern in
                            if index > 0 { RowDivider(inset: 0) }
                            HStack(spacing: 12) {
                                Text(pattern.title).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                Button("Вернуть") { update(pattern, dismiss: false) }
                                    .buttonStyle(QuietButton())
                                    .disabled(busy.contains(pattern.id))
                            }
                            .padding(.vertical, 6)
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("Скрытые паттерны (\(hidden.count))").font(.subheadline.weight(.semibold))
                }
                .padding(16)
                .featureGlass(radius: 22)
                .entrance(2 + weaknesses.count)
            }
        }
        .onChange(of: signature) { _, _ in overrides = nil }
    }

    /// The pattern's drills in the shared order (§8.6), so its card shows the two that come first everywhere else too.
    private func related(_ pattern: CommunicationPattern) -> [PersonalDrill] {
        DrillOrder.rows(drills.filter { $0.patternIds.contains(pattern.id) || $0.source.patternId == pattern.id },
                        calls: client.state?.calls ?? [])
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

/// Plain-language copy shared with the web (components/calls/format.ts).
@MainActor enum PatternCopy {
    private static func times(_ count: Int) -> String { "\(count) " + FeatureFormat.plural(count, "раз", "раза", "раз") }

    /// «В звонках: справился 1 раз, повторилось 2 раза» / «В тренировках: ещё не было».
    static func rounds(_ pattern: CommunicationPattern) -> (real: String, practice: String) {
        let avoided = max(0, pattern.real.avoided)
        let repeated = max(0, pattern.real.repeated)
        let attempts = max(0, pattern.practice.attempts)
        let successes = min(attempts, max(0, pattern.practice.independentSuccesses))
        let real = [avoided > 0 ? "справился " + times(avoided) : "", repeated > 0 ? "повторилось " + times(repeated) : ""]
            .filter { !$0.isEmpty }.joined(separator: ", ")
        let practice = attempts == 0 ? "ещё не было"
            : FeatureFormat.count(attempts, "попытка", "попытки", "попыток") + ", "
                + (successes > 0 ? "без опор справился " + times(successes) : "без опор пока не получилось")
        return ("В звонках: " + (real.isEmpty ? "повода ещё не было" : real), "В тренировках: " + practice)
    }

    /// Cost rank (1 = most expensive) in words.
    static func cost(_ rank: Int) -> (label: String, color: Color) {
        if rank <= 2 { return ("Стоит дорого", FeaturePalette.error) }
        if rank == 3 { return ("Стоит заметно", FeaturePalette.warning) }
        return ("Стоит немного", Color.secondary)
    }

    static func hint(_ status: String) -> String {
        switch status {
        case "watch": return "Видели один раз. Это про тебя?"
        case "active": return "Повторяется. Тренируем."
        case "improving": return "Получается всё чаще."
        case "resolved": return "Три реальных звонка подряд без повтора."
        default: return ""
        }
    }

    static func source(_ value: String) -> String {
        switch value {
        case "practice": return "тренировка"
        case "placement": return "тест"
        default: return "звонок"
        }
    }

    static func upperFirst(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }
}

/// Legend of the outcome marks (drawn symbols, same as the history rows).
struct PatternLegend: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { items }
            VStack(alignment: .leading, spacing: 6) { items }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var items: some View {
        item("repeated")
        item("avoided")
        item("improved")
        item("no-opportunity")
    }

    private func item(_ status: String) -> some View {
        HStack(spacing: 4) {
            OutcomeMark(status: status)
            Text(FeatureLabels.patternOutcome(status)).lineLimit(1)
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
    @State private var expanded = false

    private var statusTint: Color {
        switch pattern.status {
        case "active": return FeaturePalette.warning
        case "improving": return FeaturePalette.violet
        case "resolved": return FeaturePalette.lime
        default: return FeaturePalette.lavender
        }
    }
    private var ask: Bool { pattern.status == "watch" && !pattern.userConfirmed && onConfirm != nil }
    private var openDrills: [PersonalDrill] { Array(drills.filter { !$0.isDone }.prefix(2)) }
    private var latest: [PatternHistoryEntry] { Array(pattern.history.suffix(4)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            if pattern.isWeakness { history }
            if ask { askBlock }
            if !openDrills.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(openDrills.count > 1 ? "Тренировки" : "Тренировка").font(.subheadline.weight(.semibold))
                    DrillsList(drills: openDrills, grouped: false, inPattern: true)
                }
            }
            details
            if let onRestore {
                Button("Вернуть в работу", action: onRestore).buttonStyle(QuietButton()).disabled(busy)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .featureGlass(radius: 26)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(pattern.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                metaLine
            }
            Spacer(minLength: 6)
            StatusPill(title: FeatureLabels.patternStatus(pattern.status), color: statusTint)
        }
    }

    private var metaLine: some View {
        var parts: [Text] = []
        if pattern.isWeakness {
            let cost = PatternCopy.cost(pattern.costRank)
            parts.append(Text(cost.label).foregroundColor(cost.color).fontWeight(.semibold))
        }
        parts.append(Text(FeatureLabels.costCategory(pattern.category)).foregroundColor(.secondary))
        if pattern.userConfirmed { parts.append(Text("подтверждено тобой").foregroundColor(.secondary)) }
        let joined = parts.dropFirst().reduce(parts[0]) { line, part in line + Text(" · ").foregroundColor(.secondary) + part }
        return joined.font(.footnote).fixedSize(horizontal: false, vertical: true)
    }

    private var history: some View {
        let rounds = PatternCopy.rounds(pattern)
        return VStack(alignment: .leading, spacing: 8) {
            Text("История").font(.subheadline.weight(.semibold))
            VStack(alignment: .leading, spacing: 2) {
                Text(rounds.real)
                Text(rounds.practice)
            }
            .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !latest.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(latest.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            OutcomeMark(status: item.status, filled: item.source != "practice")
                            (Text(PatternCopy.upperFirst(FeatureLabels.patternOutcome(item.status)))
                             + Text(" — " + [FeatureFormat.longDate(item.date), PatternCopy.source(item.source)].compactMap { $0 }.joined(separator: ", "))
                                .foregroundColor(.secondary))
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if pattern.history.count > latest.count {
                    let older = pattern.history.count - latest.count
                    Text("и ещё \(older) " + FeatureFormat.plural(older, "отметка", "отметки", "отметок") + " раньше")
                        .font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private var askBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(PatternCopy.hint(pattern.status)).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if let onConfirm {
                    Button(action: onConfirm) {
                        HStack(spacing: 6) {
                            if busy { ProgressView() } else { Image(systemName: "checkmark") }
                            Text("Да, это про меня")
                        }
                    }
                    .buttonStyle(SecondaryButton(compact: true)).fixedSize().disabled(busy)
                }
                if let onDismiss {
                    Button("Не про меня", action: onDismiss).buttonStyle(QuietButton()).disabled(busy)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var details: some View {
        let quotes = Array(pattern.evidence.prefix(5))
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 12) {
                if !pattern.description.isEmpty {
                    Text(pattern.description).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(quotes.enumerated()), id: \.offset) { _, item in
                    FeatureQuote(text: item.quote, timestamp: evidenceMeta(item))
                }
                if !pattern.drillHint.isEmpty {
                    (Text("Что тренировать: ").fontWeight(.semibold) + Text(pattern.drillHint))
                        .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                if let note = pattern.userNote, !note.isEmpty {
                    (Text("Твоя заметка: ").fontWeight(.semibold) + Text(note))
                        .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                if !ask, onRestore == nil, let onDismiss, pattern.status != "resolved" {
                    Button(action: onDismiss) { Label("Скрыть паттерн", systemImage: "eye.slash") }
                        .buttonStyle(QuietButton()).disabled(busy)
                }
            }
            .padding(.top, 8)
        } label: {
            Text(quotes.isEmpty ? "Описание" : "Описание и цитаты (\(quotes.count))").font(.subheadline.weight(.semibold))
        }
    }

    private func evidenceMeta(_ item: PatternEvidence) -> String {
        var parts: [String] = [PatternCopy.upperFirst(PatternCopy.source(item.source))]
        if let date = FeatureFormat.shortDate(item.date) { parts.append(date) }
        if let at = item.at { parts.append(FeatureFormat.clock(at)) }
        parts.append(FeatureLabels.patternOutcome(item.status))
        return parts.joined(separator: " · ")
    }
}

/// Per-source outcome marks, oldest first (drawn symbols: ✕ repeated, ✓ handled, ↗ better, – no opportunity).
struct PatternHistoryDots: View {
    let history: [PatternHistoryEntry]
    var limit: Int = 12

    var body: some View {
        HStack(spacing: 4) {
            ForEach(FeatureIndexed.list(Array(history.suffix(max(1, limit))))) { item in
                OutcomeMark(status: item.value.status, filled: item.value.source != "practice")
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("История: " + history.suffix(max(1, limit)).map { FeatureLabels.patternOutcome($0.status) }.joined(separator: ", "))
    }

    static func color(_ status: String) -> Color { OutcomeMark.color(status) }
}
