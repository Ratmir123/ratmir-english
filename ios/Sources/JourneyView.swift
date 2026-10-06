import SwiftUI

enum JourneyCopy {
    static func icon(_ track: String) -> String {
        switch track { case "work": return "briefcase"; case "relocation": return "airplane"; case "ielts-foundation": return "book.closed"; default: return "bubble.left.and.bubble.right" }
    }
    static func activityIcon(_ activity: String) -> String {
        switch activity { case "listening": return "ear"; case "reading": return "text.book.closed"; case "writing": return "square.and.pencil"; default: return "waveform" }
    }
}

/// v0.4 name kept: a spring-filled bar whose counter never exceeds its target.
struct JourneyProgressBar: View {
    let current: Int
    let target: Int
    var color = Theme.violet
    var body: some View {
        LiquidProgressBar(value: ProgressCopy.ratio(current, target), color: color)
            .accessibilityLabel("Прогресс")
            .accessibilityValue("\(ProgressCopy.capped(current, target)) из \(max(0, target))")
    }
}

/// The rank inside Today's «Уровень» surface (PASS 0.5.3 §8, a row, not a card of its own): the medal large, alive and
/// spinnable on its own (never inside the button), a breathing aura in the rank colour, the rank title in that colour,
/// the XP bar in the rank's metal with a slow shimmer and «до «Ритм» — 120 XP». The text side opens Progress.
struct RankStrip: View {
    let progression: ProgressionState
    var open: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// 56 pt before PASS 0.5.3.
    static let medalSide: CGFloat = 84
    private var rank: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var next: PracticeRank? { RewardArt.nextRank(progression.level) }
    private var xpLine: String {
        guard let next else { return RuFormat.xp(progression.xp) + " · все ранги открыты" }
        return "до «\(next.title)» — " + RuFormat.xp(max(0, next.minimumXP - progression.xp))
    }
    private var progress: Double {
        guard let next else { return 1 }
        return Double(max(0, progression.xp - rank.minimumXP)) / Double(max(1, next.minimumXP - rank.minimumXP))
    }
    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // Large text keeps the full width: the medal sits above the words.
                VStack(alignment: .leading, spacing: 12) {
                    medal
                    details
                }
            } else {
                HStack(spacing: 16) {
                    medal
                    details
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var medal: some View {
        RankEmblem(level: progression.level, size: RankStrip.medalSide, aura: true)
    }

    private var details: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(rank.title).font(TypeScale.title3).foregroundStyle(RankPalette.ink(rank.art))
                        Text("ур. \(progression.level)").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                    }
                    if next != nil {
                        RankXPBar(value: progress, art: rank.art)
                    }
                    Text(xpLine).font(.footnote).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                        .contentTransition(reduceMotion ? .identity : .numericText(value: Double(progression.xp)))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
            }
            .foregroundStyle(Theme.ink)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressButton())
        .accessibilityLabel("Ранг «\(rank.title)», уровень опыта \(progression.level), \(RuFormat.xp(progression.xp)), " + xpLine)
        .accessibilityHint("Открывает вкладку «Прогресс»")
    }
}

/// XP toward the next rank in the rank's own metal with a slow shimmer (PASS 0.5.3 §8). The shimmer holds still with
/// Reduce Motion, offscreen, in the background and under the launch layer.
struct RankXPBar: View {
    let value: Double
    let art: String
    var height: CGFloat = 7
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.shellCovered) private var shellCovered
    @State private var visible = false
    /// One soft light sweeps along the fill in `shimmerSweep` seconds, once per `shimmerPeriod`.
    static let shimmerPeriod = 5.6
    static let shimmerSweep = 2.4
    private var clamped: Double { value.isFinite ? min(1, max(0, value)) : 0 }
    private var shimmering: Bool { !reduceMotion && visible && !shellCovered && scenePhase == .active && clamped > 0 }
    var body: some View {
        GeometryReader { proxy in
            let fill = max(clamped > 0 ? height : 0, proxy.size.width * CGFloat(clamped))
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.ink.opacity(0.08))
                Capsule()
                    .fill(LinearGradient(colors: RankPalette.bar(art), startPoint: .leading, endPoint: .trailing))
                    .frame(width: fill)
                if shimmering {
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                        RankXPBar.shimmer(time: context.date.timeIntervalSinceReferenceDate, fill: fill, height: height)
                    }
                    .frame(width: fill, alignment: .leading)
                    .allowsHitTesting(false)
                }
            }
        }
        .frame(height: height)
        .animation(reduceMotion ? nil : NativeMotion.progress, value: clamped)
        .modifier(RewardVisibility(visible: $visible))
        .accessibilityElement()
        .accessibilityLabel("Опыт до следующего ранга")
        .accessibilityValue("\(Int((clamped * 100).rounded())) процентов")
    }

    /// A soft light band that eases along the fill and fades in and out at its ends (no clipping or blur).
    private static func shimmer(time: TimeInterval, fill: CGFloat, height: CGFloat) -> some View {
        let phase = time.truncatingRemainder(dividingBy: shimmerPeriod) / shimmerSweep
        let progress = min(1, max(0, phase))
        let band = max(height * 3, fill * 0.3)
        let travel = max(0, fill - band)
        let eased = (1 - cos(Double.pi * progress)) / 2
        let glow = phase < 1 ? sin(Double.pi * progress) : 0
        return Capsule()
            .fill(LinearGradient(colors: [Color.white.opacity(0), Color.white.opacity(0.5), Color.white.opacity(0)],
                                 startPoint: .leading, endPoint: .trailing))
            .frame(width: band, height: height)
            .offset(x: travel * CGFloat(eased))
            .opacity(glow)
    }
}

/// The full rank card on Progress: medal (132 pt with its aura, PASS 0.5.3 §8), rank, XP bar and the ladder link.
struct JourneySummary: View {
    let progression: ProgressionState
    /// Practice facts in words (web RankCard): «12 практик с разбором, 5 дней с практикой. На этой неделе — 3 из 7.»
    var facts: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 104 pt before PASS 0.5.3.
    static let medalSide: CGFloat = 132
    private var rank: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var nextRank: PracticeRank? { RewardArt.nextRank(progression.level) }
    var body: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 16) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 18) { medal; rankHeading; Spacer(minLength: 0) }
                    VStack(alignment: .leading, spacing: 12) { medal; rankHeading }
                }
                if let nextRank {
                    LiquidProgressBar(value: Double(max(0, progression.xp - rank.minimumXP)) / Double(max(1, nextRank.minimumXP - rank.minimumXP)))
                    Text("До «\(nextRank.title)» — \(RuFormat.xp(max(0, nextRank.minimumXP - progression.xp)))")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                } else {
                    Text("Все шесть рангов открыты. Опыт практики продолжает расти.").font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                if let facts, !facts.isEmpty {
                    Text(facts).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                NavigationLink { RankLadderView() } label: {
                    HStack {
                        Text("Все ранги").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(PressButton()).foregroundStyle(Theme.ink)
            }
        }
    }
    private var medal: some View {
        RankEmblem(level: progression.level, size: JourneySummary.medalSide, aura: true)
    }
    private var rankHeading: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(rank.title).font(TypeScale.title).accessibilityAddTraits(.isHeader)
            Text(RuFormat.xp(progression.xp) + " · ранг опыта — растёт от практики, не от языка")
                .font(.subheadline).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                .contentTransition(reduceMotion ? .identity : .numericText(value: Double(progression.xp)))
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct RankLadderView: View {
    @EnvironmentObject private var client: TrainingClient
    private var progression: ProgressionState? { client.state?.progression }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Ранги открываются за XP из завершённых занятий. Это опыт практики — не CEFR и не оценка IELTS.")
                        .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                        .entrance(0)
                    // Each rank row takes its own step (1…6) of the staircase.
                    if let progression { RankLadder(progression: progression) }
                    Color.clear.frame(height: 1).id("rank-ladder-bottom")
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
                .entranceStage()
            }
#if DEBUG
            .task {
                if PreviewFixtures.screen == "ranks-bottom" {
                    try? await Task.sleep(for: .milliseconds(200))
                    proxy.scrollTo("rank-ladder-bottom", anchor: .bottom)
                }
            }
#endif
        }
        .modifier(LiquidCanvas())
        .navigationTitle("Ранги")
        .navigationBarTitleDisplayMode(.large)
    }
}

struct RankLadder: View {
    let progression: ProgressionState
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var current: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var next: PracticeRank? { RewardArt.nextRank(progression.level) }
    var body: some View {
        VStack(spacing: 10) {
            ForEach(Array(RewardArt.ranks.enumerated()), id: \.element.id) { index, rank in
                // Outside a staircase (no `entranceStage`) this is a no-op.
                rankRow(rank).entrance(index + 1)
            }
        }
    }

    /// PASS 0.5.3 §8: the current rank is bigger, alive and glowing in its colour; locked ranks are muted.
    private func medalSide(current: Bool) -> CGFloat {
        if dynamicTypeSize.isAccessibilitySize { return current ? 88 : 72 }
        return current ? 104 : 84
    }

    private func rankRow(_ rank: PracticeRank) -> some View {
        let isCurrent = rank.id == current.id
        let isNext = rank.id == next?.id
        let unlocked = progression.level >= rank.from
        return HStack(spacing: 14) {
            RankEmblem(level: rank.from, size: medalSide(current: isCurrent), animated: isCurrent, aura: isCurrent)
                .saturation(unlocked ? 1 : 0)
                .opacity(unlocked ? 1 : 0.4)
            VStack(alignment: .leading, spacing: 5) {
                Text(rank.title).font(TypeScale.title3)
                    .foregroundStyle(isCurrent ? RankPalette.ink(rank.art) : unlocked ? Theme.ink : Theme.inkSecondary)
                Text("от \(RuFormat.xp(rank.minimumXP))").font(.caption).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                Text(isCurrent ? "Твой ранг · \(RuFormat.xp(progression.xp)) сейчас" : isNext ? "Ещё \(RuFormat.xp(max(0, rank.minimumXP - progression.xp)))" : unlocked ? "Открыт" : "Впереди")
                    .font(.footnote.weight(isNext ? .semibold : .regular))
                    .foregroundStyle(isNext || isCurrent ? Theme.ink : Theme.inkSecondary).monospacedDigit()
            }
            Spacer(minLength: 0)
            Image(systemName: isCurrent ? "circle.inset.filled" : unlocked ? "checkmark" : "lock.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(isCurrent ? Theme.violet : Theme.inkSecondary)
        }
        .padding(12)
        .background(isCurrent ? Theme.solid : Color.clear, in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        // The current rank's aura glows inside its own row, never over the neighbours.
        .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        .overlay {
            if isCurrent { RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).strokeBorder(Theme.violet.opacity(0.5), lineWidth: 1.5) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(rank.title), от \(rank.minimumXP) XP. " + (isCurrent ? "Твой текущий ранг." : unlocked ? "Открыт." : isNext ? "Следующий ранг." : "Пока впереди."))
    }
}

/// Achievements: counters capped at the target, unlocked shows «Открыто · дата», locked art is desaturated (L-28).
struct AchievementsList: View {
    let achievements: [PracticeAchievement]
    private var nextGoalID: String? {
        achievements.filter { !$0.unlocked }.max {
            ProgressCopy.ratio($0.current, $0.target) < ProgressCopy.ratio($1.current, $1.target)
        }?.id
    }
    var body: some View {
        VStack(spacing: 12) {
            ForEach(Array(achievements.enumerated()), id: \.element.id) { index, achievement in
                AchievementRow(achievement: achievement, nearestGoal: achievement.id == nextGoalID)
                    .rowReveal(index)
            }
        }
    }
}

struct AchievementRow: View {
    let achievement: PracticeAchievement
    var nearestGoal = false
    var body: some View {
        LiquidCard(radius: Radius.tile, padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 14) {
                    ZStack {
                        if nearestGoal && !achievement.unlocked {
                            Circle().trim(from: 0, to: CGFloat(ProgressCopy.ratio(achievement.current, achievement.target)))
                                .stroke(Theme.violet, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                                .frame(width: 70, height: 70)
                        }
                        RewardImage(name: RewardArt.achievement(achievement.id), size: 62,
                                    motion: achievement.unlocked ? .earned : nearestGoal ? .goal : .still, locked: !achievement.unlocked)
                    }
                    .frame(width: 72, height: 72)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(achievement.title).font(.headline)
                        Text(ProgressCopy.achievementStatus(achievement))
                            .font(.caption.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(achievement.unlocked ? Theme.limeInk : Theme.inkSecondary)
                    }
                    Spacer(minLength: 0)
                }
                Text(achievement.description).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !achievement.unlocked {
                    JourneyProgressBar(current: achievement.current, target: achievement.target)
                    NavigationLink { AchievementPracticeView(achievement: achievement) } label: {
                        HStack { Text("Как получить"); Spacer(); Image(systemName: "chevron.right") }
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(QuietButton())
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

struct PracticeOutcomeView: View {
    let result: PracticeResult
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Что осталось от практики").font(.headline)
                    Spacer()
                    Text("+\(result.xp) XP").font(.subheadline.weight(.bold)).foregroundStyle(Theme.limeInk).monospacedDigit()
                }
                Text("Целевых навыков с наблюдениями: \(ProgressCopy.fraction(result.quality.observedTargets, result.quality.targetCount))")
                    .font(.subheadline.weight(.medium))
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 14) { qualityCounts }
                    VStack(alignment: .leading, spacing: 8) { qualityCounts }
                }.font(.footnote)
                if !result.evidence.isEmpty {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(result.evidence.enumerated()), id: \.offset) { _, evidence in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(SkillCopy.title(evidence.skill)).font(.caption.weight(.semibold))
                                    Text(evidence.quote).font(.subheadline).textSelection(.enabled)
                                    Text(evidenceLabel(evidence)).font(.caption).foregroundStyle(Theme.inkSecondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }.padding(.top, 10)
                    } label: { Text("Показать свои примеры").font(.footnote.weight(.semibold)) }
                }
            }
        }
    }
    @ViewBuilder private var qualityCounts: some View {
        Label("Самостоятельно: \(result.quality.independentSuccesses)", systemImage: "checkmark.circle")
        Label("С опорой: \(result.quality.supportedObservations)", systemImage: "lightbulb")
    }
    private func evidenceLabel(_ evidence: PracticeResult.Evidence) -> String {
        if evidence.supported { return "Наблюдение с опорой" }
        switch evidence.result { case "success": return "Самостоятельный успех"; case "partial": return "Получилось частично"; default: return "Пока есть трудность" }
    }
}
