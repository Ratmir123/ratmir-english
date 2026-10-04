import SwiftUI

// Call review in the owner's debrief order: Итог → Ход звонка → Что сработало → Что стоило денег
// (+ «Как сказать сильнее») → Лучшие ответы → Сделка → Спорные моменты → Английский →
// Сообщение после звонка → Риски → Паттерны → Ходы разговора → Факты → Границы разбора.

struct CallReviewView: View {
    let detail: CallDetail
    let review: CallReview
    @ObservedObject var store: CallsStore
    @ObservedObject var player: FeatureAudioPlayer
    let onSeek: ((Double) -> Void)?

    private var hasDeal: Bool { !review.agreedTerms.isEmpty || !review.dealTable.isEmpty || review.dealModel != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            conversationPart
            outcomePart
        }
    }

    /// Итог → Ход звонка → Что сработало → Что стоило денег → Лучшие ответы → Сделка.
    private var conversationPart: some View {
        VStack(alignment: .leading, spacing: 18) {
            CallSummarySection(detail: detail, review: review)
            if !review.timeline.isEmpty {
                CallTimelineSection(items: review.timeline, onSeek: onSeek)
            }
            if !review.wins.isEmpty {
                CallWinsSection(wins: review.wins, onSeek: onSeek)
            }
            if !review.costs.isEmpty {
                CallCostsSection(costs: review.costs, patterns: store.patterns, store: store, player: player, onSeek: onSeek)
            }
            if !review.betterAnswers.isEmpty {
                CallBetterAnswersSection(answers: review.betterAnswers, store: store, player: player, onSeek: onSeek)
            }
            if hasDeal {
                CallDealSection(review: review, onSeek: onSeek)
            }
        }
    }

    /// Спорные моменты → Английский → Сообщение → Риски → Паттерны → Ходы → Факты → Границы.
    private var outcomePart: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !review.debatable.isEmpty {
                CallDebatableSection(items: review.debatable, onSeek: onSeek)
            }
            if !review.language.isEmpty || review.minorErrorsIgnored > 0 {
                CallLanguageSection(items: review.language, minorIgnored: review.minorErrorsIgnored, onSeek: onSeek)
            }
            if let followUp = review.followUp, !followUp.text.isEmpty {
                CallFollowUpSection(followUp: followUp)
            }
            if !review.risks.isEmpty {
                CallRisksSection(risks: review.risks)
            }
            if !review.patterns.isEmpty {
                CallPatternsSection(outcomes: review.patterns, patterns: store.patterns)
            }
            if !review.strategyMoves.isEmpty {
                CallReviewSection("Ходы разговора", icon: "checklist", subtitle: movesSubtitle) {
                    ForEach(StrategyMoveCatalog.all) { move in
                        PlacementMoveRow(info: move, score: moveScore(move.id), quote: moveQuote(move.id))
                    }
                }
            }
            if !detail.facts.isEmpty {
                CallFactsSection(facts: detail.facts, store: store)
            }
            if !review.limitations.isEmpty || review.dropped > 0 {
                CallLimitationsSection(limitations: review.limitations, dropped: review.dropped)
            }
        }
    }

    private func moveScore(_ id: String) -> Int? {
        review.strategyMoves.first(where: { $0.id == id })?.score
    }

    private func moveQuote(_ id: String) -> String? {
        review.strategyMoves.first(where: { $0.id == id })?.quote
    }

    private var movesSubtitle: String {
        let done = review.strategyMoves.filter { $0.score == 2 }.count
        let applicable = review.strategyMoves.filter { $0.score != nil }.count
        return applicable > 0 ? "\(done) из \(applicable) там, где был повод." : "В этом звонке не было повода для этих ходов."
    }
}

/// Solid reading card with a section title.
struct CallReviewSection<Content: View>: View {
    let title: String
    let icon: String?
    let subtitle: String?
    let content: Content

    init(_ title: String, icon: String? = nil, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            FeatureSectionTitle(title: title, subtitle: subtitle, icon: icon)
            content
        }
        .featureSurface()
    }
}

/// A timestamp that plays the call from that moment when audio is available.
struct CallTimeButton: View {
    let at: Double?
    let onSeek: ((Double) -> Void)?

    var body: some View {
        if let at, at.isFinite, at >= 0 {
            if let onSeek {
                Button {
                    onSeek(at)
                } label: {
                    Label(FeatureFormat.clock(at), systemImage: "play.fill")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(FeaturePalette.cyan.opacity(0.22), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Прослушать с " + FeatureFormat.clock(at))
            } else {
                Text(FeatureFormat.clock(at))
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// ▶︎ TTS of a model line through POST tts.
struct CallSpeakButton: View {
    let text: String
    @ObservedObject var store: CallsStore
    @ObservedObject var player: FeatureAudioPlayer

    private var key: String { "tts-" + String(text.hashValue) }

    var body: some View {
        FeaturePlayButton(isPlaying: player.activeKey == key && player.isPlaying, isLoading: player.loadingKey == key,
                          label: "Послушать, как сказать") { toggle() }
    }

    private func toggle() {
        if player.activeKey == key || player.loadingKey == key {
            player.stop()
            return
        }
        player.beginLoading(key)
        Task {
            do {
                let data = try await store.speech(for: text)
                guard player.loadingKey == key else { return }
                await player.play(data: data, key: key)
            } catch {
                player.cancelLoading(key)
                if !FeatureErrorText.isCancellation(error) { store.error = FeatureErrorText.describe(error) }
            }
        }
    }
}

// MARK: - Sections

struct CallSummarySection: View {
    let detail: CallDetail
    let review: CallReview

    var body: some View {
        CallReviewSection("Итог", icon: "flag") {
            if review.fromMemory {
                FeatureChip(text: "По памяти: только стратегия, без цитат и языка", icon: "brain.head.profile", tint: FeaturePalette.cyan)
            }
            if !review.summary.isEmpty {
                Text(review.summary).font(.body).fixedSize(horizontal: false, vertical: true)
            }
            if let next = review.nextStep {
                nextStep(next)
            }
            if let metrics = detail.metrics, !review.fromMemory {
                CallMetricsGrid(metrics: metrics)
            }
        }
    }

    private func nextStep(_ step: CallNextStep) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Следующий шаг", systemImage: "arrow.forward.circle").font(.subheadline.weight(.semibold))
            Text([step.who, step.what, step.when ?? "срок не назван"].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            if !step.explicit {
                Text("Шаг не проговорён явно — закрепи его в сообщении после звонка.")
                    .font(.footnote)
                    .foregroundStyle(FeaturePalette.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct CallMetricsGrid: View {
    let metrics: CallMetrics

    private struct Item: Identifiable {
        let id: String
        let title: String
        let value: String
    }

    private var items: [Item] {
        var result: [Item] = []
        if let share = metrics.myTalkShare {
            result.append(Item(id: "share", title: "Твоя доля речи", value: (FeatureNumber.int(share * 100).map { String($0) } ?? "—") + " %"))
        }
        if let wpm = metrics.myWordsPerMinute { result.append(Item(id: "wpm", title: "Темп", value: FeatureFormat.integer(wpm) + " сл/мин")) }
        if let longest = metrics.longestMonologueSeconds { result.append(Item(id: "mono", title: "Самый длинный монолог", value: FeatureFormat.clock(longest))) }
        if let latency = metrics.responseLatencyMedianSeconds { result.append(Item(id: "latency", title: "Пауза перед ответом", value: FeatureFormat.decimal(latency) + " с")) }
        if let fillers = metrics.fillersPerMinute { result.append(Item(id: "fillers", title: "Заполнители", value: FeatureFormat.decimal(fillers) + " в мин")) }
        result.append(Item(id: "questions", title: "Твоих вопросов", value: String(metrics.myQuestions)))
        if metrics.clarifyRequests > 0 {
            result.append(Item(id: "clarify", title: "Переспросили", value: FeatureFormat.count(metrics.clarifyRequests, "раз", "раза", "раз")))
        }
        return result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.value).font(.headline).monospacedDigit()
                        Text(item.title).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
            Text("Цифры для наблюдения, без норм и квот.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

struct CallTimelineSection: View {
    let items: [CallTimelineItem]
    let onSeek: ((Double) -> Void)?

    var body: some View {
        CallReviewSection("Ход звонка", icon: "list.bullet.below.rectangle") {
            ForEach(FeatureIndexed.list(items)) { item in
                HStack(alignment: .top, spacing: 12) {
                    Circle().fill(FeaturePalette.violet).frame(width: 8, height: 8).padding(.top, 6)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(item.value.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 6)
                            CallTimeButton(at: item.value.at, onSeek: onSeek)
                        }
                        if !item.value.detail.isEmpty {
                            Text(item.value.detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }
}

struct CallWinsSection: View {
    let wins: [CallWin]
    let onSeek: ((Double) -> Void)?

    var body: some View {
        CallReviewSection("Что сработало", icon: "hand.thumbsup") {
            ForEach(FeatureIndexed.list(wins)) { item in
                VStack(alignment: .leading, spacing: 6) {
                    Label(item.value.title, systemImage: "checkmark.circle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    if !item.value.detail.isEmpty {
                        Text(item.value.detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if let quote = item.value.quote, !quote.isEmpty {
                        HStack(alignment: .top) {
                            FeatureQuote(text: quote)
                            Spacer(minLength: 6)
                            CallTimeButton(at: item.value.at, onSeek: onSeek)
                        }
                    }
                }
            }
        }
    }
}

struct CallCostsSection: View {
    let costs: [CallCost]
    let patterns: [CommunicationPattern]
    @ObservedObject var store: CallsStore
    @ObservedObject var player: FeatureAudioPlayer
    let onSeek: ((Double) -> Void)?

    var body: some View {
        CallReviewSection("Что стоило денег", icon: "dollarsign.circle", subtitle: "По порядку цены: сначала деньги и условия, потом всё остальное.") {
            ForEach(FeatureIndexed.list(costs)) { item in
                CallCostCard(cost: item.value, patternTitle: patternTitle(item.value.patternId), store: store, player: player, onSeek: onSeek)
            }
        }
    }

    private func patternTitle(_ id: String?) -> String? {
        guard let id else { return nil }
        return patterns.first { $0.id == id }?.title
    }
}

struct CallCostCard: View {
    let cost: CallCost
    let patternTitle: String?
    @ObservedObject var store: CallsStore
    @ObservedObject var player: FeatureAudioPlayer
    let onSeek: ((Double) -> Void)?

    private var impactTint: Color {
        switch cost.impact {
        case "high": return FeaturePalette.error
        case "low": return FeaturePalette.lavender
        default: return FeaturePalette.warning
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text("\(cost.rank)")
                    .font(.subheadline.weight(.bold))
                    .fontDesign(.rounded)
                    .frame(width: 30, height: 30)
                    .background(impactTint.opacity(0.3), in: Circle())
                VStack(alignment: .leading, spacing: 6) {
                    Text(cost.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        FeatureChip(text: FeatureLabels.costImpact(cost.impact), tint: impactTint)
                        FeatureChip(text: FeatureLabels.costCategory(cost.category), tint: FeaturePalette.lavender)
                    }
                }
            }
            if !cost.detail.isEmpty {
                Text(cost.detail).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            if let quote = cost.quote, !quote.isEmpty {
                HStack(alignment: .top) {
                    FeatureQuote(text: quote)
                    Spacer(minLength: 6)
                    CallTimeButton(at: cost.at, onSeek: onSeek)
                }
            }
            if let usd = cost.impactUsd {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Цена ошибки ≈ " + FeatureFormat.money(usd, currency: "USD"), systemImage: "chart.line.downtrend.xyaxis")
                        .font(.subheadline.weight(.semibold))
                    if let basis = cost.impactBasis, !basis.isEmpty {
                        Text(basis).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !cost.better.isEmpty {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Как сказать сильнее").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(cost.better)
                            .font(.subheadline.weight(.semibold))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    CallSpeakButton(text: cost.better, store: store, player: player)
                }
                .padding(12)
                .featureGlass(radius: 18, tint: FeaturePalette.lime.opacity(0.55))
            }
            if let patternTitle {
                Label("Паттерн: " + patternTitle, systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

struct CallBetterAnswersSection: View {
    let answers: [CallBetterAnswer]
    @ObservedObject var store: CallsStore
    @ObservedObject var player: FeatureAudioPlayer
    let onSeek: ((Double) -> Void)?

    var body: some View {
        CallReviewSection("Лучшие ответы", icon: "text.bubble", subtitle: "Готовые реплики твоим голосом — проговори вслух до автоматизма.") {
            ForEach(FeatureIndexed.list(answers)) { item in
                VStack(alignment: .leading, spacing: 8) {
                    if !item.value.situation.isEmpty {
                        Text(item.value.situation).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    }
                    if let trigger = item.value.trigger, !trigger.isEmpty {
                        HStack(alignment: .top) {
                            FeatureQuote(text: trigger)
                            Spacer(minLength: 6)
                            CallTimeButton(at: item.value.at, onSeek: onSeek)
                        }
                    }
                    HStack(alignment: .top, spacing: 12) {
                        Text(item.value.answer)
                            .font(.subheadline)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        CallSpeakButton(text: item.value.answer, store: store, player: player)
                    }
                    .padding(12)
                    .featureGlass(radius: 18, tint: FeaturePalette.lime.opacity(0.45))
                }
            }
        }
    }
}

struct CallDealSection: View {
    let review: CallReview
    let onSeek: ((Double) -> Void)?

    private func money(_ value: Double) -> String { FeatureFormat.money(value, currency: review.dealModel?.currency ?? "USD") }

    var body: some View {
        CallReviewSection("Сделка", icon: "doc.plaintext", subtitle: "О чём договорились и что это значит в цифрах.") {
            ForEach(FeatureIndexed.list(review.agreedTerms)) { item in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.value.term).font(.subheadline.weight(.semibold))
                        Spacer(minLength: 6)
                        if item.value.clarity != "explicit" {
                            FeatureChip(text: item.value.clarity == "implied" ? "подразумевается" : "неясно", tint: FeaturePalette.warning)
                        }
                    }
                    Text(item.value.value).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    if let quote = item.value.quote, !quote.isEmpty {
                        HStack(alignment: .top) {
                            FeatureQuote(text: quote)
                            Spacer(minLength: 6)
                            CallTimeButton(at: item.value.at, onSeek: onSeek)
                        }
                    }
                }
            }
            if !review.dealTable.isEmpty {
                dealTable
            }
            if let breakEven = review.breakEven, let floor = review.dealModel?.floor {
                Label("До твоего пола " + money(floor) + " видео добирает только при базе ≈ " + money(breakEven) + ".",
                      systemImage: "scalemass")
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var dealTable: some View {
        let floor = review.dealModel?.floor
        let percent = review.dealModel?.percent.map { FeatureFormat.decimal($0) + " %" } ?? "%"
        return VStack(alignment: .leading, spacing: 6) {
            if let base = review.dealModel?.base, !base.isEmpty {
                Text("База процента: " + base).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                    Text("База")
                    Text(percent)
                    Text("Всего")
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                Divider()
                ForEach(FeatureIndexed.list(review.dealTable)) { item in
                    GridRow {
                        Text(money(item.value.base))
                        Text(money(item.value.percentFee))
                        Text(money(item.value.total))
                            .fontWeight(floor.map { item.value.total >= $0 } ?? false ? .bold : .regular)
                    }
                    .font(.subheadline)
                    .monospacedDigit()
                }
            }
            .padding(12)
            .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

struct CallDebatableSection: View {
    let items: [CallDebatable]
    let onSeek: ((Double) -> Void)?

    var body: some View {
        CallReviewSection("Спорные моменты", icon: "scale.3d", subtitle: "Решения с аргументами в обе стороны. Вывод — ориентир, не приговор.") {
            ForEach(FeatureIndexed.list(items)) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.value.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    if let quote = item.value.quote, !quote.isEmpty {
                        HStack(alignment: .top) {
                            FeatureQuote(text: quote)
                            Spacer(minLength: 6)
                            CallTimeButton(at: item.value.at, onSeek: onSeek)
                        }
                    }
                    if !item.value.forSide.isEmpty { side("За", item.value.forSide, icon: "plus.circle") }
                    if !item.value.againstSide.isEmpty { side("Против", item.value.againstSide, icon: "minus.circle") }
                    if !item.value.verdict.isEmpty {
                        Text("Вывод: " + item.value.verdict)
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private func side(_ title: String, _ text: String, icon: String) -> some View {
        Label {
            Text(title + ": ").font(.subheadline.weight(.semibold)) + Text(text).font(.subheadline)
        } icon: {
            Image(systemName: icon).foregroundStyle(FeaturePalette.violet)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct CallLanguageSection: View {
    let items: [CallLanguageIssue]
    let minorIgnored: Int
    let onSeek: ((Double) -> Void)?

    var body: some View {
        CallReviewSection("Английский", icon: "textformat.abc", subtitle: "Только ошибки, которые меняют смысл или делают тебя младше.") {
            ForEach(FeatureIndexed.list(items)) { item in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .top) {
                        FeatureQuote(text: item.value.quote, strike: !item.value.asrSuspect)
                        Spacer(minLength: 6)
                        CallTimeButton(at: item.value.at, onSeek: onSeek)
                    }
                    if !item.value.correction.isEmpty {
                        Label(item.value.correction, systemImage: "arrow.turn.down.right")
                            .font(.subheadline.weight(.semibold))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !item.value.why.isEmpty {
                        Text(item.value.why).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 6) {
                        FeatureChip(text: FeatureLabels.languageImpact(item.value.impact),
                                    tint: item.value.impact == "meaning" ? FeaturePalette.error : FeaturePalette.warning)
                        if item.value.asrSuspect {
                            FeatureChip(text: "возможно, неверно расслышано", icon: "questionmark.circle", tint: FeaturePalette.cyan)
                        }
                    }
                }
                .opacity(item.value.asrSuspect ? 0.75 : 1)
            }
            if minorIgnored > 0 {
                Text("Ещё " + FeatureFormat.count(minorIgnored, "мелкая оговорка", "мелкие оговорки", "мелких оговорок") + " — не разбираю, смысл они не меняют.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct CallFollowUpSection: View {
    let followUp: CallFollowUp

    private var copyText: String {
        if let subject = followUp.subject, !subject.isEmpty { return "Subject: " + subject + "\n\n" + followUp.text }
        return followUp.text
    }

    var body: some View {
        CallReviewSection("Сообщение после звонка", icon: followUp.channel == "email" ? "envelope" : "message",
                          subtitle: "Закрепи все условия письменно. Подставь значения в [[скобках]] перед отправкой.") {
            if let subject = followUp.subject, !subject.isEmpty {
                Text("Тема: " + subject).font(.subheadline.weight(.semibold))
            }
            CallFollowUpText(text: followUp.text)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FeaturePalette.track, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            ForEach(followUp.notes, id: \.self) { note in
                Label(note, systemImage: "lightbulb").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            FeatureCopyButton(text: copyText, title: "Скопировать сообщение")
        }
    }
}

/// English follow-up text with [[placeholders]] emphasised.
struct CallFollowUpText: View {
    let text: String

    var body: some View {
        composed
            .font(.body)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var composed: Text {
        var result = Text("")
        var remainder = Substring(text)
        while let open = remainder.range(of: "[["),
              let close = remainder.range(of: "]]", range: open.upperBound..<remainder.endIndex) {
            result = result + Text(String(remainder[remainder.startIndex..<open.lowerBound]))
            result = result + Text(String(remainder[open.lowerBound..<close.upperBound]))
                .bold()
                .foregroundStyle(FeaturePalette.violet)
            remainder = remainder[close.upperBound...]
        }
        return result + Text(String(remainder))
    }
}

struct CallRisksSection: View {
    let risks: [CallRisk]
    var body: some View {
        CallReviewSection("Риски", icon: "exclamationmark.shield", subtitle: "Что закрыть до начала работы.") {
            ForEach(FeatureIndexed.list(risks)) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(item.id + 1). " + item.value.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    if !item.value.detail.isEmpty {
                        Text(item.value.detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

struct CallPatternsSection: View {
    let outcomes: [CallPatternOutcome]
    let patterns: [CommunicationPattern]

    var body: some View {
        CallReviewSection("Паттерны", icon: "point.3.connected.trianglepath.dotted", subtitle: "Что повторилось, а что ты удержал в этом звонке.") {
            ForEach(FeatureIndexed.list(outcomes)) { item in
                HStack(alignment: .top, spacing: 12) {
                    Text(FeatureLabels.patternOutcomeSymbol(item.value.status))
                        .font(.title3.weight(.bold))
                        .foregroundStyle(PatternHistoryDots.color(item.value.status))
                        .frame(width: 22)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(patterns.first { $0.id == item.value.patternId }?.title ?? item.value.patternId)
                            .font(.subheadline.weight(.semibold))
                        Text(FeatureLabels.patternOutcome(item.value.status)).font(.caption).foregroundStyle(.secondary)
                        if !item.value.evidence.isEmpty { FeatureQuote(text: item.value.evidence) }
                    }
                }
                .accessibilityElement(children: .combine)
            }
            NavigationLink(value: CallsRoute.patterns) {
                Label("Все паттерны", systemImage: "chevron.right")
            }
            .buttonStyle(QuietButton())
        }
    }
}

struct CallFactsSection: View {
    let facts: [ProfileFact]
    @ObservedObject var store: CallsStore

    var body: some View {
        CallReviewSection("Факты для профиля", icon: "person.text.rectangle",
                          subtitle: "Прими то, что верно: эти факты будут знать собеседник, подсказки и разбор.") {
            ForEach(facts) { fact in
                FactRow(fact: fact, busy: store.isBusy("fact:" + fact.id),
                        onAccept: { Task { await store.decideFact(factId: fact.id, accept: true) } },
                        onReject: { Task { await store.decideFact(factId: fact.id, accept: false) } })
            }
        }
    }
}

struct CallLimitationsSection: View {
    let limitations: [String]
    let dropped: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Границы разбора").font(.headline)
            ForEach(limitations, id: \.self) { line in
                Label(line, systemImage: "info.circle").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if dropped > 0 {
                Label("Отброшено пунктов: \(dropped) — их цитаты не нашлись в расшифровке.", systemImage: "line.3.horizontal.decrease.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .featureGlass(radius: 24)
    }
}
