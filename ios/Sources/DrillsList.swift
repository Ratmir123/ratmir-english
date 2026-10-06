import SwiftUI

// MARK: - One order and one start rule (MOTION-PASS-0.5.2 §8.6)

/// The drill order and start rule shared by Today's step, Practice («Для тебя», «Все тренировки»), a call's
/// «Тренировки» and the pattern cards. Web: `drillOrder` / `pendingDrills` / `sortDrillRows`
/// (components/app/today-plan.ts) and the drill start in components/practice/for-you-model.ts. Pure, so it is unit-tested.
enum DrillOrder {
    /// Not done: due first, then the newest call, then the newest drill. Without `calls` the call date is unknown and
    /// the rest decides; equal drills keep their incoming order.
    static func pending(_ drills: [PersonalDrill], calls: [CallSummary], now: Date = Date()) -> [PersonalDrill] {
        var callTimes: [String: TimeInterval] = [:]
        for call in calls where callTimes[call.id] == nil {
            let occurred = call.occurredAt.flatMap { $0.isEmpty ? nil : $0 }
            callTimes[call.id] = time(occurred ?? call.createdAt)
        }
        let current = now.timeIntervalSince1970
        let ranked = drills.enumerated().filter { !$0.element.isDone }.map { entry -> Ranked in
            let drill = entry.element
            let callTime = drill.source.type == "call" ? (drill.source.callId.flatMap { callTimes[$0] } ?? 0) : 0
            let due = (drill.dueAt ?? "").isEmpty || time(drill.dueAt) <= current
            return Ranked(drill: drill, index: entry.offset, due: due, call: callTime, created: time(drill.createdAt))
        }
        return ranked.sorted { left, right in
            if left.due != right.due { return left.due }
            if left.call != right.call { return left.call > right.call }
            if left.created != right.created { return left.created > right.created }
            return left.index < right.index
        }.map { $0.drill }
    }

    static func pending(_ state: TrainingState, now: Date = Date()) -> [PersonalDrill] {
        pending(state.drills ?? [], calls: state.calls ?? [], now: now)
    }

    /// Done drills, the most recently finished first.
    static func done(_ drills: [PersonalDrill]) -> [PersonalDrill] {
        drills.enumerated().filter { $0.element.isDone }.sorted { left, right in
            let leftTime = time(left.element.completedAt ?? left.element.createdAt)
            let rightTime = time(right.element.completedAt ?? right.element.createdAt)
            return leftTime != rightTime ? leftTime > rightTime : left.offset < right.offset
        }.map { $0.element }
    }

    /// List rows: the pending drills in the shared order, then the done ones.
    static func rows(_ drills: [PersonalDrill], calls: [CallSummary], now: Date = Date()) -> [PersonalDrill] {
        pending(drills, calls: calls, now: now) + done(drills)
    }

    /// A follow-up drill is a written message: always with supports, no second way to run it.
    static func isWritten(_ drill: PersonalDrill) -> Bool { drill.type == "followup" }

    /// What a tap starts: pressure tier 2–3 runs «Как на созвоне», tier 1 «С опорами».
    static func startMode(_ drill: PersonalDrill) -> String {
        isWritten(drill) ? "learning" : (drill.tier >= 2 ? "call" : "learning")
    }

    /// The other way to run it (a small text action next to the start); nil for written drills.
    static func otherMode(_ drill: PersonalDrill) -> String? {
        isWritten(drill) ? nil : (startMode(drill) == "call" ? "learning" : "call")
    }

    private struct Ranked {
        let drill: PersonalDrill
        let index: Int
        let due: Bool
        let call: TimeInterval
        let created: TimeInterval
    }

    private static let dayOnly: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return formatter
    }()

    /// Web `time()`: a missing or unreadable date counts as 0, the oldest.
    private static func time(_ value: String?) -> TimeInterval {
        guard let value, !value.isEmpty else { return 0 }
        let date = NativeDate.parse(value) ?? dayOnly.date(from: String(value.prefix(10)))
        return date?.timeIntervalSince1970 ?? 0
    }
}

// MARK: - List

/// Personal drills (from calls, patterns or the placement result) as rows of one surface, in the shared order: pending
/// first, done ones last (web: components/calls/drills-list.tsx). `grouped: false` renders bare rows for a host surface
/// (a pattern card), so cards never nest. «Начать» runs the default mode (`DrillOrder.startMode`); the small
/// «или …» action next to it runs the other one.
struct DrillsList: View {
    let drills: [PersonalDrill]
    var grouped = true
    /// Inside a pattern card the meta line starts with «Тренировка: <тип>».
    var inPattern = false
    @EnvironmentObject private var client: TrainingClient
    @State private var startingId: String?

    private var blocked: Bool {
        startingId != nil || client.busy || client.startingIntent != nil || client.recording
    }

    var body: some View {
        let rows = DrillOrder.rows(drills, calls: client.state?.calls ?? [])
        VStack(alignment: .leading, spacing: 10) {
            if rows.isEmpty {
                Text("Тренировок пока нет — они появятся из разборов звонков и теста уровня.")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else if grouped {
                list(rows)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                    .contentSurface()
            } else {
                list(rows)
            }
        }
    }

    private func list(_ rows: [PersonalDrill]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, drill in
                if index > 0 { RowDivider(inset: grouped ? 16 : 0) }
                DrillCard(drill: drill,
                          starting: startingId == drill.id || client.isStarting(TrainingClient.drillKey(drill.id)),
                          disabled: blocked, inset: grouped ? 16 : 0, prominent: index == 0, inPattern: inPattern) { mode in
                    start(drill, mode: mode)
                }
            }
        }
    }

    private func start(_ drill: PersonalDrill, mode: String) {
        guard !blocked else { return }
        startingId = drill.id
        Task {
            await client.startDrill(id: drill.id, mode: mode)
            startingId = nil
        }
    }
}

/// One drill as a row (no surface of its own): title, why, the line to replay, a meta line, «Начать» in the default
/// mode and «или …» for the other mode (§8.6, the same wording as the Practice tiles). A done drill can be run again.
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

    private var defaultMode: String { DrillOrder.startMode(drill) }
    private var otherMode: String? { DrillOrder.otherMode(drill) }
    private var verb: String { drill.isDone ? "Ещё раз" : drill.status == "started" ? "Продолжить" : "Начать" }
    /// A written follow-up reads «Текст», like its Practice tile.
    private var modeTitle: String { otherMode == nil ? "Текст" : ModeCopy.title(defaultMode) }
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
    /// The mode the button starts (as on the Practice tile), then the attempts.
    private var modeLine: String {
        var parts = [modeTitle]
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
            // A done drill reads quieter; its «Ещё раз» stays crisp.
            Text(drill.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                .opacity(drill.isDone ? 0.75 : 1)
            if !drill.why.isEmpty {
                Text(drill.why).font(.subheadline).foregroundStyle(.secondary).lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(drill.isDone ? 0.75 : 1)
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
                    actions
                }
                VStack(alignment: .leading, spacing: 10) {
                    meta
                    actions
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, inset).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
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
        .opacity(drill.isDone ? 0.75 : 1)
    }

    /// «Начать» (default mode) and, beside it, «или с опорами» / «или как на созвоне».
    private var actions: some View {
        HStack(alignment: .center, spacing: 4) {
            startButton
            if let otherMode { otherButton(otherMode) }
        }
    }

    private var startButton: some View {
        Button {
            onStart(defaultMode)
        } label: {
            HStack(spacing: 6) {
                if starting { ProgressView() }
                Text(starting ? "Готовлю…" : verb)
            }
            .padding(.horizontal, 4)
        }
        .modifier(DrillStartStyle(prominent: prominent && !drill.isDone))
        .fixedSize()
        .disabled(disabled)
        .accessibilityLabel(verb + " " + ModeCopy.title(defaultMode).lowercased() + ": " + drill.title)
        .accessibilityHint(startHint)
    }

    private var startHint: String {
        guard otherMode != nil else { return "Письменное задание с опорами." }
        return ModeCopy.title(defaultMode) + ". " + ModeCopy.explanation(defaultMode)
    }

    private func otherButton(_ mode: String) -> some View {
        Button { onStart(mode) } label: {
            Text("или " + ModeCopy.title(mode).lowercased())
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 8)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressButton())
        .foregroundStyle(Theme.violet)
        .fixedSize()
        .disabled(disabled)
        .accessibilityLabel(verb + " " + ModeCopy.title(mode).lowercased() + ": " + drill.title)
        .accessibilityHint(ModeCopy.explanation(mode))
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
