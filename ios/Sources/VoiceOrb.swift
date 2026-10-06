import SwiftUI
import UIKit

enum VoiceOrbMode { case ready, listening, speaking, thinking }

/// Legacy moods (calm…supportive) keep working; the rest are the shared spec emotions.
/// attentive → listening face, friendly → happy, pleased → proud, supportive → sad.
enum VoiceOrbMood: CaseIterable {
    case calm, attentive, curious, friendly, pleased, supportive
    case happy, joy, laugh, excited, love, proud, surprised, thinking, listening, speaking
    case sad, sleepy, dizzy, shy, annoyed, determined, wink, squeeze
}

/// A launch-only body pose. Its floor remains anchored, and ordinary conversation
/// callers retain the neutral pose. Applied as spring targets of the jelly body.
struct VoiceOrbGreetingPose: Equatable {
    let scaleX: Double
    let scaleY: Double
    let lift: Double
    let tilt: Double
    static let neutral = VoiceOrbGreetingPose(scaleX: 1, scaleY: 1, lift: 0, tilt: 0)
    static let arriving = VoiceOrbGreetingPose(scaleX: 1.055, scaleY: 0.945, lift: 0.045, tilt: -4)
    static let lifted = VoiceOrbGreetingPose(scaleX: 0.985, scaleY: 1.035, lift: -0.052, tilt: 3)
    static let landing = VoiceOrbGreetingPose(scaleX: 1.04, scaleY: 0.965, lift: 0.012, tilt: -1.2)
}

/// Reads the meter once per animation frame instead of observing it, so audio updates
/// never re-render the transcript, the composer or even this wrapper.
/// While `mode == .speaking` the meter (TTS playback level) drives lip-sync;
/// while `mode == .listening` it drives the microphone pulse.
struct MeasuredVoiceOrb: View {
    let meter: VoiceMeter
    let mode: VoiceOrbMode
    var mood: VoiceOrbMood? = nil
    var statusDescription: String? = nil
    var speechLevel: Double = 0
    var celebrate: Int = 0
    var interactive: Bool = true

    init(meter: VoiceMeter, mode: VoiceOrbMode, mood: VoiceOrbMood? = nil, statusDescription: String? = nil,
         speechLevel: Double = 0, celebrate: Int = 0, interactive: Bool = true) {
        self.meter = meter
        self.mode = mode
        self.mood = mood
        self.statusDescription = statusDescription
        self.speechLevel = speechLevel
        self.celebrate = celebrate
        self.interactive = interactive
    }

    var body: some View {
        MascotView(mode: mode, level: 0, mood: mood, statusDescription: statusDescription, greetingPose: .neutral,
                   speechLevel: speechLevel, celebrate: celebrate, interactive: interactive, meter: meter)
    }
}

/// Compatibility entry point used across the app. `level` is the meter value (0–1):
/// microphone level while listening, playback level while speaking.
struct VoiceOrb: View {
    let mode: VoiceOrbMode
    let level: Double
    var mood: VoiceOrbMood? = nil
    var statusDescription: String? = nil
    var greetingPose: VoiceOrbGreetingPose = .neutral
    var speechLevel: Double = 0
    var celebrate: Int = 0
    var interactive: Bool = true

    init(mode: VoiceOrbMode, level: Double, mood: VoiceOrbMood? = nil, statusDescription: String? = nil,
         greetingPose: VoiceOrbGreetingPose = .neutral, speechLevel: Double = 0, celebrate: Int = 0,
         interactive: Bool = true) {
        self.mode = mode
        self.level = level
        self.mood = mood
        self.statusDescription = statusDescription
        self.greetingPose = greetingPose
        self.speechLevel = speechLevel
        self.celebrate = celebrate
        self.interactive = interactive
    }

    var body: some View {
        MascotView(mode: mode, level: level, mood: mood, statusDescription: statusDescription, greetingPose: greetingPose,
                   speechLevel: speechLevel, celebrate: celebrate, interactive: interactive, meter: nil)
    }
}

/// The jelly mascot: Metal glass body on a 32-node ring, morphing face, small mouth with
/// lip-sync, gestures, idle life and haptics (planning/v05/MASCOT-SPEC.md).
/// - `speechLevel`: optional 0–1 voice level for lip-sync (already mapped). When 0 and
///   `mode == .speaking`, the playback meter (`meter` or `level`) is used instead.
/// - `celebrate`: increment to play `joy` with a success haptic (overlay `MascotConfetti`
///   with the same counter for confetti).
/// - `interactive`: false disables touch (VoiceOver activation still reacts).
struct MascotView: View {
    let mode: VoiceOrbMode
    let level: Double
    let mood: VoiceOrbMood?
    let statusDescription: String?
    let greetingPose: VoiceOrbGreetingPose
    let speechLevel: Double
    let celebrate: Int
    let interactive: Bool
    let meter: VoiceMeter?

    @State private var engine = MascotEngineBox()
    @State private var isVisible = false
    @State private var onScreen = true
    @State private var pressTick = 0
    @State private var releaseTick = 0
    @State private var successTick = 0
    @State private var staticReaction: MascotEmotion? = nil
    @State private var staticReactionTick = 0
    @State private var staticCycle = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme

    init(mode: VoiceOrbMode, level: Double = 0, mood: VoiceOrbMood? = nil, statusDescription: String? = nil,
         greetingPose: VoiceOrbGreetingPose = .neutral, speechLevel: Double = 0, celebrate: Int = 0,
         interactive: Bool = true, meter: VoiceMeter? = nil) {
        self.mode = mode
        self.level = level
        self.mood = mood
        self.statusDescription = statusDescription
        self.greetingPose = greetingPose
        self.speechLevel = speechLevel
        self.celebrate = celebrate
        self.interactive = interactive
        self.meter = meter
    }

    var body: some View {
        GeometryReader { proxy in
            stage(size: proxy.size)
        }
        .modifier(MascotScrollVisibility(onScreen: $onScreen))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Твой собеседник")
        .accessibilityValue(accessibilityStatus)
        .accessibilityHint(accessibilityHintText)
        .accessibilityAddTraits(accessibilityTraits)
        .accessibilityAction(.default) { activateFromAccessibility() }
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.8), trigger: pressTick)
        .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: releaseTick)
        .sensoryFeedback(.success, trigger: successTick)
        .sensoryFeedback(trigger: celebrate) { oldValue, newValue in
            newValue > oldValue ? .success : nil
        }
        .onAppear { appear() }
        .onDisappear { disappear() }
        .task(id: staticReactionTick) {
            guard staticReactionTick > 0 else { return }
            do { try await Task.sleep(for: .milliseconds(1200)) } catch { return }
            staticReaction = nil
        }
    }

    private func stage(size: CGSize) -> some View {
        let side = max(1, min(size.width, size.height))
        let live = isLive(side: side)
        let touchable = interactive && side >= MascotMetrics.touchSide
        // Small companions (rows, cards, intros) live at 30 fps; the physics steps at a fixed 1/240 s either way.
        let interval = side < MascotMetrics.fullRateSide ? 1.0 / 30.0 : 1.0 / 60.0
        return ZStack {
            TimelineView(.animation(minimumInterval: interval, paused: !live)) { context in
                MascotRenderView(pose: renderFrame(date: context.date, side: side, live: live), side: side)
            }
            if touchable {
                MascotTouchLayer(handler: { event in handleTouch(event) })
            }
        }
        .frame(width: size.width, height: size.height)
    }

    // MARK: Frames

    private var contextEmotion: MascotEmotion {
        MascotEmotion.context(mode: mode, mood: mood)
    }

    private var isStatic: Bool {
        reduceMotion
    }

    private func isLive(side: CGFloat) -> Bool {
        !reduceMotion && isVisible && onScreen && scenePhase == .active && side >= MascotMetrics.thumbnailSide
    }

    private func renderFrame(date: Date, side: CGFloat, live: Bool) -> MascotFrame {
        if reduceMotion || side < MascotMetrics.thumbnailSide {
            return MascotPhysics.restingFrame(emotion: staticReaction ?? contextEmotion, dark: colorScheme == .dark)
        }
        let physics = engine.physics
        let frameInput = makeInput(side: side)
        if live {
            return physics.advance(to: date, input: frameInput)
        }
        return physics.snapshot(input: frameInput)
    }

    private func makeInput(side: CGFloat) -> MascotInput {
        let emotion = contextEmotion
        let measured = meter?.level ?? level
        let safeLevel = measured.isFinite ? min(1, max(0, measured)) : 0
        let lipSync = (mode == .speaking || emotion == .speaking) && emotion != .listening
        var speech = speechLevel.isFinite ? min(1, max(0, speechLevel)) : 0
        if speech <= 0 && mode == .speaking {
            speech = MascotInput.mappedSpeech(fromMeter: safeLevel)
        }
        var input = MascotInput()
        input.side = side
        input.context = emotion
        input.micLevel = mode == .listening ? safeLevel : 0
        input.speechLevel = lipSync ? speech : 0
        input.lipSync = lipSync
        input.greetingScaleX = greetingPose.scaleX
        input.greetingScaleY = greetingPose.scaleY
        input.greetingLift = greetingPose.lift
        input.greetingTilt = greetingPose.tilt
        input.dark = colorScheme == .dark
        input.celebrate = celebrate
        return input
    }

    // MARK: Interaction

    private func handleTouch(_ event: MascotTouchEvent) {
        if isStatic {
            if case .ended(_, _, let quick) = event, quick {
                reactStatically()
            }
            return
        }
        let now = Date().timeIntervalSinceReferenceDate
        let physics = engine.physics
        switch event {
        case .began(let point, let side):
            physics.touchBegan(at: point, side: side, time: now)
            armPressFeedback(physics)
        case .moved(let point, let side):
            physics.touchMoved(to: point, side: side, time: now)
        case .ended:
            switch physics.touchEnded(time: now) {
            case .quiet:
                break
            case .tap:
                if physics.takePressFeedback(force: true) { pressTick += 1 }
            case .release:
                releaseTick += 1
            case .success:
                successTick += 1
            }
        case .cancelled:
            physics.touchCancelled()
        }
    }

    /// The soft press haptic waits 70 ms so a finger that starts scrolling the page stays silent.
    private func armPressFeedback(_ physics: MascotPhysics) {
        Task { @MainActor in
            do { try await Task.sleep(for: .milliseconds(70)) } catch { return }
            if physics.takePressFeedback(force: false) { pressTick += 1 }
        }
    }

    private func activateFromAccessibility() {
        if isStatic || engine.physics.side < Double(MascotMetrics.thumbnailSide) {
            reactStatically()
        } else {
            engine.physics.accessibilityTap(time: Date().timeIntervalSinceReferenceDate)
        }
    }

    private func reactStatically() {
        let reaction = MascotEmotion.tapReaction(at: staticCycle)
        staticCycle = (staticCycle + 1) % MascotEmotion.tapCycleLength
        staticReaction = reaction.emotion
        staticReactionTick += 1
    }

    private func appear() {
        isVisible = true
        let firstMascot = !MascotLaunchMemory.greeted
        MascotLaunchMemory.greeted = true
        if firstMascot && interactive && !reduceMotion && contextEmotion == .calm {
            engine.physics.playLaunchGreeting(time: Date().timeIntervalSinceReferenceDate)
        }
    }

    private func disappear() {
        isVisible = false
        engine.physics.touchCancelled()
    }

    // MARK: Accessibility

    private var accessibilityStatus: String {
        if let statusDescription { return statusDescription }
        switch mode {
        case .ready: return "Собеседник ждёт твоего ответа"
        case .listening: return "Собеседник слушает, микрофон включён"
        case .speaking: return "Собеседник говорит"
        case .thinking: return "Собеседник готовит ответ"
        }
    }

    private var accessibilityTraits: AccessibilityTraits {
        interactive ? .isButton : []
    }

    private var accessibilityHintText: String {
        interactive ? "Коснись, чтобы поздороваться. Можно потянуть в сторону или подержать." : ""
    }
}

/// Pauses the loop while a ScrollView keeps the mascot alive off screen. iOS 17 compares the mascot's
/// frame with the screen (a stack never calls onDisappear for a row scrolled away).
private struct MascotScrollVisibility: ViewModifier {
    @Binding var onScreen: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollVisibilityChange(threshold: 0.05) { visible in
                onScreen = visible
            }
        } else {
            content.onGeometryChange(for: Bool.self) { proxy in
                let frame = proxy.frame(in: .global)
                return frame.width > 0 && frame.height > 0 && frame.intersects(UIScreen.main.bounds)
            } action: { visible in
                onScreen = visible
            }
        }
    }
}
