import SwiftUI

enum JourneyCopy {
    static func icon(_ track: String) -> String {
        switch track { case "work": return "briefcase"; case "relocation": return "airplane"; case "ielts-foundation": return "book.closed"; default: return "bubble.left.and.bubble.right" }
    }
    static func activityIcon(_ activity: String) -> String {
        switch activity { case "listening": return "ear"; case "reading": return "text.book.closed"; case "writing": return "square.and.pencil"; default: return "waveform" }
    }
    static func focus(_ activity: String) -> String {
        switch activity {
        case "listening": return "Услышать главную мысль и детали, потом уточнить услышанное."
        case "reading": return "Найти основание для ответа в коротком оригинальном тексте."
        case "writing": return "Написать связный абзац: мысль, причина и конкретный пример."
        default: return "Развить ответ от короткой реакции к объяснению и примеру."
        }
    }
    static func skill(_ id: String) -> String {
        ["listening": "Понимание на слух", "vocabulary": "Словарь", "grammar": "Фразы", "coherence": "Связность", "reciprocity": "Внимание к собеседнику", "initiative": "Инициатива", "repair": "Уточнения"][id] ?? id
    }
}

struct JourneyProgressBar: View {
    let current: Int
    let target: Int
    var color = Theme.lavender
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        ProgressView(value: Double(max(0, min(current, max(1, target)))), total: Double(max(1, target)))
            .tint(color).animation(reduceMotion ? nil : NativeMotion.feedback, value: current)
            .accessibilityLabel("Прогресс практики").accessibilityValue("\(current) из \(target)")
    }
}

struct JourneySummary: View {
    let progression: ProgressionState
    private var rank: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var nextRank: PracticeRank? { RewardArt.nextRank(progression.level) }
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { RankEmblem(level: progression.level); rankHeading; Spacer(minLength: 0) }
                    VStack(alignment: .leading, spacing: 10) { RankEmblem(level: progression.level); rankHeading }
                }
                HStack {
                    Text("\(progression.xp) XP").font(.subheadline.weight(.semibold)).monospacedDigit()
                    Spacer()
                    Text("Уровень опыта \(progression.level)").font(.caption).foregroundStyle(Theme.secondary)
                }
                if let nextRank {
                    JourneyProgressBar(current: progression.xp - rank.minimumXP, target: nextRank.minimumXP - rank.minimumXP, color: Theme.lavender)
                    Text("До «\(nextRank.title)» ещё \(max(0, nextRank.minimumXP - progression.xp)) XP")
                        .font(.footnote).foregroundStyle(Theme.secondary).monospacedDigit()
                } else {
                    Text("Все шесть рангов открыты. Опыт практики продолжает расти.").font(.footnote).foregroundStyle(Theme.secondary)
                }
                Text("Ранги отмечают опыт практики. Языковой уровень проверяем по твоим ответам.")
                    .font(.caption).foregroundStyle(Theme.secondary)
                NavigationLink { RankLadderView() } label: {
                    HStack { Text("Все ранги").font(.subheadline.weight(.medium)); Spacer(); Text("6").font(.caption).foregroundStyle(Theme.secondary); Image(systemName: "chevron.right").font(.caption.weight(.semibold)) }
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(PressButton()).foregroundStyle(Theme.charcoal)
                NavigationLink { AchievementsView() } label: {
                    RewardInvitation(unlocked: progression.achievements.filter { $0.unlocked }.count, total: progression.achievements.count)
                }.buttonStyle(PressButton())
                NavigationLink { CurriculumView() } label: { Label("Твой путь", systemImage: "map").font(.footnote.weight(.medium)).frame(minHeight: 44) }
                    .foregroundStyle(Theme.charcoal)
            }
        }
    }
    private var rankHeading: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ТВОЙ РАНГ").font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(Theme.secondary)
            Text(rank.title).font(.title.weight(.semibold))
            Text("Опыт практики").font(.footnote).foregroundStyle(Theme.secondary)
        }
    }
}

/// A clear invitation, without a fake unread counter or a distracting blinking dot.
struct RewardInvitation: View {
    let unlocked: Int
    let total: Int
    var body: some View {
        HStack(spacing: 12) {
            RewardImage(name: RewardArt.achievement("own-improvement"), size: 50, motion: .goal)
            VStack(alignment: .leading, spacing: 3) {
                Text("Награды").font(.headline)
                Text("Открыто \(unlocked) из \(total)").font(.caption).foregroundStyle(Theme.charcoal.opacity(0.74))
            }
            Spacer(minLength: 0)
            Image(systemName: "arrow.up.right").font(.subheadline.weight(.semibold))
        }.foregroundStyle(Theme.charcoal).padding(.horizontal, 14).padding(.vertical, 8)
            .background(Theme.lime, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.white.opacity(0.68), lineWidth: 1).allowsHitTesting(false) }
            .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .accessibilityElement(children: .combine)
    }
}

struct RankLadderView: View {
    @EnvironmentObject private var client: TrainingClient
    private var progression: ProgressionState? { client.state?.progression }
    var body: some View {
        ScrollViewReader { proxy in ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ScreenHeading(title: "Все ранги", subtitle: "Шесть ступеней опыта: от первой попытки до устойчивой практики.")
                Text("Ранги открываются за XP из завершённых занятий. Они не равны CEFR или оценке IELTS.")
                    .font(.subheadline).foregroundStyle(Theme.secondary)
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
        }.modifier(ReadingCanvas()).navigationTitle("Ранги").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}

struct RankLadder: View {
    let progression: ProgressionState
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var current: PracticeRank { RewardArt.practiceRank(progression.level) }
    private var next: PracticeRank? { RewardArt.nextRank(progression.level) }
    var body: some View {
        VStack(spacing: 0) {
            ForEach(RewardArt.ranks) { rank in
                let isCurrent = rank.id == current.id
                let isNext = rank.id == next?.id
                let unlocked = progression.level >= rank.from
                Group {
                    if dynamicTypeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                RankEmblem(level: rank.from, size: 94, animated: isCurrent)
                                Spacer(minLength: 0)
                                rankStatus(isCurrent: isCurrent, unlocked: unlocked)
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                Text(rank.title).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                                if isCurrent { currentRankBadge }
                                rankDetails(rank, isCurrent: isCurrent, isNext: isNext, unlocked: unlocked)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else {
                        HStack(spacing: 12) {
                            RankEmblem(level: rank.from, size: 94, animated: isCurrent)
                            VStack(alignment: .leading, spacing: 5) {
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 8) {
                                        Text(rank.title).font(.title3.weight(.semibold)).fixedSize()
                                        if isCurrent { currentRankBadge.fixedSize() }
                                    }
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(rank.title).font(.title3.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                                        if isCurrent { currentRankBadge }
                                    }
                                }
                                rankDetails(rank, isCurrent: isCurrent, isNext: isNext, unlocked: unlocked)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            rankStatus(isCurrent: isCurrent, unlocked: unlocked)
                        }
                    }
                }.padding(.vertical, dynamicTypeSize.isAccessibilitySize ? 16 : 9).padding(.horizontal, 10)
                    .background(isCurrent ? Theme.lavender.opacity(0.24) : Color.clear, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(rank.title), от \(rank.minimumXP) XP. " + (isCurrent ? "Твой текущий ранг, \(progression.xp) XP." : unlocked ? "Уже открыт." : isNext ? "Следующий ранг, ещё \(max(0, rank.minimumXP - progression.xp)) XP." : "Пока впереди."))
                if rank.id != RewardArt.ranks.last?.id { Divider().padding(.leading, dynamicTypeSize.isAccessibilitySize ? 10 : 116).padding(.trailing, 10).opacity(0.45) }
            }
        }
    }
    private var currentRankBadge: some View {
        Text("Твой ранг").font(.caption2.weight(.semibold))
            .padding(.horizontal, 9).padding(.vertical, 5).background(Theme.lime, in: Capsule())
            .fixedSize(horizontal: false, vertical: true)
    }
    private func rankDetails(_ rank: PracticeRank, isCurrent: Bool, isNext: Bool, unlocked: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Уровень \(rank.from) · от \(rank.minimumXP) XP").font(.caption).foregroundStyle(Theme.secondary).monospacedDigit()
            Text(isCurrent ? "\(progression.xp) XP сейчас" : isNext ? "Ещё \(max(0, rank.minimumXP - progression.xp)) XP" : unlocked ? "Уже открыт" : "Впереди")
                .font(.footnote.weight(isNext ? .medium : .regular)).foregroundStyle(isNext ? Theme.charcoal : Theme.secondary).monospacedDigit()
        }.fixedSize(horizontal: false, vertical: true)
    }
    private func rankStatus(isCurrent: Bool, unlocked: Bool) -> some View {
        Image(systemName: isCurrent ? "circle.inset.filled" : unlocked ? "checkmark" : "lock")
            .font(.caption.weight(.semibold)).foregroundStyle(isCurrent ? Theme.charcoal : Theme.secondary)
            .fixedSize()
    }
}

/// The server picks the next focus; Sol still plans the actual personal lesson.
struct NextPracticeCard: View {
    let progression: ProgressionState
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        if let recommendation = progression.recommendation {
            SurfaceCard(color: Theme.lavender.opacity(0.55)) {
                VStack(alignment: .leading, spacing: 14) {
                    InputLabel(title: "Короткий следующий шаг")
                    Label(recommendation.title, systemImage: JourneyCopy.icon(recommendation.track)).font(.title3.weight(.semibold))
                    Text(recommendation.why)
                        .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Text("Сложность подберём по твоим попыткам. Остальные направления тоже доступны.")
                        .font(.caption).foregroundStyle(Theme.secondary)
                    Button { Task { await client.start(mode: recommendation.preferredMode, context: recommendation.track == "ielts-foundation" ? "life" : recommendation.track, forceNew: true, familyId: recommendation.familyId) } } label: {
                        HStack { Text("Начать короткую практику"); Spacer(); Image(systemName: "arrow.up.right") }
                    }.buttonStyle(PrimaryButton()).disabled(client.busy || client.recording || client.hasUnuploadedRecording)
                    NavigationLink { CurriculumView() } label: {
                        Text("Выбрать другое направление").font(.footnote.weight(.medium)).frame(minHeight: 44)
                    }.foregroundStyle(Theme.charcoal)
                }
            }
        }
    }
}

struct CurriculumView: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ScreenHeading(title: "Твой путь", subtitle: "Обычные разговоры, работа и понемногу основа для IELTS.")
                Text("Направления можно чередовать. Числа ниже показывают завершённые занятия и небольшой ориентир по практике, а не освоение языка.")
                    .font(.subheadline).foregroundStyle(Theme.secondary)
                ForEach(client.state?.progression?.tracks ?? []) { track in
                    NavigationLink { PracticeTrackView(trackID: track.id) } label: { TrackRow(track: track) }
                        .buttonStyle(PressButton())
                }
                Text("IELTS здесь пока практика основ четырёх навыков. Полный экзамен, прогноз band и гарантии для визы не входят в эти счётчики.")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }.modifier(ReadingCanvas()).navigationTitle("Путь").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}

private struct TrackRow: View {
    let track: PracticeTrack
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: JourneyCopy.icon(track.id)).font(.title3).frame(width: 42, height: 42)
                    .background(track.id == "ielts-foundation" ? Theme.lime : Theme.lavender.opacity(0.55), in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 6) {
                    Text(track.title).font(.headline)
                    Text(track.description).font(.footnote).foregroundStyle(Theme.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
            }
            HStack {
                Text("\(track.completedSessions)/\(track.targetSessions) занятий").font(.caption.weight(.medium)).monospacedDigit()
                Spacer()
                Text("Открыто").font(.caption).foregroundStyle(Theme.secondary)
            }
            JourneyProgressBar(current: track.completedSessions, target: track.targetSessions)
        }.foregroundStyle(Theme.charcoal).multilineTextAlignment(.leading).padding(20)
            .background(Color.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

struct PracticeTrackView: View {
    let trackID: String
    var preferredActivity: String? = nil
    @EnvironmentObject private var client: TrainingClient
    @State private var mode = "learning"
    private var track: PracticeTrack? { client.state?.progression?.tracks.first { $0.id == trackID } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if let track {
                    ScreenHeading(title: track.title, subtitle: track.description)
                    Text("\(track.completedSessions) из \(track.targetSessions) завершённых занятий по ориентиру практики.")
                        .font(.subheadline).foregroundStyle(Theme.secondary)
                    if trackID == "ielts-foundation" { ieltsActivities(track) }
                    else { conversationPractice(track) }
                    if client.busy {
                        ActivityPanel(title: client.operationStage ?? "Готовим практику", detail: "Разговор подбирается под твои попытки.", startedAt: client.operationStartedAt)
                    }
                }
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }.modifier(ReadingCanvas()).navigationTitle("Практика").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
    private func conversationPractice(_ track: PracticeTrack) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 18) {
                Text("Один разговор, один понятный фокус").font(.headline)
                Text("Содержание и трудность меняются по твоим ответам. Иногда будем возвращаться к прежней теме, чтобы проверить навык после паузы.")
                    .font(.subheadline).foregroundStyle(Theme.secondary)
                SelectionRow(selection: $mode, options: [SelectionOption(id: "learning", title: "С опорами", icon: "lightbulb"), SelectionOption(id: "call", title: "Созвон", icon: "phone")])
                Button { Task { await client.startTrack(track.id, mode: mode) } } label: {
                    HStack { Text("Начать разговор"); Spacer(); Image(systemName: "arrow.up.right") }
                }.buttonStyle(PrimaryButton()).disabled(client.busy || client.recording || client.hasUnuploadedRecording)
                if trackID == "relocation" {
                    Text("Тренируем настоящие обстоятельства и вопросы. Не придумываем визовые требования или ответы.").font(.caption).foregroundStyle(Theme.secondary)
                }
            }
        }
    }
    private func ieltsActivities(_ track: PracticeTrack) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Начнём с коротких заданий. Можно выбрать любой навык и смешивать их с разговорами о жизни и работе.")
                .font(.subheadline).foregroundStyle(Theme.secondary)
            ForEach(track.activities.sorted { ($0.id == preferredActivity ? 0 : 1) < ($1.id == preferredActivity ? 0 : 1) }) { activity in
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Label(activity.title, systemImage: JourneyCopy.activityIcon(activity.id)).font(.headline)
                        if activity.id == preferredActivity { Text("Для выбранной награды").font(.caption.weight(.semibold)).foregroundStyle(Theme.charcoal) }
                        Text(JourneyCopy.focus(activity.id)).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                        Text("\(activity.completedSessions)/\(activity.targetSessions) завершённых заданий").font(.caption).foregroundStyle(Theme.secondary).monospacedDigit()
                        JourneyProgressBar(current: activity.completedSessions, target: activity.targetSessions)
                        Button { Task { await client.startTrack(track.id, activity: activity.id) } } label: {
                            HStack { Text("Начать задание"); Spacer(); Image(systemName: "arrow.up.right") }
                        }.buttonStyle(SecondaryButton()).disabled(client.busy || client.recording || client.hasUnuploadedRecording)
                        if activity.id == "listening" { Text("Сначала слушаем без текста. Повторить или уточнить можно.").font(.caption).foregroundStyle(Theme.secondary) }
                        if activity.id == "writing" { Text("Здесь пишем с клавиатуры, чтобы проверить именно письмо.").font(.caption).foregroundStyle(Theme.secondary) }
                    }
                }
            }
            Text("Короткие задания тренируют основу. Их результат не равен band IELTS.").font(.caption).foregroundStyle(Theme.secondary)
        }
    }
}

struct AchievementsView: View {
    @EnvironmentObject private var client: TrainingClient
    private var achievements: [PracticeAchievement] { client.state?.progression?.achievements ?? [] }
    private var nextGoalID: String? {
        achievements.filter { !$0.unlocked }.max {
            Double($0.current) / Double(max(1, $0.target)) < Double($1.current) / Double(max(1, $1.target))
        }?.id
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ScreenHeading(title: "Твои награды", subtitle: "Открыто \(achievements.filter { $0.unlocked }.count) из \(achievements.count).")
                Text("Выбери награду и практику для неё. Языковой уровень проверяем по твоим ответам.")
                    .font(.subheadline).foregroundStyle(Theme.secondary)
                Text("Дни практики считаются по UTC. Это не обязательная серия посещений.").font(.caption).foregroundStyle(Theme.secondary)
                ForEach(achievements) { achievement in AchievementRow(achievement: achievement, nearestGoal: achievement.id == nextGoalID) }
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }.modifier(ReadingCanvas()).navigationTitle("Награды").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}

private struct AchievementRow: View {
    let achievement: PracticeAchievement
    var nearestGoal = false
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    Button {} label: {
                        RewardImage(name: RewardArt.achievement(achievement.id), size: 72, motion: achievement.unlocked ? .earned : nearestGoal ? .goal : .still)
                    }.buttonStyle(RewardArtPressStyle())
                        .accessibilityLabel("Значок «\(achievement.title)»")
                        .accessibilityHint("Нажми, чтобы пошевелить значок. Условие награды ниже.")
                    VStack(alignment: .leading, spacing: 6) {
                        Text(achievement.title).font(.headline)
                        Text(achievement.unlocked ? "Открыто" : "Пока впереди").font(.caption).foregroundStyle(Theme.secondary)
                    }
                    Spacer(minLength: 0)
                }
                Text(achievement.description).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Text("\(achievement.current)/\(achievement.target)").font(.subheadline.weight(.semibold)).monospacedDigit()
                    Spacer()
                    if let date = achievement.unlockedAt.flatMap(NativeDate.parse) {
                        Text(date, format: .dateTime.day().month(.abbreviated)).font(.caption).foregroundStyle(Theme.secondary)
                    }
                }
                JourneyProgressBar(current: achievement.current, target: achievement.target, color: achievement.unlocked ? Theme.lime : Theme.lavender)
                if !achievement.unlocked {
                    NavigationLink { AchievementPracticeView(achievement: achievement) } label: {
                        HStack { Label("Взять на прицел", systemImage: "scope"); Spacer(); Image(systemName: "arrow.up.right") }
                    }.buttonStyle(SecondaryButton())
                }
            }
        }
    }
}

struct PracticeOutcomeView: View {
    let result: PracticeResult
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack { Text("Что осталось от практики").font(.headline); Spacer(); Text("+\(result.xp) XP").font(.caption.weight(.semibold)) }
                Text("Целевых навыков с наблюдениями: \(result.quality.observedTargets)/\(result.quality.targetCount)").font(.subheadline.weight(.medium))
                Text("Это охват разбора, а не число успешно освоенных целей.").font(.caption).foregroundStyle(Theme.secondary)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 14) { qualityCounts }
                    VStack(alignment: .leading, spacing: 8) { qualityCounts }
                }.font(.footnote)
                if result.quality.partial > 0 || result.quality.difficulty > 0 {
                    Text("Частично: \(result.quality.partial). Есть трудность: \(result.quality.difficulty).")
                        .font(.caption).foregroundStyle(Theme.secondary)
                }
                if !result.evidence.isEmpty {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(Array(result.evidence.enumerated()), id: \.offset) { _, evidence in
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(JourneyCopy.skill(evidence.skill)).font(.caption.weight(.semibold))
                                    Text(evidence.quote).font(.subheadline).textSelection(.enabled)
                                    Text(evidenceLabel(evidence)).font(.caption).foregroundStyle(Theme.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }.padding(.top, 12)
                    } label: { Text("Показать свои примеры").font(.footnote.weight(.medium)) }
                }
            }
        }
    }
    @ViewBuilder private var qualityCounts: some View {
        Label("Самостоятельных успехов: \(result.quality.independentSuccesses)", systemImage: "checkmark.circle")
        Label("С опорой: \(result.quality.supportedObservations)", systemImage: "lightbulb")
    }
    private func evidenceLabel(_ evidence: PracticeResult.Evidence) -> String {
        if evidence.supported { return "Наблюдение с опорой" }
        switch evidence.result { case "success": return "Самостоятельный успех"; case "partial": return "Получилось частично"; default: return "Пока есть трудность" }
    }
}

/// Shown only after the server has acknowledged this device's explicit completion action.
struct CompletionMomentBanner: View {
    let moment: CompletionMoment
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var celebrating = false
    private var result: PracticeResult? { client.state?.progression?.recentResults.first { $0.sessionId == moment.sessionId } }
    private var newAchievement: PracticeAchievement? {
        guard !moment.deferred, !moment.baseline else { return nil }
        return client.state?.progression?.achievements.first { $0.unlocked && !moment.unlockedBefore.contains($0.id) }
    }
    var body: some View {
        HStack(spacing: 12) {
            VoiceOrb(mode: .ready, level: 0, mood: moment.deferred ? .calm : .pleased, statusDescription: moment.deferred ? "Занятие сохранено, новая попытка ждёт" : "Занятие завершено")
                .frame(width: 58, height: 58).scaleEffect(celebrating && !reduceMotion ? 1.06 : 1)
            VStack(alignment: .leading, spacing: 5) {
                Text(moment.baseline ? "Проба сохранена" : moment.deferred ? "На сегодня сохранили" : "Хорошая работа. Занятие завершено.")
                    .font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Text(moment.deferred ? result.map { "+\($0.xp) XP за практику. Улучшенная попытка ждёт." } ?? "К улучшенной попытке вернёмся позже." : result.map { "+\($0.xp) XP за практику. Примеры сохранены ниже." } ?? "Твои ответы и разбор сохранены.")
                    .font(.caption).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                if let achievement = newAchievement {
                    Label("Новая награда: " + achievement.title, systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            Button { client.dismissCompletionMoment() } label: { Image(systemName: "xmark").font(.caption.weight(.semibold)).frame(width: 44, height: 44) }
                .accessibilityLabel("Скрыть подтверждение")
        }.foregroundStyle(Theme.charcoal).padding(12)
            .background(moment.deferred ? Color.white : Theme.lime.opacity(0.6), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .animation(reduceMotion ? nil : NativeMotion.settle, value: celebrating)
            .sensoryFeedback(trigger: celebrating) { _, value in value && !moment.deferred ? .success : nil }
            .task(id: moment.id) {
                guard !moment.deferred, scenePhase == .active else { return }
                celebrating = true
                do { try await Task.sleep(for: .milliseconds(620)) } catch { return }
                celebrating = false
            }
    }
}
