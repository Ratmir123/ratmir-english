import SwiftUI

// MARK: - Staircase entrance (MOTION-PASS-0.5.2 §2)

/// One entrance for every screen («лесенкой»): blocks marked `.entrance(n)` rise in order the first time their
/// screen appears (Today: after the launch hand-off). Opacity + 18 pt rise, decelerating on (0.16, 1, 0.3, 1).
/// PASS 0.5.3 §5 (no freezes): a light blur 4 → 0 only on the first five blocks, gone by 60 % of the rise, and never on
/// a block holding a live companion or a 3D medal (a blur over a live layer is redrawn every frame).
/// Taps never wait for it. Reduce Motion: a short cross-fade without movement.
enum NativeEntrance {
    static let duration = 0.82
    static let step = 0.075
    static let maxSteps = 9
    static let distance: CGFloat = 18
    static let blur: CGFloat = 4
    /// Blocks 0…4 may blur; later blocks travel and fade only.
    static let blurredSteps = 5
    /// The blur resolves within this share of `duration`.
    static let blurShare = 0.6
    static func delay(_ index: Int) -> Double {
        Double(min(max(index, 0), maxSteps)) * step
    }
    static func animation(_ index: Int) -> Animation {
        .timingCurve(0.16, 1, 0.3, 1, duration: duration).delay(delay(index))
    }
    static func blurAnimation(_ index: Int) -> Animation {
        .timingCurve(0.16, 1, 0.3, 1, duration: duration * blurShare).delay(delay(index))
    }
    /// The hidden state's blur of block `index`: 0 for live content and for blocks past the first five.
    static func hiddenBlur(index: Int, holdsLiveContent: Bool) -> CGFloat {
        holdsLiveContent || index >= blurredSteps ? 0 : blur
    }
    /// Reduce Motion: the shared gentle cross-fade, no travel or blur.
    static let reduced = NativeMotion.crossFade
}

private struct EntranceVisibleKey: EnvironmentKey { static let defaultValue = true }

/// PASS 0.5.3 §5: true while the launch layer (or the placement test) covers the shell. Companions, rank medals and the
/// ambient backdrop underneath hold still, so only the launch companion animates; they wake when the layer leaves.
private struct ShellCoveredKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// False until the owning screen's first appearance; blocks outside any stage are always visible.
    var entranceVisible: Bool {
        get { self[EntranceVisibleKey.self] }
        set { self[EntranceVisibleKey.self] = newValue }
    }

    var shellCovered: Bool {
        get { self[ShellCoveredKey.self] }
        set { self[ShellCoveredKey.self] = newValue }
    }
}

/// Raised by live companions and 3D medals; the entrance block that holds one never blurs.
struct EntranceLiveContentKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = value || nextValue()
    }
}

/// A block of a screen; `index` is its place on the staircase (top to bottom).
struct EntranceStep: ViewModifier {
    let index: Int
    @Environment(\.entranceVisible) private var visible
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var holdsLiveContent = false
    func body(content: Content) -> some View {
        content
            .blur(radius: visible || reduceMotion ? 0 : NativeEntrance.hiddenBlur(index: index, holdsLiveContent: holdsLiveContent))
            .animation(reduceMotion ? NativeEntrance.reduced : NativeEntrance.blurAnimation(index), value: visible)
            .opacity(visible ? 1 : 0)
            .offset(y: visible || reduceMotion ? 0 : NativeEntrance.distance)
            .animation(reduceMotion ? NativeEntrance.reduced : NativeEntrance.animation(index), value: visible)
            .onPreferenceChange(EntranceLiveContentKey.self) { [binding = $holdsLiveContent] live in
                if binding.wrappedValue != live { binding.wrappedValue = live }
            }
    }
}

/// Owns the entrance of one screen. `ready` lets Today wait for the launch greeting to hand off; `animated: false`
/// shows the blocks at once (the learner skipped the greeting: Home must be usable immediately).
/// The first frame is committed hidden, then the staircase runs; later appearances (tab switches) keep it shown.
struct EntranceStage: ViewModifier {
    var ready: Bool = true
    var animated: Bool = true
    @State private var revealed = false
    func body(content: Content) -> some View {
        content
            .environment(\.entranceVisible, revealed)
            .task(id: ready) {
                guard ready, !revealed else { return }
                guard animated else {
                    var transaction = Transaction()
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { revealed = true }
                    return
                }
                // One frame hidden first, otherwise SwiftUI coalesces both states and nothing moves.
                try? await Task.sleep(for: .milliseconds(30))
                revealed = true
            }
    }
}

/// The light cascade for rows and for content that arrives later (a segment switch, a list after a refresh):
/// opacity + 10 pt rise + blur 4 → 0 on `NativeMotion.reveal`, 70 ms apart, at most six steps (web `.reveal`).
/// Reduce Motion: shown at once.
struct RowReveal: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content.modifier(RevealEffect(progress: shown || reduceMotion ? 1 : 0))
            .onAppear {
                guard !shown else { return }
                if reduceMotion {
                    shown = true
                } else {
                    let delay = Double(min(max(index, 0), 6)) * NativeMotion.staggerStep
                    withAnimation(NativeMotion.reveal.delay(delay)) { shown = true }
                }
            }
    }
}

/// A List row's card background that fades in step with its staircase block (rows inside a List cannot travel
/// together with their cell background, so the card only fades while its content rises).
struct EntranceFill: View {
    let index: Int
    var color: Color = Theme.solid
    @Environment(\.entranceVisible) private var visible
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        color
            .opacity(visible ? 1 : 0)
            .animation(reduceMotion ? NativeEntrance.reduced : NativeEntrance.animation(index), value: visible)
    }
}

extension View {
    /// Place on the screen's staircase (0 = first). Use on top-level blocks only, not on every row.
    func entrance(_ index: Int) -> some View { modifier(EntranceStep(index: index)) }
    /// Put on the root of a tab screen (inside its NavigationStack/ScrollView content).
    func entranceStage(ready: Bool = true, animated: Bool = true) -> some View {
        modifier(EntranceStage(ready: ready, animated: animated))
    }
    /// Light reveal cascade for rows and late content (capped at six steps).
    func rowReveal(_ index: Int = 0) -> some View { modifier(RowReveal(index: index)) }
    /// Marks a live companion or a 3D medal: the staircase block around it rises and fades without a blur.
    func entranceLiveContent() -> some View { preference(key: EntranceLiveContentKey.self, value: true) }
}

// MARK: - Screen mascot (MOTION-PASS-0.5.2 §3)

/// The live jelly companion for screen intros, empty states and cards. Every size animates (idle life, blinking,
/// touch); the mood says what this screen is about. Decorative for VoiceOver: the adjacent text carries meaning.
struct ScreenMascot: View {
    let mood: VoiceOrbMood
    var size: CGFloat = 72
    var mode: VoiceOrbMode = .ready
    var interactive = true
    var body: some View {
        VoiceOrb(mode: mode, level: 0, mood: mood, interactive: interactive)
            .frame(width: size, height: size * 1.045)
            .accessibilityHidden(true)
    }
}

/// One line under a tab's large title with the companion on the right: what this screen is for, said by him.
/// Mood and line follow the screen's state (MOTION-PASS-0.5.2 §3 table). `showsCompanion: false` while the
/// screen's empty state holds the companion instead: one companion per screen.
struct ScreenIntro: View {
    let text: String
    let mood: VoiceOrbMood
    var size: CGFloat = 76
    var showsCompanion = true
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // Large text keeps the full width; the companion sits above the line.
                VStack(alignment: .leading, spacing: 10) {
                    companion(size: min(size, 64))
                    line
                }
            } else {
                HStack(alignment: .center, spacing: 14) {
                    line
                    companion(size: size)
                }
            }
        }
        .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: showsCompanion)
        .accessibilityElement(children: .combine)
    }

    private var line: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Theme.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func companion(size: CGFloat) -> some View {
        if showsCompanion {
            ScreenMascot(mood: mood, size: size)
                .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.opacity.combined(with: AnyTransition.scale(scale: 0.86)))
        }
    }
}
