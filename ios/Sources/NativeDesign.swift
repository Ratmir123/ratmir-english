import SwiftUI
import UIKit

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
                    UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30, style: .continuous)
                        .fill(Theme.surface).ignoresSafeArea(.container, edges: .bottom)
                } else {
                    UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30, style: .continuous)
                        .fill(.regularMaterial)
                        .overlay {
                            UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30, style: .continuous)
                                .fill(Color.white.opacity(0.58))
                        }
                        .ignoresSafeArea(.container, edges: .bottom)
                }
            }
            .environment(\.colorScheme, .light)
    }
}

/// The backing owns the whole bottom edge. A safeAreaBar adds another system
/// surface below the custom composer, so the inset intentionally has no gap.
struct ConversationDock<Dock: View>: ViewModifier {
    let dock: Dock
    init(@ViewBuilder dock: () -> Dock) { self.dock = dock() }
    @ViewBuilder func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) { dock }
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
        Text("S·").font(.system(size: size * 0.55, weight: .bold, design: .rounded))
            .foregroundStyle(Theme.charcoal).frame(width: size, height: size)
            .background(Theme.lime, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityLabel("Smooth English")
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
    private var vertical: Bool { dynamicTypeSize.isAccessibilitySize }
    private var selectedIndex: Int { options.firstIndex { $0.id == selection } ?? 0 }
    var body: some View {
        let layout = vertical ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        NativeGlassGroup {
            layout {
                ForEach(options) { option in
                    Button {
                        guard selection != option.id else { return }
                        selection = option.id
                    } label: {
                        VStack(spacing: 7) {
                            Image(systemName: option.icon).font(.body)
                            Text(option.title).font(.caption.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                        }.frame(maxWidth: .infinity, minHeight: vertical ? 68 : 54).padding(.vertical, 9)
                            .foregroundStyle(selection == option.id ? Theme.charcoal : Theme.secondary)
                            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    }.buttonStyle(SegmentPressButton()).accessibilityAddTraits(selection == option.id ? .isSelected : [])
                }
            }
            .background {
                GeometryReader { geometry in
                    let frame = NativeSegmentGeometry.frame(size: geometry.size, count: options.count, index: selectedIndex, vertical: vertical)
                    Color.clear.frame(width: frame.width, height: frame.height)
                        .modifier(LiquidChrome(radius: 20, tint: Theme.lavender.opacity(0.56), interactive: true))
                        .offset(x: frame.minX, y: frame.minY)
                        .animation(reduceMotion ? nil : NativeMotion.selection, value: selectedIndex)
                        .animation(nil, value: vertical)
                }.allowsHitTesting(false)
            }
            .background(Theme.surface.opacity(0.38), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// One persistent lens moves between fixed labels. No conditional insertion or
/// opacity transition can replay when the user taps again before it settles.
enum NativeSegmentGeometry {
    static func frame(size: CGSize, count: Int, index: Int, vertical: Bool, spacing: CGFloat = 8) -> CGRect {
        guard count > 0 else { return .zero }
        let selected = min(count - 1, max(0, index))
        if vertical {
            let height = max(0, (size.height - spacing * CGFloat(count - 1)) / CGFloat(count))
            return CGRect(x: 0, y: CGFloat(selected) * (height + spacing), width: size.width, height: height)
        }
        let width = max(0, (size.width - spacing * CGFloat(count - 1)) / CGFloat(count))
        return CGRect(x: CGFloat(selected) * (width + spacing), y: 0, width: width, height: size.height)
    }
}

struct SegmentPressButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// SwiftUI child navigation stacks can reset the tab-item tint on selection.
/// Pin item colors on this controller only, keeping the native glass background.
struct StableTabBarAppearance: UIViewControllerRepresentable {
    let selection: Int
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) { controller.apply() }
    final class Controller: UIViewController {
        override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); apply() }
        override func didMove(toParent parent: UIViewController?) { super.didMove(toParent: parent); apply() }
        func apply() {
            guard let tab = tabBarController else { return }
            let selected = UIColor(red: 34 / 255, green: 33 / 255, blue: 36 / 255, alpha: 1)
            let normal = selected.withAlphaComponent(0.62)
            func configure(_ source: UITabBarAppearance) -> UITabBarAppearance {
                let result = source.copy() as! UITabBarAppearance
                for item in [result.stackedLayoutAppearance, result.inlineLayoutAppearance, result.compactInlineLayoutAppearance] {
                    item.selected.iconColor = selected
                    item.selected.titleTextAttributes = [.foregroundColor: selected]
                    item.normal.iconColor = normal
                    item.normal.titleTextAttributes = [.foregroundColor: normal]
                }
                return result
            }
            tab.tabBar.tintColor = selected
            tab.tabBar.unselectedItemTintColor = normal
            tab.tabBar.standardAppearance = configure(tab.tabBar.standardAppearance)
            tab.tabBar.scrollEdgeAppearance = configure(tab.tabBar.scrollEdgeAppearance ?? tab.tabBar.standardAppearance)
        }
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
