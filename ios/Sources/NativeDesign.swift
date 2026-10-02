import SwiftUI

enum Theme {
    static let charcoal = Color(red: 34.0 / 255, green: 33.0 / 255, blue: 36.0 / 255)
    static let surface = Color(red: 225.0 / 255, green: 225.0 / 255, blue: 225.0 / 255)
    static let lavender = Color(red: 187.0 / 255, green: 178.0 / 255, blue: 245.0 / 255)
    static let lime = Color(red: 218.0 / 255, green: 241.0 / 255, blue: 99.0 / 255)
    static let secondary = charcoal.opacity(0.66)
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
    }
}

struct Metric: View {
    let value: String
    let title: String
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(value).font(.system(.largeTitle, design: .rounded).weight(.semibold)).monospacedDigit().tracking(-1)
            Text(title).font(.caption.weight(.medium))
        }.foregroundStyle(Theme.charcoal).frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background(color, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
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
    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: dynamicTypeSize.isAccessibilitySize ? 1 : options.count)
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(options) { option in
                Button { selection = option.id } label: {
                    VStack(spacing: 7) {
                        Image(systemName: option.icon).font(.body)
                        Text(option.title).font(.caption.weight(.medium))
                    }.frame(maxWidth: .infinity).padding(.vertical, 13)
                        .foregroundStyle(selection == option.id ? Theme.charcoal : Theme.secondary)
                        .background(selection == option.id ? Theme.lavender.opacity(0.45) : Theme.surface.opacity(0.45), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }.buttonStyle(PressButton()).accessibilityAddTraits(selection == option.id ? .isSelected : [])
            }
        }
    }
}

struct PressButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(isEnabled ? 1 : 0.46)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct PrimaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 16)
            .frame(maxWidth: .infinity).foregroundStyle(Theme.lime)
            .background(Theme.charcoal, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(isEnabled ? 1 : 0.48).scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct SecondaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 16)
            .frame(maxWidth: .infinity).foregroundStyle(Theme.charcoal)
            .background(Theme.lime, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(isEnabled ? 1 : 0.45).scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
    }
}

struct QuietButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.footnote.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 12)
            .foregroundStyle(Theme.charcoal).background(Color.white.opacity(0.65), in: Capsule())
            .opacity(isEnabled ? 1 : 0.45).scaleEffect(configuration.isPressed && !reduceMotion ? 0.975 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
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
            .accessibilityElement(children: .combine)
    }
}

enum VoiceOrbMode { case ready, listening, speaking, thinking }

/// Keep the timeline in this leaf; it never recomputes the transcript or composer.
/// Expansion follows measured mic/playback power. Waiting has a separate quiet drift.
struct VoiceOrb: View {
    let mode: VoiceOrbMode
    let level: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    private var animated: Bool { mode != .ready && !reduceMotion && scenePhase == .active }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !animated)) { timeline in
            GeometryReader { geometry in
                let size = min(geometry.size.width, geometry.size.height)
                let time = animated ? timeline.date.timeIntervalSinceReferenceDate : 0
                let energy = min(1, max(0, level))
                let drift = animated ? sin(time * (mode == .thinking ? 0.85 : 1.4)) : 0
                let blinkPhase = time.truncatingRemainder(dividingBy: 7.4)
                let blink = animated && blinkPhase > 7.18 ? 0.13 : 1.0
                let eyeHeight = mode == .thinking ? 0.62 : blink
                let shape = SoftOrbShape(warp: reduceMotion ? 0 : drift * 0.028 + energy * 0.035)
                ZStack {
                    Ellipse().fill(Color(red: 0.27, green: 0.5, blue: 0.76).opacity(0.13))
                        .frame(width: size * 0.73, height: size * 0.14).blur(radius: 14).offset(y: size * 0.35)
                    ZStack {
                        shape.fill(Color(red: 0.31, green: 0.33, blue: 0.81))
                        Ellipse().fill(Color(red: 0.39, green: 0.88, blue: 0.9))
                            .frame(width: size * 0.73, height: size * 0.8).blur(radius: size * 0.14)
                            .offset(x: -size * 0.30, y: -size * 0.13 + drift * size * 0.026)
                        Ellipse().fill(Color(red: 0.49, green: 0.34, blue: 0.95))
                            .frame(width: size * 0.88, height: size * 0.8).blur(radius: size * 0.15)
                            .offset(x: size * 0.12 + drift * size * 0.028, y: -size * 0.02)
                        Ellipse().fill(Color(red: 0.35, green: 0.78, blue: 0.76).opacity(0.9))
                            .frame(width: size * 0.66, height: size * 0.6).blur(radius: size * 0.18)
                            .offset(x: size * 0.30, y: size * 0.31)
                        shape.fill(LinearGradient(colors: [Color.white.opacity(0.40), Color.white.opacity(0.015), Theme.charcoal.opacity(0.09)], startPoint: .topLeading, endPoint: .bottomTrailing))
                        HStack(spacing: size * 0.2) { eye(size: size, height: eyeHeight); eye(size: size, height: eyeHeight) }
                            .offset(y: -size * 0.005 + (mode == .listening ? -energy * size * 0.012 : 0))
                    }.frame(width: size * 0.82, height: size * 0.82).clipShape(shape)
                        .overlay { shape.stroke(Color.white.opacity(0.16), lineWidth: 1).frame(width: size * 0.82, height: size * 0.82) }
                        .scaleEffect(reduceMotion ? 1 : 1 + energy * 0.08 + (mode == .thinking ? drift * 0.016 : 0))
                        .rotationEffect(.degrees(reduceMotion ? 0 : drift * (mode == .thinking ? 3.5 : 1.1)))
                        .offset(y: reduceMotion ? 0 : drift * size * 0.01)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: energy)
                }.frame(width: geometry.size.width, height: geometry.size.height)
            }
        }.accessibilityLabel(accessibilityText).accessibilityAddTraits(.isImage)
    }
    private func eye(size: CGFloat, height: Double) -> some View {
        Capsule().fill(Color.white).frame(width: size * 0.065, height: size * 0.11).scaleEffect(y: height)
            .shadow(color: Color.white.opacity(0.9), radius: size * 0.035)
    }
    private var accessibilityText: String {
        switch mode { case .ready: return "Собеседник ждёт твоего ответа"; case .listening: return "Собеседник слушает, микрофон включён"; case .speaking: return "Собеседник говорит"; case .thinking: return "Собеседник готовит ответ" }
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
