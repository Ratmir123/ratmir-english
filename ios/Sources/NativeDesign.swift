import SwiftUI
import UIKit

// MARK: - Colour tokens (planning/v05/DESIGN-SYSTEM.md §2)

/// Semantic colours. Every token is a dynamic UIColor, so light/dark follow the
/// system and Increase Contrast strengthens secondary text and hairlines.
enum Theme {
    enum Palette {
        static let base = dynamic(0xEEEEF3, 0x0B0B10)
        static let ink = dynamic(0x18171C, 0xF5F5F8)
        static let inkSecondary = dynamic(0x18171C, 0xF5F5F8, lightAlpha: 0.62, darkAlpha: 0.64, contrastAlpha: 0.84)
        static let inkTertiary = dynamic(0x18171C, 0xF5F5F8, lightAlpha: 0.42, darkAlpha: 0.42, contrastAlpha: 0.70)
        static let solid = dynamic(0xFFFFFF, 0x17161D)
        static let well = dynamic(0xF4F4F8, 0x201F28)
        /// The inverted surface of a screen's one primary task (DESIGN-PASS 0.5.1): graphite / lifted violet-graphite.
        static let inkSurface = dynamic(0x1D1C22, 0x232130)
        /// Quiet control fill (secondary buttons, sunken rows), like the system's bordered fill.
        static let fill = dynamic(0x18171C, 0xFFFFFF, lightAlpha: 0.06, darkAlpha: 0.10, contrastAlpha: 0.16)
        /// Content surfaces cast a soft offset shadow in light only.
        static let cardShadow = dynamic(0x1C1646, 0x000000, lightAlpha: 0.06, darkAlpha: 0)
        static let inkShadow = dynamic(0x1C1646, 0x000000, lightAlpha: 0.20, darkAlpha: 0.35)
        static let glassHighlight = dynamic(0xFFFFFF, 0xFFFFFF, lightAlpha: 0.85, darkAlpha: 0.16)
        static let hairline = dynamic(0x141228, 0xFFFFFF, lightAlpha: 0.07, darkAlpha: 0.09, contrastAlpha: 0.32)
        static let shadow = dynamic(0x1C1646, 0x000000, lightAlpha: 0.18, darkAlpha: 0.60)
        static let shadowSoft = dynamic(0x1C1646, 0x000000, lightAlpha: 0.07, darkAlpha: 0.35)
        static let lime = dynamic(0xDAF163, 0xDAF163)
        /// Lime-family text that stays readable on light backgrounds.
        static let limeInk = dynamic(0x4E6A00, 0xDAF163)
        static let lavender = dynamic(0xBBB2F5, 0xC4BCFF)
        static let violet = dynamic(0x6F5CF2, 0x8D7DFF)
        static let cyan = dynamic(0x3FD5EA, 0x4FE0F2)
        static let pink = dynamic(0xFF8FB1, 0xFF8FB1)
        static let warning = dynamic(0xFF9F0A, 0xFF9F0A)
        static let danger = dynamic(0xFF453A, 0xFF453A)
        static let ctaFill = dynamic(0x18171C, 0xDAF163)
        static let ctaLabel = dynamic(0xDAF163, 0x121116)
        static let ctaDisabled = dynamic(0x18171C, 0xF5F5F8, lightAlpha: 0.10, darkAlpha: 0.12)
        // One quiet tone with barely visible depth (same alphas as the web's --ambient-*).
        static let ambientViolet = dynamic(0xBBB2F5, 0x5B4BE0, lightAlpha: 0.20, darkAlpha: 0.18)
        static let ambientCyan = dynamic(0x7FE3F0, 0x1FB5C9, lightAlpha: 0.12, darkAlpha: 0.08)
        static let ambientLime = dynamic(0xDAF163, 0xB7D93A, lightAlpha: 0.10, darkAlpha: 0.05)

        static func dynamic(_ light: UInt32, _ dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1, contrastAlpha: CGFloat? = nil) -> UIColor {
            UIColor { traits in
                let isDark = traits.userInterfaceStyle == .dark
                var alpha = isDark ? darkAlpha : lightAlpha
                if let contrastAlpha, traits.accessibilityContrast == .high { alpha = max(alpha, contrastAlpha) }
                return Palette.rgb(isDark ? dark : light, alpha: alpha)
            }
        }
        static func rgb(_ hex: UInt32, alpha: CGFloat) -> UIColor {
            UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                    blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
        }
    }

    static let base = Color(uiColor: Palette.base)
    static let ink = Color(uiColor: Palette.ink)
    static let inkSecondary = Color(uiColor: Palette.inkSecondary)
    static let inkTertiary = Color(uiColor: Palette.inkTertiary)
    static let solid = Color(uiColor: Palette.solid)
    static let well = Color(uiColor: Palette.well)
    static let inkSurface = Color(uiColor: Palette.inkSurface)
    static let fill = Color(uiColor: Palette.fill)
    static let cardShadow = Color(uiColor: Palette.cardShadow)
    static let inkShadow = Color(uiColor: Palette.inkShadow)
    static let glassHighlight = Color(uiColor: Palette.glassHighlight)
    static let hairline = Color(uiColor: Palette.hairline)
    static let shadow = Color(uiColor: Palette.shadow)
    static let shadowSoft = Color(uiColor: Palette.shadowSoft)
    static let lime = Color(uiColor: Palette.lime)
    static let limeInk = Color(uiColor: Palette.limeInk)
    static let lavender = Color(uiColor: Palette.lavender)
    static let violet = Color(uiColor: Palette.violet)
    static let cyan = Color(uiColor: Palette.cyan)
    static let pink = Color(uiColor: Palette.pink)
    static let warning = Color(uiColor: Palette.warning)
    static let danger = Color(uiColor: Palette.danger)
    static let ctaFill = Color(uiColor: Palette.ctaFill)
    static let ctaLabel = Color(uiColor: Palette.ctaLabel)
    static let ctaDisabled = Color(uiColor: Palette.ctaDisabled)
    static let ambientViolet = Color(uiColor: Palette.ambientViolet)
    static let ambientCyan = Color(uiColor: Palette.ambientCyan)
    static let ambientLime = Color(uiColor: Palette.ambientLime)
    /// Text on light accent fills (lime, lavender, cyan), identical in both themes.
    static let onAccent = Color(red: 24.0 / 255, green: 23.0 / 255, blue: 28.0 / 255)

    // v0.4 names, kept for source compatibility. They are adaptive now.
    static let charcoal = ink
    static let surface = base
    static let secondary = inkSecondary
}

enum Radius {
    static let card: CGFloat = 28
    static let sheet: CGFloat = 34
    static let tile: CGFloat = 22
    static let input: CGFloat = 18
}

/// Display type uses SF Rounded (DESIGN-SYSTEM §2 Type); numbers are rounded and tabular.
enum TypeScale {
    static let hero = Font.system(.largeTitle, design: .rounded).weight(.bold)
    static let title = Font.system(.title, design: .rounded).weight(.semibold)
    static let title2 = Font.system(.title2, design: .rounded).weight(.semibold)
    static let title3 = Font.system(.title3, design: .rounded).weight(.semibold)
    static let headline = Font.system(.headline, design: .rounded)
    static let stat = Font.system(.title2, design: .rounded).weight(.semibold).monospacedDigit()
    static let bigStat = Font.system(.largeTitle, design: .rounded).weight(.bold).monospacedDigit()
}

// MARK: - Motion (DESIGN-SYSTEM §2 Motion)

/// Ordinary controls and state changes ease out without overshoot (DESIGN-PASS 0.5.1 «Движение»):
/// press 160 ms, state 240 ms. `bouncy` is only for the mascot, medals and reward moments.
/// State and hit targets never wait for motion.
enum NativeMotion {
    static let press = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.16)
    static let standard = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.24)
    static let bouncy = Animation.bouncy(duration: 0.5, extraBounce: 0.1)
    static let selection = Animation.spring(response: 0.28, dampingFraction: 0.88)
    static let settle = Animation.spring(response: 0.30, dampingFraction: 0.82)
    static let reveal = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.32)
    static let feedback = Animation.easeOut(duration: 0.16)
    static var insertion: AnyTransition {
        .modifier(active: RevealEffect(progress: 0), identity: RevealEffect(progress: 1))
    }
    /// Lists and cards stagger 40 ms, at most six items.
    static func stagger(_ index: Int) -> Animation { standard.delay(Double(min(max(index, 0), 6)) * 0.04) }
}

/// Opacity + 8 pt rise + blur 6 → 0.
struct RevealEffect: ViewModifier {
    let progress: Double
    func body(content: Content) -> some View {
        content.opacity(progress)
            .offset(y: CGFloat(1 - progress) * 8)
            .blur(radius: CGFloat(1 - progress) * 6)
    }
}

/// Staggered entrance for cards (max six). Reduce Motion: shown at once.
struct StaggeredReveal: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content.modifier(RevealEffect(progress: shown || reduceMotion ? 1 : 0))
            .onAppear {
                guard !shown else { return }
                if reduceMotion { shown = true } else { withAnimation(NativeMotion.stagger(index)) { shown = true } }
            }
    }
}

extension View {
    func staggeredReveal(_ index: Int) -> some View { modifier(StaggeredReveal(index: index)) }
}

// MARK: - Russian formatting

/// Dates and numbers always use Russian conventions ("3 окт.", "1 500 XP", 24 h).
enum RuFormat {
    static let locale = Locale(identifier: "ru_RU")
    static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        let n10 = abs(count) % 10
        let n100 = abs(count) % 100
        if n10 == 1 && n100 != 11 { return one }
        if (2...4).contains(n10) && !(12...14).contains(n100) { return few }
        return many
    }
    static func count(_ value: Int, _ one: String, _ few: String, _ many: String) -> String {
        number(value) + " " + plural(value, one, few, many)
    }
    static func minutes(_ value: Int) -> String { count(value, "минуту", "минуты", "минут") }
    static func number(_ value: Int) -> String { value.formatted(.number.locale(locale)) }
    static func xp(_ value: Int) -> String { number(value) + " XP" }
    static func day(_ date: Date) -> String { date.formatted(.dateTime.day().month(.abbreviated).locale(locale)) }
    static func dayTime(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).hour().minute().locale(locale))
    }
    static func time(_ date: Date) -> String { date.formatted(.dateTime.hour().minute().locale(locale)) }
    static func weekday(_ date: Date) -> String { date.formatted(.dateTime.weekday(.abbreviated).locale(locale)) }
    static func relativeDay(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Сегодня" }
        if calendar.isDateInYesterday(date) { return "Вчера" }
        return day(date)
    }
}

enum NativeDate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()
    static func parse(_ value: String) -> Date? { fractional.date(from: value) ?? plain.date(from: value) }
}

// MARK: - Canvas and ambient background

/// Slow aurora behind content: MeshGradient on iOS 18+, blurred blobs on iOS 17,
/// static with Reduce Motion, solid with Reduce Transparency. Paused off screen.
struct AmbientBackdrop: View {
    var intensity: Double = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    private var moving: Bool { visible && !reduceMotion && scenePhase == .active }
    var body: some View {
        ZStack {
            Theme.base
            if !reduceTransparency {
                TimelineView(.animation(minimumInterval: 1.0 / 15.0, paused: !moving)) { context in
                    AmbientLayer(time: moving ? context.date.timeIntervalSinceReferenceDate : 0)
                }
                .opacity(intensity)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { visible = true }
        .onDisappear { visible = false }
    }
}

private struct AmbientLayer: View {
    let time: Double
    var body: some View {
        if #available(iOS 18.0, *) {
            AmbientMesh(time: time)
        } else {
            AmbientBlobs(time: time)
        }
    }
}

@available(iOS 18.0, *)
private struct AmbientMesh: View {
    let time: Double
    var body: some View {
        MeshGradient(width: 3, height: 3, points: points, colors: colors)
    }
    private var points: [SIMD2<Float>] {
        let a = Float(sin(time * 2 * Double.pi / 34))
        let b = Float(cos(time * 2 * Double.pi / 41))
        let c = Float(sin(time * 2 * Double.pi / 38 + 1.3))
        let d = Float(cos(time * 2 * Double.pi / 45 + 0.7))
        let topMiddle = SIMD2<Float>(0.5 + 0.16 * a, 0)
        let leftMiddle = SIMD2<Float>(0, 0.45 + 0.14 * b)
        let center = SIMD2<Float>(0.5 + 0.13 * c, 0.5 + 0.11 * d)
        let rightMiddle = SIMD2<Float>(1, 0.55 + 0.14 * a)
        let bottomMiddle = SIMD2<Float>(0.5 + 0.16 * d, 1)
        return [SIMD2<Float>(0, 0), topMiddle, SIMD2<Float>(1, 0),
                leftMiddle, center, rightMiddle,
                SIMD2<Float>(0, 1), bottomMiddle, SIMD2<Float>(1, 1)]
    }
    private var colors: [Color] {
        [Theme.ambientViolet, Color.clear, Theme.ambientCyan,
         Color.clear, Theme.ambientLime.opacity(0.55), Color.clear,
         Theme.ambientCyan.opacity(0.7), Theme.ambientLime, Theme.ambientViolet]
    }
}

private struct AmbientBlobs: View {
    let time: Double
    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            ZStack {
                blob(Theme.ambientViolet, side: width * 1.05,
                     x: -width * 0.30 + CGFloat(sin(time * 2 * Double.pi / 34)) * width * 0.08, y: -height * 0.30)
                blob(Theme.ambientCyan, side: width * 0.9,
                     x: width * 0.34, y: -height * 0.04 + CGFloat(cos(time * 2 * Double.pi / 41)) * height * 0.05)
                blob(Theme.ambientLime, side: width * 0.85,
                     x: -width * 0.08 + CGFloat(cos(time * 2 * Double.pi / 38)) * width * 0.07, y: height * 0.34)
            }
            .frame(width: width, height: height)
        }
    }
    private func blob(_ color: Color, side: CGFloat, x: CGFloat, y: CGFloat) -> some View {
        Circle().fill(color).frame(width: side, height: side).blur(radius: side * 0.22).offset(x: x, y: y)
    }
}

/// Screen root: ambient background and adaptive foreground. Never forces a colour scheme.
struct LiquidCanvas: ViewModifier {
    var intensity: Double = 1
    func body(content: Content) -> some View {
        content.foregroundStyle(Theme.ink)
            .background { AmbientBackdrop(intensity: intensity) }
    }
}

/// v0.4 name kept for source compatibility: now the adaptive canvas.
struct ReadingCanvas: ViewModifier {
    func body(content: Content) -> some View { content.modifier(LiquidCanvas()) }
}

// MARK: - Materials

/// Glass for floating chrome only (tab bar, sheet headers, the conversation dock, toasts). iOS 26+: Liquid Glass; earlier:
/// thin material, inner highlight and a float shadow; Reduce Transparency / Increase Contrast: solid.
struct LiquidChrome: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    var radius: CGFloat = 28
    var tint: Color? = nil
    var interactive = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @ViewBuilder func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if reduceTransparency || contrast == .increased {
            content.background { SolidChromeFill(shape: shape, tint: tint) }
        } else if #available(iOS 26.0, *) {
            if let tint {
                content.glassEffect(.regular.tint(tint).interactive(interactive && isEnabled && !reduceMotion), in: shape)
            } else {
                content.glassEffect(.regular.interactive(interactive && isEnabled && !reduceMotion), in: shape)
            }
        } else {
            content.background { GlassFallbackFill(shape: shape, tint: tint) }
        }
    }
}

private struct SolidChromeFill: View {
    let shape: RoundedRectangle
    let tint: Color?
    var body: some View {
        ZStack {
            shape.fill(Theme.solid)
            if let tint { shape.fill(tint.opacity(0.55)) }
            shape.strokeBorder(Theme.hairline, lineWidth: 1)
        }
    }
}

private struct GlassFallbackFill: View {
    let shape: RoundedRectangle
    let tint: Color?
    var body: some View {
        ZStack {
            shape.fill(.ultraThinMaterial)
            if let tint { shape.fill(tint.opacity(0.62)) }
            shape.strokeBorder(LinearGradient(colors: [Theme.glassHighlight, Theme.hairline], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        }
        .shadow(color: Theme.shadow, radius: 16, x: 0, y: 10)
    }
}

/// One native container batches sibling glass and lets the system morph it.
struct NativeGlassGroup<Content: View>: View {
    let spacing: CGFloat
    let content: Content
    init(spacing: CGFloat = 10, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }
    @ViewBuilder var body: some View {
        if #available(iOS 26.0, *) { GlassEffectContainer(spacing: spacing) { content } }
        else { content }
    }
}

/// Content surface (DESIGN-PASS 0.5.1): opaque card colour, a hairline edge and a soft offset shadow
/// in light only. Content never sits on glass; a status tint is a quiet wash over the solid fill.
struct ContentSurface: ViewModifier {
    var radius: CGFloat = Radius.card
    var tint: Color? = nil
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                ZStack {
                    shape.fill(Theme.solid)
                    if let tint { shape.fill(tint.opacity(0.6)) }
                }
                .shadow(color: Theme.cardShadow, radius: 10, x: 0, y: 4)
            }
            .overlay { shape.strokeBorder(Theme.hairline, lineWidth: 1).allowsHitTesting(false) }
    }
}

extension View {
    func contentSurface(radius: CGFloat = Radius.card, tint: Color? = nil) -> some View {
        modifier(ContentSurface(radius: radius, tint: tint))
    }
}

/// Content card (v0.4 name kept): a solid `ContentSurface`. Glass belongs to chrome only.
struct LiquidCard<Content: View>: View {
    let radius: CGFloat
    let padding: CGFloat
    let tint: Color?
    let content: Content
    init(radius: CGFloat = Radius.card, padding: CGFloat = 20, tint: Color? = nil, @ViewBuilder content: () -> Content) {
        self.radius = radius
        self.padding = padding
        self.tint = tint
        self.content = content()
    }
    var body: some View {
        content.frame(maxWidth: .infinity, alignment: .leading).padding(padding)
            .contentSurface(radius: radius, tint: tint)
    }
}

/// Solid reading surface (reviews, transcripts, long text). Never glass.
struct SurfaceCard<Content: View>: View {
    let color: Color
    let content: Content
    init(color: Color = Theme.solid, @ViewBuilder content: () -> Content) {
        self.color = color
        self.content = content()
    }
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        content.frame(maxWidth: .infinity, alignment: .leading).padding(20)
            .background { shape.fill(color).shadow(color: Theme.cardShadow, radius: 10, x: 0, y: 4) }
            .overlay { shape.strokeBorder(Theme.hairline, lineWidth: 1).allowsHitTesting(false) }
    }
}

/// The one primary task of a screen: an inverted surface (graphite in light, lifted violet-graphite
/// in dark) with light text and the lime action. The content renders in the dark appearance, so every
/// adaptive token (text, hairlines, `PrimaryButton`) flips with it.
struct InkCard<Content: View>: View {
    let padding: CGFloat
    let content: Content
    init(padding: CGFloat = 22, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .foregroundStyle(Theme.ink)
            .environment(\.colorScheme, .dark)
            .background { shape.fill(Theme.inkSurface).shadow(color: Theme.inkShadow, radius: 18, x: 0, y: 10) }
            .overlay { shape.strokeBorder(Color.white.opacity(0.08), lineWidth: 1).allowsHitTesting(false) }
    }
}

/// One surface holding a list of rows (no cards inside cards); rows are separated with `RowDivider`.
/// An optional title sits inside the surface above the first row.
struct GroupedRows<Content: View>: View {
    let title: String?
    let content: Content
    init(_ title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let title {
                Text(title).font(TypeScale.headline.weight(.semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .contentSurface()
    }
}

/// Hairline between rows of one surface, inset from the leading edge like a system list.
struct RowDivider: View {
    var inset: CGFloat = 16
    var body: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, inset).accessibilityHidden(true)
    }
}

/// A tappable row inside `GroupedRows`: optional stroke icon, title, detail and a trailing chevron or accessory.
struct ListRowLabel<Accessory: View>: View {
    var icon: String? = nil
    let title: String
    var detail: String? = nil
    var showsChevron = true
    let accessory: Accessory
    init(icon: String? = nil, title: String, detail: String? = nil, showsChevron: Bool = true,
         @ViewBuilder accessory: () -> Accessory) {
        self.icon = icon
        self.title = title
        self.detail = detail
        self.showsChevron = showsChevron
        self.accessory = accessory()
    }
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            if let icon {
                Image(systemName: icon).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                    .frame(width: 26).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.footnote).foregroundStyle(Theme.inkSecondary).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            accessory
            if showsChevron {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        .contentShape(Rectangle())
    }
}

extension ListRowLabel where Accessory == EmptyView {
    init(icon: String? = nil, title: String, detail: String? = nil, showsChevron: Bool = true) {
        self.init(icon: icon, title: title, detail: detail, showsChevron: showsChevron) { EmptyView() }
    }
}

/// Row press feedback inside a grouped surface: a quiet fill instead of a scale.
struct RowButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(isEnabled ? 1 : 0.46)
            .background(configuration.isPressed && isEnabled ? Theme.fill : Color.clear)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// MARK: - Composer dock

/// Bottom glass backing of the conversation dock. Drawn only when the dock has content (C-14).
struct ComposerBackdrop: ViewModifier {
    var visible = true
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity)
            .background {
                if visible {
                    if reduceTransparency || contrast == .increased {
                        UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous)
                            .fill(Theme.solid)
                    } else {
                        UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous)
                            .fill(.regularMaterial)
                            .overlay(alignment: .top) {
                                UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous)
                                    .stroke(Theme.hairline, lineWidth: 1)
                            }
                            .shadow(color: Theme.shadowSoft, radius: 18, x: 0, y: -4)
                    }
                }
            }
    }
}

/// The backing owns the whole bottom edge, including the home-indicator area.
struct ConversationDock<Dock: View>: ViewModifier {
    let showsBackdrop: Bool
    let dock: Dock
    @State private var containerBottomInset: CGFloat? = nil
    init(showsBackdrop: Bool = true, @ViewBuilder dock: () -> Dock) {
        self.showsBackdrop = showsBackdrop
        self.dock = dock()
    }
    func body(content: Content) -> some View {
        GeometryReader { geometry in
            content.safeAreaInset(edge: .bottom, spacing: 0) {
                // The space is part of this backing's real layout, not a shape
                // escaping an inset. Sheet/large-type content cannot leak below it.
                dock.padding(.bottom, containerBottomInset ?? geometry.safeAreaInsets.bottom)
                    .modifier(ComposerBackdrop(visible: showsBackdrop))
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

// MARK: - Buttons

struct PressButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(isEnabled ? 1 : 0.46)
            .opacity(configuration.isPressed && isEnabled ? 0.85 : 1)
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// The one filled action of a screen: charcoal + lime in light, lime + dark in dark.
struct PrimaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .padding(.horizontal, 22).padding(.vertical, 15)
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(isEnabled ? Theme.ctaLabel : Theme.inkTertiary)
            .background(isEnabled ? Theme.ctaFill : Theme.ctaDisabled, in: Capsule())
            .shadow(color: isEnabled ? Theme.cardShadow : Color.clear, radius: 8, x: 0, y: 4)
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// Secondary action: a quiet filled capsule (like the system bordered button). Not glass: it sits on content.
struct SecondaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .padding(.horizontal, 20).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 50)
            .foregroundStyle(isEnabled ? Theme.ink : Theme.inkTertiary)
            .background(Theme.fill, in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// Small quiet capsule for secondary actions (min 44 × 44).
struct QuietButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.footnote.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 11)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(isEnabled ? Theme.ink : Theme.inkTertiary)
            .background(Theme.fill, in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// Round icon control on content (play a line, delete a row): solid quiet fill or a status tint.
struct SoftIconButton: ButtonStyle {
    var size: CGFloat = 44
    var tint: Color? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(width: size, height: size)
            .foregroundStyle(isEnabled ? Theme.ink : Theme.inkTertiary)
            .background(tint ?? Theme.fill, in: Circle())
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.94 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// Circular glass icon button (44 pt by default) — floating chrome only (dock, sheet header).
struct LiquidIconButton: ButtonStyle {
    var size: CGFloat = 44
    var tint: Color? = nil
    var foreground: Color = Theme.ink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(width: size, height: size)
            .foregroundStyle(isEnabled ? foreground : Theme.inkTertiary)
            .modifier(LiquidChrome(radius: size / 2, tint: tint, interactive: false))
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.92 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// Destructive text action in a quiet capsule.
struct DestructiveQuietButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.footnote.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 11)
            .frame(minWidth: 44, minHeight: 44)
            .foregroundStyle(isEnabled ? Theme.danger : Theme.inkTertiary)
            .background(Theme.fill, in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

struct SegmentPressButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed && !reduceMotion ? 0.965 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

// MARK: - Small components

struct BrandMark: View {
    let size: CGFloat
    var body: some View {
        Text("S·").font(.system(size: size * 0.55, weight: .bold, design: .rounded))
            .foregroundStyle(Theme.onAccent).frame(width: size, height: size)
            .background(Theme.lime, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityLabel("Smooth Talk")
    }
}

struct ScreenHeading: View {
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(TypeScale.hero).tracking(-0.6)
            Text(subtitle).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
        }.padding(.top, 12).padding(.bottom, 4)
    }
}

/// Small caption label (form fields, eyebrows).
struct InputLabel: View {
    let title: String
    var body: some View { Text(title).font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary) }
}

/// Section title with real emphasis (the review's key sections are not grey captions).
struct LiquidSectionHeader: View {
    let title: String
    var systemImage: String? = nil
    var body: some View {
        HStack(spacing: 8) {
            if let systemImage { Image(systemName: systemImage).foregroundStyle(Theme.ink).accessibilityHidden(true) }
            Text(title).font(TypeScale.headline.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Status chip: a coloured dot and ink text, readable over any background.
struct StatusPill: View {
    let title: String
    let color: Color
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(color.opacity(0.22), in: Capsule())
        .overlay { Capsule().strokeBorder(Theme.hairline, lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }
}

/// A number and its label, placed inside a host surface (no tile, no colour bar of its own).
struct Metric: View {
    let value: String
    let title: String
    var color: Color = Theme.violet
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(TypeScale.stat)
                .contentTransition(reduceMotion ? .identity : .numericText())
            Text(title).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Theme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : NativeMotion.feedback, value: value)
        .accessibilityElement(children: .combine)
    }
}

/// Inline, non-modal message with an optional action (recoverable errors, notices).
struct InlineBanner: View {
    enum Tone { case error, warning, info, success }
    let tone: Tone
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var dismiss: (() -> Void)? = nil
    private var icon: String {
        switch tone {
        case .error: return "exclamationmark.triangle.fill"
        case .warning: return "exclamationmark.circle.fill"
        case .info: return "info.circle.fill"
        case .success: return "checkmark.seal.fill"
        }
    }
    private var color: Color {
        switch tone {
        case .error: return Theme.danger
        case .warning: return Theme.warning
        case .info: return Theme.violet
        case .success: return Theme.limeInk
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(color).font(.body.weight(.semibold)).padding(.top, 2)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                if let message, !message.isEmpty {
                    Text(message).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
                if let actionTitle, let action {
                    Button(actionTitle, action: action).buttonStyle(QuietButton()).padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
            if let dismiss {
                Button(action: dismiss) { Image(systemName: "xmark").font(.caption.weight(.bold)) }
                    .buttonStyle(SoftIconButton(size: 32))
                    .accessibilityLabel("Скрыть сообщение")
            }
        }
        .padding(14)
        .background(Theme.solid, in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).strokeBorder(color.opacity(0.45), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }
}

struct SelectionOption: Identifiable {
    let id: String
    let title: String
    let icon: String
}

/// System segmented control (platform glass) or a large-type list.
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
                            }.foregroundStyle(Theme.ink).padding(16).frame(maxWidth: .infinity, minHeight: 54)
                                .background(selection == option.id ? Theme.lavender.opacity(0.42) : Theme.well,
                                            in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }.buttonStyle(SegmentPressButton()).accessibilityAddTraits(selection == option.id ? .isSelected : [])
                    }
                }
            } else {
                NativePracticeSegments(selection: $selection, options: options, reduceMotion: reduceMotion)
                    .frame(height: 40)
            }
        }.sensoryFeedback(.selection, trigger: selection)
    }
}

/// UISegmentedControl adopts the system Liquid Glass interaction with the current SDK.
/// Do not set custom background/divider images or coloured selected backgrounds.
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
        let normalFont = UIFont.preferredFont(forTextStyle: .subheadline)
        let selectedFont = UIFont.systemFont(ofSize: normalFont.pointSize, weight: .semibold)
        setTitleTextAttributes([.foregroundColor: Theme.Palette.inkSecondary, .font: normalFont], for: .normal)
        setTitleTextAttributes([.foregroundColor: Theme.Palette.ink, .font: selectedFont], for: .selected)
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

struct SoftDisclosureStyle: DisclosureGroupStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : NativeMotion.standard) { configuration.isExpanded.toggle() }
            } label: {
                HStack(spacing: 12) {
                    configuration.label.frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                        .rotationEffect(.degrees(configuration.isExpanded ? 180 : 0))
                        .foregroundStyle(Theme.inkSecondary)
                }.foregroundStyle(Theme.ink).frame(minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(PressButton())
                .accessibilityValue(configuration.isExpanded ? "Развёрнуто" : "Свёрнуто")
                .accessibilityHint("Дважды коснись, чтобы " + (configuration.isExpanded ? "свернуть подробности." : "раскрыть подробности."))
            if configuration.isExpanded {
                configuration.content.transition(reduceMotion ? .identity : NativeMotion.insertion)
            }
        }
    }
}

struct TranscriptCard: View {
    let turn: Turn
    /// Overrides the speaker caption (e.g. «Реплика из твоего созвона» in a replay).
    var label: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label ?? (turn.role == "user" ? "Ты" : "Собеседник")).font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
            Text(turn.text).font(.body).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
            .background(turn.role == "user" ? Theme.lavender.opacity(0.28) : Theme.solid, in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1)
            }
    }
}

struct EvidenceLabel: View {
    let title: String
    let confirmed: Bool
    var body: some View {
        Label(title, systemImage: confirmed ? "checkmark.circle.fill" : "circle")
            .font(.caption).foregroundStyle(confirmed ? Theme.ink : Theme.inkSecondary)
            .accessibilityLabel(title + (confirmed ? ": подтверждено" : ": пока не подтверждено"))
    }
}

struct ActivityPanel: View {
    let title: String
    let detail: String
    let startedAt: Date?
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ProgressView().tint(Theme.violet).padding(.top, 3)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    if let startedAt { Text(startedAt, style: .timer).font(.caption.monospacedDigit()).foregroundStyle(Theme.inkSecondary) }
                }
                Text(detail).font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
        }.padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentSurface(radius: Radius.tile)
            .contentTransition(.opacity)
            .accessibilityElement(children: .combine)
    }
}

/// Progress bar: a solid fill on a quiet track, easing out without overshoot (DESIGN-PASS 0.5.1).
struct LiquidProgressBar: View {
    let value: Double
    var color: Color = Theme.violet
    var height: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var clamped: Double { value.isFinite ? min(1, max(0, value)) : 0 }
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.ink.opacity(0.08))
                Capsule().fill(color)
                    .frame(width: max(clamped > 0 ? height : 0, proxy.size.width * CGFloat(clamped)))
            }
        }
        .frame(height: height)
        .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.6), value: clamped)
        .accessibilityElement()
        .accessibilityValue("\(Int((clamped * 100).rounded())) процентов")
    }
}

// MARK: - Launch greeting

/// Launch decoration never waits on a model or owns navigation. An interrupted
/// launch is consumed, so foreground/background changes cannot replay it.
struct NativeOpeningReadiness: Hashable {
    let signedIn: Bool
    let stateLoaded: Bool
    /// v0.5: the placement test is about to be presented (keeps its v0.4 name).
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
struct NativeOpeningGreeting: View {
    let name: String
    let sentence: String
    let active: Bool
    let leaving: Bool
    let skip: () -> Void
    @State private var entered = false
    @State private var played = false
    @State private var pose = VoiceOrbGreetingPose.arriving
    @State private var mood = VoiceOrbMood.happy
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Button(action: skip) {
            VStack(spacing: 18) {
                Spacer(minLength: 18)
                VoiceOrb(mode: .ready, level: 0, mood: mood, greetingPose: pose, interactive: false)
                    .frame(width: 176, height: 184).allowsHitTesting(false).accessibilityHidden(true)
                    .opacity(entered && !leaving ? 1 : 0)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.62), value: entered)
                    .animation(reduceMotion ? nil : .timingCurve(0.4, 0, 0.6, 1, duration: 0.38), value: leaving)
                Text("Привет, \(name).")
                    .font(TypeScale.hero).tracking(-0.6)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .opacity(entered && !leaving ? 1 : 0).offset(y: leaving ? -4 : entered ? 0 : 12)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.58).delay(0.24), value: entered)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.18), value: leaving)
                Text(sentence).font(.body).foregroundStyle(Theme.inkSecondary)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 360)
                    .opacity(entered && !leaving ? 1 : 0).offset(y: leaving ? -3 : entered ? 0 : 10)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.58).delay(0.54), value: entered)
                    .animation(reduceMotion ? nil : .timingCurve(0.23, 1, 0.32, 1, duration: 0.18), value: leaving)
                Spacer(minLength: 18)
                Spacer(minLength: 0).frame(height: 42)
            }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                .foregroundStyle(Theme.ink)
                .background {
                    Theme.base.opacity(leaving ? 0 : 1)
                        .animation(reduceMotion ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: NativeOpeningState.handoffSeconds), value: leaving)
                }
        }.buttonStyle(.plain).contentShape(Rectangle()).ignoresSafeArea()
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
                    mood = .joy
                    try await Task.sleep(for: .milliseconds(760))
                    pose = .landing
                    try await Task.sleep(for: .milliseconds(640))
                    pose = .neutral
                } catch { return }
            }
    }
}
