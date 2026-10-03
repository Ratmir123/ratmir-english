import SwiftUI

enum VoiceOrbMode { case ready, listening, speaking, thinking }
enum VoiceOrbMood { case calm, attentive, curious, friendly, pleased, supportive }

/// Actual audio updates invalidate this leaf, never the transcript or composer.
struct MeasuredVoiceOrb: View {
    @ObservedObject var meter: VoiceMeter
    let mode: VoiceOrbMode
    var mood: VoiceOrbMood? = nil
    var statusDescription: String? = nil
    var body: some View { VoiceOrb(mode: mode, level: meter.level, mood: mood, statusDescription: statusDescription) }
}

/// A breathing glass lens, with one geometrically morphing shape for each eye.
struct VoiceOrb: View {
    let mode: VoiceOrbMode
    let level: Double
    var mood: VoiceOrbMood? = nil
    var statusDescription: String? = nil
    @State private var winking = false
    @State private var interaction = 0
    @State private var isVisible = false
    @State private var phaseOrigin = Date()
    @GestureState private var touchOffset = CGSize.zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    private var animated: Bool { !reduceMotion && isVisible && scenePhase == .active }
    private var measuredEnergy: Double {
        guard (mode == .listening || mode == .speaking), level.isFinite else { return 0 }
        return min(1, max(0, level))
    }
    private var expression: VoiceOrbMood {
        if let mood { return mood }
        switch mode { case .ready: return .calm; case .listening: return .attentive; case .speaking: return .friendly; case .thinking: return .curious }
    }
    var body: some View {
        Button(action: reactToTouch) {
            CompanionStage(mode: mode, energy: measuredEnergy, expression: expression,
                           winking: winking, interaction: interaction, touchOffset: touchOffset,
                           animated: animated, phaseOrigin: phaseOrigin)
        }
            .buttonStyle(CompanionPressStyle(reduceMotion: reduceMotion))
            .contentShape(Circle())
            .simultaneousGesture(orbTouch)
            .accessibilityLabel("Твой собеседник")
            .accessibilityValue(accessibilityText)
            .accessibilityHint("Коснись, чтобы поздороваться. Можно слегка потянуть в сторону.")
            .sensoryFeedback(.selection, trigger: interaction)
            .onAppear { isVisible = true; phaseOrigin = Date() }
            .onDisappear { isVisible = false; winking = false }
            .task(id: interaction) {
                guard interaction > 0 else { return }
                do { try await Task.sleep(for: .milliseconds(740)) } catch { return }
                winking = false
            }
    }
    private var orbTouch: some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($touchOffset) { value, offset, _ in
                // Horizontal play leaves the surrounding vertical scroll free.
                guard !reduceMotion, abs(value.translation.width) > abs(value.translation.height) * 1.2 else { return }
                offset = CGSize(width: max(-65, min(65, value.translation.width)), height: max(-30, min(30, value.translation.height)))
            }
            .onEnded { value in
                if abs(value.translation.width) > abs(value.translation.height) * 1.2 { reactToTouch() }
            }
    }
    private func reactToTouch() {
        // Retarget one spring and cancellable task, including rapid taps.
        winking = true
        interaction += 1
    }
    private var accessibilityText: String {
        if let statusDescription { return statusDescription }
        switch mode { case .ready: return "Собеседник ждёт твоего ответа"; case .listening: return "Собеседник слушает, микрофон включён"; case .speaking: return "Собеседник говорит"; case .thinking: return "Собеседник готовит ответ" }
    }
}

private struct CompanionPressedKey: EnvironmentKey { static let defaultValue = false }
private extension EnvironmentValues {
    var companionPressed: Bool {
        get { self[CompanionPressedKey.self] }
        set { self[CompanionPressedKey.self] = newValue }
    }
}

/// Body and floor have separate transforms. Pressing or dragging never drags the ground shadow.
private struct CompanionStage: View {
    let mode: VoiceOrbMode
    let energy: Double
    let expression: VoiceOrbMood
    let winking: Bool
    let interaction: Int
    let touchOffset: CGSize
    let animated: Bool
    let phaseOrigin: Date
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.companionPressed) private var pressed
    var body: some View {
        TimelineView(.animation(minimumInterval: mode == .ready ? 1.0 / 30 : 1.0 / 60, paused: !animated)) { timeline in
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                let time = animated ? timeline.date.timeIntervalSince(phaseOrigin) : 0
                let breath = animated ? sin(time * 1.45) : 0
                let sway = animated ? sin(time * 0.91) : 0
                let pressure = pressed && !reduceMotion ? 1.0 : 0.0
                let floating = reduceMotion ? 0 : breath * 0.021 - energy * 0.014
                let height = min(1, max(-1, -floating / 0.035))
                let blinkPhase = time.truncatingRemainder(dividingBy: 6.7)
                let blink = animated ? 1 - exp(-pow((blinkPhase - 6.43) / 0.075, 2)) * 0.90 : 1
                let gazeX = reduceMotion ? 0 : Double(touchOffset.width) / 65
                let gazeY = reduceMotion ? 0 : Double(touchOffset.height) / 30
                ZStack {
                    Ellipse()
                        .fill(RadialGradient(colors: [Color(red: 0.35, green: 0.45, blue: 0.77).opacity(0.21), .clear], center: .center, startRadius: 0, endRadius: size * 0.38))
                        .frame(width: size * 0.76, height: size * 0.15)
                        .scaleEffect(x: 1 + height * 0.07 + pressure * 0.04, y: 1 + height * 0.13 - pressure * 0.04)
                        .opacity(reduceMotion ? 1 : 1 - height * 0.18 + pressure * 0.08)
                        .offset(y: size * 0.36)
                        .animation(reduceMotion ? nil : .interactiveSpring(response: 0.28, dampingFraction: 0.85), value: pressed)
                    lens(size: size, time: time, energy: energy, pressure: pressure, breath: breath, sway: sway, blink: blink, gazeX: gazeX, gazeY: gazeY)
                }.frame(width: geometry.size.width, height: geometry.size.height)
            }
        }.accessibilityHidden(true)
    }
    private func lens(size: CGFloat, time: Double, energy: Double, pressure: Double, breath: Double, sway: Double, blink: Double, gazeX: Double, gazeY: Double) -> some View {
        ZStack {
            Rectangle().fill(Color.white)
                .colorEffect(ShaderLibrary.liquidCompanion(.boundingRect, .float(Float(time)), .float(Float(reduceMotion ? 0 : energy)), .float(Float(gazeX)), .float(Float(gazeY))))
            HStack(spacing: size * 0.175) {
                CompanionEye(size: size, side: 0, mood: expression, blink: blink, time: time, mode: mode, reaction: winking ? interaction % 3 + 1 : 0)
                CompanionEye(size: size, side: 1, mood: expression, blink: blink, time: time, mode: mode, reaction: winking ? interaction % 3 + 1 : 0)
            }
                .offset(x: size * 0.038 * gazeX + (mode == .thinking ? sway * size * 0.012 : 0), y: size * 0.024 * gazeY - size * 0.015)
                .animation(reduceMotion ? nil : .interactiveSpring(response: 0.30, dampingFraction: 0.78), value: touchOffset)
        }
        .frame(width: size * 0.90, height: size * 0.90)
        .scaleEffect(x: reduceMotion ? 1 : 1 + breath * 0.018 + energy * 0.055 + pressure * 0.055 + (winking ? 0.025 : 0),
                     y: reduceMotion ? 1 : 1 - breath * 0.016 + energy * 0.085 - pressure * 0.09 - (winking ? 0.012 : 0))
        .rotationEffect(.degrees(reduceMotion ? 0 : sway * (mode == .thinking ? 4.5 : 1.6) + Double(touchOffset.width) * 0.12))
        .offset(x: reduceMotion ? 0 : touchOffset.width * 0.24,
                y: reduceMotion ? 0 : breath * size * 0.021 - energy * size * 0.014 + touchOffset.height * 0.10)
        .animation(reduceMotion ? nil : .interactiveSpring(response: 0.20, dampingFraction: 0.78), value: energy)
        .animation(reduceMotion ? nil : .interactiveSpring(response: 0.32, dampingFraction: 0.67), value: winking)
        .animation(reduceMotion ? nil : .interactiveSpring(response: 0.34, dampingFraction: 0.72, blendDuration: 0.08), value: touchOffset)
        .animation(reduceMotion ? nil : .interactiveSpring(response: pressed ? 0.17 : 0.34, dampingFraction: 0.72), value: pressed)
    }
}

private struct CompanionPressStyle: ButtonStyle {
    let reduceMotion: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.companionPressed, !reduceMotion && configuration.isPressed)
    }
}

private struct CompanionEye: View {
    let size: CGFloat
    let side: Int
    let mood: VoiceOrbMood
    let blink: Double
    let time: Double
    let mode: VoiceOrbMode
    let reaction: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var baseOpenness: Double {
        switch mood { case .attentive: return 1.1; case .curious: return side == 0 ? 1.02 : 0.64; case .supportive: return 0.78; default: return 1 }
    }
    private var baseTilt: Double {
        switch mood { case .curious: return side == 0 ? -9 : 10; case .supportive: return side == 0 ? -10 : 10; case .friendly: return side == 0 ? -4 : 4; default: return 0 }
    }
    private func pulse(period: Double, centre: Double, radius: Double) -> Double {
        guard !reduceMotion else { return 0 }
        let phase = time.truncatingRemainder(dividingBy: period)
        let distance = abs(phase - centre)
        guard distance < radius else { return 0 }
        return pow((1 + cos(distance / radius * .pi)) * 0.5, 2)
    }
    private var curiosity: Double {
        let spontaneous = pulse(period: 17.4, centre: 8.2, radius: 1.8)
        return reaction == 3 ? 1 : spontaneous * (mode == .listening || mode == .thinking ? 0.9 : 0.6)
    }
    private var joy: Double {
        if reaction == 2 { return 1 }
        if reaction == 1 { return side == 1 ? 1 : 0.18 }
        if mood == .pleased { return 1 }
        if mood == .supportive || mode == .thinking { return 0 }
        return pulse(period: mode == .speaking ? 8.6 : 13.1, centre: mode == .speaking ? 2.4 : 4.4, radius: 1.1) * (mode == .listening ? 0.18 : 0.76)
    }
    private var openness: Double { baseOpenness + curiosity * (side == 0 ? 0.16 : -0.24) }
    private var tilt: Double { baseTilt + curiosity * (side == 0 ? -13 : 12) }
    var body: some View {
        MorphingCompanionEye(open: openness * blink, joy: joy)
            .fill(Color(red: 0.99, green: 0.995, blue: 1))
            .frame(width: size * 0.078, height: size * 0.115)
            .rotationEffect(.degrees(tilt))
            .shadow(color: Color.white.opacity(0.68), radius: size * 0.014)
            .animation(reduceMotion ? nil : .interactiveSpring(response: 0.29, dampingFraction: 0.82), value: mood)
            .animation(reduceMotion ? nil : .interactiveSpring(response: 0.28, dampingFraction: 0.78), value: reaction)
    }
}

/// Identical four-curve topology: a pill bends into a smile, without an opacity swap.
private struct MorphingCompanionEye: Shape {
    var open: Double
    var joy: Double
    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(open, joy) }
        set { open = newValue.first; joy = newValue.second }
    }
    func path(in rect: CGRect) -> Path {
        let j = min(1, max(0, joy)), o = max(0.08, open)
        func point(_ px: Double, _ py: Double, _ sx: Double, _ sy: Double) -> CGPoint {
            let x = px + (sx - px) * j, y = py + (sy - py) * j
            return CGPoint(x: rect.width * x, y: rect.height * (0.5 + (y - 0.5) * o))
        }
        var path = Path()
        path.move(to: point(0.05, 0.5, 0.0, 0.68))
        path.addCurve(to: point(0.5, 0.0, 0.5, 0.28), control1: point(0.05, 0.16, 0.08, 0.43), control2: point(0.20, 0.0, 0.28, 0.28))
        path.addCurve(to: point(0.95, 0.5, 1.0, 0.68), control1: point(0.80, 0.0, 0.72, 0.28), control2: point(0.95, 0.16, 0.92, 0.43))
        path.addCurve(to: point(0.5, 1.0, 0.5, 0.48), control1: point(0.95, 0.84, 0.96, 0.87), control2: point(0.80, 1.0, 0.72, 0.48))
        path.addCurve(to: point(0.05, 0.5, 0.0, 0.68), control1: point(0.20, 1.0, 0.28, 0.48), control2: point(0.05, 0.84, 0.04, 0.87))
        path.closeSubpath()
        return path
    }
}
