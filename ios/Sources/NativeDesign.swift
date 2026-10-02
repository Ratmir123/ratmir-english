import SwiftUI

enum Theme {
    static let charcoal = Color(red: 34.0 / 255, green: 33.0 / 255, blue: 36.0 / 255)
    static let surface = Color(red: 225.0 / 255, green: 225.0 / 255, blue: 225.0 / 255)
    static let lavender = Color(red: 187.0 / 255, green: 178.0 / 255, blue: 245.0 / 255)
    static let lime = Color(red: 218.0 / 255, green: 241.0 / 255, blue: 99.0 / 255)
    static let secondary = charcoal.opacity(0.66)
}

/// Short, retargetable springs. State and hit targets never wait for motion.
enum NativeMotion {
    static let press = Animation.interactiveSpring(response: 0.20, dampingFraction: 0.82, blendDuration: 0.08)
    static let selection = Animation.interactiveSpring(response: 0.28, dampingFraction: 0.88, blendDuration: 0.10)
    static let settle = Animation.interactiveSpring(response: 0.30, dampingFraction: 0.82, blendDuration: 0.10)
    static let reveal = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.22)
    static let feedback = Animation.easeOut(duration: 0.16)
    static var insertion: AnyTransition { .opacity.combined(with: .offset(y: 5)) }
}

/// Material belongs to floating controls. Reading surfaces remain quiet and solid.
struct LiquidChrome: ViewModifier {
    var radius: CGFloat = 28
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    func body(content: Content) -> some View {
        content
            .background {
                let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
                if reduceTransparency || contrast == .increased { shape.fill(Color.white) }
                else { shape.fill(.thinMaterial).overlay { shape.fill(Color.white.opacity(0.28)) } }
            }
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [.white.opacity(0.9), Theme.charcoal.opacity(0.06), .white.opacity(0.45)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .shadow(color: Theme.charcoal.opacity(0.065), radius: 10, x: 0, y: 4)
    }
}

struct SoftDisclosureStyle: DisclosureGroupStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : NativeMotion.reveal) { configuration.isExpanded.toggle() }
            } label: {
                HStack(spacing: 12) {
                    configuration.label.frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                        .rotationEffect(.degrees(configuration.isExpanded ? 180 : 0))
                        .foregroundStyle(Theme.secondary)
                }.foregroundStyle(Theme.charcoal).frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(PressButton())
                .accessibilityValue(configuration.isExpanded ? "Развёрнуто" : "Свёрнуто")
                .accessibilityHint("Дважды коснись, чтобы " + (configuration.isExpanded ? "свернуть подробности." : "раскрыть подробности."))
            if configuration.isExpanded {
                configuration.content.transition(reduceMotion ? .identity : NativeMotion.insertion)
            }
        }
    }
}

enum NativeDate {
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct BrandMark: View {
    let size: CGFloat
    var body: some View {
        Text("R·").font(.system(size: size * 0.55, weight: .bold, design: .rounded))
            .foregroundStyle(Theme.charcoal).frame(width: size, height: size)
            .background(Theme.lime, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityLabel("Ratmir English")
    }
}

struct ScreenHeading: View {
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(.largeTitle, design: .rounded).weight(.semibold)).tracking(-0.7)
            Text(subtitle).font(.subheadline).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
        }.padding(.top, 12).padding(.bottom, 4)
    }
}

struct InputLabel: View {
    let title: String
    var body: some View { Text(title).font(.caption.weight(.medium)).foregroundStyle(Theme.secondary) }
}

struct SurfaceCard<Content: View>: View {
    let color: Color
    let content: Content
    init(color: Color = .white, @ViewBuilder content: () -> Content) { self.color = color; self.content = content() }
    var body: some View {
        content.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(color, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Color.white.opacity(0.45), lineWidth: 1).allowsHitTesting(false) }
    }
}

struct Metric: View {
    let value: String
    let title: String
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(value).font(.system(.largeTitle, design: .rounded).weight(.semibold)).monospacedDigit().tracking(-1)
                .contentTransition(reduceMotion ? .identity : .numericText())
            Text(title).font(.caption.weight(.medium))
        }.foregroundStyle(Theme.charcoal).frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(color, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .animation(reduceMotion ? nil : NativeMotion.feedback, value: value)
    }
}

struct StatusPill: View {
    let title: String
    let color: Color
    var body: some View {
        Text(title).font(.caption2.weight(.semibold)).foregroundStyle(Theme.charcoal)
            .padding(.horizontal, 10).padding(.vertical, 7).background(color, in: Capsule())
    }
}

struct SelectionOption: Identifiable {
    let id: String
    let title: String
    let icon: String
}

struct SelectionRow: View {
    @Binding var selection: String
    let options: [SelectionOption]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var lens
    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: dynamicTypeSize.isAccessibilitySize ? 1 : options.count)
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(options) { option in
                Button {
                    guard selection != option.id else { return }
                    withAnimation(reduceMotion ? nil : NativeMotion.selection) { selection = option.id }
                } label: {
                    VStack(spacing: 7) {
                        Image(systemName: option.icon).font(.body)
                        Text(option.title).font(.caption.weight(.medium))
                    }.frame(maxWidth: .infinity, minHeight: 44).padding(.vertical, 13)
                        .foregroundStyle(selection == option.id ? Theme.charcoal : Theme.secondary)
                        .background {
                            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surface.opacity(0.38))
                            if selection == option.id {
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(Theme.lavender.opacity(0.55))
                                    .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.8), lineWidth: 1) }
                                    .matchedGeometryEffect(id: "selected-lens", in: lens)
                            }
                        }.contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }.buttonStyle(PressButton()).accessibilityAddTraits(selection == option.id ? .isSelected : [])
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

struct PressButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(isEnabled ? 1 : 0.46)
            .opacity(configuration.isPressed && isEnabled ? 0.85 : 1)
            .scaleEffect(x: configuration.isPressed && !reduceMotion ? 0.982 : 1, y: configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct PrimaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 16)
            .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(Theme.lime)
            .background(Theme.charcoal, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(configuration.isPressed ? 0.22 : 0.10), lineWidth: 1).allowsHitTesting(false) }
            .opacity(isEnabled ? configuration.isPressed ? 0.90 : 1 : 0.48)
            .scaleEffect(x: configuration.isPressed && !reduceMotion ? 0.982 : 1, y: configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct SecondaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 16)
            .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(Theme.charcoal)
            .background(Theme.lime, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(configuration.isPressed ? 0.8 : 0.4), lineWidth: 1).allowsHitTesting(false) }
            .opacity(isEnabled ? configuration.isPressed ? 0.88 : 1 : 0.45)
            .scaleEffect(x: configuration.isPressed && !reduceMotion ? 0.982 : 1, y: configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct QuietButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.footnote.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 12)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(Theme.charcoal).background(Color.white.opacity(configuration.isPressed ? 0.95 : 0.72), in: Capsule())
            .overlay { Capsule().strokeBorder(Color.white.opacity(0.85), lineWidth: 1).allowsHitTesting(false) }
            .opacity(isEnabled ? 1 : 0.45).scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct TranscriptCard: View {
    let turn: Turn
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(turn.role == "user" ? "ТЫ" : "СОБЕСЕДНИК").font(.caption2.weight(.semibold)).tracking(0.7).foregroundStyle(Theme.secondary)
            Text(turn.text).font(.body).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(turn.role == "user" ? Theme.lavender.opacity(0.36) : .white, in: RoundedRectangle(cornerRadius: 23, style: .continuous))
    }
}

struct PriorityCard: View {
    let priority: Priority
    let number: Int
    @State private var showExplanation = false
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    Text(String(number)).font(.caption.weight(.semibold)).frame(width: 26, height: 26).background(Theme.lavender.opacity(0.5), in: Circle())
                    Text(priority.title).font(.headline)
                }
                Text(priority.quote).font(.subheadline).foregroundStyle(Theme.secondary)
                    .padding(.leading, 12).overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(Theme.lavender).frame(width: 3) }
                VStack(alignment: .leading, spacing: 8) {
                    InputLabel(title: "Пример сильнее")
                    Text(priority.example).font(.subheadline.weight(.semibold)).textSelection(.enabled)
                }
                VStack(alignment: .leading, spacing: 8) {
                    InputLabel(title: "Твоя следующая попытка")
                    Text(priority.retryInstruction).font(.subheadline)
                }
                DisclosureGroup(isExpanded: $showExplanation) {
                    Text(priority.explanation).font(.subheadline).foregroundStyle(Theme.secondary).padding(.top, 8)
                } label: { Text("Почему это важно").font(.footnote.weight(.medium)) }
            }
        }
    }
}

struct EvidenceLabel: View {
    let title: String
    let confirmed: Bool
    var body: some View {
        Label(title, systemImage: confirmed ? "checkmark.circle.fill" : "circle")
            .font(.caption).foregroundStyle(confirmed ? Theme.charcoal : Theme.secondary)
            .accessibilityLabel(title + (confirmed ? ": подтверждено" : ": пока не подтверждено"))
    }
}

struct ActivityPanel: View {
    let title: String
    let detail: String
    let startedAt: Date?
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ProgressView().tint(Theme.charcoal).padding(.top, 3)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    if let startedAt { Text(startedAt, style: .timer).font(.caption.monospacedDigit()).foregroundStyle(Theme.secondary) }
                }
                Text(detail).font(.footnote).foregroundStyle(Theme.secondary)
            }
        }.padding(18).background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 23, style: .continuous))
            .contentTransition(.opacity)
            .accessibilityElement(children: .combine)
    }
}

enum VoiceOrbMode { case ready, listening, speaking, thinking }
enum VoiceOrbMood { case calm, attentive, curious, friendly, pleased, supportive }

/// Meter updates invalidate only this small view rather than the whole conversation.
struct MeasuredVoiceOrb: View {
    @ObservedObject var meter: VoiceMeter
    let mode: VoiceOrbMode
    var mood: VoiceOrbMood? = nil
    var statusDescription: String? = nil
    var body: some View { VoiceOrb(mode: mode, level: meter.level, mood: mood, statusDescription: statusDescription) }
}

/// Keep the timeline in this leaf; it never recomputes the transcript or composer.
/// Expansion follows measured mic/playback power. Waiting has a separate quiet drift.
struct VoiceOrb: View {
    let mode: VoiceOrbMode
    let level: Double
    var mood: VoiceOrbMood? = nil
    var statusDescription: String? = nil
    @State private var winking = false
    @State private var lastInteraction = Date.distantPast
    @State private var interaction = 0
    @GestureState private var touchOffset = CGSize.zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    private var animated: Bool { (mode != .ready || winking) && !reduceMotion && scenePhase == .active }
    private var expression: VoiceOrbMood {
        if let mood { return mood }
        switch mode { case .ready: return .calm; case .listening: return .attentive; case .speaking: return .friendly; case .thinking: return .curious }
    }
    var body: some View {
        Button(action: reactToTouch) { orbTimeline }
            .buttonStyle(PressButton())
            .contentShape(Circle())
            .offset(x: reduceMotion ? 0 : touchOffset.width * 0.20, y: reduceMotion ? 0 : touchOffset.height * 0.10)
            .rotationEffect(.degrees(reduceMotion ? 0 : Double(touchOffset.width) * 0.04))
            .animation(reduceMotion ? nil : NativeMotion.settle, value: touchOffset)
            .simultaneousGesture(orbTouch)
            .accessibilityLabel("Твой собеседник")
            .accessibilityValue(accessibilityText)
            .accessibilityHint("Коснись, чтобы он подмигнул. Можно слегка потянуть в сторону.")
            .sensoryFeedback(.selection, trigger: interaction)
            .task(id: interaction) {
                guard interaction > 0 else { return }
                do { try await Task.sleep(for: .milliseconds(620)) } catch { return }
                winking = false
            }
    }
    private var orbTouch: some Gesture {
        DragGesture(minimumDistance: 10)
            .updating($touchOffset) { value, offset, _ in
                // Horizontal play does not steal the surrounding vertical scroll.
                guard !reduceMotion, abs(value.translation.width) > abs(value.translation.height) * 1.2 else { return }
                offset = CGSize(width: max(-70, min(70, value.translation.width)), height: max(-30, min(30, value.translation.height)))
            }
            .onEnded { value in
                if abs(value.translation.width) > abs(value.translation.height) * 1.2 { reactToTouch() }
            }
    }
    private var orbTimeline: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animated)) { timeline in
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                let time = animated ? timeline.date.timeIntervalSinceReferenceDate : 0
                let energy = min(1, max(0, level))
                let drift = animated ? sin(time * (mode == .thinking ? 0.85 : 1.4)) : 0
                let blinkPhase = time.truncatingRemainder(dividingBy: 7.4)
                let blink = animated && blinkPhase > 7.18 ? 0.13 : 1.0
                let shape = SoftOrbShape(warp: reduceMotion ? 0 : drift * 0.028 + energy * 0.035)
                ZStack {
                    Ellipse().fill(RadialGradient(colors: [Color(red: 0.27, green: 0.5, blue: 0.76).opacity(0.14), .clear], center: .center, startRadius: 0, endRadius: size * 0.4))
                        .frame(width: size * 0.80, height: size * 0.17).offset(y: size * 0.35)
                    ZStack {
                        shape.fill(Color(red: 0.31, green: 0.33, blue: 0.81))
                        Ellipse().fill(RadialGradient(colors: [Color(red: 0.39, green: 0.88, blue: 0.9), Color(red: 0.39, green: 0.88, blue: 0.9).opacity(0.80), .clear], center: .center, startRadius: 0, endRadius: size * 0.49))
                            .frame(width: size * 0.98, height: size * 1.05)
                            .offset(x: -size * 0.30, y: -size * 0.13 + drift * size * 0.026)
                        Ellipse().fill(RadialGradient(colors: [Color(red: 0.49, green: 0.34, blue: 0.95), Color(red: 0.49, green: 0.34, blue: 0.95).opacity(0.75), .clear], center: .center, startRadius: 0, endRadius: size * 0.5))
                            .frame(width: size * 1.05, height: size * 0.98)
                            .offset(x: size * 0.12 + drift * size * 0.028, y: -size * 0.02)
                        Ellipse().fill(RadialGradient(colors: [Color(red: 0.35, green: 0.78, blue: 0.76).opacity(0.95), Color(red: 0.35, green: 0.78, blue: 0.76).opacity(0.6), .clear], center: .center, startRadius: 0, endRadius: size * 0.43))
                            .frame(width: size * 0.94, height: size * 0.90)
                            .offset(x: size * 0.30, y: size * 0.31)
                        shape.fill(LinearGradient(colors: [Color.white.opacity(0.40), Color.white.opacity(0.015), Theme.charcoal.opacity(0.09)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        HStack(spacing: size * 0.2) {
                            OrbEye(size: size, side: 0, mood: winking && expression == .pleased ? .friendly : expression, blink: blink, wink: false)
                            OrbEye(size: size, side: 1, mood: expression, blink: blink, wink: winking)
                        }
                            .offset(y: -size * 0.005 + (mode == .listening ? -energy * size * 0.012 : 0))
                    }.frame(width: size * 0.82, height: size * 0.82).clipShape(shape)
                        .overlay { shape.stroke(Color.white.opacity(0.16), lineWidth: 1).frame(width: size * 0.82, height: size * 0.82) }
                        .scaleEffect(reduceMotion ? 1 : 1 + energy * 0.08 + (mode == .thinking ? drift * 0.016 : 0))
                        .rotationEffect(.degrees(reduceMotion ? 0 : drift * (mode == .thinking ? 3.5 : 1.1)))
                        .offset(y: reduceMotion ? 0 : drift * size * 0.01)
                        .animation(reduceMotion ? nil : NativeMotion.feedback, value: energy)
                        .scaleEffect(winking && !reduceMotion ? 1.035 : 1)
                        .animation(reduceMotion ? nil : NativeMotion.settle, value: winking)
                }.frame(width: geometry.size.width, height: geometry.size.height)
            }
        }.accessibilityHidden(true)
            .animation(reduceMotion ? nil : NativeMotion.reveal, value: mode)
    }
    private func reactToTouch() {
        guard Date().timeIntervalSince(lastInteraction) > 0.9 else { return }
        lastInteraction = Date()
        winking = true
        interaction += 1
    }
    private var accessibilityText: String {
        if let statusDescription { return statusDescription }
        switch mode { case .ready: return "Собеседник ждёт твоего ответа"; case .listening: return "Собеседник слушает, микрофон включён"; case .speaking: return "Собеседник говорит"; case .thinking: return "Собеседник готовит ответ" }
    }
}

struct OrbEye: View {
    let size: CGFloat
    let side: Int
    let mood: VoiceOrbMood
    let blink: Double
    let wink: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var squint: Double {
        switch mood { case .attentive: return 1.13; case .curious: return side == 0 ? 0.95 : 0.62; case .supportive: return 0.76; default: return 1 }
    }
    private var tilt: Double {
        switch mood { case .curious: return side == 0 ? -7 : 12; case .supportive: return side == 0 ? -12 : 12; case .friendly: return side == 0 ? -3 : 3; default: return 0 }
    }
    var body: some View {
        ZStack {
            OrbSmileEye().stroke(Color.white, style: StrokeStyle(lineWidth: size * 0.023, lineCap: .round))
                .frame(width: size * 0.073, height: size * 0.065).opacity(wink || mood == .pleased ? 1 : 0)
            Capsule().fill(Color.white).frame(width: size * 0.065, height: size * 0.11)
                .scaleEffect(y: squint * blink).rotationEffect(.degrees(tilt)).opacity(wink || mood == .pleased ? 0 : 1)
        }.frame(width: size * 0.075, height: size * 0.13)
            .shadow(color: Color.white.opacity(0.9), radius: size * 0.035)
            .animation(reduceMotion ? nil : NativeMotion.feedback, value: mood)
            .animation(reduceMotion ? nil : NativeMotion.feedback, value: wink)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.09), value: blink)
    }
}

struct OrbSmileEye: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.height * 0.7))
        path.addQuadCurve(to: CGPoint(x: rect.width, y: rect.height * 0.7), control: CGPoint(x: rect.width * 0.5, y: -rect.height * 0.32))
        return path
    }
}

struct SoftOrbShape: Shape {
    var warp: Double
    var animatableData: Double { get { warp } set { warp = newValue } }
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height, bend = CGFloat(warp)
        var path = Path()
        path.move(to: CGPoint(x: w * 0.5, y: 0))
        path.addCurve(to: CGPoint(x: w, y: h * 0.5), control1: CGPoint(x: w * (0.86 + bend), y: -h * bend * 0.15), control2: CGPoint(x: w, y: h * 0.14))
        path.addCurve(to: CGPoint(x: w * 0.5, y: h), control1: CGPoint(x: w, y: h * (0.88 - bend)), control2: CGPoint(x: w * 0.89, y: h))
        path.addCurve(to: CGPoint(x: 0, y: h * 0.5), control1: CGPoint(x: w * (0.1 - bend), y: h), control2: CGPoint(x: 0, y: h * 0.9))
        path.addCurve(to: CGPoint(x: w * 0.5, y: 0), control1: CGPoint(x: 0, y: h * (0.13 + bend)), control2: CGPoint(x: w * 0.14, y: 0))
        path.closeSubpath()
        return path
    }
}
