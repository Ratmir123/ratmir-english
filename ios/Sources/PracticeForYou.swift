import SwiftUI

// MARK: - What «Для тебя» shows (web: components/practice/for-you-model.ts)

/// Practice «Для тебя» decisions (MOTION-PASS-0.5.2 §7 with the §8 fixes), mirrored from the web model so both platforms
/// show the same tiles in the same order: today's plan (without a drill) first, then pending drills — due first, then the
/// newest call, then the newest drill — at most six tiles; every drill on the «Все тренировки» screen.
@MainActor enum PracticeForYouPlan {
    /// Tiles in the block, the plan included; the rest is one tap away in «Все тренировки».
    static let maxTiles = 6
    /// Usual drill length by type: mirrors `DRILL_TEMPLATES[type].minutes` in lib/server/teacher.ts
    /// (a drill takes the shorter of this and the daily budget).
    static let drillMinutes: [String: Int] = ["replay": 6, "pitch": 5, "price": 6, "questions": 6, "closing": 6,
                                              "language": 5, "cards": 5, "story": 6, "followup": 8, "rapidfire": 10]
    /// Scenarios built for a pattern category: mirrors `patternCategories` in lib/training.ts
    /// (the catalog JSON lists pattern ids only).
    static let builtFor: [String: [String]] = [
        "strategy-pitch-30": ["positioning", "structure", "fluency"], "strategy-agency-screening": ["structure"],
        "strategy-price": ["negotiation"], "strategy-recap-close": ["closing"], "strategy-confidential": ["confidentiality"],
        "work-call-opening": ["positioning"], "work-brief-call": ["questions", "listening"],
    ]

    struct Tile: Identifiable {
        enum Kind {
            case plan(PracticeRecommendation)
            case drill(PersonalDrill)
        }
        let id: String
        let kind: Kind
        let minutes: Int
        /// "call" | "learning": what a tap on the tile starts.
        let mode: String
        /// The second way to run it (a small text action on the tile); nil for written and reading tasks.
        let other: String?
    }

    struct Suggestion: Identifiable {
        let id: String
        let patternTitle: String
        let family: CatalogFamily
    }

    struct Model {
        var plan: Tile? = nil
        /// Pending drill tiles of the block (after the plan).
        var tiles: [Tile] = []
        var pending: [Tile] = []
        /// Done drills, newest first (folded under «Пройденные»).
        var done: [Tile] = []
        var suggestions: [Suggestion] = []
        var total: Int { pending.count + done.count }
        var blockTiles: [Tile] { (plan.map { [$0] } ?? []) + tiles }
    }

    static func lessonBudget(_ daily: Int) -> Int { min(30, max(5, daily)) }
    private static func otherMode(_ mode: String) -> String { mode == "call" ? "learning" : "call" }

    /// The partner's line to listen to (drills from a real moment only).
    static func seedLine(_ tile: Tile) -> String? {
        guard case .drill(let drill) = tile.kind,
              let line = drill.seedLine?.trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty else { return nil }
        return line
    }
    /// A tile footer holds the other mode and/or the line to listen to.
    static func hasFooter(_ tile: Tile) -> Bool { tile.other != nil || seedLine(tile) != nil }

    /// One start rule everywhere (§8.6): pressure tier 2–3 runs «Как на созвоне», tier 1 «С опорами».
    /// A follow-up drill is a written message, always with supports.
    static func tile(_ drill: PersonalDrill, daily: Int) -> Tile {
        let text = drill.type == "followup"
        let mode = text ? "learning" : (drill.tier >= 2 ? "call" : "learning")
        return Tile(id: drill.id, kind: .drill(drill), minutes: min(lessonBudget(daily), drillMinutes[drill.type] ?? 6),
                    mode: mode, other: text ? nil : otherMode(mode))
    }

    /// Today's plan without a drill starts directly in its preferred mode, exactly like Today's card (§8.8).
    static func planTile(_ state: TrainingState) -> Tile? {
        guard let recommendation = state.progression?.recommendation, (recommendation.drillId ?? "").isEmpty else { return nil }
        let text = recommendation.activity == "reading" || recommendation.activity == "writing"
        let mode = text ? "learning" : (recommendation.preferredMode == "call" ? "call" : "learning")
        return Tile(id: "plan:" + recommendation.familyId, kind: .plan(recommendation), minutes: lessonBudget(state.profile.dailyMinutes),
                    mode: mode, other: text ? nil : otherMode(mode))
    }

    /// Web `pendingDrills`: not done; due first, then the newest call, then the newest drill.
    static func pending(_ state: TrainingState, now: Date = Date()) -> [PersonalDrill] {
        var callTimes: [String: Date] = [:]
        for call in state.calls ?? [] {
            callTimes[call.id] = FeatureFormat.date(call.occurredAt) ?? FeatureFormat.date(call.createdAt) ?? .distantPast
        }
        func due(_ drill: PersonalDrill) -> Bool {
            guard let date = FeatureFormat.date(drill.dueAt) else { return true }
            return date <= now
        }
        func callTime(_ drill: PersonalDrill) -> Date {
            guard drill.source.type == "call", let id = drill.source.callId else { return .distantPast }
            return callTimes[id] ?? .distantPast
        }
        func created(_ drill: PersonalDrill) -> Date { FeatureFormat.date(drill.createdAt) ?? .distantPast }
        return (state.drills ?? []).filter { !$0.isDone }.sorted { left, right in
            let leftDue = due(left), rightDue = due(right)
            if leftDue != rightDue { return leftDue }
            let leftCall = callTime(left), rightCall = callTime(right)
            if leftCall != rightCall { return leftCall > rightCall }
            return created(left) > created(right)
        }
    }

    static func done(_ state: TrainingState) -> [PersonalDrill] {
        func finished(_ drill: PersonalDrill) -> Date { FeatureFormat.date(drill.completedAt ?? drill.createdAt) ?? .distantPast }
        return (state.drills ?? []).filter { $0.isDone }.sorted { finished($0) > finished($1) }
    }

    /// Web `familyForPattern` over the catalog: a scenario listing the pattern and built for its category, then any scenario
    /// listing it, then one built for the category (catalog order breaks ties).
    static func family(for pattern: CommunicationPattern, in families: [CatalogFamily], excluding exclude: Set<String>) -> CatalogFamily? {
        let contexts = Set(pattern.contexts)
        let eligible = families.filter { family in
            family.category != "ielts" && family.activity == "speaking" && !exclude.contains(family.id)
                && (contexts.isEmpty || contexts.contains(family.context))
        }
        func built(_ family: CatalogFamily) -> Bool { (builtFor[family.id] ?? []).contains(pattern.category) }
        let listed = eligible.filter { $0.patternIds.contains(pattern.id) }
        return listed.first(where: built) ?? listed.first ?? eligible.first(where: built)
    }

    /// At most two catalog scenarios against the costliest open weaknesses. A pattern a pending drill already trains is
    /// skipped, and so is the plan's own scenario.
    static func suggestions(_ state: TrainingState, catalog: [CatalogSection], pending: [PersonalDrill], planFamily: String?) -> [Suggestion] {
        let busy = Set(pending.flatMap { $0.patternIds })
        let families = catalog.flatMap { $0.families }
        let open = (state.patterns ?? [])
            .filter { !$0.dismissed && $0.kind == "weakness" && ($0.status == "active" || $0.status == "improving") }
            .sorted { $0.costRank < $1.costRank }
        var result: [Suggestion] = []
        for pattern in open where !busy.contains(pattern.id) && result.count < 2 {
            var exclude = Set(result.map { $0.family.id })
            if let planFamily { exclude.insert(planFamily) }
            if let match = family(for: pattern, in: families, excluding: exclude) {
                result.append(Suggestion(id: pattern.id, patternTitle: pattern.title, family: match))
            }
        }
        return result
    }

    static func model(_ state: TrainingState?, catalog: [CatalogSection], now: Date = Date()) -> Model {
        guard let state else { return Model() }
        let daily = state.profile.dailyMinutes
        let plan = planTile(state)
        let pendingDrills = pending(state, now: now)
        let pendingTiles = pendingDrills.map { tile($0, daily: daily) }
        var planFamily: String? = nil
        if let plan, case .plan(let recommendation) = plan.kind { planFamily = recommendation.familyId }
        return Model(plan: plan, tiles: Array(pendingTiles.prefix(maxTiles - (plan == nil ? 0 : 1))), pending: pendingTiles,
                     done: done(state).map { tile($0, daily: daily) },
                     suggestions: suggestions(state, catalog: catalog, pending: pendingDrills, planFamily: planFamily))
    }
}

// MARK: - «Для тебя»

/// «Для тебя» on Practice: the plan and the drills from calls as compact tiles in one snapping row, the costliest patterns as
/// light rows that open the scenario sheet, «Все тренировки · N» → every drill on a pushed screen; a quiet line with a curious
/// companion when nothing is pending. Web: components/practice/for-you.tsx.
struct PracticeForYou: View {
    let onOpenFamily: (CatalogFamily) -> Void
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        let model = PracticeForYouPlan.model(client.state, catalog: client.catalog)
        VStack(alignment: .leading, spacing: 14) {
            header(total: model.total)
            tileRow(model.blockTiles)
            if model.pending.isEmpty { emptyLine }
            if !model.suggestions.isEmpty { patterns(model.suggestions) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func header(total: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("Для тебя").font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                if total > 0 {
                    NavigationLink {
                        PracticeAllDrillsView()
                    } label: {
                        HStack(spacing: 4) {
                            Text("Все тренировки · \(total)")
                            Image(systemName: "chevron.right").imageScale(.small).accessibilityHidden(true)
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressButton())
                    .foregroundStyle(Theme.violet)
                    .accessibilityHint("Открывает все тренировки, и пройденные тоже")
                }
            }
            Text("По твоим созвонам и последним разборам.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private func tileRow(_ tiles: [PracticeForYouPlan.Tile]) -> some View {
        if tiles.count == 1, let only = tiles.first {
            PracticeTileView(tile: only)
        } else if !tiles.isEmpty {
            // Every tile keeps the footer room when any has one, so the meta lines of neighbours stay aligned.
            let reserve = tiles.contains { PracticeForYouPlan.hasFooter($0) }
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(tiles) { tile in
                        PracticeTileView(tile: tile, reserveFooter: reserve)
                            .frame(width: 272)
                            .frame(maxHeight: .infinity, alignment: .top)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            .scrollClipDisabled()
            .contentMargins(.horizontal, 20, for: .scrollContent)
            .padding(.horizontal, -20)
        }
    }

    private var emptyLine: some View {
        HStack(alignment: .center, spacing: 12) {
            ScreenMascot(mood: .curious, size: 52)
            VStack(alignment: .leading, spacing: 8) {
                Text("Загрузи запись созвона — после разбора здесь появятся тренировки из твоих моментов.")
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                Button { client.requestedTab = .calls } label: {
                    Label("Загрузить созвон", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(QuietButton())
                .accessibilityHint("Открывает вкладку «Созвоны»")
            }
        }
    }

    private func patterns(_ items: [PracticeForYouPlan.Suggestion]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Против твоих паттернов").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            ForEach(items) { item in
                Button { onOpenFamily(item.family) } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.patternTitle).font(.subheadline.weight(.semibold))
                                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                            Text(item.family.title + " · \(item.family.minutes) мин").font(.footnote).foregroundStyle(Theme.inkSecondary)
                                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .background(Theme.fill, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                }
                .buttonStyle(PressButton())
                .accessibilityHint("Открывает ситуацию «" + item.family.title + "»")
            }
        }
    }
}

// MARK: - Tile

/// One plan or drill: a tap starts the default mode, «или …» starts the other one, the speaker plays the partner's line.
/// `.tile` is a compact surface for the «Для тебя» row; `.row` sits inside one surface on the «Все тренировки» screen.
struct PracticeTileView: View {
    enum Style { case tile, row }
    let tile: PracticeForYouPlan.Tile
    var style: Style = .tile
    var reserveFooter = false
    @EnvironmentObject private var client: TrainingClient

    private var drill: PersonalDrill? {
        if case .drill(let value) = tile.kind { return value }
        return nil
    }
    private var recommendation: PracticeRecommendation? {
        if case .plan(let value) = tile.kind { return value }
        return nil
    }
    private var isPlan: Bool { recommendation != nil }
    private var title: String { drill?.title ?? recommendation?.title ?? "" }
    private var why: String { drill?.why ?? recommendation?.why ?? "" }
    private var seed: String? { PracticeForYouPlan.seedLine(tile) }
    /// Same key as the drill row in Созвоны, so a line playing there shows here too.
    private var lineKey: String { "drill-seed:" + tile.id }
    private var startKey: String {
        if let drill { return TrainingClient.drillKey(drill.id) }
        return TrainingClient.familyKey(recommendation?.familyId ?? "")
    }
    private var starting: Bool { client.isStarting(startKey) }
    private var blocked: Bool { client.busy || client.startingIntent != nil || client.recording }
    private var status: String { drill?.status ?? "new" }
    private var verb: String { status == "done" ? "Ещё раз" : status == "started" ? "Продолжить" : "Начать" }
    private var modeTitle: String { tile.other == nil ? "Текст" : FamilyAccent.modeTitle(tile.mode) }
    private var hasFooter: Bool { starting || tile.other != nil || seed != nil }
    private var details: String {
        var parts: [String] = []
        if status == "started" { parts.append("Начата") }
        if status == "done" { parts.append("Пройдена") }
        parts.append("~\(tile.minutes) мин")
        parts.append(modeTitle)
        return parts.joined(separator: " · ")
    }
    private var spoken: String {
        var parts: [String] = []
        if isPlan { parts.append("План на сегодня") }
        if let drill { parts.append("Давление \(drill.tier) из 3") }
        if status == "started" { parts.append("начата") }
        if status == "done" { parts.append("пройдена") }
        parts.append("около \(tile.minutes) мин")
        parts.append(modeTitle)
        return parts.joined(separator: ", ")
    }

    var body: some View {
        Button { start(tile.mode) } label: { tileContent }
            .buttonStyle(PracticeTileButtonStyle(dimmed: blocked && !starting))
            .disabled(blocked)
            .accessibilityLabel(verb + ": " + title)
            .accessibilityValue(spoken)
            .accessibilityHint(why)
            .overlay(alignment: .bottomLeading) { footer }
            .contextMenu { menu }
    }

    private var tileContent: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.headline).foregroundStyle(status == "done" ? Theme.inkSecondary : Theme.ink)
                .lineLimit(style == .tile ? 2 : 4).multilineTextAlignment(.leading)
            if !why.isEmpty {
                Text(why).font(.footnote).foregroundStyle(Theme.inkSecondary)
                    .lineLimit(style == .tile ? 1 : 3).multilineTextAlignment(.leading)
            }
            Spacer(minLength: 6)
            meta
            if hasFooter || reserveFooter { Color.clear.frame(height: 34) }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .modifier(PracticeTileSurface(visible: style == .tile, tint: isPlan ? Theme.lavender.opacity(0.32) : nil))
        .contentShape(RoundedRectangle(cornerRadius: style == .tile ? Radius.tile : 0, style: .continuous))
    }

    private var meta: some View {
        HStack(alignment: .center, spacing: 6) {
            if let drill {
                Circle().fill(Self.tierColor(drill.tier)).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(details)
            } else {
                Image(systemName: "scope").font(.caption.weight(.semibold)).foregroundStyle(Theme.violet).accessibilityHidden(true)
                Text("\(Text("План на сегодня").fontWeight(.semibold).foregroundStyle(Theme.violet)) · \(details)")
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(Theme.inkSecondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var footer: some View {
        if hasFooter {
            HStack(spacing: 8) {
                if starting {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Готовлю…").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                    }
                    .padding(.horizontal, 8)
                    .frame(minHeight: 44)
                } else if let other = tile.other {
                    Button { start(other) } label: {
                        Text("или " + FamilyAccent.modeTitle(other).lowercased())
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 8)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressButton())
                    .foregroundStyle(Theme.violet)
                    .disabled(blocked)
                    .accessibilityLabel(verb + " " + FamilyAccent.modeTitle(other).lowercased() + ": " + title)
                }
                Spacer(minLength: 0)
                if let seed, !starting { listenButton(seed) }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
        }
    }

    private func listenButton(_ line: String) -> some View {
        let playing = client.playingModelLine == lineKey || client.loadingModelLine == lineKey
        return Button { Task { await client.speakModelLine(line, key: lineKey) } } label: {
            if client.loadingModelLine == lineKey {
                ProgressView()
            } else {
                Image(systemName: playing ? "stop.fill" : "speaker.wave.2.fill")
            }
        }
        .buttonStyle(SoftIconButton(size: 36))
        .disabled(client.recording)
        .accessibilityLabel(playing ? "Остановить реплику" : "Послушать реплику")
    }

    @ViewBuilder private var menu: some View {
        Button { start(tile.mode) } label: {
            Label(tile.other == nil ? verb : verb + " · " + FamilyAccent.modeTitle(tile.mode),
                  systemImage: tile.mode == "call" ? "phone" : "lightbulb")
        }
        if let other = tile.other {
            Button { start(other) } label: {
                Label(FamilyAccent.modeTitle(other), systemImage: other == "call" ? "phone" : "lightbulb")
            }
        }
        if let seed {
            Button { Task { await client.speakModelLine(seed, key: lineKey) } } label: {
                Label("Послушать реплику", systemImage: "speaker.wave.2")
            }
        }
    }

    private func start(_ mode: String) {
        guard !blocked else { return }
        if let drill {
            Task { await client.startDrill(id: drill.id, mode: mode) }
        } else if let recommendation {
            Task { await client.startFamily(familyId: recommendation.familyId, mode: mode) }
        }
    }

    /// Pressure as a quiet colour (not bars): calm cyan, violet, warm pink.
    static func tierColor(_ tier: Int) -> Color {
        switch tier {
        case 3: return Theme.pink
        case 2: return Theme.violet
        default: return Theme.cyan
        }
    }
}

/// The tile surface (opaque, hairline, light shadow); rows of the full list sit on their host surface instead.
private struct PracticeTileSurface: ViewModifier {
    let visible: Bool
    let tint: Color?
    @ViewBuilder func body(content: Content) -> some View {
        if visible { content.contentSurface(radius: Radius.tile, tint: tint) } else { content }
    }
}

/// Press feedback for a whole tile: a quiet dim, no scale (the footer actions sit on top of it).
private struct PracticeTileButtonStyle: ButtonStyle {
    let dimmed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(dimmed ? 0.6 : configuration.isPressed ? 0.82 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

// MARK: - Every drill

/// Every drill (§8.3), pushed from Practice: pending first in the shared order, done ones folded under «Пройденные».
/// Web: the «Все тренировки» sheet in components/practice/for-you.tsx.
struct PracticeAllDrillsView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var showDone = false

    var body: some View {
        let model = PracticeForYouPlan.model(client.state, catalog: client.catalog)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(summary(model)).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                if model.pending.isEmpty {
                    Text("Новые тренировки появятся после разбора следующего созвона.")
                        .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                } else {
                    rows(model.pending)
                }
                if !model.done.isEmpty {
                    DisclosureGroup(isExpanded: $showDone) {
                        rows(model.done).padding(.top, 8)
                    } label: {
                        Text("Пройденные · \(model.done.count)").font(TypeScale.headline.weight(.semibold))
                    }
                    .disclosureGroupStyle(SoftDisclosureStyle())
                }
            }
            .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 32)
            .frame(maxWidth: 680).frame(maxWidth: .infinity)
        }
        .modifier(LiquidCanvas())
        .navigationTitle("Все тренировки")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await client.refreshQuietly() }
    }

    private func summary(_ model: PracticeForYouPlan.Model) -> String {
        var parts = [model.pending.isEmpty ? "Все пройдены" : "Ждут: \(model.pending.count)"]
        if !model.done.isEmpty { parts.append("Пройдены: \(model.done.count)") }
        return parts.joined(separator: " · ")
    }

    private func rows(_ tiles: [PracticeForYouPlan.Tile]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(tiles.enumerated()), id: \.element.id) { index, tile in
                if index > 0 { RowDivider() }
                PracticeTileView(tile: tile, style: .row)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .contentSurface()
    }
}
