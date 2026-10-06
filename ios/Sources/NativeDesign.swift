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

// MARK: - Motion (MOTION-PASS-0.5.2 §1)

/// «Glass jelly settles»: things decelerate long and soft on the expo-out curve (0.16, 1, 0.3, 1) and never snap;
/// slightly slower than 0.5.1, exits shorter than entrances. `bouncy` is only for the mascot, medals and reward
/// moments. State and hit targets never wait for motion. `FeatureMotion` (CallsComponents.swift) mirrors these.
enum NativeMotion {
    /// Pressed controls: 200 ms.
    static let press = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.20)
    /// State changes (expand, swap, insert): 380 ms.
    static let standard = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.38)
    /// Content that rises into place (`RevealEffect`, `rowReveal`): 500 ms.
    static let reveal = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.50)
    /// Small value changes (numbers, ticks): 200 ms.
    static let feedback = Animation.easeOut(duration: 0.20)
    static let selection = Animation.spring(response: 0.42, dampingFraction: 0.86)
    static let settle = Animation.spring(response: 0.48, dampingFraction: 0.84)
    /// Leaving accelerates away and is shorter than arriving (web `--ease-exit`).
    static let exit = Animation.timingCurve(0.4, 0, 1, 1, duration: 0.24)
    /// A row's pressed fill inside a grouped surface.
    static let rowPress = Animation.easeOut(duration: 0.16)
    /// Progress fills (`transform`-like width changes): 900 ms.
    static let progress = Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.90)
    /// Reduce Motion: fewer and gentler — a cross-fade instead of travel or blur.
    static let crossFade = Animation.easeInOut(duration: 0.30)
    /// Mascot, medals and reward moments only (680 ms on the web).
    static let bouncy = Animation.bouncy(duration: 0.66, extraBounce: 0.1)
    /// Lists and cards stagger 70 ms, at most eight steps.
    static let staggerStep = 0.07
    static let staggerLimit = 8
    static var insertion: AnyTransition {
        .modifier(active: RevealEffect(progress: 0), identity: RevealEffect(progress: 1))
    }
    static func stagger(_ index: Int) -> Animation {
        standard.delay(Double(min(max(index, 0), staggerLimit)) * staggerStep)
    }
}

/// Opacity + 10 pt rise + blur 4 → 0 (web `.reveal`).
struct RevealEffect: ViewModifier {
    let progress: Double
    func body(content: Content) -> some View {
        content.opacity(progress)
            .offset(y: CGFloat(1 - progress) * 10)
            .blur(radius: CGFloat(1 - progress) * 4)
    }
}

extension View {
    /// Kept for source compatibility: the light row cascade (`rowReveal`, Entrance.swift).
    func staggeredReveal(_ index: Int) -> some View { rowReveal(index) }
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

/// Slow aurora behind content: MeshGradient on iOS 18+, soft radial blobs on iOS 17,
/// static with Reduce Motion, solid with Reduce Transparency. Paused off screen and while the launch layer covers
/// the shell (PASS 0.5.3 §5).
struct AmbientBackdrop: View {
    var intensity: Double = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.shellCovered) private var shellCovered
    @State private var visible = false
    private var moving: Bool { visible && !reduceMotion && !shellCovered && scenePhase == .active }
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
    /// The circle of diameter `side` blurred by 0.22 · side, drawn as one radial gradient out to 1.88 × its radius:
    /// the same soft blob without a blur pass on every 15 Hz frame (PASS 0.5.3 §5).
    private func blob(_ color: Color, side: CGFloat, x: CGFloat, y: CGFloat) -> some View {
        let reach = side * AmbientBlobs.reach
        return RadialGradient(stops: AmbientBlobs.falloff.map { Gradient.Stop(color: color.opacity($0.alpha), location: $0.location) },
                              center: .center, startRadius: 0, endRadius: reach / 2)
            .frame(width: reach, height: reach)
            .offset(x: x, y: y)
    }

    /// Diameter of the gradient relative to the blob's own diameter.
    private static let reach: CGFloat = 1.88
    /// Radial profile of a disc blurred by 0.44 of its radius, measured out to 1.88 radii.
    private static let falloff: [(location: CGFloat, alpha: Double)] = [
        (0, 0.92), (0.3, 0.8), (0.53, 0.46), (0.78, 0.12), (1, 0),
    ]
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
            .animation(NativeMotion.rowPress, value: configuration.isPressed)
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
/// `compact` sizes it for a row (44 pt tall, hugging its label).
struct PrimaryButton: ButtonStyle {
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .subheadline.weight(.semibold) : .body.weight(.semibold))
            .padding(.horizontal, compact ? 18 : 22).padding(.vertical, compact ? 10 : 15)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 44 : 52)
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
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .subheadline.weight(.semibold) : .body.weight(.semibold))
            .padding(.horizontal, compact ? 18 : 20).padding(.vertical, compact ? 10 : 14)
            .frame(maxWidth: compact ? nil : .infinity, minHeight: compact ? 44 : 50)
            .foregroundStyle(isEnabled ? Theme.ink : Theme.inkTertiary)
            .background(Theme.fill, in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

/// Sheet close control for the navigation bar: an xmark (iOS 26 renders it as a glass circle), so a
/// long sheet title never truncates a text button to «От…». The spoken label keeps the verb.
struct SheetCloseButton: View {
    var title = "Отмена"
    let action: () -> Void
    var body: some View {
        Button(action: action) { Image(systemName: "xmark").font(.body.weight(.semibold)) }
            .accessibilityLabel(title)
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

/// The brand is the companion itself (MOTION-PASS-0.5.2 §3), no letter mark: Login ≈ 64 pt (happy),
/// Profile «О приложении» ≈ 44 pt (calm). Decorative: the adjacent text names the app.
struct BrandMark: View {
    let size: CGFloat
    var mood: VoiceOrbMood = .calm
    var interactive = false
    var body: some View {
        ScreenMascot(mood: mood, size: size, interactive: interactive)
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
                withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard) { configuration.isExpanded.toggle() }
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
                configuration.content.transition(reduceMotion ? AnyTransition.opacity : NativeMotion.insertion)
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
        .animation(reduceMotion ? nil : NativeMotion.progress, value: clamped)
        .accessibilityElement()
        .accessibilityValue("\(Int((clamped * 100).rounded())) процентов")
    }
}

// MARK: - Launch layer (MOTION-PASS-0.5.2 §4)

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
    /// The greeting was on screen: a skip then reveals Home at once instead of replaying the staircase.
    private(set) var greeted = false
    static let greetingMilliseconds = 3_200
    /// The hand-off to Home: a slow, soft fade of the whole layer (companion included, in place) while
    /// Today's staircase rises underneath.
    static let handoffSeconds = 0.80
    mutating func begin(readiness: NativeOpeningReadiness, reduceMotion: Bool) -> Bool {
        guard readiness.ready, !consumed else { return false }
        consumed = true
        animateHome = readiness.allowed && !reduceMotion
        greeted = animateHome
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

/// The launch greeting from saved facts only, the same copy as the web `deriveOpeningGreeting`
/// (lib/startup-welcome.ts): «Привет, <имя>.» — or plain «Привет.» while no real name is saved — and one motivating
/// line (`LaunchMotivation`). Launch never waits for a model call; without a state the line is the boot line.
struct OpeningGreeting: Equatable {
    let greeting: String
    let motivation: String

    init(state: TrainingState?, now: Date = Date(), calendar: Calendar = .current) {
        greeting = OpeningGreeting.displayName(state?.profile.name).map { "Привет, \($0)." } ?? "Привет."
        let sessions = state?.sessions ?? []
        // Web `resumable`: anything not completed (a parked retry is completed); a removed 0.4 probe never counts; and,
        // like Today's main card, nothing untouched for 72 h (it waits in «Незаконченные» instead).
        let resumable = sessions.contains { $0.status != "completed" && !$0.isBaseline && $0.isFresh(now: now) }
        // Web `completedToday`: completed earlier today with at least one spoken or typed answer.
        let completedToday = sessions.contains { session in
            guard session.status == "completed", let stamp = session.updatedAt, let updated = NativeDate.parse(stamp),
                  updated <= now, calendar.isDate(updated, inSameDayAs: now) else { return false }
            return session.turns.contains { $0.role == "user" && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        var facts = LaunchMotivationFacts()
        facts.resumable = resumable
        facts.completedToday = completedToday
        // «Мои фразы» due now (new phrases are due at once): the same reader as Today and Practice.
        facts.duePhrases = state?.duePhraseCount(now: now) ?? 0
        // Web: a personal drill from a real call that is not done yet.
        facts.pendingCallDrill = (state?.drills ?? []).contains { !$0.isDone && $0.source.type == "call" }
        // «На этой неделе»: today and the six days before, from the same practice dates as Today's «N из 7».
        facts.practiceDays = LaunchMotivation.practiceDays(OpeningGreeting.practiceDates(state), now: now, calendar: calendar)
        facts.dayOfYear = LaunchMotivation.dayOfYear(now, calendar: calendar)
        motivation = LaunchMotivation.line(facts)
    }

    /// When practice happened (`PracticeRhythm`'s sources): completed lessons and the server's practice results.
    static func practiceDates(_ state: TrainingState?) -> [Date] {
        guard let state else { return [] }
        var dates = state.sessions.filter { $0.status == "completed" }.compactMap(\.latestDate)
        dates += (state.progression?.recentResults ?? []).compactMap { NativeDate.parse($0.completedAt) }
        return dates
    }

    /// Today's heading (web `greeting()` in components/app/labels.ts): the time of day, then the name when one is saved.
    static func dayGreeting(name: String?, now: Date = Date(), calendar: Calendar = .current) -> String {
        let hour = calendar.component(.hour, from: now)
        let part = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер"
        return displayName(name).map { part + ", " + $0 } ?? part
    }

    /// A real name, or nil for the placeholders the server and the client use when none was given
    /// (web: 'Ты', 'You', 'Learner'; a missing name decodes as «ты» here).
    static func displayName(_ name: String?) -> String? {
        guard let clean = name?.trimmingCharacters(in: .whitespacesAndNewlines), !clean.isEmpty,
              !["ты", "you", "learner"].contains(clean.lowercased()) else { return nil }
        return clean
    }
}

/// What the launch motivation rules look at (web `LaunchMotivationFacts`); each platform derives them from its state.
struct LaunchMotivationFacts: Equatable {
    /// A conversation is waiting (Today's «Продолжить», not older than 72 h).
    var resumable = false
    /// A completed practice with his own words today.
    var completedToday = false
    /// «Мои фразы» due now.
    var duePhrases = 0
    /// A personal drill from a real call that is not done yet.
    var pendingCallDrill = false
    /// Practice days among today and the six days before.
    var practiceDays = 0
    /// 1-based day of the year for the pool.
    var dayOfYear = 1
}

/// PASS 0.5.3 §6: the motivating line under the launch companion — the same strings (byte for byte), order and rules as
/// lib/startup-welcome.ts (`launchMotivation`, `MOTIVATION_POOL`, `duePhrasesLine`, `rhythmLine`, `bootMotivation`).
/// Pure. The boot line (before any data) is the pool line of the day; the personal line is the first match of: a
/// conversation waits → practised today → phrases due → a drill from a call → ≥ 3 practice days this week → the pool.
enum LaunchMotivation {
    static let resumeLine = "Разговор ждёт — продолжим с того же места."
    static let doneTodayLine = "Сегодня уже была практика. Дальше — в своём темпе."
    static let callDrillLine = "Есть тренировка из твоего созвона — переиграем момент."
    /// «Держим ритм» needs at least this many practice days in the last seven (today included).
    static let rhythmDays = 3
    /// The day-of-year pool, in this order: index = (1-based local day of the year − 1) mod 7, 1 January → the first line.
    static let pool = [
        "Пять минут вслух — лучше часа в голове.",
        "Сильный ответ начинается с главного.",
        "Каждый разговор делает следующий созвон проще.",
        "Говори своими словами — точность придёт с практикой.",
        "Короткий шаг каждый день сильнее редкого рывка.",
        "Свою цену называют спокойно.",
        "Сегодня — ещё один спокойный разговор на английском.",
    ]

    /// «1 фраза ждёт повторения — скажем её вслух.» / «3 фразы ждут … их …» / «5 фраз ждут …» / «21 фраза ждёт … их …».
    static func duePhrasesLine(_ count: Int) -> String {
        let n = max(1, count)
        let noun = RuFormat.plural(n, "фраза", "фразы", "фраз")
        return "\(n) \(noun) \(noun == "фраза" ? "ждёт" : "ждут") повторения — скажем \(n == 1 ? "её" : "их") вслух."
    }

    /// «3 дня практики на этой неделе. Держим ритм.» / «5 дней …».
    static func rhythmLine(_ days: Int) -> String {
        let n = max(0, days)
        return "\(n) " + RuFormat.plural(n, "день", "дня", "дней") + " практики на этой неделе. Держим ритм."
    }

    /// 1 for 1 January … 365/366 for 31 December in `calendar` (its time zone).
    static func dayOfYear(_ now: Date, calendar: Calendar = .current) -> Int {
        guard now.timeIntervalSinceReferenceDate.isFinite else { return 1 }
        return calendar.ordinality(of: .day, in: .year, for: now) ?? 1
    }

    /// The pool line for a day of the year (1-based).
    static func poolLine(day: Int) -> String {
        let count = pool.count
        return pool[((day - 1) % count + count) % count]
    }

    /// The line from the first frame, before any data: the day-of-year pool only.
    static func boot(now: Date = Date(), calendar: Calendar = .current) -> String {
        poolLine(day: dayOfYear(now, calendar: calendar))
    }

    /// Distinct practice days among today and the six days before it in `calendar` (the window of Today's «N из 7»).
    /// Future and older-than-eight-days times never count.
    static func practiceDays(_ completed: [Date], now: Date = Date(), calendar: Calendar = .current) -> Int {
        let key = { (date: Date) in calendar.dateComponents([.year, .month, .day], from: date) }
        var week = Set<DateComponents>()
        for back in 0..<7 {
            if let day = calendar.date(byAdding: .day, value: -back, to: now) { week.insert(key(day)) }
        }
        var practised = Set<DateComponents>()
        for date in completed {
            let ahead = date.timeIntervalSince(now)
            guard ahead.isFinite, ahead <= 1, -ahead <= 8 * 86_400 else { continue }
            let day = key(date)
            if week.contains(day) { practised.insert(day) }
        }
        return practised.count
    }

    /// The first rule that matches, in this order; otherwise the day-of-year pool.
    static func line(_ facts: LaunchMotivationFacts) -> String {
        if facts.resumable { return resumeLine }
        if facts.completedToday { return doneTodayLine }
        if facts.duePhrases > 0 { return duePhrasesLine(facts.duePhrases) }
        if facts.pendingCallDrill { return callDrillLine }
        if facts.practiceDays >= rhythmDays { return rhythmLine(facts.practiceDays) }
        return poolLine(day: facts.dayOfYear)
    }
}

/// What the launch layer shows. One view and one companion serve every stage, so nothing remounts or jumps.
enum LaunchStage: Equatable {
    /// The saved access key is being checked: the companion breathes (calm), nothing else.
    case waiting
    /// The server did not answer: a sad companion, the reason, «Повторить» and «Ввести код заново».
    case offline(detail: String, retrying: Bool)
    /// «Привет, …» next to the same companion, then the hand-off to Home.
    case greeting
}

enum NativeLaunch {
    /// The layer cross-fades out when no greeting follows it (Home without a greeting, a refused code, «Ввести код заново»).
    static let coverFadeSeconds = 0.5
    /// The companion appears a moment after the first frame (the system launch screen is the bare background).
    static let mascotDelayMilliseconds = 150
    /// A slow server gets a quiet «Подключаюсь к серверу…» under the companion.
    static let slowHintSeconds = 4.0
    /// A sign-in that hangs becomes «Нет связи с сервером» instead of an endless launch.
    static let restoreTimeoutSeconds = 30.0
    /// The companion's frame in every stage: the greeting continues from the very first launch frame.
    static let mascotSize = CGSize(width: 176, height: 184)
}

/// One launch layer from the first frame to the hand-off (MOTION-PASS-0.5.2 §4): the app background and the same
/// companion instance (176 × 184, its centre at 40 % of the screen) while the saved key is checked, when the server
/// cannot be reached and during the greeting. Text below the companion never moves it. The greeting can be tapped
/// or escaped at any moment; there is no visible continue button.
/// PASS 0.5.3 §6 (the launch is the preloader): from the first moments one motivating line from the day-of-year pool
/// sits under the companion; at the greeting «Привет, …» rises above it and the line cross-fades to the personal one
/// when that differs. Reward and scenario art is decoded meanwhile (`ImagePrewarm`).
struct LaunchView: View {
    let stage: LaunchStage
    /// «Привет, <имя>.» or «Привет.» (`OpeningGreeting`).
    let greeting: String
    /// The personal motivating line (`OpeningGreeting.motivation`); empty = the boot line.
    let sentence: String
    /// Fading out: the greeting's hand-off to Home or a plain cover fade.
    let leaving: Bool
    let leaveSeconds: Double
    let skip: () -> Void
    let retry: () -> Void
    let enterCode: () -> Void
    /// The boot line: no data needed, the same all day.
    private let bootLine: String
    @State private var shown = false
    @State private var greeted = false
    @State private var played = false
    @State private var slow = false
    @State private var pose: VoiceOrbGreetingPose
    @State private var greetingMood: VoiceOrbMood?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(stage: LaunchStage, greeting: String = "Привет.", sentence: String = "", leaving: Bool = false,
         leaveSeconds: Double = NativeOpeningState.handoffSeconds, skip: @escaping () -> Void = {},
         retry: @escaping () -> Void = {}, enterCode: @escaping () -> Void = {}) {
        self.stage = stage
        self.greeting = greeting
        self.sentence = sentence
        self.leaving = leaving
        self.leaveSeconds = leaveSeconds
        self.skip = skip
        self.retry = retry
        self.enterCode = enterCode
        bootLine = LaunchMotivation.boot()
        // Straight into the greeting (no launch wait before it): the companion lands squashed and springs up.
        let direct = stage == .greeting
        _pose = State(initialValue: direct ? VoiceOrbGreetingPose.arriving : VoiceOrbGreetingPose.neutral)
        _greetingMood = State(initialValue: direct ? VoiceOrbMood.happy : nil)
    }

    private var personalLine: String {
        let line = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        return line.isEmpty ? bootLine : line
    }
    /// The greeting brings a different line: the boot line hands over to it.
    private var crossFades: Bool { personalLine != bootLine }
    private var bootLineVisible: Bool { shown && !leaving && !isOffline && !(greeted && crossFades) }
    private var personalLineVisible: Bool { greeted && !leaving && crossFades }

    private var isGreeting: Bool { stage == .greeting }
    private var offline: (detail: String, retrying: Bool)? {
        if case .offline(let detail, let retrying) = stage { return (detail, retrying) }
        return nil
    }
    private var isOffline: Bool { offline != nil }
    /// Launch: calm, breathing. Offline: sad (thinking while it retries). Greeting: happy, a hop of joy.
    private var mood: VoiceOrbMood {
        if let offline = offline { return offline.retrying ? .thinking : .sad }
        return greetingMood ?? .calm
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                Theme.base
                    .opacity(leaving ? 0 : 1)
                    .animation(reduceMotion ? NativeMotion.crossFade : fade, value: leaving)
                if dynamicTypeSize.isAccessibilitySize {
                    // Large text: no greeting runs here, so the layer may scroll and the companion can be smaller.
                    ScrollView {
                        column(mascot: CGSize(width: 120, height: 125))
                            .padding(.top, 72).padding(.horizontal, 24).padding(.bottom, 40)
                            .frame(width: proxy.size.width)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                } else {
                    column(mascot: NativeLaunch.mascotSize)
                        .padding(.top, mascotTop(proxy.size.height))
                        .padding(.horizontal, 28)
                        .frame(width: proxy.size.width)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
        .ignoresSafeArea()
        .foregroundStyle(Theme.ink)
        .contentShape(Rectangle())
        .onTapGesture { if isGreeting { skip() } }
        .background { skipShortcut }
        .accessibilityElement(children: .contain)
        .task { await revealCompanion() }
        .task(id: isGreeting && scenePhase == .active) { await greet() }
        .task(id: stage == .waiting) { await watchSlowServer() }
    }

    private func column(mascot: CGSize) -> some View {
        VStack(spacing: 18) {
            VoiceOrb(mode: .ready, level: 0, mood: mood, greetingPose: pose, interactive: false)
                .frame(width: mascot.width, height: mascot.height)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                .opacity(shown && !leaving ? 1 : 0)
                .animation(reduceMotion ? NativeMotion.crossFade : arrive, value: shown)
                .animation(reduceMotion ? NativeMotion.crossFade : fade, value: leaving)
            ZStack(alignment: .top) {
                VStack(spacing: 18) {
                    greetingLines
                    waitingLine
                }
                if let offline = offline {
                    offlineBlock(offline)
                        .transition(reduceMotion ? AnyTransition.opacity
                                    : AnyTransition.opacity.combined(with: AnyTransition.offset(y: 8)))
                }
            }
            .frame(maxWidth: 420)
            .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.reveal, value: isOffline)
        }
    }

    /// «Привет, …» (its place kept from the start, so nothing moves) above the motivating line.
    private var greetingLines: some View {
        VStack(spacing: 18) {
            Text(greeting)
                .font(TypeScale.hero).tracking(-0.6)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .opacity(greeted && !leaving ? 1 : 0)
                .offset(y: greeted || reduceMotion ? 0 : 12)
                .animation(reduceMotion ? NativeMotion.crossFade : lineIn.delay(0.24), value: greeted)
                .animation(reduceMotion ? NativeMotion.crossFade : lineOut, value: leaving)
            ZStack(alignment: .top) {
                motivationText(bootLine)
                    .opacity(bootLineVisible ? 1 : 0)
                    .animation(reduceMotion ? NativeMotion.crossFade : lineIn.delay(0.3), value: shown)
                    .animation(reduceMotion ? NativeMotion.crossFade : lineOut, value: greeted)
                    .animation(reduceMotion ? NativeMotion.crossFade : lineOut, value: leaving)
                    .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.exit, value: isOffline)
                if crossFades {
                    motivationText(personalLine)
                        .opacity(personalLineVisible ? 1 : 0)
                        .offset(y: greeted || reduceMotion ? 0 : 10)
                        .animation(reduceMotion ? NativeMotion.crossFade : lineIn.delay(0.54), value: greeted)
                        .animation(reduceMotion ? NativeMotion.crossFade : lineOut, value: leaving)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isGreeting ? greeting + " " + personalLine : bootLine)
        .accessibilityHidden(isOffline || !(isGreeting || shown))
        .accessibilityAddTraits(isGreeting ? .isButton : [])
        .accessibilityHint(isGreeting ? "Коснись, чтобы сразу открыть главную." : "")
        .accessibilityAction(.default) { if isGreeting { skip() } }
    }

    private func motivationText(_ line: String) -> some View {
        Text(line)
            .font(.body).foregroundStyle(Theme.inkSecondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 360)
    }

    /// Only after a few seconds of waiting, under the motivating line: the server is slow, not the app.
    private var waitingLine: some View {
        Text("Подключаюсь к серверу…")
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
            .opacity(stage == .waiting && slow && !leaving ? 1 : 0)
            .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.reveal, value: slow)
            .animation(NativeMotion.exit, value: stage == .waiting)
            .allowsHitTesting(false)
            .accessibilityHidden(stage != .waiting || !slow)
    }

    private func offlineBlock(_ offline: (detail: String, retrying: Bool)) -> some View {
        VStack(spacing: 10) {
            Text("Нет связи с сервером")
                .font(TypeScale.title2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(offline.detail)
                .font(.subheadline)
                .foregroundStyle(Theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 10) {
                Button(action: retry) {
                    HStack(spacing: 10) {
                        if offline.retrying { ProgressView().tint(Theme.ctaLabel) }
                        Text(offline.retrying ? "Подключаюсь…" : "Повторить")
                    }
                }
                .buttonStyle(PrimaryButton())
                Button("Ввести код заново", action: enterCode)
                    .buttonStyle(QuietButton())
            }
            .disabled(offline.retrying)
            .padding(.top, 14)
        }
        .frame(maxWidth: 360)
    }

    @ViewBuilder private var skipShortcut: some View {
        if isGreeting {
            Button("Открыть главную", action: skip)
                .keyboardShortcut(.cancelAction)
                .opacity(0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    /// The companion's top edge: its centre sits at 40 % of the screen height in every stage.
    private func mascotTop(_ height: CGFloat) -> CGFloat {
        max(40, (height * 0.40 - NativeLaunch.mascotSize.height / 2).rounded())
    }

    /// The companion arrives: a long, soft deceleration.
    private var arrive: Animation { .timingCurve(0.16, 1, 0.3, 1, duration: 0.7) }
    private var lineIn: Animation { .timingCurve(0.16, 1, 0.3, 1, duration: 0.62) }
    /// Text leaves first and faster (exits are shorter than entrances).
    private var lineOut: Animation { .timingCurve(0.4, 0, 1, 1, duration: min(0.36, leaveSeconds)) }
    /// The layer and the companion fade together, softly and in place: no jump, nothing left behind.
    private var fade: Animation { .timingCurve(0.42, 0, 0.2, 1, duration: leaveSeconds) }

    /// A launch or offline layer: the companion appears a moment after the first frame.
    private func revealCompanion() async {
        guard !shown, !isGreeting else { return }
        do { try await Task.sleep(for: .milliseconds(NativeLaunch.mascotDelayMilliseconds)) } catch { return }
        shown = true
    }

    /// Calm → happy perk-up → a hop of joy → landing, next to the same companion that waited at launch.
    private func greet() async {
        guard isGreeting, scenePhase == .active, !played else { return }
        played = true
        shown = true
        greeted = true
        greetingMood = .happy
        pose = .neutral
        guard !reduceMotion else { return }
        do {
            try await Task.sleep(for: .milliseconds(780))
            pose = .lifted
            greetingMood = .joy
            try await Task.sleep(for: .milliseconds(760))
            pose = .landing
            try await Task.sleep(for: .milliseconds(640))
            pose = .neutral
            greetingMood = .happy
        } catch { return }
    }

    private func watchSlowServer() async {
        guard stage == .waiting else { slow = false; return }
        do { try await Task.sleep(for: .seconds(NativeLaunch.slowHintSeconds)) } catch { return }
        slow = true
    }
}
