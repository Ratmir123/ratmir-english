import SwiftUI
import UIKit

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
    /// Mirrors ACHIEVEMENT_ART in lib/achievement-targets.ts (v0.5 achievements reuse existing art).
    static let achievementArt: [String: String] = [
        "first-practice": "first-practice", "three-days": "three-days", "ten-practices": "ten-practices",
        "own-improvement": "own-improvement", "balanced-practice": "balanced-worlds",
        "independent-listening": "independent-listening", "ielts-four-sides": "four-sides",
        "placement-complete": "four-sides", "first-call-review": "independent-listening", "call-replay": "own-improvement",
        "pattern-improving": "rank-mint", "counter-offer": "rank-gold", "no-disclaimers": "three-days",
        "case-first": "ten-practices", "dated-next-step": "balanced-worlds", "clean-pitch": "first-practice"
    ]
    static func achievement(_ id: String) -> String {
        "reward-" + (achievementArt[id] ?? "first-practice") + "-v041"
    }
    static func rank(_ level: Int) -> (art: String, title: String) {
        let rank = practiceRank(level)
        return (rank.art, rank.title)
    }
}

/// The rank art as a physical medal (DESIGN-PASS-0.5.1, RankMedalSolid.swift): a rim when it turns, light
/// and foil that move against the turn and the phone's tilt, a floor shadow that slides and shrinks.
/// The current rank sways and floats; a drag spins it with inertia, a tap turns it once. Locked and small
/// medals stay still. Decorative (navigation wraps it where useful, L-08).
struct RankEmblem: View {
    let level: Int
    var size: CGFloat = 124
    var animated = true
    /// Rank-up: starts back-facing and lands face-front after 1.5 decelerating turns with a flash.
    var entrance = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var spin = MedalSpinModel()
    /// A finger or a throw is on the medal: full frame rate until it rests.
    @State private var handling = false
    @State private var motionHeld = false
    private var rank: PracticeRank { RewardArt.practiceRank(level) }
    private var moving: Bool { animated && !reduceMotion && contrast != .increased && visible && scenePhase == .active }
    private var lit: Bool { size >= MedalTuning.solidMin }
    private var gestures: Bool { lit && animated && !reduceMotion }
    var body: some View {
        TimelineView(.animation(minimumInterval: handling ? nil : 1.0 / 30, paused: !(moving || handling))) { context in
            emblem(time: context.date.timeIntervalSinceReferenceDate)
        }
        .frame(width: size, height: size)
        .overlay {
            if gestures { MascotTouchLayer(handler: { touch($0) }) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Ранг «\(rank.title)»")
        .modifier(RewardVisibility(visible: $visible))
        .onAppear {
            guard entrance, lit, !reduceMotion else { return }
            spin.enter(at: Date().timeIntervalSinceReferenceDate)
            handling = true
        }
        .onChange(of: moving, initial: true) { _, value in holdMotion(value) }
        .onDisappear { holdMotion(false) }
        .task(id: handling) { await releaseFrames() }
    }
    private func emblem(time: TimeInterval) -> some View {
        let idle = moving ? time : 0
        let pose = RewardMotionPose.rank(art: rank.art, time: idle, size: size, active: moving)
        let hand = spin.advance(to: time)
        // Idle yaw sway keeps the rim readable at rest; it eases between ±yaw like the web's alternate animation.
        let sway = moving ? -MedalTuning.yaw(for: rank.art) * cos(time * .pi / MedalTuning.turnPeriod) : 0
        let yaw = lit ? hand.yaw + sway : 0
        let pitch = lit ? hand.pitch : 0
        let device = moving && lit ? MedalMotion.shared.light(at: time) : (yaw: 0.0, pitch: 0.0)
        let shape = MedalLight(yaw: yaw, pitch: pitch, size: size)
        return ZStack {
            Ellipse().fill(Theme.ink.opacity(pose.shadowOpacity))
                .frame(width: size * 0.43, height: size * 0.075)
                .scaleEffect(x: pose.shadowScale * shape.shadowWidth, y: 1)
                .offset(x: shape.shadowX, y: size * 0.32)
            ZStack {
                if lit { RankAtmosphere(art: rank.art, time: idle) }
                if lit {
                    MedalSolid(art: rank.art, size: size, yaw: yaw, pitch: pitch, lightYaw: yaw + device.yaw, lightPitch: pitch + device.pitch,
                               holo: ["rank-violet", "rank-rose", "rank-gold"].contains(rank.art), glint: spin.flash(at: time) ?? glint(idle))
                } else {
                    Image("reward-" + rank.art + "-v041").resizable().scaledToFit()
                }
            }.scaleEffect(pose.scale).rotationEffect(.degrees(pose.rotation), anchor: UnitPoint(x: 0.5, y: 0.64)).offset(y: pose.lift)
        }.frame(width: size, height: size)
    }
    /// An occasional glint across the face while the medal idles.
    private func glint(_ time: TimeInterval) -> Double? {
        guard moving else { return nil }
        let phase = ((time + 2.2) / MedalTuning.glintPeriod).truncatingRemainder(dividingBy: 1)
        guard phase < MedalTuning.glintShare else { return nil }
        return (1 - cos(phase / MedalTuning.glintShare * .pi)) / 2
    }
    private func touch(_ event: MascotTouchEvent) {
        let now = Date().timeIntervalSinceReferenceDate
        switch event {
        case .began(let point, let side): spin.touchBegan(point, side: side)
        case .moved(let point, let side): spin.touchMoved(point, side: side, time: now)
        case .ended(let point, let side, let quick): spin.touchEnded(point, side: side, time: now, quick: quick)
        case .cancelled: spin.touchCancelled()
        }
        if !handling { handling = true }
    }
    /// Drops back to the idle 30 fps (or a paused timeline) once the medal rests.
    private func releaseFrames() async {
        guard handling else { return }
        while !Task.isCancelled {
            do { try await Task.sleep(for: .milliseconds(150)) } catch { return }
            if !spin.isBusy(at: Date().timeIntervalSinceReferenceDate) { handling = false; return }
        }
    }
    private func holdMotion(_ on: Bool) {
        let wanted = on && lit
        guard wanted != motionHeld else { return }
        motionHeld = wanted
        if wanted { MedalMotion.shared.acquire() } else { MedalMotion.shared.release() }
    }
}

/// A deterministic pose has no repeat-forever tasks or queued reactions.
/// TimelineView can stop completely while the card is offscreen.
struct RewardMotionPose {
    var lift: CGFloat = 0
    var rotation: Double = 0
    var scale: CGFloat = 1
    var shadowScale: CGFloat = 1
    var shadowOpacity: Double = 0.06
    static func rank(art: String, time: TimeInterval, size: CGFloat, active: Bool) -> Self {
        guard active else { return Self() }
        let period: Double
        let amplitude: Double
        let sway: Double
        switch art {
        case "rank-mint": (period, amplitude, sway) = (4.6, 0.047, 3.5)
        case "rank-sky": (period, amplitude, sway) = (4.8, 0.061, 4.0)
        case "rank-violet": (period, amplitude, sway) = (4.2, 0.047, 4.5)
        case "rank-rose": (period, amplitude, sway) = (3.8, 0.055, 5.0)
        case "rank-gold": (period, amplitude, sway) = (4.0, 0.061, 4.0)
        default: (period, amplitude, sway) = (5.4, 0.039, 3.0)
        }
        let wave = (1 - cos(time * 2 * .pi / period)) / 2
        return Self(lift: -size * CGFloat(amplitude * wave), rotation: sway * (wave * 1.45 - 0.45), scale: 1 + CGFloat(wave) * 0.025, shadowScale: 1 - CGFloat(wave) * 0.16, shadowOpacity: 0.06 - wave * 0.025)
    }
    static func achievement(time: TimeInterval, size: CGFloat, motion: RewardImage.Motion, active: Bool) -> Self {
        guard active, motion != .still else { return Self(shadowOpacity: 0.035) }
        if motion == .earned {
            let wave = (1 - cos(time * 2 * .pi / 4.4)) / 2
            return Self(lift: -size * CGFloat(wave) * 0.061, rotation: -3 + wave * 7, scale: 1 + CGFloat(wave) * 0.045, shadowScale: 1 - CGFloat(wave) * 0.16, shadowOpacity: 0.05 - wave * 0.02)
        }
        // One inviting lean with a quiet pause; locked icons never pretend to be earned.
        let phase = time.truncatingRemainder(dividingBy: 5.2) / 5.2
        let wave = phase < 0.62 ? 0 : sin((phase - 0.62) / 0.38 * .pi)
        return Self(lift: -size * CGFloat(wave) * 0.047, rotation: -5 * wave, scale: 1 + CGFloat(wave) * 0.05, shadowScale: 1 - CGFloat(wave) * 0.12, shadowOpacity: 0.035 - wave * 0.01)
    }
}

private struct RewardVisibility: ViewModifier {
    @Binding var visible: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollVisibilityChange(threshold: 0.1) { visible = $0 }.onDisappear { visible = false }
        } else {
            // iOS 17 fallback also stops drawings when a ScrollView moves the card away.
            content.onGeometryChange(for: Bool.self) { proxy in
                let frame = proxy.frame(in: .global)
                let screen = UIScreen.main.bounds
                return frame.intersects(screen) && frame.width > 0 && frame.height > 0
            } action: { visible = $0 }
                .onDisappear { visible = false }
        }
    }
}

struct RewardArtPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : configuration.isPressed ? 0.93 : 1)
            .rotationEffect(.degrees(reduceMotion ? 0 : configuration.isPressed ? -4 : 0))
            .animation(reduceMotion ? nil : .spring(response: 0.25, dampingFraction: 0.68), value: configuration.isPressed)
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
                // Four-point sparkles, the same shape as the web's clip-path stars.
                for index in 0..<4 {
                    let angle = Double(index) * .pi / 2 + 0.45
                    let point = CGPoint(x: center.x + CGFloat(cos(angle)) * side * 0.39, y: center.y + CGFloat(sin(angle)) * side * 0.33)
                    let flicker = (sin(time * (art == "rank-pearl" ? 1.0 : 2.2) + Double(index) * 1.8) + 1) / 2
                    let reach = side * CGFloat(0.037 + flicker * 0.019)
                    let waist = reach * 0.18
                    var spark = Path()
                    spark.move(to: CGPoint(x: point.x, y: point.y - reach))
                    spark.addLine(to: CGPoint(x: point.x + waist, y: point.y - waist))
                    spark.addLine(to: CGPoint(x: point.x + reach, y: point.y))
                    spark.addLine(to: CGPoint(x: point.x + waist, y: point.y + waist))
                    spark.addLine(to: CGPoint(x: point.x, y: point.y + reach))
                    spark.addLine(to: CGPoint(x: point.x - waist, y: point.y + waist))
                    spark.addLine(to: CGPoint(x: point.x - reach, y: point.y))
                    spark.addLine(to: CGPoint(x: point.x - waist, y: point.y - waist))
                    spark.closeSubpath()
                    context.fill(spark, with: .color(accent.opacity(0.20 + flicker * 0.45)))
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
    enum Motion: Equatable { case still, earned, goal }
    let name: String
    var size: CGFloat = 70
    var motion: Motion = .still
    /// Locked rewards are desaturated so earned ones keep their meaning.
    var locked = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    private var moving: Bool { motion != .still && !reduceMotion && visible && scenePhase == .active }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !moving)) { context in
            let pose = RewardMotionPose.achievement(time: moving ? context.date.timeIntervalSinceReferenceDate : 0, size: size, motion: motion, active: moving)
            ZStack {
                Ellipse().fill(Theme.ink.opacity(pose.shadowOpacity))
                    .frame(width: size * 0.44, height: size * 0.07).scaleEffect(x: pose.shadowScale, y: 1).offset(y: size * 0.32)
                Image(name).resizable().scaledToFit()
                    .saturation(locked ? 0 : 1).opacity(locked ? 0.5 : 1)
                    .scaleEffect(pose.scale).rotationEffect(.degrees(pose.rotation), anchor: UnitPoint(x: 0.5, y: 0.68)).offset(y: pose.lift)
            }
        }.frame(width: size, height: size).accessibilityHidden(true).modifier(RewardVisibility(visible: $visible))
    }
}

/// Where «Как получить» leads (mirrors achievementTarget in lib/achievement-targets.ts).
enum AchievementRoute {
    case resume(Conversation, label: String)
    case family(id: String, label: String)
    case free(context: String, label: String)
    case placement(label: String)
    case tab(ShellTab, label: String)
    /// A screen inside «Созвоны» (e.g. the patterns list).
    case calls(CallsRoute, label: String)
    case drill(id: String, mode: String, label: String)
}

/// «Как получить»: what the achievement asks for and one direct way there (L-09).
struct AchievementPracticeView: View {
    let achievement: PracticeAchievement
    @EnvironmentObject private var client: TrainingClient
    private var state: TrainingState? { client.state }

    private var savedAttempt: Conversation? {
        let sorted = (state?.sessions ?? []).sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
        return sorted.first { session in
            session.lesson.kind != "calibration" && session.analysis?.priorities.isEmpty == false &&
            (session.status == "review" || (session.awaitsRetry && !RewardArt.qualifiedImprovement(session)))
        }
    }

    private var route: AchievementRoute {
        switch achievement.id {
        case "own-improvement":
            if let savedAttempt {
                return .resume(savedAttempt, label: RewardArt.qualifiedImprovement(savedAttempt) ? "Завершить свою практику" : "Вернуться к своей попытке")
            }
            return .free(context: "life", label: "К короткой практике")
        case "balanced-practice":
            let tracks = state?.progression?.tracks ?? []
            let life = tracks.first { $0.id == "life" }?.completedSessions ?? 0
            let work = tracks.first { $0.id == "work" }?.completedSessions ?? 0
            return life <= work ? .free(context: "life", label: "К разговорам о жизни") : .free(context: "work", label: "К рабочим разговорам")
        case "independent-listening":
            return .family(id: "ielts-listening", label: "К практике на слух")
        case "ielts-four-sides":
            let activities = state?.progression?.tracks.first { $0.id == "ielts-foundation" }?.activities ?? []
            let weakest = activities.sorted { $0.completedSessions < $1.completedSessions }.first?.id ?? "speaking"
            return .family(id: "ielts-" + weakest, label: "К следующему навыку")
        case "placement-complete":
            return .placement(label: state?.placementSignal?.started == true ? "Продолжить тест" : "Пройти тест уровня")
        case "first-call-review":
            return .tab(.calls, label: "Загрузить созвон")
        case "call-replay":
            if let state, let drill = DrillOrder.pending(state).first {
                return .drill(id: drill.id, mode: DrillOrder.startMode(drill), label: "Переиграть момент")
            }
            return .tab(.calls, label: "К созвонам")
        case "pattern-improving":
            return .calls(.patterns, label: "К паттернам")
        case "counter-offer": return .family(id: "strategy-price", label: "Отрепетировать встречную цифру")
        case "no-disclaimers": return .family(id: "work-call-opening", label: "Отрепетировать начало звонка")
        case "case-first": return .family(id: "strategy-agency-screening", label: "Отрепетировать вопросы агентства")
        case "dated-next-step": return .family(id: "strategy-recap-close", label: "Отрепетировать финал звонка")
        case "clean-pitch": return .family(id: "strategy-pitch-30", label: "К питчу за 30 секунд")
        default: return .free(context: "life", label: "К короткой практике")
        }
    }

    private var explanation: String {
        switch achievement.id {
        case "three-days": return "Засчитываются разные дни практики. Несколько занятий за один день добавят только один день."
        case "own-improvement":
            if let savedAttempt, RewardArt.qualifiedImprovement(savedAttempt) { return "Ответ уже исправлен. Осталось завершить занятие, чтобы сохранить результат." }
            return savedAttempt == nil ? "Сначала нужна своя попытка и разбор, затем её улучшение своими словами." : "Есть сохранённый разбор. Вернись к нему и исправь ответ без готового текста."
        case "independent-listening": return "Слушай без текста и используй услышанные детали в ответе."
        case "ielts-four-sides": return "Попробуй речь, понимание на слух, чтение и письмо. Начнём с навыка, где пока меньше попыток."
        case "balanced-practice": return "Откроем направление, где пока меньше завершённых занятий."
        case "placement-complete": return "Около 25 минут в два захода. Можно прерваться и продолжить позже."
        case "first-call-review": return "Запись, расшифровка или готовый разбор реального звонка. Разбор покажет, что стоило денег и что тренировать."
        case "call-replay": return "Тренировки появляются после разбора реального звонка."
        case "pattern-improving": return "Паттерн сдаётся, когда ты несколько раз обходишь его в тренировках и на реальном звонке."
        case "counter-offer", "no-disclaimers", "case-first", "dated-next-step":
            return "Награда за реальный созвон. Сначала отрепетируй момент здесь, затем загрузи следующий звонок."
        case "clean-pitch": return "Скажи питч голосом: до 45 секунд, с цифрой или результатом и без оговорок."
        default: return achievement.description
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 16) {
                    RewardImage(name: RewardArt.achievement(achievement.id), size: 92, motion: achievement.unlocked ? .earned : .goal, locked: !achievement.unlocked)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(achievement.title).font(TypeScale.title2).fixedSize(horizontal: false, vertical: true)
                        Text(ProgressCopy.achievementStatus(achievement)).font(.subheadline.weight(.semibold)).monospacedDigit()
                            .foregroundStyle(Theme.inkSecondary)
                    }
                }
                Text(achievement.description).font(.body).fixedSize(horizontal: false, vertical: true)
                if !achievement.unlocked { JourneyProgressBar(current: achievement.current, target: achievement.target) }
                Text(explanation).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                if !achievement.unlocked { actionButton }
            }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
        }
        .modifier(LiquidCanvas())
        .navigationTitle("Как получить")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var routeLabel: String {
        switch route {
        case .resume(_, let label): return label
        case .family(_, let label): return label
        case .free(_, let label): return label
        case .placement(let label): return label
        case .tab(_, let label): return label
        case .calls(_, let label): return label
        case .drill(_, _, let label): return label
        }
    }

    private var startKey: String? {
        switch route {
        case .family(let id, _): return TrainingClient.familyKey(id)
        case .free: return TrainingClient.freeKey
        case .drill(let id, _, _): return TrainingClient.drillKey(id)
        case .resume, .placement, .tab, .calls: return nil
        }
    }

    @ViewBuilder private var actionButton: some View {
        let key = startKey
        Button { follow(route) } label: {
            StartButtonLabel(title: routeLabel, starting: key.map { client.isStarting($0) } ?? false)
        }
        .buttonStyle(PrimaryButton())
        .disabled(client.busy || client.startingIntent != nil || client.recording || (key != nil && client.hasUnuploadedRecording))
        if key != nil && client.hasUnuploadedRecording {
            Text("Сначала реши, что делать с несохранённой записью на вкладке «Сегодня».")
                .font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
    }

    private func follow(_ route: AchievementRoute) {
        switch route {
        case .resume(let session, _):
            client.resume(session)
        case .family(let id, _):
            let mode = client.catalogFamily(id)?.preferredMode ?? (id == "ielts-listening" || id.hasPrefix("strategy-") ? "call" : "learning")
            Task { await client.startFamily(familyId: id, mode: mode) }
        case .free(let context, _):
            Task { await client.startFree(mode: "learning", context: context) }
        case .placement:
            client.placementPresented = true
        case .tab(let tab, _):
            client.requestedTab = tab
        case .calls(let destination, _):
            CallsNavigator.shared.open(destination)
            client.requestedTab = .calls
        case .drill(let id, let mode, _):
            Task { await client.startDrill(id: id, mode: mode) }
        }
    }
}
