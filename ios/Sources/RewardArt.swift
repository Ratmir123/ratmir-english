import SwiftUI

enum RewardArt {
    static func qualifiedImprovement(_ session: Conversation) -> Bool {
        guard let review = session.analysis, (review.version ?? 0) >= 1, !review.priorities.isEmpty,
              let start = session.createdAt.flatMap(NativeDate.parse), let updated = session.updatedAt.flatMap(NativeDate.parse) else { return false }
        return session.retries.contains { retry in
            guard retry.improved == true, retry.analysisVersion == nil || retry.analysisVersion == review.version,
                  !retry.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, retry.transcriptEdited != true,
                  let date = retry.createdAt.flatMap(NativeDate.parse), date >= start, date <= updated,
                  date <= Date().addingTimeInterval(1) else { return false }
            return review.createdAt.flatMap(NativeDate.parse).map { date >= $0 } ?? true
        }
    }
    static func achievement(_ id: String) -> String {
        let names = ["balanced-practice": "balanced-worlds", "ielts-four-sides": "four-sides"]
        return "reward-" + (names[id] ?? id) + "-v041"
    }
    static func rank(_ level: Int) -> (art: String, title: String) {
        switch level {
        case 25...: return ("rank-gold", "Огонь")
        case 16...: return ("rank-rose", "Искра")
        case 10...: return ("rank-violet", "Напор")
        case 6...: return ("rank-sky", "Ритм")
        case 3...: return ("rank-mint", "Разгон")
        default: return ("rank-pearl", "Старт")
        }
    }
}

struct RewardImage: View {
    let name: String
    var size: CGFloat = 70
    var body: some View {
        Image(name).resizable().scaledToFit().frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// This destination describes the route; it never starts a billable lesson by opening.
struct AchievementPracticeView: View {
    let achievement: PracticeAchievement
    @EnvironmentObject private var client: TrainingClient
    private var savedAttempt: Conversation? {
        guard achievement.id == "own-improvement" else { return nil }
        return client.state?.sessions.sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }.first { session in
            session.baseline == nil && session.lesson.kind != "calibration" && session.analysis?.priorities.isEmpty == false &&
            (session.status == "review" || (session.status == "completed" && session.retryDeferred == true && !RewardArt.qualifiedImprovement(session)))
        }
    }
    private var track: String {
        switch achievement.id {
        case "independent-listening", "ielts-four-sides": return "ielts-foundation"
        case "balanced-practice":
            let values = client.state?.progression?.tracks ?? []
            return (values.first { $0.id == "life" }?.completedSessions ?? 0) <= (values.first { $0.id == "work" }?.completedSessions ?? 0) ? "life" : "work"
        default: return "life"
        }
    }
    private var explanation: String {
        switch achievement.id {
        case "three-days": return "Засчитываются три разных дня по UTC. Несколько занятий за сегодня не добавят ещё один день."
        case "own-improvement":
            if let savedAttempt, RewardArt.qualifiedImprovement(savedAttempt) { return "Ответ уже исправлен. Осталось завершить занятие, чтобы сохранить результат." }
            return savedAttempt == nil ? "Сначала нужна собственная попытка и разбор, затем её улучшение своими словами." : "Есть сохранённый разбор. Вернись к своей попытке и исправь её без готового ответа."
        case "independent-listening": return "Слушай без текста и используй услышанные детали в своём ответе. Опоры доступны, но награда учитывает самостоятельное понимание."
        case "ielts-four-sides": return "Попробуй речь, понимание на слух, чтение и письмо. Начни с навыка, где пока меньше попыток."
        case "balanced-practice": return "Откроем направление, где пока меньше завершённых занятий."
        default: return "Выбери короткое занятие, ответь сам и сохрани практику с разбором."
        }
    }
    private var activity: String? {
        if achievement.id == "independent-listening" { return "listening" }
        if achievement.id == "ielts-four-sides" {
            return client.state?.progression?.tracks.first { $0.id == "ielts-foundation" }?.activities
                .sorted { $0.completedSessions < $1.completedSessions }.first?.id ?? "speaking"
        }
        return nil
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 16) {
                    RewardImage(name: RewardArt.achievement(achievement.id), size: 92)
                    ScreenHeading(title: achievement.title, subtitle: "Твоя цель · \(achievement.current)/\(achievement.target)")
                }
                Text(achievement.description).font(.subheadline)
                JourneyProgressBar(current: achievement.current, target: achievement.target)
                Text(explanation).font(.subheadline).foregroundStyle(Theme.secondary)
                if let savedAttempt {
                    Button { client.resume(savedAttempt) } label: {
                        Label(RewardArt.qualifiedImprovement(savedAttempt) ? "Завершить свою практику" : "Вернуться к своей попытке", systemImage: "arrow.uturn.backward")
                    }.buttonStyle(PrimaryButton()).disabled(client.busy || client.recording || client.hasUnuploadedRecording)
                } else {
                    NavigationLink { PracticeTrackView(trackID: track, preferredActivity: activity) } label: {
                        Label("Выбрать подходящую практику", systemImage: "arrow.up.right")
                    }.buttonStyle(PrimaryButton())
                }
                Text("Одно короткое задание под выбранную цель.").font(.caption).foregroundStyle(Theme.secondary)
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }.modifier(ReadingCanvas()).navigationTitle("Взять на прицел").navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}
