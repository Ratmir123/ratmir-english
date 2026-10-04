import SwiftUI

// Placement result (audit-product §2.9): shape first, every band with its range, confidence and
// basis; skipped sections say «не измерено»; never percentages; strategy moves are counts.

struct PlacementResultView: View {
    let view: PlacementView
    /// Inside the placement flow the flow handles retakes; elsewhere the view presents the flow itself.
    var onRetake: (() -> Void)? = nil
    var onStartPractice: (() -> Void)? = nil
    @EnvironmentObject private var client: TrainingClient
    @State private var showRetakeFlow = false

    var body: some View {
        ScrollView {
            Group {
                if let result = view.result {
                    PlacementResultContent(view: view, result: result, retake: retakeAction, startPractice: onStartPractice)
                } else {
                    FeatureEmptyState(icon: "chart.bar.doc.horizontal", title: "Результата пока нет",
                                      text: "Пройди тест уровня — здесь появится профиль по навыкам.")
                        .padding(.top, 40)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
        }
        .background { FeatureBackdrop() }
        .fullScreenCover(isPresented: $showRetakeFlow) {
            PlacementFlowView(startRetake: true).environmentObject(client)
        }
    }

    private var retakeAction: () -> Void {
        if let onRetake { return onRetake }
        return { showRetakeFlow = true }
    }
}

struct PlacementResultContent: View {
    let view: PlacementView
    let result: PlacementResult
    let retake: () -> Void
    let startPractice: (() -> Void)?
    @State private var celebrate = 0
    @State private var feedback = 0
    @State private var mood: VoiceOrbMood = .excited
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            profilePart
            practicePart
        }
        .sensoryFeedback(.success, trigger: feedback)
        .task(id: result.attemptId) { await celebrateOnce() }
    }

    /// Shape first: headline, overall, skills, speaking detail and strategy moves.
    private var profilePart: some View {
        VStack(alignment: .leading, spacing: 20) {
            PlacementResultHeader(result: result, mood: mood, celebrate: celebrate)
                .featureReveal(0)
            if !result.skills.isEmpty {
                PlacementSkillsCard(skills: result.skills).featureReveal(1)
            }
            PlacementSpeakingCard(speaking: result.speaking, skill: result.skill("speaking"))
                .featureReveal(2)
            PlacementMovesCard(moves: result.communication.moves)
                .featureReveal(3)
        }
    }

    /// What to do next, details, honesty notes and the retake.
    private var practicePart: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !result.priorities.isEmpty {
                PlacementPrioritiesCard(priorities: result.priorities)
                    .featureReveal(4)
            }
            if !result.languageTargets.isEmpty {
                PlacementTargetsCard(targets: result.languageTargets).featureReveal(5)
            }
            PlacementCommunicationCard(communication: result.communication)
            if !result.review.isEmpty {
                PlacementReviewCard(items: result.review)
            }
            PlacementLimitationsCard(limitations: result.limitations, procedureVersion: result.procedureVersion)
            PlacementRetakeCard(view: view, retake: retake)
            if let startPractice {
                Button("Начать практику", action: startPractice)
                    .buttonStyle(PrimaryButton())
                    .padding(.top, 4)
            }
        }
    }

    /// Celebrates a result once (haptic, confetti, excited → proud); later visits show it calmly.
    private func celebrateOnce() async {
        let key = "placement-result-celebrated"
        var seen = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
        guard !result.attemptId.isEmpty, !seen.contains(result.attemptId) else {
            mood = .proud
            return
        }
        seen.insert(result.attemptId)
        UserDefaults.standard.set(Array(Array(seen).suffix(20)), forKey: key)
        feedback += 1
        if !reduceMotion { celebrate += 1 }
        do { try await Task.sleep(for: .seconds(1.8)) } catch { return }
        mood = .proud
    }
}

// MARK: - Header and badge

struct PlacementResultHeader: View {
    let result: PlacementResult
    let mood: VoiceOrbMood
    let celebrate: Int

    private var metaLine: String {
        var parts = ["Тест " + result.procedureVersion]
        if let date = FeatureFormat.longDate(result.completedAt) { parts.append(date) }
        return parts.joined(separator: " · ")
    }
    private var overallLine: String {
        "медиана навыков · уверенность " + FeatureLabels.confidence(result.overall?.confidence)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(metaLine).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Text("ориентир, не сертификат").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                VoiceOrb(mode: .ready, level: 0, mood: mood, statusDescription: "Результат готов", celebrate: celebrate, interactive: true)
                    .frame(width: 76, height: 80)
            }
            HStack(alignment: .center, spacing: 16) {
                PlacementLevelBadge(label: result.overall?.label ?? "—", size: 96)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Общий ориентир").font(.headline)
                    Text(overallLine).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if !result.headline.isEmpty {
                Text(result.headline)
                    .font(.title2.weight(.bold))
                    .fontDesign(.rounded)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let summary = result.overall?.summary, !summary.isEmpty {
                Text(summary).font(.body).fixedSize(horizontal: false, vertical: true)
            }
            if let partner = result.partnerLevel, !partner.isEmpty {
                Label("Собеседники в практике будут говорить на уровне " + partner + " — как ты понимаешь на слух.", systemImage: "person.wave.2")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .featureGlass(radius: 30)
        .mascotConfetti(trigger: celebrate, origin: UnitPoint(x: 0.85, y: 0.12))
    }
}

/// CEFR badge that assembles with a liquid fill from the bottom (static with Reduce Motion).
struct PlacementLevelBadge: View {
    let label: String
    var size: CGFloat = 96
    @State private var level: CGFloat = 0
    @State private var waving = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var gradient: LinearGradient {
        LinearGradient(colors: [FeaturePalette.lime, Color(red: 0.73, green: 0.70, blue: 0.96)], startPoint: .bottom, endPoint: .top)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        ZStack {
            shape.fill(Color(red: 0.94, green: 0.93, blue: 0.99))
            liquid.clipShape(shape)
            Text(label)
                .font(.system(size: size * (label.count > 2 ? 0.3 : 0.36), weight: .heavy, design: .rounded))
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .padding(.horizontal, 6)
                .foregroundStyle(Color(red: 0.09, green: 0.09, blue: 0.11))
        }
        .frame(width: size, height: size)
        .overlay { shape.strokeBorder(Color.white.opacity(0.6), lineWidth: 1).allowsHitTesting(false) }
        .shadow(color: FeaturePalette.shadow, radius: 12, x: 0, y: 8)
        .onAppear {
            if reduceMotion {
                level = 1.15
            } else {
                withAnimation(.spring(response: 1.2, dampingFraction: 0.8)) { level = 1.15 }
            }
        }
        .task {
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            waving = false
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Общий уровень " + label)
    }

    @ViewBuilder private var liquid: some View {
        if reduceMotion {
            Rectangle().fill(gradient)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !waving)) { context in
                let seconds = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1000)
                PlacementWaveShape(level: level, phase: CGFloat(seconds * 2.4), amplitude: size * 0.045)
                    .fill(gradient)
            }
        }
    }
}

struct PlacementWaveShape: Shape {
    var level: CGFloat
    var phase: CGFloat
    var amplitude: CGFloat

    var animatableData: CGFloat {
        get { level }
        set { level = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let clamped = min(1.25, max(0, level))
        let baseline = rect.maxY - rect.height * clamped
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: baseline))
        let steps = 28
        for step in 0...steps {
            let progress = CGFloat(step) / CGFloat(steps)
            let x = rect.minX + rect.width * progress
            let y = baseline + sin(progress * .pi * 2 + phase) * amplitude
            path.addLine(to: CGPoint(x: x, y: y))
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Skills

struct PlacementSkillsCard: View {
    let skills: [PlacementSkillResult]
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            FeatureSectionTitle(title: "Навыки", subtitle: "Каждый уровень — с диапазоном, уверенностью и тем, на чём он основан.")
            ForEach(FeatureIndexed.list(skills)) { item in
                PlacementSkillRow(skill: item.value)
                if item.id < skills.count - 1 { Divider() }
            }
        }
        .featureSurface()
    }
}

struct PlacementSkillRow: View {
    let skill: PlacementSkillResult

    private var details: String {
        var parts: [String] = []
        if let range = skill.range { parts.append("диапазон " + range.text) }
        parts.append("уверенность " + FeatureLabels.confidence(skill.confidence))
        if !skill.basis.isEmpty {
            parts.append(skill.basis)
        } else if let answered = skill.answered, answered > 0 {
            let correct = min(answered, max(0, skill.correct ?? 0))
            parts.append(FeatureFormat.count(answered, "вопрос", "вопроса", "вопросов") + ", \(correct) верно")
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(FeatureLabels.skill(skill.id), systemImage: FeatureLabels.skillIcon(skill.id))
                    .font(.headline)
                Spacer(minLength: 8)
                if skill.measured, let label = skill.label {
                    Text(label).font(.title3.weight(.bold)).fontDesign(.rounded)
                } else {
                    Text("не измерено").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            if skill.measured {
                PlacementRangeScale(range: skill.range, label: skill.label)
                Text(details).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if !skill.note.isEmpty {
                    Text(skill.note).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text(skill.basis.isEmpty ? "Раздел пропущен — навык не измерен. Это не низкий уровень." : skill.basis)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Six bands A1…C2: the likely range is tinted, the estimate is marked. No percentages.
struct PlacementRangeScale: View {
    let range: PlacementRange?
    let label: String?

    var body: some View {
        let point = PlacementCEFR.value(label) ?? 0
        let low = PlacementCEFR.value(range?.from) ?? point
        let high = max(low, PlacementCEFR.value(range?.to) ?? point)
        HStack(spacing: 4) {
            ForEach(1...6, id: \.self) { band in
                VStack(spacing: 4) {
                    Capsule()
                        .fill(fill(band: band, low: low, high: high, point: point))
                        .frame(height: band == point ? 10 : 6)
                    Text(PlacementCEFR.levels[band - 1])
                        .font(.caption2.weight(band == point ? .bold : .regular))
                        .foregroundStyle(band >= low && band <= high ? Color.primary : Color.secondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(low: low, high: high))
    }

    private func fill(band: Int, low: Int, high: Int, point: Int) -> Color {
        if band == point { return FeaturePalette.violet }
        if band >= low && band <= high { return FeaturePalette.lavender }
        return FeaturePalette.track
    }

    private func accessibilityText(low: Int, high: Int) -> String {
        guard low >= 1, high >= low, high <= 6 else { return "Уровень " + (label ?? "не определён") }
        return "Уровень " + (label ?? "—") + ", диапазон от " + PlacementCEFR.levels[low - 1] + " до " + PlacementCEFR.levels[high - 1]
    }
}

// MARK: - Speaking

struct PlacementSpeakingCard: View {
    let speaking: PlacementSpeakingResult
    let skill: PlacementSkillResult?

    private var criteria: [PlacementCriterion] { speaking.criteria }
    private var measured: Bool { criteria.contains { $0.label != nil } }
    private var weakest: String? {
        let positions = criteria.compactMap { item -> (String, Double)? in
            guard let position = PlacementCEFR.position(item.label) else { return nil }
            return (item.id, position)
        }
        guard let low = positions.min(by: { $0.1 < $1.1 }), let high = positions.max(by: { $0.1 < $1.1 }),
              high.1 - low.1 >= 0.5 else { return nil }
        return low.0
    }

    var body: some View {
        if measured || !(speaking.timing?.isEmpty ?? true) {
            VStack(alignment: .leading, spacing: 16) {
                FeatureSectionTitle(title: "Речь подробнее", subtitle: "Четыре критерия CEFR и цифры темпа из твоих записей.")
                if measured { criteriaGrid }
                if let timing = speaking.timing, !timing.isEmpty { timingList(timing) }
                ForEach(speaking.notes, id: \.self) { note in
                    Label(note, systemImage: "info.circle").font(.footnote).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !speaking.errors.isEmpty { errorsList }
                if !speaking.examples.isEmpty { examples }
            }
            .featureSurface()
        }
    }

    private var criteriaGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(criteria) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title).font(.subheadline.weight(.semibold))
                    Text(item.label ?? "не измерено")
                        .font(item.label == nil ? Font.footnote : Font.title3.weight(.bold))
                        .fontDesign(.rounded)
                        .foregroundStyle(item.label == nil ? Color.secondary : Color.primary)
                    if weakest == item.id {
                        Text("главный тормоз").font(.caption.weight(.semibold)).foregroundStyle(FeaturePalette.warning)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func timingList(_ timing: PlacementTiming) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Темп").font(.headline)
            if let value = timing.wordsPerMinute { metric("Слов в минуту", FeatureFormat.integer(value)) }
            if let value = timing.pausesPerMinute { metric("Пауз в минуту", FeatureFormat.decimal(value)) }
            if let value = timing.longestPauseSeconds { metric("Самая долгая пауза", FeatureFormat.decimal(value) + " с") }
            if let value = timing.meanLengthOfRun { metric("Слов между паузами", "≈ " + FeatureFormat.decimal(value)) }
            if let value = timing.fillersPerMinute { metric("Заполнителей (um, uh) в минуту", FeatureFormat.decimal(value)) }
            if let value = timing.latencySeconds { metric("Пауза перед ответом", FeatureFormat.decimal(value) + " с") }
            Text("Темп — страховка для оценки беглости, а не самостоятельный уровень.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var errorsList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Ошибки, которые важны").font(.headline)
            ForEach(FeatureIndexed.list(speaking.errors)) { item in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        FeatureQuote(text: item.value.quote, strike: true)
                        Spacer(minLength: 6)
                        FeatureChip(text: FeatureLabels.languageImpact(item.value.impact),
                                    tint: item.value.impact == "meaning" ? FeaturePalette.error : FeaturePalette.warning)
                    }
                    if !item.value.correction.isEmpty {
                        Label(item.value.correction, systemImage: "arrow.turn.down.right")
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var examples: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(FeatureIndexed.list(speaking.examples)) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        FeatureQuote(text: item.value.quote)
                        if !item.value.comment.isEmpty {
                            Text(item.value.comment).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                        if !item.value.better.isEmpty {
                            Text("Сильнее: " + item.value.better)
                                .font(.subheadline.weight(.semibold))
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Text("Примеры из твоих ответов · \(speaking.examples.count)").font(.subheadline.weight(.semibold))
        }
    }
}

// MARK: - Strategy moves

struct PlacementMovesCard: View {
    let moves: [StrategyMoveScore]

    var body: some View {
        if !moves.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                FeatureSectionTitle(title: "Ходы разговора", subtitle: subtitle)
                ForEach(StrategyMoveCatalog.all) { move in
                    PlacementMoveRow(info: move, score: score(move.id), quote: quote(move.id))
                }
            }
            .featureSurface()
        }
    }

    private var subtitle: String {
        let done = StrategyMoveCatalog.all.filter { score($0.id) == 2 }.count
        let applicable = StrategyMoveCatalog.all.filter { score($0.id) != nil }.count
        guard applicable > 0 else { return "В сцене не было повода для этих ходов." }
        return "\(done) из \(applicable) в рабочей сцене. Это стратегия, а не уровень английского."
    }

    private func score(_ id: String) -> Int? { moves.first { $0.id == id }?.score }
    private func quote(_ id: String) -> String? { moves.first { $0.id == id }?.quote }
}

struct PlacementMoveRow: View {
    let info: StrategyMoveInfo
    let score: Int?
    let quote: String?

    private var symbol: String {
        switch score {
        case .some(2): return "checkmark.circle.fill"
        case .some(1): return "circle.lefthalf.filled"
        case .some(0): return "xmark.circle.fill"
        default: return "minus.circle"
        }
    }
    private var tint: Color {
        switch score {
        case .some(2): return FeaturePalette.success
        case .some(1): return FeaturePalette.warning
        case .some(0): return FeaturePalette.error
        default: return Color.secondary
        }
    }
    private var status: String {
        switch score {
        case .some(2): return "получилось"
        case .some(1): return "частично"
        case .some(0): return "не получилось"
        default: return "не было повода"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(tint).font(.body.weight(.semibold)).frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(info.title).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 6)
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
                if let score, score < 2 {
                    Text("Как надо: " + info.good).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if let quote, !quote.isEmpty {
                    FeatureQuote(text: quote)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(info.title + ": " + status)
    }
}

// MARK: - Priorities, targets, communication

struct PlacementPrioritiesCard: View {
    let priorities: [PlacementPriority]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            FeatureSectionTitle(title: "Что делаем дальше", subtitle: "Главное, что быстрее всего сдвинет твои звонки.")
            ForEach(FeatureIndexed.list(Array(priorities.prefix(3)))) { item in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(item.id + 1)")
                        .font(.subheadline.weight(.bold))
                        .fontDesign(.rounded)
                        .frame(width: 28, height: 28)
                        .background(FeaturePalette.lavender.opacity(0.55), in: Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.value.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                        if !item.value.why.isEmpty {
                            Text(item.value.why).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        if !item.value.action.isEmpty {
                            Text("Что делать: " + item.value.action).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .featureSurface()
    }
}

struct PlacementTargetsCard: View {
    let targets: [PlacementLanguageTarget]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            FeatureSectionTitle(title: "Что подтянуть в языке", subtitle: "Из твоих же ответов — с этого начнутся тренировки.")
            ForEach(FeatureIndexed.list(targets)) { item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.value.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    if let quote = item.value.quote, !quote.isEmpty { FeatureQuote(text: quote, strike: item.value.correction != nil) }
                    if let correction = item.value.correction, !correction.isEmpty {
                        Label(correction, systemImage: "arrow.turn.down.right")
                            .font(.subheadline)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .featureSurface()
    }
}

struct PlacementCommunicationCard: View {
    let communication: PlacementCommunication
    var body: some View {
        if !communication.strengths.isEmpty || !communication.risks.isEmpty || !communication.observations.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                FeatureSectionTitle(title: "Как ты ведёшь разговор")
                ForEach(communication.strengths, id: \.self) { text in
                    Label(text, systemImage: "checkmark.circle").font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(communication.risks, id: \.self) { text in
                    Label(text, systemImage: "exclamationmark.circle").font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                ForEach(FeatureIndexed.list(communication.observations)) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.value.title).font(.subheadline.weight(.semibold))
                        if !item.value.detail.isEmpty {
                            Text(item.value.detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        if let quote = item.value.quote, !quote.isEmpty { FeatureQuote(text: quote) }
                    }
                }
            }
            .featureSurface()
        }
    }
}

// MARK: - Item review, limitations, retake

struct PlacementReviewCard: View {
    let items: [PlacementReviewItem]
    @State private var expanded = false

    private var sections: [String] {
        var order: [String] = []
        for item in items where !order.contains(item.section) { order.append(item.section) }
        return order
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(sections, id: \.self) { section in
                    VStack(alignment: .leading, spacing: 14) {
                        Text(FeatureLabels.section(section)).font(.headline)
                        ForEach(items.filter { $0.section == section }) { item in
                            PlacementReviewItemView(item: item)
                        }
                    }
                }
            }
            .padding(.top, 12)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text("Разбор вопросов").font(.headline)
                Text("\(items.filter { $0.correct }.count) из \(items.count) верно · ключи и объяснения")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .featureSurface()
    }
}

struct PlacementReviewItemView: View {
    let item: PlacementReviewItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let passage = item.passage, !passage.isEmpty {
                DisclosureGroup {
                    Text(passage).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                } label: {
                    Text(item.section == "listening" ? "Текст записи" : "Текст").font(.footnote.weight(.semibold))
                }
            }
            Text(item.prompt).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            ForEach(FeatureIndexed.list(item.options)) { option in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: symbol(option.id)).foregroundStyle(tint(option.id)).font(.footnote)
                    Text(option.value).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(option.value + accessibilitySuffix(option.id))
            }
            if !item.explanation.isEmpty {
                Text(item.explanation).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func symbol(_ index: Int) -> String {
        if index == item.answer { return "checkmark.circle.fill" }
        if index == item.chosen { return "xmark.circle.fill" }
        return "circle"
    }
    private func tint(_ index: Int) -> Color {
        if index == item.answer { return FeaturePalette.success }
        if index == item.chosen { return FeaturePalette.error }
        return Color.secondary
    }
    private func accessibilitySuffix(_ index: Int) -> String {
        if index == item.answer && index == item.chosen { return ", твой ответ, верно" }
        if index == item.answer { return ", правильный ответ" }
        if index == item.chosen { return ", твой ответ" }
        return ""
    }
}

struct PlacementLimitationsCard: View {
    let limitations: [String]
    let procedureVersion: String

    private var lines: [String] {
        if !limitations.isEmpty { return limitations }
        return ["Речь оценена моделью по описаниям уровней CEFR и пока не сверена с живыми экзаменаторами.",
                "Задания новые и ещё не откалиброваны на других учениках."]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Честные границы").font(.headline)
            ForEach(lines, id: \.self) { line in
                Label(line, systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Прогресс сравниваем только внутри версии теста (" + procedureVersion + ").")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .featureGlass(radius: 24)
    }
}

struct PlacementRetakeCard: View {
    let view: PlacementView
    let retake: () -> Void
    @State private var confirmEarly = false

    private var availableDate: Date? { FeatureFormat.date(view.retakeAvailableAt) }
    private var early: Bool { (availableDate ?? .distantPast) > Date() }
    private var subtitle: String {
        if early, let date = FeatureFormat.longDate(view.retakeAvailableAt) {
            return "Рекомендуем после " + date + ", с другими заданиями. Изменение покажем, только если оно больше погрешности."
        }
        return "С другими заданиями того же формата. Изменение покажем, только если оно больше погрешности."
    }
    private var historyLine: String? {
        guard view.history.count > 1 else { return nil }
        let parts = view.history.suffix(4).map { entry -> String in
            let date = FeatureFormat.shortDate(entry.completedAt) ?? ""
            return date.isEmpty ? entry.overall : entry.overall + " · " + date
        }
        return parts.joined(separator: "  →  ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            FeatureSectionTitle(title: "Повторный тест", subtitle: subtitle)
            if let historyLine {
                Label(historyLine, systemImage: "chart.line.uptrend.xyaxis")
                    .font(.footnote.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if early {
                Button("Пересдать раньше") { confirmEarly = true }
                    .buttonStyle(QuietButton())
            } else {
                Button("Пересдать тест", action: retake)
                    .buttonStyle(SecondaryButton())
            }
        }
        .featureSurface()
        .confirmationDialog("Пересдать раньше срока?", isPresented: $confirmEarly, titleVisibility: .visible) {
            Button("Пересдать сейчас", action: retake)
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("За пару недель изменения обычно в пределах погрешности. Результат может просто повторить этот.")
        }
    }
}

// MARK: - Level card (Today / Progress)

/// Compact placement card: start, continue, scoring, error or the measured level.
struct PlacementLevelCard: View {
    let view: PlacementView
    let onOpen: () -> Void
    let onStart: () -> Void

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .featureGlass(radius: 28)
    }

    @ViewBuilder private var content: some View {
        switch view.phase {
        case .completed:
            if let result = view.result { completed(result) } else { notStarted }
        case .inProgress:
            inProgress
        case .scoring:
            scoring
        case .error:
            failed
        case .notStarted, .unknown:
            notStarted
        }
    }

    private var notStarted: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Тест уровня", systemImage: "gauge.with.dots.needle.33percent").font(.headline)
            Text("Узнаем твой настоящий уровень · ~25 мин в два подхода")
                .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Начать тест", action: onStart).buttonStyle(PrimaryButton())
        }
    }

    private var inProgress: some View {
        let total = max(view.sections.count, 1)
        let done = min(view.finishedSections, total)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(view.result == nil ? "Тест уровня" : "Пересдача", systemImage: "gauge.with.dots.needle.50percent").font(.headline)
                Spacer()
                if let previous = view.result?.overall?.label {
                    FeatureChip(text: "сейчас " + previous, tint: FeaturePalette.lavender)
                }
            }
            Text("Пройдено \(done) из \(total) разделов" + (view.remainingMinutes > 0 ? " · осталось ≈ \(view.remainingMinutes) мин" : ""))
                .font(.subheadline).foregroundStyle(.secondary)
            FeatureProgressBar(value: Double(done) / Double(total), tint: FeaturePalette.violet,
                               accessibilityText: "Пройдено \(done) из \(total) разделов")
            Button("Продолжить тест", action: onStart).buttonStyle(PrimaryButton())
        }
    }

    private var scoring: some View {
        HStack(spacing: 14) {
            VoiceOrb(mode: .thinking, level: 0, mood: .thinking, statusDescription: "Считаю результат", interactive: false)
                .frame(width: 56, height: 60)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Считаю результат").font(.headline)
                Text("Обычно около двух минут.").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button("Открыть", action: onOpen).buttonStyle(QuietButton())
        }
    }

    private var failed: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Результат не посчитался", systemImage: "exclamationmark.triangle").font(.headline)
            Text("Ответы сохранены. Подсчёт можно запустить ещё раз.").font(.subheadline).foregroundStyle(.secondary)
            Button("Повторить подсчёт", action: onOpen).buttonStyle(PrimaryButton())
        }
    }

    private func completed(_ result: PlacementResult) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(action: onOpen) {
                HStack(alignment: .center, spacing: 14) {
                    PlacementLevelBadge(label: result.overall?.label ?? "—", size: 64)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Твой уровень").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(result.headline.isEmpty ? (result.overall?.summary ?? "Профиль по навыкам") : result.headline)
                            .font(.subheadline.weight(.semibold))
                            .multilineTextAlignment(.leading)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(FeatureTileButtonStyle())
            .foregroundStyle(Color.primary)
            .accessibilityHint("Открывает профиль по навыкам")
            skillGrid(result)
            if let date = FeatureFormat.date(view.retakeAvailableAt), date <= Date() {
                Button("Пересдать тест", action: onStart).buttonStyle(SecondaryButton())
            }
        }
    }

    private func skillGrid(_ result: PlacementResult) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            ForEach(result.skills) { skill in
                VStack(alignment: .leading, spacing: 4) {
                    Text(Self.shortName(skill.id)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Text(skill.measured ? (skill.label ?? "—") : "—")
                        .font(.subheadline.weight(.bold))
                        .fontDesign(.rounded)
                    FeatureProgressBar(value: (PlacementCEFR.position(skill.label) ?? 0) / 6.5,
                                       tint: skill.measured ? FeaturePalette.violet : FeaturePalette.track, height: 4,
                                       accessibilityText: FeatureLabels.skill(skill.id) + ": " + (skill.measured ? (skill.label ?? "—") : "не измерено"))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }

    static func shortName(_ id: String) -> String {
        switch id {
        case "listening": return "Слух"
        case "reading": return "Чтение"
        case "grammar": return "Фразы"
        case "vocabulary": return "Слова"
        case "speaking": return "Речь"
        case "interaction": return "Диалог"
        default: return FeatureLabels.skill(id)
        }
    }
}
