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
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    RewardImage(name: "reward-" + RewardArt.rank(progression.level).art + "-v041", size: 76)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(progression.levelTitle).font(.title3.weight(.semibold))
                        Text(RewardArt.rank(progression.level).title + " · опыт практики").font(.caption).foregroundStyle(Theme.secondary)
                    }
                    Spacer(minLength: 0)
                }
                HStack {
                    Text("\(progression.xp) XP").font(.subheadline.weight(.semibold)).monospacedDigit()
                    Spacer()
                    Text("Ещё \(progression.xpToNextLevel) до следующего").font(.caption).foregroundStyle(Theme.secondary)
                }
                JourneyProgressBar(current: progression.xpInLevel, target: progression.nextLevelXP - progression.levelFloorXP)
                Text("XP показывает выполненную практику. Это не CEFR и не оценка английского.")
                    .font(.caption).foregroundStyle(Theme.secondary)
                Divider().opacity(0.5)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) { journeyLinks }
                    VStack(alignment: .leading, spacing: 8) { journeyLinks }
                }
            }
        }
    }
    @ViewBuilder private var journeyLinks: some View {
        NavigationLink { CurriculumView() } label: { Label("Твой путь", systemImage: "map").frame(minHeight: 44) }
        NavigationLink { AchievementsView() } label: {
            Label("Награды \(progression.achievements.filter { $0.unlocked }.count)/\(progression.achievements.count)", systemImage: "seal")
                .frame(minHeight: 44)
        }
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
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ScreenHeading(title: "Твои награды", subtitle: "Открыто \(achievements.filter { $0.unlocked }.count) из \(achievements.count).")
                Text("Выбери награду и практику для неё. Языковой уровень проверяем по твоим ответам.")
                    .font(.subheadline).foregroundStyle(Theme.secondary)
                Text("Дни практики считаются по UTC. Это не обязательная серия посещений.").font(.caption).foregroundStyle(Theme.secondary)
                ForEach(achievements) { achievement in AchievementRow(achievement: achievement) }
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }.modifier(ReadingCanvas()).navigationTitle("Награды").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}

private struct AchievementRow: View {
    let achievement: PracticeAchievement
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    RewardImage(name: RewardArt.achievement(achievement.id), size: 72)
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
