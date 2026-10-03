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
                        .fill(Theme.surface)
                } else {
                    UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30, style: .continuous)
                        .fill(.regularMaterial)
                        .overlay {
                            UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30, style: .continuous)
                                .fill(Color.white.opacity(0.58))
                        }
                }
            }
            .environment(\.colorScheme, .light)
    }
}

/// The backing owns the whole bottom edge. A safeAreaBar adds another system
/// surface below the custom composer, so the inset intentionally has no gap.
struct ConversationDock<Dock: View>: ViewModifier {
    let dock: Dock
    @State private var containerBottomInset: CGFloat?
    init(@ViewBuilder dock: () -> Dock) { self.dock = dock() }
    func body(content: Content) -> some View {
        GeometryReader { geometry in
            content.safeAreaInset(edge: .bottom, spacing: 0) {
                // The space is part of this backing's real layout, not a shape
                // escaping an inset. Sheet/large-type content cannot leak below it.
                dock.padding(.bottom, containerBottomInset ?? geometry.safeAreaInsets.bottom)
                    .modifier(ComposerBackdrop())
            }
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .background {
            ContainerBottomInsetReader { value in
                if containerBottomInset != value { containerBottomInset = value }
            }.allowsHitTesting(false)
        }
    }
}

/// The owning window's container inset excludes keyboard avoidance. Reading a
/// GeometryProxy's keyboard-expanded inset as padding would create a giant gap.
private struct ContainerBottomInsetReader: UIViewRepresentable {
    let onChange: (CGFloat) -> Void
    func makeUIView(context: Context) -> InsetView {
        let view = InsetView()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.onChange = onChange
        return view
    }
    func updateUIView(_ view: InsetView, context: Context) {
        view.onChange = onChange
        view.publishInset()
    }
    final class InsetView: UIView {
        var onChange: ((CGFloat) -> Void)?
        override func didMoveToWindow() { super.didMoveToWindow(); publishInset() }
        override func safeAreaInsetsDidChange() { super.safeAreaInsetsDidChange(); publishInset() }
        func publishInset() {
            guard let window else { return }
            let inset = max(0, window.safeAreaInsets.bottom)
            DispatchQueue.main.async { [weak self] in self?.onChange?(inset) }
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

/// Let the system own the glass and the foreground together. A separately
/// composited glass view can refract/erase sibling text even from a background.
struct SelectionRow: View {
    @Binding var selection: String
    let options: [SelectionOption]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 8) {
                    ForEach(options) { option in
                        Button {
                            selection = option.id
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: option.icon).font(.system(size: 24, weight: .medium))
                                    .frame(width: 32, height: 32)
                                Text(option.title).font(.body.weight(.medium))
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 0)
                                if selection == option.id {
                                    Image(systemName: "checkmark").font(.system(size: 24, weight: .semibold))
                                        .frame(width: 28, height: 32)
                                }
                            }.foregroundStyle(Theme.charcoal).padding(16).frame(maxWidth: .infinity, minHeight: 54)
                                .background(selection == option.id ? Theme.lavender.opacity(0.48) : Theme.surface.opacity(0.42),
                                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }.buttonStyle(SegmentPressButton()).accessibilityAddTraits(selection == option.id ? .isSelected : [])
                    }
                }
            } else {
                NativePracticeSegments(selection: $selection, options: options, reduceMotion: reduceMotion)
                    .frame(height: 46)
            }
        }.sensoryFeedback(.selection, trigger: selection)
    }
}

/// UISegmentedControl adopts the same system Liquid Glass interaction as the
/// native navigation controls when built with the current SDK. Do not set custom
/// background/divider images, colored selected backgrounds, or sibling overlays.
struct NativePracticeSegments: UIViewRepresentable {
    @Binding var selection: String
    let options: [SelectionOption]
    var reduceMotion = false
    func makeCoordinator() -> Coordinator { Coordinator(selection: $selection, options: options) }
    func makeUIView(context: Context) -> NativePracticeSegmentedControl {
        let control = NativePracticeSegmentedControl(items: options.map(\.title))
        control.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        control.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
        control.apply(options: options, selectedID: selection, animated: false)
        return control
    }
    func updateUIView(_ control: NativePracticeSegmentedControl, context: Context) {
        context.coordinator.selection = $selection
        context.coordinator.options = options
        control.isEnabled = context.environment.isEnabled
        control.apply(options: options, selectedID: selection, animated: !reduceMotion)
    }
    final class Coordinator: NSObject {
        var selection: Binding<String>
        var options: [SelectionOption]
        init(selection: Binding<String>, options: [SelectionOption]) { self.selection = selection; self.options = options }
        @objc func changed(_ control: UISegmentedControl) {
            guard options.indices.contains(control.selectedSegmentIndex) else { return }
            let next = options[control.selectedSegmentIndex].id
            if selection.wrappedValue != next { selection.wrappedValue = next }
        }
    }
}

final class NativePracticeSegmentedControl: UISegmentedControl {
    private var configuredIDs: [String] = []
    func apply(options: [SelectionOption], selectedID: String, animated: Bool) {
        let nextIDs = options.map(\.id)
        if configuredIDs != nextIDs || numberOfSegments != options.count {
            removeAllSegments()
            for (index, option) in options.enumerated() { insertSegment(withTitle: option.title, at: index, animated: false) }
            configuredIDs = nextIDs
        } else {
            for (index, option) in options.enumerated() where titleForSegment(at: index) != option.title {
                setTitle(option.title, forSegmentAt: index)
            }
        }
        let foreground = UIColor(red: 34 / 255, green: 33 / 255, blue: 36 / 255, alpha: 1)
        let normalFont = UIFont.preferredFont(forTextStyle: .subheadline)
        let selectedFont = UIFont.systemFont(ofSize: normalFont.pointSize, weight: .semibold)
        setTitleTextAttributes([.foregroundColor: foreground.withAlphaComponent(0.74), .font: normalFont], for: .normal)
        setTitleTextAttributes([.foregroundColor: foreground, .font: selectedFont], for: .selected)
        let nextIndex = options.firstIndex { $0.id == selectedID } ?? UISegmentedControl.noSegment
        guard selectedSegmentIndex != nextIndex else { return }
        // Programmatic preview/state changes retarget the current native transition.
        // Real touches and dragging keep the platform's built-in glass physics.
        if animated, window != nil, !UIAccessibility.isReduceMotionEnabled {
            UIView.animate(withDuration: 0.26, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut]) {
                self.selectedSegmentIndex = nextIndex
                self.layoutIfNeeded()
            }
        } else { selectedSegmentIndex = nextIndex }
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


/// Launch decoration never waits on a model or owns navigation. An interrupted
/// launch is consumed, so foreground/background changes cannot replay it.
struct NativeOpeningReadiness: Hashable {
    let signedIn: Bool
    let stateLoaded: Bool
    let onboardingBlocked: Bool
    let protectedActivity: Bool
    let foreground: Bool
    var ready: Bool { signedIn && stateLoaded && foreground }
    // Own the initial foreground frame before scenePhase becomes active. Only
    // the automatic timer waits for .active; protected flows still stay visible.
    var displayEligible: Bool { signedIn && stateLoaded && !onboardingBlocked && !protectedActivity }
    var allowed: Bool { displayEligible && foreground }
}

struct NativeOpeningState {
    enum Phase: Equatable { case waiting, greeting, handoff, finished }
    private(set) var phase = Phase.waiting
    private(set) var consumed = false
    private(set) var animateHome = false
    static let greetingMilliseconds = 3_200
    static let handoffSeconds = 0.60
    static let homeEntranceSeconds = 0.56
    static let homeStaggerSeconds = 0.08
    mutating func begin(readiness: NativeOpeningReadiness, reduceMotion: Bool) -> Bool {
        guard readiness.ready, !consumed else { return false }
        consumed = true
        animateHome = readiness.allowed && !reduceMotion
        phase = animateHome ? .greeting : .finished
        return phase == .greeting
    }
    mutating func finish(animated: Bool) {
        guard consumed else { return }
        animateHome = animateHome && animated
        phase = .finished
    }
    mutating func beginHandoff() -> Bool {
        guard consumed, phase == .greeting, animateHome else { return false }
        phase = .handoff
        return true
    }
}

struct NativeHomeEntrance: ViewModifier {
    let visible: Bool
    let animated: Bool
    let index: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content.opacity(visible || reduceMotion ? 1 : 0)
            .offset(y: visible || reduceMotion ? 0 : 12)
            .animation(animated && !reduceMotion ? .timingCurve(0.23, 1, 0.32, 1, duration: NativeOpeningState.homeEntranceSeconds).delay(Double(min(5, max(0, index))) * NativeOpeningState.homeStaggerSeconds) : nil, value: visible)
            .transaction { transaction in
                if !animated || reduceMotion { transaction.animation = nil; transaction.disablesAnimations = true }
            }
    }
}

/// No visible continue button: the entire greeting can be tapped or escaped.
/// The model, learning state, and Home content are already ready underneath it.
struct NativeOpeningGreeting: View {
    let name: String
    let sentence: String
    let active: Bool
    let leaving: Bool
    let skip: () -> Void
    @State private var entered = false
    @State private var played = false
    @State private var pose = VoiceOrbGreetingPose.arriving
    @State private var mood = VoiceOrbMood.friendly
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Button(action: skip) {
            VStack(spacing: 18) {
                Spacer(minLength: 18)
                VoiceOrb(mode: .ready, level: 0, mood: mood, greetingPose: pose)
                    .frame(width: 176, height: 184).allowsHitTesting(false).accessibilityHidden(true)
                    .opacity(entered && !leaving ? 1 : 0)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.62), value: entered)
                    .animation(reduceMotion ? nil : .timingCurve(0.4, 0, 0.6, 1, duration: 0.38), value: leaving)
                Text("Привет, \(name).")
                    .font(.system(.largeTitle, design: .rounded).weight(.semibold)).tracking(-0.7)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .opacity(entered && !leaving ? 1 : 0).offset(y: leaving ? -4 : entered ? 0 : 12)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.58).delay(0.24), value: entered)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.18), value: leaving)
                Text(sentence).font(.body).foregroundStyle(Theme.secondary)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 360)
                    .opacity(entered && !leaving ? 1 : 0).offset(y: leaving ? -3 : entered ? 0 : 10)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.58).delay(0.54), value: entered)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.18), value: leaving)
                Spacer(minLength: 18)
                Spacer(minLength: 0).frame(height: 42)
            }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(Theme.charcoal)
                .background {
                    Theme.surface.opacity(leaving ? 0 : 1)
                        .animation(reduceMotion ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: NativeOpeningState.handoffSeconds), value: leaving)
                }
        }.buttonStyle(.plain).ignoresSafeArea()
            .allowsHitTesting(!leaving)
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel("Привет, " + name + ". " + sentence)
            .accessibilityHint("Коснись, чтобы сразу открыть главную.")
            .task(id: active) {
                guard active, scenePhase == .active, !played else { return }
                played = true
                entered = true
                pose = .neutral
                guard !reduceMotion else { return }
                do {
                    try await Task.sleep(for: .milliseconds(780))
                    pose = .lifted
                    mood = .pleased
                    try await Task.sleep(for: .milliseconds(760))
                    pose = .landing
                    try await Task.sleep(for: .milliseconds(640))
                    pose = .neutral
                } catch { return }
            }
    }
}
