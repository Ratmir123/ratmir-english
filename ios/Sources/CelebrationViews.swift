import SwiftUI

/// The reward after a confirmed completion (C-02): "+N XP" rolls, the rank bar springs from
/// the value before, a new achievement is named. Shown on Today, auto-hides after a few seconds.
struct CompletionCelebration: View {
    let moment: CompletionMoment
    var onCelebrate: () -> Void = {}
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var shownXP = 0
    private var progression: ProgressionState? { client.state?.progression }
    private var result: PracticeResult? { progression?.recentResults.first { $0.sessionId == moment.sessionId } }
    private var newAchievement: PracticeAchievement? {
        guard !moment.deferred else { return nil }
        return progression?.achievements.first { $0.unlocked && !moment.unlockedBefore.contains($0.id) }
    }
    private var currentXP: Int { max(moment.xpBefore, progression?.xp ?? moment.xpBefore) }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VoiceOrb(mode: .ready, level: 0, mood: moment.deferred ? .calm : .love,
                     statusDescription: moment.deferred ? "Занятие сохранено" : "Занятие завершено", interactive: false)
                .frame(width: 54, height: 54)
            details
            Spacer(minLength: 0)
            Button { client.dismissCompletionMoment() } label: {
                Image(systemName: "xmark").font(.caption.weight(.bold))
            }
            .buttonStyle(LiquidIconButton(size: 36))
            .accessibilityLabel("Скрыть")
        }
        .padding(12)
        .modifier(LiquidChrome(radius: Radius.tile, tint: moment.deferred ? nil : Theme.lime.opacity(0.35), interactive: false))
        .padding(.horizontal, 14)
        .frame(maxWidth: 560)
        .task(id: moment.id) { await play() }
        .onChange(of: progression?.xp ?? -1) { _, value in
            guard value >= 0 else { return }
            withAnimation(reduceMotion ? nil : NativeMotion.bouncy) { shownXP = max(moment.xpBefore, value) }
        }
        .accessibilityElement(children: .contain)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(moment.deferred ? "На сегодня сохранили" : "Занятие завершено")
                .font(.subheadline.weight(.semibold))
            HStack(spacing: 6) {
                if let result {
                    Text("+\(result.xp) XP")
                        .font(.subheadline.weight(.bold)).monospacedDigit()
                        .foregroundStyle(Theme.limeInk)
                        .contentTransition(reduceMotion ? .identity : .numericText(value: Double(result.xp)))
                } else {
                    Text("Считаю опыт…").font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                if moment.deferred {
                    Text("· попытка ждёт").font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
            }
            rankBar
            if let achievement = newAchievement {
                Label("Новая награда: " + achievement.title, systemImage: "rosette")
                    .font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private var rankBar: some View {
        if let progression {
            let rank = RewardArt.practiceRank(progression.level)
            if let next = RewardArt.nextRank(progression.level) {
                let span = max(1, next.minimumXP - rank.minimumXP)
                let value = Double(max(0, shownXP - rank.minimumXP)) / Double(span)
                LiquidProgressBar(value: value, color: Theme.violet, height: 6)
                    .frame(maxWidth: 220)
                    .accessibilityLabel("До ранга «\(next.title)»")
            }
        }
    }

    private func play() async {
        shownXP = moment.xpBefore
        if !moment.deferred { onCelebrate() }
        do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
        withAnimation(reduceMotion ? nil : NativeMotion.bouncy) { shownXP = currentXP }
        guard !voiceOver else { return }
        do { try await Task.sleep(for: .seconds(7)) } catch { return }
        if client.completionMoment?.id == moment.id { client.dismissCompletionMoment() }
    }
}

/// Rank up: a full-screen glass moment, the medal drops in with a bounce (DESIGN-SYSTEM Celebrations).
struct RankUpOverlay: View {
    let level: Int
    let onClaim: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dropped = false
    @State private var burst = 0
    private var rank: PracticeRank { RewardArt.practiceRank(level) }

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            Theme.base.opacity(0.35).ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer(minLength: 20)
                RankEmblem(level: level, size: 190, animated: dropped)
                    .offset(y: dropped || reduceMotion ? 0 : -260)
                    .scaleEffect(dropped || reduceMotion ? 1 : 0.6)
                    .opacity(dropped || reduceMotion ? 1 : 0)
                VStack(spacing: 10) {
                    Text("НОВЫЙ РАНГ").font(.caption.weight(.bold)).tracking(1.4).foregroundStyle(Theme.violet)
                    Text("«\(rank.title)»").font(TypeScale.hero).multilineTextAlignment(.center)
                    Text("Ранг отмечает опыт практики, а не уровень языка. Продолжай в своём темпе.")
                        .font(.subheadline).foregroundStyle(Theme.inkSecondary).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 28)
                Spacer(minLength: 20)
                Button(action: onClaim) {
                    HStack { Text("Забрать"); Spacer(); Image(systemName: "checkmark") }
                }
                .buttonStyle(PrimaryButton())
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .frame(maxWidth: 520)
        }
        .mascotConfetti(trigger: burst, origin: UnitPoint(x: 0.5, y: 0.3))
        .sensoryFeedback(.levelChange, trigger: burst)
        .onAppear {
            withAnimation(reduceMotion ? nil : NativeMotion.bouncy) { dropped = true }
            burst += 1
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}
