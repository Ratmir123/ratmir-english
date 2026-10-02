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

/// The supplied learning palette remains light and legible inside reading regions.
/// This local environment does not force the device's tab bar, sheets, or system UI.
struct ReadingCanvas: ViewModifier {
    func body(content: Content) -> some View {
        content.background(Theme.surface).foregroundStyle(Theme.charcoal)
            .environment(\.colorScheme, .light)
            .toolbarColorScheme(.light, for: .navigationBar)
    }
}

/// Material belongs to floating controls. Reading surfaces remain quiet and solid.
struct LiquidChrome: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    var radius: CGFloat = 28
    var tint: Color? = nil
    var interactive = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @ViewBuilder
    func body(content: Content) -> some View {
        if !isEnabled {
            content.background(Theme.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.white.opacity(0.7), lineWidth: 1).allowsHitTesting(false) }
        } else if reduceTransparency || contrast == .increased {
            content.background(tint ?? .white, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.charcoal.opacity(0.22), lineWidth: 1).allowsHitTesting(false) }
        } else if #available(iOS 26.0, *) {
            if let tint {
                content.glassEffect(.regular.tint(tint).interactive(interactive && !reduceMotion), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            } else {
                content.glassEffect(.regular.interactive(interactive && !reduceMotion), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            }
        } else {
            if let tint {
                content.background(tint, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.white.opacity(0.25), lineWidth: 1).allowsHitTesting(false) }
            } else {
                content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.white.opacity(0.7), lineWidth: 1).allowsHitTesting(false) }
                    .shadow(color: Theme.charcoal.opacity(0.065), radius: 10, x: 0, y: 4)
            }
        }
    }
}

/// One native container batches the few floating control effects and lets the system
/// preserve their fluid interaction. The reading content itself never becomes glass.
struct NativeGlassGroup<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    @ViewBuilder var body: some View {
        if #available(iOS 26.0, *) { GlassEffectContainer(spacing: 8) { content } }
        else { content }
    }
}

/// A full-width optical backing, including the home-indicator area. Glass buttons
/// float above it, while sharp scrolling text cannot compete with the composer.
struct ComposerBackdrop: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity)
            .background {
                if reduceTransparency || contrast == .increased {
                    Theme.surface.ignoresSafeArea(.container, edges: .bottom)
                } else {
                    Rectangle().fill(.regularMaterial)
                        .overlay(Color.white.opacity(0.58))
                        .ignoresSafeArea(.container, edges: .bottom)
                }
            }
            .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.76)).frame(height: 1).allowsHitTesting(false) }
            .environment(\.colorScheme, .light)
    }
}

/// Unlike an inset alone, the native bar extends the scroll edge effect through
/// the complete control area and home-indicator safe area on the modern SDK.
struct ConversationDock<Dock: View>: ViewModifier {
    let dock: Dock
    init(@ViewBuilder dock: () -> Dock) { self.dock = dock() }
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.safeAreaBar(edge: .bottom, spacing: 0) { dock }
                .scrollEdgeEffectStyle(.hard, for: .bottom)
        } else {
            content.safeAreaInset(edge: .bottom, spacing: 0) { dock }
        }
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
            .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(isEnabled ? Theme.lime : Theme.secondary)
            .modifier(LiquidChrome(radius: 20, tint: Theme.charcoal))
            .scaleEffect(x: configuration.isPressed && isEnabled && !reduceMotion ? 0.982 : 1, y: configuration.isPressed && isEnabled && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct SecondaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 16)
            .frame(maxWidth: .infinity, minHeight: 44).foregroundStyle(isEnabled ? Theme.charcoal : Theme.secondary)
            .modifier(LiquidChrome(radius: 20, tint: Theme.lime))
            .scaleEffect(x: configuration.isPressed && isEnabled && !reduceMotion ? 0.982 : 1, y: configuration.isPressed && isEnabled && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct QuietButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.footnote.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 12)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(Theme.charcoal).modifier(LiquidChrome(radius: 24))
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
