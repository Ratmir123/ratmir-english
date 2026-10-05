import Foundation
import CoreGraphics

// MARK: - Shared constants (identical on iPhone and PC: planning/v05/MASCOT-SPEC.md)

enum MascotTuning {
    static let nodeCount = 32
    static let fixedStep = 1.0 / 240.0
    static let maxSubsteps = 8
    static let ringStiffness = 140.0
    static let ringDamping = 7.5
    static let ringNeighbour = 900.0
    static let volumePreservation = 0.85
    static let minDisplacement = -0.32
    static let maxDisplacement = 0.26
    /// R0: base body radius in shader units (canvas half-size = 1).
    static let bodyRadius = 0.78
    static let faceStiffness = 320.0
    static let faceDamping = 36.0
    static let dentImpulse = 2.4
    static let dentSigma = 0.45
    static let pressSquash = 0.9
    static let holdForce = 22.0
    static let holdRamp = 0.35
    static let squeezeDelay = 0.6
    static let dragFollow = 0.35
    static let dragRadius = 0.22
    static let stretchForce = 14.0
    static let stretchRange = 0.5
    static let dragTilt = 0.09
    static let dragTiltLimit = 12.0
    static let tapDuration = 0.22
    static let tapSlop = 6.0
    static let tapSquash = 1.4
    static let tapHop = 0.9
    static let boingSquash = 2.0
    static let shakeStroke = 0.15
    static let sleepAfter = 60.0
    /// Envelope follower: attack 35 ms, release 110 ms, per fixed step.
    static let attackCoefficient = 1.0 - exp(-MascotTuning.fixedStep / 0.035)
    static let releaseCoefficient = 1.0 - exp(-MascotTuning.fixedStep / 0.110)
    /// Slow travelling wave that keeps the outline liquid at rest (about ±1.4 % of R0).
    static let idleWave = 4.0
}

enum MascotMetrics {
    /// Smaller mascots (thumbnails, banners) render a static pose and ignore touch.
    static let thumbnailSide: CGFloat = 96
}

/// One launch greeting hop per app launch (MASCOT-SPEC §8, Home idle).
@MainActor
enum MascotLaunchMemory {
    static var greeted = false
}

// MARK: - Value types

/// `v += (k·(target − x) − c·v)·dt; x += v·dt` (semi-implicit Euler).
struct MascotSpring {
    var value: Double
    var velocity: Double

    init(_ value: Double = 0) {
        self.value = value
        self.velocity = 0
    }

    mutating func step(toward target: Double, stiffness: Double, damping: Double, dt: Double) {
        velocity += (stiffness * (target - value) - damping * velocity) * dt
        value += velocity * dt
    }

    mutating func snap(to target: Double) {
        value = target
        velocity = 0
    }

    mutating func limit(_ lower: Double, _ upper: Double) {
        if value < lower {
            value = lower
            if velocity < 0 { velocity = 0 }
        } else if value > upper {
            value = upper
            if velocity > 0 { velocity = 0 }
        }
    }
}

/// Everything the view hands to the simulation once per rendered frame.
struct MascotInput {
    var side: CGFloat = 200
    var context: MascotEmotion = .calm
    var micLevel: Double = 0
    var speechLevel: Double = 0
    var lipSync = false
    var greetingScaleX: Double = 1
    var greetingScaleY: Double = 1
    var greetingLift: Double = 0
    var greetingTilt: Double = 0
    var dark = false
    var celebrate = 0

    /// TrainingClient meters playback as (dB + 55) / 55; the spec maps (dB + 50) / 40.
    static func mappedSpeech(fromMeter level: Double) -> Double {
        let decibels = level * 55 - 55
        return min(1, max(0, (decibels + 50) / 40))
    }
}

struct MascotEyeFrame {
    var open: Double = 1
    var smile: Double = 0
    var squint: Double = 0
    var tilt: Double = 0
    var wide: Double = 1
    var shape: MascotEyeKind = .pill
    var previousShape: MascotEyeKind = .pill
    var fade: Double = 1
}

struct MascotMouthFrame {
    var width: Double = 0.07
    var open: Double = 0
    var smile: Double = 0.35
    var round: Double = 0
    var offsetX: Double = 0
    var tongue: Double = 0
}

/// A render snapshot. Geometry is relative to the canvas side S unless noted (pt).
struct MascotFrame {
    var displacements: [Float] = []
    var time: Float = 0
    var energy: Float = 0
    var dark: Float = 0
    var tintR: Float = 0.24
    var tintG: Float = 0.86
    var tintB: Float = 0.96
    var tintAmount: Float = 0
    var gazeX: Double = 0
    var gazeY: Double = 0
    /// Body offset in pt (position spring + hop).
    var offsetX: Double = 0
    var offsetY: Double = 0
    var scaleX: Double = 1
    var scaleY: Double = 1
    /// Degrees, positive = clockwise.
    var rotation: Double = 0
    /// Squash q (positive = wider and shorter); feeds the floor shadow (MascotShadowPose).
    var squash: Double = 0
    var leftEye = MascotEyeFrame()
    var rightEye = MascotEyeFrame()
    var mouth = MascotMouthFrame()
    var blush: Double = 0
    var spiralAngle: Double = 0
    var heartScale: Double = 1
    var starScale: Double = 1
    var sleepZ: Double = 0
    var sleepPhase: Double = 0
}

enum MascotTouchFeedback {
    /// Nothing to report (scroll, cancelled).
    case quiet
    /// A quick tap: give the soft press haptic now if the hold timer did not.
    case tap
    /// End of a hold or drag: light haptic.
    case release
    /// Long press released into `joy`: success haptic.
    case success
}

enum MascotIdleAction: Equatable {
    case rest
    case glance(Double)
    case curiousTilt
    case happyFlicker
}

private enum MascotTouchMode {
    case idle, pressing, dragging, scrolling
}

private struct MascotScheduledImpulse {
    var time = 0.0
    var squash = 0.0
    var hop = 0.0
    var active = false
}

private enum MascotFaceChannel: Int {
    case openL = 0, openR, smileL, smileR, squintL, squintR, tiltL, tiltR, wideL, wideR
    case gazeX, gazeY
    case mouthW, mouthO, mouthS, mouthR, mouthDX
    case blush, tintR, tintG, tintB, tintAmount
    case sleepZ

    static let count = MascotFaceChannel.sleepZ.rawValue + 1
}

/// Keeps one simulation per view identity. SwiftUI re-creates the box when a parent
/// re-renders, but only the first box survives in @State and only it creates the engine.
final class MascotEngineBox {
    private var storage: MascotPhysics?

    var physics: MascotPhysics {
        if let existing = storage { return existing }
        let created = MascotPhysics()
        storage = created
        return created
    }
}

// MARK: - Simulation

/// Deterministic fixed-step jelly simulation: 32-node radial ring, global body springs,
/// gesture recognition, emotions, idle life and audio reactivity. Main thread only.
/// Never allocates per frame: all buffers are created once in `init`.
final class MascotPhysics {
    static let restDisplacements = [Float](repeating: 0, count: MascotTuning.nodeCount)

    // Ring
    private var ringD: [Double]
    private var ringV: [Double]
    private var ringF: [Double]
    private let ringAngle: [Double]
    private var bufferA: [Float]
    private var bufferB: [Float]
    private var writeA = true

    // Body springs and their per-frame targets
    private var posX = MascotSpring()
    private var posY = MascotSpring()
    private var squash = MascotSpring()
    private var tilt = MascotSpring()
    private var hop = MascotSpring()
    private var puffX = MascotSpring(1)
    private var puffY = MascotSpring(1)
    private var pulse = MascotSpring()
    private var posTargetX = 0.0
    private var posTargetY = 0.0
    private var squashTarget = 0.0
    private var tiltTarget = 0.0
    private var hopTarget = 0.0
    private var puffTargetX = 1.0
    private var puffTargetY = 1.0
    private var pulseTarget = 0.0

    // Face parameter springs
    private var face: [MascotSpring]
    private var faceGoal: [Double]

    // Clock
    private var lastTime = -1.0
    private var accumulator = 0.0
    private var simTime = 0.0
    /// Canvas side S in pt; 0 until the first live or snapshot frame (`prime`).
    private(set) var side = 0.0
    private var darkValue = 0.0
    private var darkReady = false

    // Emotions
    private var primed = false
    private var context: MascotEmotion = .calm
    private var shown: MascotEmotion = .calm
    private var shownSince = 0.0
    private var transient: MascotEmotion?
    private var transientUntil = 0.0
    private var queued: MascotEmotion?
    private var queuedDuration = 0.0
    private var sleeping = false
    private var lastActivity = 0.0
    private var lastCelebrate = 0
    private var launchHopPending = false
    private var shapeL: MascotEyeKind = .pill
    private var shapeR: MascotEyeKind = .pill
    private var previousL: MascotEyeKind = .pill
    private var previousR: MascotEyeKind = .pill
    private var changeL = -10.0
    private var changeR = -10.0

    // Blink and idle life
    private var nextBlink = 0.0
    private var blinkStart = -10.0
    private var secondBlinkAt = -1.0
    private var nextIdle = 0.0
    private var idle: MascotIdleAction = .rest
    private var idleUntil = 0.0

    // Behaviours
    private var laughNext = 0.0
    private var laughSign = 1.0
    private var squintUntil = -10.0
    private var scheduled: [MascotScheduledImpulse]

    // Audio
    private var envelope = 0.0
    private var bobEnvelope = 0.0
    private var mic = 0.0
    private var speech = 0.0
    private var lipSync = false

    // Touch
    private var touch: MascotTouchMode = .idle
    private var touchStartTime = 0.0
    private var touchStartX = 0.0
    private var touchStartY = 0.0
    private var touchAngle = 0.0
    private var touchTravelled = false
    private var pressFeedbackPending = false
    private var squeezing = false
    private var holdDepth = 0.0
    private var dragX = 0.0
    private var dragY = 0.0
    private var stretch = 0.0
    private var stretchAngle = 0.0
    private var shakeDirection = 0
    private var shakeExtreme = 0.0
    private var reversals: [Double]
    private var reversalIndex = 0
    private var taps: [Double]
    private var tapIndex = 0
    private var tapCycle = 0
    private var rng: UInt64

    init() {
        let count = MascotTuning.nodeCount
        ringD = [Double](repeating: 0, count: count)
        ringV = [Double](repeating: 0, count: count)
        ringF = [Double](repeating: 0, count: count)
        var angles = [Double](repeating: 0, count: count)
        for index in 0..<count {
            angles[index] = 2 * Double.pi * Double(index) / Double(count)
        }
        ringAngle = angles
        bufferA = [Float](repeating: 0, count: count)
        bufferB = [Float](repeating: 0, count: count)
        face = [MascotSpring](repeating: MascotSpring(), count: MascotFaceChannel.count)
        faceGoal = [Double](repeating: 0, count: MascotFaceChannel.count)
        scheduled = [MascotScheduledImpulse](repeating: MascotScheduledImpulse(), count: 8)
        reversals = [Double](repeating: -1_000, count: 4)
        taps = [Double](repeating: -1_000, count: 12)
        rng = UInt64.random(in: 1...UInt64.max)
        faceGoal[MascotFaceChannel.tintR.rawValue] = MascotRGB.base.r
        faceGoal[MascotFaceChannel.tintG.rawValue] = MascotRGB.base.g
        faceGoal[MascotFaceChannel.tintB.rawValue] = MascotRGB.base.b
        applyFaceGoals(MascotEmotion.calm.faceTarget)
        snapFace()
    }

    // MARK: Frame API

    /// Sets the initial context without any transition, so the first frame is already right.
    func prime(input: MascotInput) {
        side = max(1, Double(input.side))
        guard !primed else { return }
        primed = true
        context = input.context
        shown = input.context
        let goal = input.context.faceTarget
        shapeL = goal.shapeL
        shapeR = goal.shapeR
        previousL = goal.shapeL
        previousR = goal.shapeR
        applyFaceGoals(goal)
        snapFace()
        darkValue = input.dark ? 1 : 0
        darkReady = true
        lastCelebrate = input.celebrate
    }

    /// Advances to the timeline date with fixed 1/240 s steps (≤ 8 per frame, remainder dropped).
    func advance(to date: Date, input: MascotInput) -> MascotFrame {
        let now = date.timeIntervalSinceReferenceDate
        prime(input: input)
        var elapsed = 0.0
        if lastTime < 0 {
            lastActivity = now
            shownSince = now
            nextBlink = now + 1.2 + nextRandom() * 2.4
            nextIdle = now + 4 + nextRandom() * 3
            startBehaviour(shown, now: now)
        } else {
            elapsed = now - lastTime
        }
        lastTime = now
        if !(elapsed >= 0) { elapsed = 0 }
        // After a pause (hidden, inactive) continue without a phase jump.
        if elapsed > 0.25 { elapsed = 1.0 / 60.0 }
        updateDark(input.dark, elapsed: elapsed)
        absorb(input, now: now)
        if touch == .pressing && !squeezing && now - touchStartTime >= MascotTuning.squeezeDelay {
            squeezing = true
        }
        let emotion = resolveEmotion(now: now)
        if emotion != shown {
            enter(emotion, now: now)
        }
        updateBlinkAndIdle(now: now, emotion: emotion)
        planTargets(input, emotion: emotion, now: now)
        fireScheduled(now: now)
        if launchHopPending {
            launchHopPending = false
            hop.velocity -= 0.7 * side
        }
        accumulator += elapsed
        var steps = 0
        while accumulator >= MascotTuning.fixedStep && steps < MascotTuning.maxSubsteps {
            substep(MascotTuning.fixedStep)
            accumulator -= MascotTuning.fixedStep
            steps += 1
        }
        if accumulator >= MascotTuning.fixedStep {
            accumulator = 0
        }
        return makeFrame(now: now)
    }

    /// Current state without stepping (paused while hidden or inactive).
    func snapshot(input: MascotInput) -> MascotFrame {
        prime(input: input)
        let now = lastTime < 0 ? Date().timeIntervalSinceReferenceDate : lastTime
        return makeFrame(now: now)
    }

    /// Static pose for Reduce Motion and thumbnails: targets only, no simulation.
    static func restingFrame(emotion: MascotEmotion, dark: Bool) -> MascotFrame {
        let goal = emotion.faceTarget
        var frame = MascotFrame()
        frame.displacements = MascotPhysics.restDisplacements
        frame.dark = dark ? 1 : 0
        if goal.tintAmount > 0 {
            frame.tintR = Float(goal.tint.r)
            frame.tintG = Float(goal.tint.g)
            frame.tintB = Float(goal.tint.b)
            frame.tintAmount = Float(goal.tintAmount)
        }
        frame.gazeX = goal.gazeX
        frame.gazeY = goal.gazeY
        frame.leftEye = MascotEyeFrame(open: goal.openL, smile: goal.smileL, squint: goal.squint, tilt: goal.tiltL,
                                       wide: goal.wide, shape: goal.shapeL, previousShape: goal.shapeL, fade: 1)
        frame.rightEye = MascotEyeFrame(open: goal.openR, smile: goal.smileR, squint: goal.squint, tilt: goal.tiltR,
                                        wide: goal.wide, shape: goal.shapeR, previousShape: goal.shapeR, fade: 1)
        frame.mouth = MascotMouthFrame(width: goal.mouthW, open: goal.mouthO, smile: goal.mouthS,
                                       round: goal.mouthR, offsetX: goal.mouthDX, tongue: 0)
        frame.blush = goal.blush
        frame.sleepZ = emotion == .sleepy ? 1 : 0
        frame.sleepPhase = 0.35
        return frame
    }

    func playLaunchGreeting(time now: Double) {
        play(.happy, for: 0.9, now: now)
        launchHopPending = true
    }

    // MARK: Touch API (canvas coordinates, y grows down)

    func touchBegan(at point: CGPoint, side canvasSide: CGFloat, time now: Double) {
        let s = max(1, Double(canvasSide))
        side = s
        if sleeping { wake(now: now) }
        lastActivity = now
        let centreX = s / 2 + posX.value
        let centreY = s / 2 + posY.value + hop.value
        let dx = Double(point.x) - centreX
        let dy = Double(point.y) - centreY
        let rho = (dx * dx + dy * dy).squareRoot() / (MascotTuning.bodyRadius * s / 2)
        touchAngle = atan2(dy, dx)
        for index in 0..<ringV.count {
            ringV[index] -= MascotTuning.dentImpulse * gaussian(wrapAngle(ringAngle[index] - touchAngle))
        }
        if rho < 0.55 {
            squash.velocity += MascotTuning.pressSquash
        }
        squintUntil = now + 0.15
        touch = .pressing
        touchStartTime = now
        touchStartX = Double(point.x)
        touchStartY = Double(point.y)
        touchTravelled = false
        pressFeedbackPending = true
        squeezing = false
        dragX = 0
        dragY = 0
        shakeDirection = 0
        shakeExtreme = Double(point.x)
    }

    /// Soft press haptic once per touch: after a short hold or at the end of a quick tap,
    /// never for a touch that turned into page scrolling.
    func takePressFeedback(force: Bool) -> Bool {
        guard pressFeedbackPending else { return false }
        guard force || touch == .pressing || touch == .dragging else { return false }
        pressFeedbackPending = false
        return true
    }

    func touchMoved(to point: CGPoint, side canvasSide: CGFloat, time now: Double) {
        guard touch == .pressing || touch == .dragging else { return }
        let s = max(1, Double(canvasSide))
        side = s
        let x = Double(point.x)
        let y = Double(point.y)
        let dx = x - touchStartX
        let dy = y - touchStartY
        if touch == .pressing {
            guard (dx * dx + dy * dy).squareRoot() > MascotTuning.tapSlop else { return }
            touchTravelled = true
            squeezing = false
            // Only horizontal-dominant drags deform; a vertical drag is the page scrolling.
            if abs(dx) > 1.2 * abs(dy) {
                touch = .dragging
                shakeDirection = dx > 0 ? 1 : -1
                shakeExtreme = x
            } else {
                touch = .scrolling
                pressFeedbackPending = false
                return
            }
        }
        dragX = dx
        dragY = dy
        lastActivity = now
        let strokeLength = MascotTuning.shakeStroke * s
        if shakeDirection > 0 {
            if x > shakeExtreme {
                shakeExtreme = x
            } else if shakeExtreme - x > strokeLength {
                registerReversal(now: now)
                shakeDirection = -1
                shakeExtreme = x
            }
        } else if shakeDirection < 0 {
            if x < shakeExtreme {
                shakeExtreme = x
            } else if x - shakeExtreme > strokeLength {
                registerReversal(now: now)
                shakeDirection = 1
                shakeExtreme = x
            }
        }
    }

    func touchEnded(time now: Double) -> MascotTouchFeedback {
        let mode = touch
        let duration = now - touchStartTime
        let wasSqueezing = squeezing
        touch = .idle
        squeezing = false
        dragX = 0
        dragY = 0
        lastActivity = now
        switch mode {
        case .idle, .scrolling:
            return .quiet
        case .dragging:
            return .release
        case .pressing:
            if wasSqueezing {
                squash.velocity += MascotTuning.boingSquash
                play(.joy, for: 1.2, now: now)
                return .success
            }
            if !touchTravelled && duration < MascotTuning.tapDuration {
                registerTap(now: now, physical: true)
                return .tap
            }
            return .release
        }
    }

    func touchCancelled() {
        touch = .idle
        pressFeedbackPending = false
        squeezing = false
        dragX = 0
        dragY = 0
    }

    /// VoiceOver activation: the tap reaction without physical noise.
    func accessibilityTap(time now: Double) {
        if sleeping { wake(now: now) }
        registerTap(now: now, physical: false)
    }

    // MARK: Emotion state

    private func absorb(_ input: MascotInput, now: Double) {
        if input.context != context {
            context = input.context
            lastActivity = now
            if sleeping { wake(now: now) }
        }
        if input.celebrate != lastCelebrate {
            if input.celebrate > lastCelebrate {
                play(.joy, for: 1.5, now: now)
            }
            lastCelebrate = input.celebrate
        }
        mic = min(1, max(0, input.micLevel))
        speech = min(1, max(0, input.speechLevel))
        lipSync = input.lipSync
        if mic > 0.08 || (lipSync && speech > 0.05) {
            lastActivity = now
        }
        let quiet = touch == .idle && transient == nil
        if !sleeping && context == .calm && quiet && now - lastActivity > MascotTuning.sleepAfter {
            sleeping = true
        }
    }

    private func wake(now: Double) {
        sleeping = false
        lastActivity = now
        play(.surprised, for: 0.5, then: .happy, nextDuration: 0.8, now: now)
    }

    private func play(_ emotion: MascotEmotion, for duration: Double, then next: MascotEmotion? = nil,
                      nextDuration: Double = 0, now: Double) {
        transient = emotion
        transientUntil = now + duration
        queued = next
        queuedDuration = nextDuration
        sleeping = false
        lastActivity = now
    }

    private func resolveEmotion(now: Double) -> MascotEmotion {
        if squeezing { return .squeeze }
        if let active = transient {
            if now < transientUntil { return active }
            if let next = queued {
                transient = next
                transientUntil = now + queuedDuration
                queued = nil
                return next
            }
            transient = nil
        }
        return sleeping ? .sleepy : context
    }

    private func enter(_ emotion: MascotEmotion, now: Double) {
        shown = emotion
        shownSince = now
        let goal = emotion.faceTarget
        changeShapes(left: goal.shapeL, right: goal.shapeR, now: now)
        startBehaviour(emotion, now: now)
    }

    /// One-shot body behaviour when an emotion starts (MASCOT-SPEC §5, last column).
    private func startBehaviour(_ emotion: MascotEmotion, now: Double) {
        switch emotion {
        case .happy:
            squash.velocity += 0.6
        case .joy:
            schedule(at: now, hop: -0.75 * side)
            schedule(at: now + 0.15, hop: -0.75 * side)
        case .laugh:
            laughNext = now
            laughSign = 1
        case .excited:
            schedule(at: now, hop: -0.6 * side)
            schedule(at: now + 0.2, hop: -0.6 * side)
            schedule(at: now + 0.4, hop: -0.6 * side)
        case .surprised:
            hop.velocity -= 0.5 * side
        case .determined:
            // One firm nod: this kick peaks at ≈ 0.04·S down on the hop spring, then returns.
            hop.velocity += 1.05 * side
        default:
            break
        }
    }

    private func changeShapes(left: MascotEyeKind, right: MascotEyeKind, now: Double) {
        if left != shapeL {
            previousL = crossFade(since: changeL, now: now) >= 0.5 ? shapeL : previousL
            shapeL = left
            changeL = now
        }
        if right != shapeR {
            previousR = crossFade(since: changeR, now: now) >= 0.5 ? shapeR : previousR
            shapeR = right
            changeR = now
        }
    }

    private func crossFade(since start: Double, now: Double) -> Double {
        min(1, max(0, (now - start) / 0.12))
    }

    private func registerTap(now: Double, physical: Bool) {
        taps[tapIndex % taps.count] = now
        tapIndex += 1
        var withinTwo = 0
        var withinFour = 0
        for time in taps {
            let age = now - time
            if age <= 2 { withinTwo += 1 }
            if age <= 4 { withinFour += 1 }
        }
        if withinFour >= 9 {
            // Tickle overload: annoyed, then a short laugh, then back to the context.
            play(.annoyed, for: 1.2, then: .laugh, nextDuration: 0.8, now: now)
            for index in 0..<taps.count { taps[index] = -1_000 }
        } else if withinTwo >= 4 {
            play(.laugh, for: 1.4, now: now)
        } else {
            let reaction = MascotEmotion.tapReaction(at: tapCycle)
            tapCycle = (tapCycle + 1) % MascotEmotion.tapCycleLength
            play(reaction.emotion, for: reaction.duration, now: now)
        }
        if physical {
            squash.velocity += MascotTuning.tapSquash
            hop.velocity -= MascotTuning.tapHop * side
        }
    }

    private func registerReversal(now: Double) {
        reversals[reversalIndex % reversals.count] = now
        reversalIndex += 1
        var recent = 0
        for time in reversals where now - time <= 1.0 {
            recent += 1
        }
        if recent >= 3 {
            play(.dizzy, for: 1.8, now: now)
            for index in 0..<reversals.count { reversals[index] = -1_000 }
        }
    }

    private func schedule(at time: Double, squash squashImpulse: Double = 0, hop hopImpulse: Double = 0) {
        for index in 0..<scheduled.count where !scheduled[index].active {
            scheduled[index] = MascotScheduledImpulse(time: time, squash: squashImpulse, hop: hopImpulse, active: true)
            return
        }
    }

    private func fireScheduled(now: Double) {
        for index in 0..<scheduled.count where scheduled[index].active && scheduled[index].time <= now {
            squash.velocity += scheduled[index].squash
            hop.velocity += scheduled[index].hop
            scheduled[index].active = false
        }
    }

    // MARK: Blink and idle life (MASCOT-SPEC §4, §6)

    private func updateBlinkAndIdle(now: Double, emotion: MascotEmotion) {
        let pillEyes = shapeL == .pill && shapeR == .pill
        if now >= nextBlink {
            if pillEyes && !sleeping {
                blinkStart = now
                secondBlinkAt = nextRandom() < 0.2 ? now + 0.22 : -1
            }
            nextBlink = now + 3.2 + nextRandom() * 3.3
        }
        if secondBlinkAt > 0 && now >= secondBlinkAt {
            blinkStart = now
            secondBlinkAt = -1
        }
        guard emotion == .calm && touch == .idle else {
            idle = .rest
            if nextIdle < now + 4 {
                nextIdle = now + 4 + nextRandom() * 3
            }
            return
        }
        if now >= idleUntil {
            idle = .rest
        }
        guard now >= nextIdle else { return }
        let roll = nextRandom()
        if roll < 0.40 {
            blinkStart = now
            secondBlinkAt = nextRandom() < 0.35 ? now + 0.22 : -1
        } else if roll < 0.60 {
            idle = .glance(nextRandom() < 0.5 ? -0.5 : 0.5)
            idleUntil = now + 0.8
        } else if roll < 0.70 {
            hop.velocity -= 0.45 * side
        } else if roll < 0.85 {
            idle = .curiousTilt
            idleUntil = now + 1.1
        } else {
            idle = .happyFlicker
            idleUntil = now + 0.6
        }
        nextIdle = now + 4 + nextRandom() * 3
    }

    private func blinkClosure(now: Double) -> Double {
        let elapsed = now - blinkStart
        guard elapsed >= 0 && elapsed < 0.14 else { return 0 }
        return sin(Double.pi * elapsed / 0.14)
    }

    // MARK: Targets (once per rendered frame)

    private func planTargets(_ input: MascotInput, emotion: MascotEmotion, now: Double) {
        let s = side
        let t = simTime
        let age = now - shownSince
        var goal = emotion.faceTarget
        switch idle {
        case .rest:
            break
        case .glance(let direction):
            goal.gazeX = direction
        case .curiousTilt:
            goal.openR = min(goal.openR, 0.82)
            goal.tiltL -= 4
            goal.tiltR += 5
        case .happyFlicker:
            goal.smileL = max(goal.smileL, 0.4)
            goal.smileR = max(goal.smileR, 0.4)
        }
        if emotion == .listening {
            goal.openL += 0.1 * mic
            goal.openR += 0.1 * mic
        }
        if now < squintUntil {
            goal.squint = min(1, goal.squint + 0.5)
        }
        if touch == .dragging {
            let length = (dragX * dragX + dragY * dragY).squareRoot()
            if length > 0.5 {
                let reach = min(1, length / (0.25 * s))
                goal.gazeX = dragX / length * reach
                goal.gazeY = dragY / length * reach
            }
        }
        if emotion == .dizzy {
            goal.mouthS = -0.2 + 0.3 * sin(4 * Double.pi * t)
        }
        applyFaceGoals(goal)
        faceGoal[MascotFaceChannel.sleepZ.rawValue] = emotion == .sleepy ? 1 : 0

        var squashGoal = 0.012 * sin(1.45 * t)
        var tiltGoal = 0.0
        var hopGoal = 0.0
        var offsetGoalX = 0.0
        var offsetGoalY = 0.0
        var puffGoalX = 1.0
        var puffGoalY = 1.0
        switch emotion {
        case .laugh:
            tiltGoal = 5 * sin(2 * Double.pi * 5.5 * t)
            if now >= laughNext {
                squash.velocity += 0.5 * laughSign
                laughSign = -laughSign
                laughNext = now + 0.18
            }
        case .excited:
            if age < 1.0 {
                tiltGoal = 8 * sin(2 * Double.pi * 4 * age)
            }
        case .love:
            hopGoal = -0.04 * s
            let beat = 0.015 * sin(2 * Double.pi * 1.6 * t)
            puffGoalX = 1 + beat
            puffGoalY = 1 + beat
        case .proud:
            puffGoalX = 1.06
            puffGoalY = 1.06
            tiltGoal = -4
        case .surprised:
            squashGoal = -0.25
        case .curious:
            tiltGoal = 9
        case .thinking:
            tiltGoal = 4.5 * sin(0.91 * t)
        case .listening:
            puffGoalX = 1.02
            puffGoalY = 1.02
        case .sad:
            puffGoalY = 0.95
            squashGoal = 0.008 * sin(0.9 * t)
        case .sleepy:
            squashGoal = 0.02 * sin(Double.pi * t)
        case .dizzy:
            let angle = 4 * Double.pi * t
            offsetGoalX = 0.03 * s * cos(angle)
            offsetGoalY = 0.03 * s * sin(angle)
        case .shy:
            puffGoalX = 0.95
            puffGoalY = 0.95
            tiltGoal = -6
        case .annoyed:
            if age < 0.3 {
                tiltGoal = 4 * sin(2 * Double.pi * 8 * age)
            }
        case .wink:
            tiltGoal = 6
        case .squeeze:
            squashGoal = 0.22
        default:
            break
        }
        if idle == .curiousTilt {
            tiltGoal += 7
        }
        // Opening greeting pose rides on the same springs (applied as targets).
        puffGoalX *= input.greetingScaleX
        puffGoalY *= input.greetingScaleY
        hopGoal += input.greetingLift * s
        tiltGoal += input.greetingTilt
        // Syllable bob: q += 0.18·Δenvelope⁺, applied as a velocity kick of the same size.
        if lipSync {
            let rise = envelope - bobEnvelope
            if rise > 0 {
                squash.velocity += 0.18 * rise * 16
            }
        }
        bobEnvelope = envelope
        if touch == .dragging {
            var followX = dragX * MascotTuning.dragFollow
            var followY = dragY * MascotTuning.dragFollow
            let follow = (followX * followX + followY * followY).squareRoot()
            let limit = MascotTuning.dragRadius * s
            if follow > limit && follow > 0 {
                followX *= limit / follow
                followY *= limit / follow
            }
            offsetGoalX += followX
            offsetGoalY += followY
            tiltGoal = min(MascotTuning.dragTiltLimit, max(-MascotTuning.dragTiltLimit, dragX * MascotTuning.dragTilt))
            let length = (dragX * dragX + dragY * dragY).squareRoot()
            stretch = min(1, length / (MascotTuning.stretchRange * s))
            stretchAngle = atan2(dragY, dragX)
        } else {
            stretch = 0
        }
        posTargetX = offsetGoalX
        posTargetY = offsetGoalY
        squashTarget = squashGoal
        tiltTarget = tiltGoal
        hopTarget = hopGoal
        puffTargetX = puffGoalX
        puffTargetY = puffGoalY
        pulseTarget = 0.05 * mic
    }

    private func applyFaceGoals(_ goal: MascotFaceTarget) {
        setGoal(.openL, goal.openL)
        setGoal(.openR, goal.openR)
        setGoal(.smileL, goal.smileL)
        setGoal(.smileR, goal.smileR)
        setGoal(.squintL, goal.squint)
        setGoal(.squintR, goal.squint)
        setGoal(.tiltL, goal.tiltL)
        setGoal(.tiltR, goal.tiltR)
        setGoal(.wideL, goal.wide)
        setGoal(.wideR, goal.wide)
        setGoal(.gazeX, goal.gazeX)
        setGoal(.gazeY, goal.gazeY)
        setGoal(.mouthW, goal.mouthW)
        setGoal(.mouthO, goal.mouthO)
        setGoal(.mouthS, goal.mouthS)
        setGoal(.mouthR, goal.mouthR)
        setGoal(.mouthDX, goal.mouthDX)
        setGoal(.blush, goal.blush)
        if goal.tintAmount > 0 {
            // Keep the old colour while a tint fades out; jump to the new colour when none is visible.
            let invisible = face[MascotFaceChannel.tintAmount.rawValue].value < 0.01
            setGoal(.tintR, goal.tint.r)
            setGoal(.tintG, goal.tint.g)
            setGoal(.tintB, goal.tint.b)
            if invisible {
                face[MascotFaceChannel.tintR.rawValue].snap(to: goal.tint.r)
                face[MascotFaceChannel.tintG.rawValue].snap(to: goal.tint.g)
                face[MascotFaceChannel.tintB.rawValue].snap(to: goal.tint.b)
            }
        }
        setGoal(.tintAmount, goal.tintAmount)
    }

    private func setGoal(_ channel: MascotFaceChannel, _ value: Double) {
        faceGoal[channel.rawValue] = value
    }

    private func faceValue(_ channel: MascotFaceChannel) -> Double {
        face[channel.rawValue].value
    }

    private func snapFace() {
        for index in 0..<face.count {
            face[index].snap(to: faceGoal[index])
        }
    }

    private func updateDark(_ dark: Bool, elapsed: Double) {
        let target = dark ? 1.0 : 0.0
        guard darkReady else {
            darkValue = target
            darkReady = true
            return
        }
        let step = elapsed / 0.3
        if darkValue < target {
            darkValue = min(target, darkValue + step)
        } else if darkValue > target {
            darkValue = max(target, darkValue - step)
        }
    }

    // MARK: Fixed step

    private func substep(_ dt: Double) {
        simTime += dt
        let count = ringD.count
        if touch == .pressing {
            holdDepth = min(1, holdDepth + dt / MascotTuning.holdRamp)
        } else {
            holdDepth = max(0, holdDepth - dt / 0.12)
        }
        let wavePhase = simTime * 0.95
        let waveAmplitude = sleeping ? MascotTuning.idleWave * 0.5 : MascotTuning.idleWave
        for index in 0..<count {
            let angle = ringAngle[index]
            var force = waveAmplitude * sin(2 * angle - wavePhase)
            if holdDepth > 0 {
                force -= MascotTuning.holdForce * gaussian(wrapAngle(angle - touchAngle)) * holdDepth
            }
            if stretch > 0 {
                force += MascotTuning.stretchForce * cos(angle - stretchAngle) * stretch
            }
            ringF[index] = force
        }
        for index in 0..<count {
            let left = ringD[index == 0 ? count - 1 : index - 1]
            let right = ringD[index == count - 1 ? 0 : index + 1]
            let spring = -MascotTuning.ringStiffness * ringD[index] - MascotTuning.ringDamping * ringV[index]
            let coupling = MascotTuning.ringNeighbour * (left + right - 2 * ringD[index])
            ringV[index] += (spring + coupling + ringF[index]) * dt
        }
        var mean = 0.0
        for index in 0..<count {
            ringD[index] += ringV[index] * dt
            mean += ringD[index]
        }
        mean /= Double(count)
        for index in 0..<count {
            var value = ringD[index] - MascotTuning.volumePreservation * mean
            if value < MascotTuning.minDisplacement {
                value = MascotTuning.minDisplacement
                if ringV[index] < 0 { ringV[index] = 0 }
            } else if value > MascotTuning.maxDisplacement {
                value = MascotTuning.maxDisplacement
                if ringV[index] > 0 { ringV[index] = 0 }
            }
            ringD[index] = value
        }

        posX.step(toward: posTargetX, stiffness: 170, damping: 15, dt: dt)
        posY.step(toward: posTargetY, stiffness: 170, damping: 15, dt: dt)
        squash.step(toward: squashTarget, stiffness: 260, damping: 9, dt: dt)
        squash.limit(-0.35, 0.35)
        tilt.step(toward: tiltTarget, stiffness: 120, damping: 11, dt: dt)
        tilt.limit(-14, 14)
        hop.step(toward: hopTarget, stiffness: 210, damping: 13, dt: dt)
        puffX.step(toward: puffTargetX, stiffness: 170, damping: 18, dt: dt)
        puffY.step(toward: puffTargetY, stiffness: 170, damping: 18, dt: dt)
        pulse.step(toward: pulseTarget, stiffness: MascotTuning.faceStiffness, damping: MascotTuning.faceDamping, dt: dt)

        let speechTarget = lipSync ? speech : 0
        let coefficient = speechTarget > envelope ? MascotTuning.attackCoefficient : MascotTuning.releaseCoefficient
        envelope += (speechTarget - envelope) * coefficient

        for index in 0..<face.count {
            face[index].step(toward: faceGoal[index], stiffness: MascotTuning.faceStiffness,
                             damping: MascotTuning.faceDamping, dt: dt)
        }
        if lipSync {
            // Mouth opening follows the voice directly, not through the face spring.
            face[MascotFaceChannel.mouthO.rawValue].snap(to: 0.08 + 0.85 * envelope)
        }
    }

    // MARK: Output

    private func makeFrame(now: Double) -> MascotFrame {
        var frame = MascotFrame()
        frame.displacements = publishDisplacements()
        frame.time = Float(simTime.truncatingRemainder(dividingBy: 10_000))
        frame.energy = Float(min(1, max(mic, envelope)))
        frame.dark = Float(darkValue)
        frame.tintR = Float(faceValue(.tintR))
        frame.tintG = Float(faceValue(.tintG))
        frame.tintB = Float(faceValue(.tintB))
        frame.tintAmount = Float(min(0.35, max(0, faceValue(.tintAmount))))
        frame.gazeX = min(1, max(-1, faceValue(.gazeX)))
        frame.gazeY = min(1, max(-1, faceValue(.gazeY)))
        frame.offsetX = posX.value
        frame.offsetY = posY.value + hop.value
        let q = squash.value
        frame.scaleX = (1 + 0.5 * q) * puffX.value
        frame.scaleY = (1 - q) * puffY.value
        frame.rotation = tilt.value
        frame.squash = q
        let pillEyes = shapeL == .pill && shapeR == .pill
        let blinkFactor = (pillEyes && !sleeping) ? 1 - 0.92 * blinkClosure(now: now) : 1
        frame.leftEye = eyeFrame(left: true, now: now, blink: blinkFactor)
        frame.rightEye = eyeFrame(left: false, now: now, blink: blinkFactor)
        let open = min(1, max(0, faceValue(.mouthO)))
        var mouth = MascotMouthFrame()
        mouth.width = min(0.2, max(0.03, faceValue(.mouthW)))
        mouth.open = open
        mouth.smile = min(1, max(-1, faceValue(.mouthS)))
        mouth.round = min(1, max(0, faceValue(.mouthR)))
        mouth.offsetX = faceValue(.mouthDX)
        mouth.tongue = (shown == .laugh || shown == .joy) ? min(1, max(0, (open - 0.5) / 0.1)) : 0
        frame.mouth = mouth
        frame.blush = min(0.7, max(0, faceValue(.blush)))
        frame.spiralAngle = (simTime * 360).truncatingRemainder(dividingBy: 360)
        frame.heartScale = 1 + 0.08 * sin(2 * Double.pi * 1.6 * simTime)
        frame.starScale = 1 + 0.06 * sin(2 * Double.pi * 3 * simTime)
        frame.sleepZ = min(1, max(0, faceValue(.sleepZ)))
        frame.sleepPhase = (simTime / 2.4).truncatingRemainder(dividingBy: 1)
        return frame
    }

    private func eyeFrame(left: Bool, now: Double, blink: Double) -> MascotEyeFrame {
        var eye = MascotEyeFrame()
        eye.open = max(0, faceValue(left ? .openL : .openR)) * blink
        eye.smile = min(1, max(0, faceValue(left ? .smileL : .smileR)))
        eye.squint = min(1, max(0, faceValue(left ? .squintL : .squintR)))
        eye.tilt = faceValue(left ? .tiltL : .tiltR)
        eye.wide = max(0.5, faceValue(left ? .wideL : .wideR))
        eye.shape = left ? shapeL : shapeR
        eye.previousShape = left ? previousL : previousR
        eye.fade = crossFade(since: left ? changeL : changeR, now: now)
        return eye
    }

    /// Two alternating buffers: SwiftUI keeps the previous frame's array while the next is written.
    private func publishDisplacements() -> [Float] {
        let extra = pulse.value
        let lower = MascotTuning.minDisplacement
        let upper = MascotTuning.maxDisplacement
        if writeA {
            for index in 0..<bufferA.count {
                bufferA[index] = Float(min(upper, max(lower, ringD[index] + extra)))
            }
            writeA = false
            return bufferA
        }
        for index in 0..<bufferB.count {
            bufferB[index] = Float(min(upper, max(lower, ringD[index] + extra)))
        }
        writeA = true
        return bufferB
    }

    // MARK: Helpers

    private func gaussian(_ delta: Double) -> Double {
        let sigma = MascotTuning.dentSigma
        return exp(-(delta * delta) / (2 * sigma * sigma))
    }

    private func wrapAngle(_ angle: Double) -> Double {
        var wrapped = angle.truncatingRemainder(dividingBy: 2 * Double.pi)
        if wrapped > Double.pi { wrapped -= 2 * Double.pi }
        if wrapped < -Double.pi { wrapped += 2 * Double.pi }
        return wrapped
    }

    /// xorshift64: deterministic, allocation-free randomness for blinks and idle life.
    private func nextRandom() -> Double {
        rng ^= rng << 13
        rng ^= rng >> 7
        rng ^= rng << 17
        return Double(rng >> 11) / Double(UInt64(1) << 53)
    }
}
