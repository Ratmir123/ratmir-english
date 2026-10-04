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

/// Compact rank and XP for Today (44 pt medal, rank, XP bar → Progress).
struct RankStrip: View {
    let progression: ProgressionState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var rank: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var next: PracticeRank? { RewardArt.nextRank(progression.level) }
    var body: some View {
        HStack(spacing: 14) {
            RankEmblem(level: progression.level, size: 48, animated: false)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(rank.title).font(.subheadline.weight(.semibold))
                    Text("уровень опыта").font(.caption).foregroundStyle(Theme.inkSecondary)
                    Spacer(minLength: 4)
                    Text(RuFormat.xp(progression.xp)).font(.footnote.weight(.semibold)).monospacedDigit()
                        .contentTransition(reduceMotion ? .identity : .numericText(value: Double(progression.xp)))
                }
                if let next {
                    LiquidProgressBar(value: Double(max(0, progression.xp - rank.minimumXP)) / Double(max(1, next.minimumXP - rank.minimumXP)), height: 6)
                    Text("До «\(next.title)» — \(RuFormat.xp(max(0, next.minimumXP - progression.xp)))")
                        .font(.caption).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                } else {
                    Text("Все ранги открыты").font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
        }
        .foregroundStyle(Theme.ink)
        .padding(14)
        .modifier(LiquidChrome(radius: Radius.tile, tint: nil, interactive: false))
        .accessibilityElement(children: .combine)
    }
}

/// The full rank card on Progress: medal, rank, XP bar and the ladder link.
struct JourneySummary: View {
    let progression: ProgressionState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var rank: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var nextRank: PracticeRank? { RewardArt.nextRank(progression.level) }
    var body: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 16) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 14) { RankEmblem(level: progression.level, size: 104); rankHeading; Spacer(minLength: 0) }
                    VStack(alignment: .leading, spacing: 10) { RankEmblem(level: progression.level, size: 104); rankHeading }
                }
                if let nextRank {
                    LiquidProgressBar(value: Double(max(0, progression.xp - rank.minimumXP)) / Double(max(1, nextRank.minimumXP - rank.minimumXP)))
                    Text("До «\(nextRank.title)» — \(RuFormat.xp(max(0, nextRank.minimumXP - progression.xp)))")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                } else {
                    Text("Все шесть рангов открыты. Опыт практики продолжает расти.").font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                NavigationLink { RankLadderView() } label: {
                    HStack {
                        Text("Все ранги").font(.subheadline.weight(.semibold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(PressButton()).foregroundStyle(Theme.ink)
            }
        }
    }
    private var rankHeading: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ТВОЙ РАНГ · ОПЫТ ПРАКТИКИ").font(.caption2.weight(.bold)).tracking(1).foregroundStyle(Theme.inkSecondary)
            Text(rank.title).font(TypeScale.title)
            Text(RuFormat.xp(progression.xp)).font(TypeScale.stat)
                .contentTransition(reduceMotion ? .identity : .numericText(value: Double(progression.xp)))
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
                    if let progression { RankLadder(progression: progression) }
                    Color.clear.frame(height: 1).id("rank-ladder-bottom")
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
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
            ForEach(RewardArt.ranks) { rank in
                rankRow(rank)
            }
        }
    }

    private func rankRow(_ rank: PracticeRank) -> some View {
        let isCurrent = rank.id == current.id
        let isNext = rank.id == next?.id
        let unlocked = progression.level >= rank.from
        return HStack(spacing: 14) {
            RankEmblem(level: rank.from, size: dynamicTypeSize.isAccessibilitySize ? 72 : 84, animated: isCurrent)
                .saturation(unlocked ? 1 : 0)
                .opacity(unlocked ? 1 : 0.45)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(rank.title).font(TypeScale.title3)
                    if isCurrent { StatusPill(title: "Твой ранг", color: Theme.lime) }
                }
                Text("от \(RuFormat.xp(rank.minimumXP))").font(.caption).foregroundStyle(Theme.inkSecondary).monospacedDigit()
                Text(isCurrent ? "\(RuFormat.xp(progression.xp)) сейчас" : isNext ? "Ещё \(RuFormat.xp(max(0, rank.minimumXP - progression.xp)))" : unlocked ? "Открыт" : "Впереди")
                    .font(.footnote.weight(isNext ? .semibold : .regular))
                    .foregroundStyle(isNext || isCurrent ? Theme.ink : Theme.inkSecondary).monospacedDigit()
            }
            Spacer(minLength: 0)
            Image(systemName: isCurrent ? "circle.inset.filled" : unlocked ? "checkmark" : "lock.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(isCurrent ? Theme.violet : Theme.inkSecondary)
        }
        .padding(12)
        .background(isCurrent ? Theme.lavender.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
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
                    .staggeredReveal(index)
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
