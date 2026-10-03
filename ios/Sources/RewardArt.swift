import SwiftUI

/// Cosmetic rank thresholds mirror the existing server's 100-XP experience levels.
/// A rank badge never changes progression or claims a language level.
struct PracticeRank: Identifiable {
    let from: Int
    let art: String
    let title: String
    var id: String { art }
    var minimumXP: Int { (from - 1) * 100 }
}

enum RewardArt {
    static let ranks = [
        PracticeRank(from: 1, art: "rank-pearl", title: "Старт"),
        PracticeRank(from: 3, art: "rank-mint", title: "Разгон"),
        PracticeRank(from: 6, art: "rank-sky", title: "Ритм"),
        PracticeRank(from: 10, art: "rank-violet", title: "Напор"),
        PracticeRank(from: 16, art: "rank-rose", title: "Искра"),
        PracticeRank(from: 25, art: "rank-gold", title: "Огонь"),
    ]
    static func practiceRank(_ level: Int) -> PracticeRank { ranks.last { level >= $0.from } ?? ranks[0] }
    static func nextRank(_ level: Int) -> PracticeRank? { ranks.first { level < $0.from } }
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
        let rank = practiceRank(level)
        return (rank.art, rank.title)
    }
}

/// The metal emblem stays anchored. Only light and its rank-specific atmosphere move.
/// One 30-Hz canvas is active for the current rank; inactive/locked ranks remain static.
struct RankEmblem: View {
    let level: Int
    var size: CGFloat = 124
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    private var rank: PracticeRank { RewardArt.practiceRank(level) }
    private var moving: Bool { animated && !reduceMotion && contrast != .increased && visible && scenePhase == .active }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moving)) { context in
            let time = moving ? context.date.timeIntervalSinceReferenceDate : 0
            ZStack {
                RankAtmosphere(art: rank.art, time: time)
                Image("reward-" + rank.art + "-v041").resizable().scaledToFit()
                    .overlay {
                        if moving {
                            LinearGradient(colors: [.clear, .white.opacity(0.08), .white.opacity(0.52), .clear], startPoint: .leading, endPoint: .trailing)
                                .frame(width: size * 0.30, height: size * 1.6)
                                .rotationEffect(.degrees(24))
                                .offset(x: size * CGFloat((time.truncatingRemainder(dividingBy: 5.4) / 5.4) * 3.2 - 1.6))
                                .frame(width: size, height: size)
                                .mask(Image("reward-" + rank.art + "-v041").resizable().scaledToFit())
                        }
                    }
            }.frame(width: size, height: size).clipped()
        }.frame(width: size, height: size).accessibilityHidden(true)
            .onAppear { visible = true }.onDisappear { visible = false }
    }
}

private struct RankAtmosphere: View {
    let art: String
    let time: TimeInterval
    private var accent: Color {
        switch art {
        case "rank-mint": return Color(red: 0.15, green: 0.77, blue: 0.56)
        case "rank-sky": return Color(red: 0.17, green: 0.64, blue: 0.93)
        case "rank-violet": return Theme.lavender
        case "rank-rose": return Color(red: 0.93, green: 0.36, blue: 0.56)
        case "rank-gold": return Color(red: 0.96, green: 0.66, blue: 0.15)
        default: return Color(red: 0.70, green: 0.73, blue: 0.86)
        }
    }
    var body: some View {
        Canvas { context, dimensions in
            let side = min(dimensions.width, dimensions.height)
            let center = CGPoint(x: dimensions.width / 2, y: dimensions.height * 0.52)
            let pulse = (sin(time * 1.8) + 1) / 2
            switch art {
            case "rank-mint":
                for index in 0..<2 {
                    let phase = (time / 3.6 + Double(index) * 0.5).truncatingRemainder(dividingBy: 1)
                    let radius = side * CGFloat(0.27 + phase * 0.20)
                    let ellipse = CGRect(x: center.x - radius, y: center.y - radius * 0.78, width: radius * 2, height: radius * 1.56)
                    context.stroke(Path(ellipseIn: ellipse), with: .color(accent.opacity((1 - phase) * 0.30)), lineWidth: 1.1)
                }
            case "rank-sky":
                for index in 0..<3 {
                    let phase = (time / 4.5 + Double(index) / 3).truncatingRemainder(dividingBy: 1)
                    var air = Path()
                    let y = center.y + side * CGFloat(0.20 - phase * 0.40)
                    air.move(to: CGPoint(x: side * 0.10, y: y + side * 0.06))
                    air.addQuadCurve(to: CGPoint(x: side * 0.90, y: y - side * 0.04), control: CGPoint(x: side * 0.56, y: y - side * 0.14))
                    context.stroke(air, with: .color(accent.opacity(sin(phase * .pi) * 0.35)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
                }
            case "rank-violet", "rank-pearl":
                for index in 0..<4 {
                    let angle = Double(index) * .pi / 2 + 0.45
                    let point = CGPoint(x: center.x + CGFloat(cos(angle)) * side * 0.39, y: center.y + CGFloat(sin(angle)) * side * 0.33)
                    let flicker = (sin(time * (art == "rank-pearl" ? 1.0 : 2.2) + Double(index) * 1.8) + 1) / 2
                    let reach = side * CGFloat(0.012 + flicker * 0.021)
                    var spark = Path()
                    spark.move(to: CGPoint(x: point.x - reach, y: point.y)); spark.addLine(to: CGPoint(x: point.x + reach, y: point.y))
                    spark.move(to: CGPoint(x: point.x, y: point.y - reach)); spark.addLine(to: CGPoint(x: point.x, y: point.y + reach))
                    context.stroke(spark, with: .color(accent.opacity(0.20 + flicker * 0.45)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
                }
            case "rank-rose", "rank-gold":
                let count = art == "rank-gold" ? 10 : 6
                for index in 0..<count {
                    let angle = Double(index) * .pi * 2 / Double(count) - .pi / 2
                    let radius = side * 0.34
                    let length = side * CGFloat(0.036 + pulse * (art == "rank-gold" ? 0.066 : 0.045))
                    var ray = Path()
                    ray.move(to: CGPoint(x: center.x + CGFloat(cos(angle)) * radius, y: center.y + CGFloat(sin(angle)) * radius))
                    ray.addLine(to: CGPoint(x: center.x + CGFloat(cos(angle)) * (radius + length), y: center.y + CGFloat(sin(angle)) * (radius + length)))
                    context.stroke(ray, with: .color(accent.opacity(0.18 + pulse * 0.34)), style: StrokeStyle(lineWidth: art == "rank-gold" ? 1.8 : 1.4, lineCap: .round))
                }
            default: break
            }
        }.allowsHitTesting(false)
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
