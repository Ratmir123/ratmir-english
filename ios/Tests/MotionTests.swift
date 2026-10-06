import XCTest
import UIKit
@testable import RatmirEnglish

/// PASS 0.5.3 motion on the iPhone: the mascot rolls instead of leaning (§4), the light entrance and the soft shadows
/// (§5), the launch motivation (§6) and the slow medal turns (§8). The vectors mirror tests/mascot-roll.test.ts,
/// tests/medal-turns.test.ts and tests/startup-welcome.test.ts on the PC.
final class MotionTests: XCTestCase {
    // MARK: Helpers

    private let origin = 800_000_000.0
    private let frame = 1.0 / 60.0

    private func input(_ emotion: MascotEmotion) -> MascotInput {
        var value = MascotInput()
        value.side = 240
        value.context = emotion
        return value
    }

    /// Advances the mascot at 60 fps for `seconds` from `time`; returns the new time.
    @discardableResult
    private func run(_ physics: MascotPhysics, from time: Double, seconds: Double, context: MascotEmotion,
                     each: (MascotFrame) -> Void = { _ in }) -> Double {
        let value = input(context)
        var now = time
        for _ in 0..<Int((seconds / frame).rounded()) {
            now += frame
            each(physics.advance(to: Date(timeIntervalSinceReferenceDate: now), input: value))
        }
        return now
    }

    private struct MedalFrame {
        let time: Double
        let angle: Double
        let velocity: Double
        let glint: Bool
    }

    private struct MedalRun {
        let frames: [MedalFrame]
        let rest: Double
        let angle: Double
        let face: Double
        let past: Double
        let peak: Double
        var glints: [MedalFrame] { frames.filter { $0.glint } }
    }

    /// Plays a medal move at 60 fps to rest, like `play` in tests/medal-turns.test.ts.
    private func play(_ move: MedalMove, from start: Double) -> MedalRun {
        let face = MedalTurns.restFace(move, angle: start)
        let direction: Double = face - start < 0 ? -1 : 1
        var frames: [MedalFrame] = []
        var current: MedalMove? = move
        var angle = start
        var time = 0.0
        while let active = current, time < 10 {
            let step = MedalTurns.step(active, angle: angle, dt: frame)
            time += frame
            angle = step.angle
            current = step.next
            frames.append(MedalFrame(time: time, angle: angle, velocity: step.velocity, glint: step.glint))
        }
        let past = max(0, frames.map { ($0.angle - face) * direction }.max() ?? 0)
        let peak = frames.map { abs($0.velocity) }.max() ?? 0
        return MedalRun(frames: frames, rest: time, angle: angle, face: face, past: past, peak: peak)
    }

    private func monotonic(_ frames: [MedalFrame], _ direction: Double) -> Bool {
        guard frames.count > 1 else { return true }
        for index in 1..<frames.count where (frames[index].angle - frames[index - 1].angle) * direction < -1e-9 {
            return false
        }
        return true
    }

    private func calendar(_ zone: String) throws -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: zone))
        return calendar
    }

    private func date(_ stamp: String) throws -> Date {
        try XCTUnwrap(NativeDate.parse(stamp))
    }

    private func state(_ extra: [String: Any]) throws -> TrainingState {
        var value: [String: Any] = ["profile": ["name": "Alex", "dailyMinutes": 15], "sessions": [], "skills": [], "xp": 0, "completed": 0]
        for (key, item) in extra { value[key] = item }
        return try JSONDecoder().decode(TrainingState.self, from: JSONSerialization.data(withJSONObject: value))
    }

    // MARK: Mascot roll (§4)

    func testEveryEmotionRollsAboutUprightAndStartsUpright() {
        for emotion in MascotEmotion.allCases where emotion != .calm {
            let amplitude = emotion.roll?.amplitude ?? 0
            // Fast centred jitters the tilt spring mostly filters out: the giggle (always) and the first-second shakes.
            let jitter = emotion == .laugh ? 2.5 : 0
            let shake: Double = emotion == .excited ? 8 : emotion == .laugh ? 5 : emotion == .annoyed ? 4 : 0
            for seed in UInt64(11)...UInt64(14) {
                let physics = MascotPhysics(seed: seed)
                var first: Double?
                var entry = 0.0
                let time = run(physics, from: origin, seconds: 1.2, context: emotion) { pose in
                    if first == nil { first = pose.rotation }
                    entry = max(entry, abs(pose.rotation))
                }
                XCTAssertEqual(first ?? 1, 0, accuracy: 1e-9, "\(emotion) starts upright")
                XCTAssertLessThanOrEqual(entry, amplitude * 1.05 + shake + 0.1, "\(emotion) entry")
                let window = emotion.roll.map { 3 * $0.period } ?? 3
                var sum = 0.0
                var count = 0.0
                var peak = 0.0
                run(physics, from: time, seconds: window, context: emotion) { pose in
                    sum += pose.rotation
                    count += 1
                    peak = max(peak, abs(pose.rotation))
                }
                XCTAssertLessThan(abs(sum / count), 0.15, "\(emotion) (seed \(seed)) rolls about upright")
                guard emotion != .excited else { continue }
                XCTAssertLessThanOrEqual(peak, amplitude * 1.05 + jitter + 0.1, "\(emotion) (seed \(seed)) stays gentle")
                if emotion.roll != nil {
                    XCTAssertGreaterThanOrEqual(peak, amplitude * 0.9, "\(emotion) (seed \(seed)) actually rolls")
                }
            }
        }
        // The shared table (lib/mascot/emotions.ts EMOTION_ROLLS).
        XCTAssertEqual(MascotEmotion.curious.roll, MascotRoll(amplitude: 6, period: 4.2))
        XCTAssertEqual(MascotEmotion.wink.roll, MascotRoll(amplitude: 4.5, period: 3.8))
        XCTAssertEqual(MascotEmotion.shy.roll, MascotRoll(amplitude: 4, period: 4.6))
        XCTAssertEqual(MascotEmotion.proud.roll, MascotRoll(amplitude: 3, period: 5.2))
        XCTAssertEqual(MascotEmotion.thinking.roll, MascotRoll(amplitude: 4.5, period: 6.9))
        XCTAssertEqual(MascotEmotion.happy.roll, MascotRoll(amplitude: 2.5, period: 3.4))
        XCTAssertEqual(MascotEmotion.joy.roll, MascotRoll(amplitude: 2.5, period: 3.4))
        XCTAssertNil(MascotEmotion.calm.roll)
        XCTAssertNil(MascotEmotion.excited.roll)
    }

    func testRollSidesAreRandomAndRollingTapReactionsAlternate() {
        var sides = Set<Double>()
        for seed in UInt64(1)...UInt64(12) {
            let physics = MascotPhysics(seed: seed)
            var side = 0.0
            run(physics, from: origin, seconds: 1, context: .curious) { pose in
                if side == 0 && abs(pose.rotation) > 0.5 { side = pose.rotation > 0 ? 1 : -1 }
            }
            sides.insert(side)
        }
        XCTAssertEqual(sides, [-1, 1], "both directions occur, none is preferred")

        let tapper = MascotPhysics(seed: 5)
        var time = run(tapper, from: origin, seconds: frame, context: .calm)
        var rolled: [(emotion: MascotEmotion, sign: Double)] = []
        for _ in 0..<(2 * MascotEmotion.tapCycleLength) {
            tapper.accessibilityTap(time: time)
            time = run(tapper, from: time, seconds: frame, context: .calm)
            let emotion = tapper.emotion
            var rotation = 0.0
            time = run(tapper, from: time, seconds: 0.7, context: .calm) { pose in rotation = pose.rotation }
            if emotion.roll != nil { rolled.append((emotion, rotation > 0 ? 1 : -1)) }
            time = run(tapper, from: time, seconds: 1.1, context: .calm)
        }
        XCTAssertEqual(rolled.map { $0.emotion }, [.wink, .happy, .curious, .wink, .happy, .curious])
        for index in rolled.indices.dropFirst() {
            XCTAssertEqual(rolled[index].sign, -rolled[index - 1].sign, "tap reaction \(index) rolls the other way")
        }
    }

    func testExcitedShakesForTheFirstSecondOnly() {
        let physics = MascotPhysics(seed: 4)
        var early = 0.0
        var late = 0.0
        var time = run(physics, from: origin, seconds: 1, context: .excited) { early = max(early, abs($0.rotation)) }
        time = run(physics, from: time, seconds: 0.7, context: .excited)
        run(physics, from: time, seconds: 4, context: .excited) { late = max(late, abs($0.rotation)) }
        XCTAssertGreaterThan(early, 2, "shakes at first")
        XCTAssertLessThan(late, 0.2, "then stands upright")
        XCTAssertEqual(physics.emotion, .excited, "still excited, just not shaking")
    }

    func testCalmRollEpisodeIsOneSmoothSymmetricCycle() {
        for sign in [1.0, -1.0] {
            let physics = MascotPhysics(seed: 21)
            physics.startIdleRoll(sign: sign, time: origin)
            var high = -Double.infinity
            var low = Double.infinity
            var highAt = 0.0
            var lowAt = 0.0
            var sum = 0.0
            var count = 0.0
            var last = 0.0
            var elapsed = 0.0
            run(physics, from: origin, seconds: MascotRollTuning.idleDuration + 0.6, context: .calm) { pose in
                elapsed += self.frame
                if pose.rotation > high { high = pose.rotation; highAt = elapsed }
                if pose.rotation < low { low = pose.rotation; lowAt = elapsed }
                sum += pose.rotation
                count += 1
                last = pose.rotation
            }
            XCTAssertTrue(high > 4.5 && high < 5.6 && low < -4.5 && low > -5.6, "±5° (\(low)…\(high))")
            XCTAssertTrue(sign > 0 ? highAt < lowAt : lowAt < highAt, "the first lobe goes the episode's way")
            XCTAssertLessThan(abs(sum / count), 0.15, "centred")
            XCTAssertLessThan(abs(last), 0.3, "upright again")
        }
        // The pure episode: 0 → +5° → −5° → 0 over 2.6 s, nothing outside it.
        XCTAssertEqual(MascotRollTuning.idleRoll(elapsed: 0.65, sign: 1), 5, accuracy: 1e-9)
        XCTAssertEqual(MascotRollTuning.idleRoll(elapsed: 1.95, sign: 1), -5, accuracy: 1e-9)
        XCTAssertEqual(MascotRollTuning.idleRoll(elapsed: 0.65, sign: -1), -5, accuracy: 1e-9)
        XCTAssertEqual(MascotRollTuning.idleRoll(elapsed: 2.6, sign: 1), 0)
        XCTAssertEqual(MascotRollTuning.idleRoll(elapsed: -0.1, sign: 1), 0)
        var integral = 0.0
        for step in 0..<2_600 { integral += MascotRollTuning.idleRoll(elapsed: (Double(step) + 0.5) / 1_000, sign: 1) / 1_000 }
        XCTAssertEqual(integral, 0, accuracy: 1e-6, "as much to one side as to the other")
        // Only calm shows it.
        let busy = MascotPhysics(seed: 22)
        busy.startIdleRoll(sign: 1, time: origin)
        var peak = 0.0
        run(busy, from: origin, seconds: MascotRollTuning.idleDuration, context: .listening) { peak = max(peak, abs($0.rotation)) }
        XCTAssertLessThan(peak, 0.05, "no idle roll outside calm")
    }

    func testStaticPosesAreUprightAndTheShadowFollowsTheRoll() {
        for emotion in MascotEmotion.allCases {
            for dark in [false, true] {
                let pose = MascotPhysics.restingFrame(emotion: emotion, dark: dark)
                XCTAssertEqual(pose.rotation, 0, "\(emotion) rests upright")
                XCTAssertEqual(MascotShadowPose(frame: pose, side: 120).contact.x, 0, accuracy: 1e-12)
            }
        }
        let side = 240.0
        XCTAssertEqual(MascotRollTuning.pivotY, 0.86, accuracy: 1e-12)
        XCTAssertLessThan(MascotRollTuning.pivotY, MascotShadowTuning.floorY, "the pivot sits just above the rest bottom")
        XCTAssertEqual(MascotRollTuning.offset(rotation: 6, side: side), 0.35 * 0.78 * side * 6 * Double.pi / 180, accuracy: 1e-9)
        XCTAssertEqual(MascotRollTuning.offset(rotation: -6, side: side), -MascotRollTuning.offset(rotation: 6, side: side), accuracy: 1e-12)
        XCTAssertEqual(MascotRollTuning.offset(rotation: 0, side: side), 0)
        XCTAssertEqual(MascotRollTuning.offset(rotation: .nan, side: side), 0, "robust to bad input")
        for rotation in [3.0, 6.0, -4.5] {
            var pose = MascotFrame()
            pose.rotation = rotation
            let shade = MascotShadowPose(frame: pose, side: CGFloat(side))
            let lean = sin(rotation * Double.pi / 180)
            let shift = MascotRollTuning.offset(rotation: rotation, side: side)
            XCTAssertEqual(shade.contact.x, shift + MascotShadowTuning.contact.lean * side * lean, accuracy: 1e-9, "contact follows Δx")
            XCTAssertEqual(shade.ambient.x, shift + MascotShadowTuning.ambient.lean * side * lean, accuracy: 1e-9, "ambient follows Δx")
            // Rolling about the pivot keeps the base on the floor (the bottom is only 0.03·S below the pivot).
            let pivot = (MascotRollTuning.pivotY - 0.5) * side
            let bottom = MascotTuning.bodyRadius * side / 2
            XCTAssertLessThan(abs(pivot + (bottom - pivot) * cos(rotation * Double.pi / 180) - bottom), 0.002 * side)
        }
    }

    func testSoftShadowsKeepTheirInkWithoutABlurPass() {
        let sharp = MascotSoftEllipse(width: 100, height: 20, blur: 0)
        XCTAssertEqual(sharp, MascotSoftEllipse(width: 100, height: 20, blur: -3), "no blur, no change")
        XCTAssertEqual(sharp.width, 100, accuracy: 1e-12)
        XCTAssertEqual(sharp.height, 20, accuracy: 1e-12)
        XCTAssertEqual(sharp.alpha, 1, accuracy: 1e-12)
        let soft = MascotSoftEllipse(width: 100, height: 20, blur: 4)
        XCTAssertGreaterThan(soft.width, 100)
        XCTAssertGreaterThan(soft.height, 20)
        XCTAssertLessThan(soft.alpha, 1)
        XCTAssertEqual(soft.width * soft.height * soft.alpha, 100 * 20, accuracy: 1e-9, "the same ink, spread wider")
        XCTAssertGreaterThan(soft.height / 20, soft.width / 100, "a thin shadow thickens more than it widens")
        XCTAssertEqual(MascotShadowFill.cached(dark: 0).poolAlpha, 0, "no light pool on light pages")
        XCTAssertEqual(MascotShadowFill.cached(dark: 1).poolAlpha, MascotShadowTuning.dark.pool, accuracy: 1e-12)
        XCTAssertEqual(MascotShadowFill.cached(dark: 0.5).poolAlpha, MascotShadowTuning.dark.pool / 2, accuracy: 1e-12)
        XCTAssertEqual(MascotTuning.maxSubsteps, 12, "a late 30 fps frame never drops time")
    }

    // MARK: Entrance (§5)

    func testEntranceBlurIsLightEarlyAndNeverOnLiveContent() {
        XCTAssertEqual(NativeEntrance.blur, 4)
        XCTAssertEqual(NativeEntrance.blurredSteps, 5)
        XCTAssertEqual(NativeEntrance.blurShare, 0.6, accuracy: 1e-12)
        for index in 0..<NativeEntrance.blurredSteps {
            XCTAssertEqual(NativeEntrance.hiddenBlur(index: index, holdsLiveContent: false), 4)
            XCTAssertEqual(NativeEntrance.hiddenBlur(index: index, holdsLiveContent: true), 0, "a companion or a medal never blurs")
        }
        for index in NativeEntrance.blurredSteps..<12 {
            XCTAssertEqual(NativeEntrance.hiddenBlur(index: index, holdsLiveContent: false), 0, "later blocks rise without blur")
        }
        XCTAssertEqual(NativeEntrance.delay(3), 3 * NativeEntrance.step, accuracy: 1e-12)
        XCTAssertEqual(NativeEntrance.delay(40), Double(NativeEntrance.maxSteps) * NativeEntrance.step, accuracy: 1e-12)
    }

    // MARK: Medals (§8, components/ui/medal-3d.ts)

    func testMedalTuningMirrorsTheWeb() {
        XCTAssertEqual(MedalTuning.solidMin, 48)
        XCTAssertEqual(MedalTuning.depth, 0.09, accuracy: 1e-12)
        XCTAssertEqual(MedalTuning.perspective, 4)
        XCTAssertEqual(MedalTuning.tiltYaw, 16)
        XCTAssertEqual(MedalTuning.tiltPitch, 12)
        XCTAssertEqual(MedalTuning.dragDegrees, 200)
        XCTAssertEqual(MedalTuning.tapTurn, 360)
        XCTAssertEqual(MedalTuning.tapSeconds, 2.4)
        XCTAssertTrue(MedalTuning.tapSettle > 0 && MedalTuning.tapSettle <= 1.5)
        XCTAssertEqual(MedalTuning.tapGlint, 0.82)
        XCTAssertEqual(MedalTuning.entranceTurn, 720)
        XCTAssertEqual(MedalTuning.entranceSeconds, 3.6)
        XCTAssertEqual(MedalTuning.entranceGlint, 0.6)
        XCTAssertEqual(MedalTuning.maxSpeed, 720)
        XCTAssertEqual(MedalTuning.throwMinSpeed, 120)
        XCTAssertEqual(MedalTuning.throwMinSeconds, 0.9)
        XCTAssertEqual(MedalTuning.throwSeconds, 2.4)
        XCTAssertEqual(MedalTuning.throwMaxSeconds, 4.5)
        XCTAssertEqual(MedalTuning.coast, 0.4)
        XCTAssertEqual(MedalTuning.stiffness, 20)
        XCTAssertEqual(MedalTuning.damping, 8)
        XCTAssertEqual(MedalTuning.springMaxSeconds, 3)
        XCTAssertEqual(MedalTuning.showcaseMin, 64)
        XCTAssertEqual(MedalTuning.showcaseIdle, 8)
        XCTAssertEqual(MedalTuning.showcaseEveryMin, 11)
        XCTAssertEqual(MedalTuning.showcaseEveryMax, 16)
        XCTAssertEqual(MedalTuning.showcaseTurn, 360)
        XCTAssertEqual(MedalTuning.showcaseSeconds, 3.4)
        XCTAssertEqual(MedalTuning.showcaseGlint, 0.86)
        XCTAssertEqual(MedalTuning.step, 1.0 / 240, accuracy: 1e-15)
    }

    func testMedalEasingsRunForwardAndTheirSlopesAreTheirDerivatives() {
        for ease in MedalEase.allCases {
            XCTAssertEqual(ease.at(0), 0, accuracy: 1e-12, "\(ease)")
            XCTAssertEqual(ease.at(1), 1, accuracy: 1e-12, "\(ease)")
            var s = 0.01
            while s < 1 {
                XCTAssertGreaterThanOrEqual(ease.at(s), ease.at(s - 0.01) - 1e-12, "\(ease) at \(s)")
                XCTAssertEqual(ease.slope(s), (ease.at(s + 1e-5) - ease.at(s - 1e-5)) / 2e-5, accuracy: 1e-3, "\(ease) slope at \(s)")
                s += 0.01
            }
        }
        XCTAssertEqual(MedalEase.inOutCubic.slope(0), 0, "a tap starts at rest")
        XCTAssertEqual(MedalEase.inOutCubic.slope(1), 0, "and lands at rest")
        XCTAssertEqual(MedalEase.outQuint.slope(0), 5, accuracy: 1e-12, "the rank-up enters fast")
        XCTAssertEqual(MedalEase.outQuint.slope(1), 0)
    }

    func testTapTurnsOnceOverTwoPointFourSecondsAndSettlesFromAtMostOneAndAHalfDegrees() throws {
        for side in [1.0, -1.0] {
            let turn = try XCTUnwrap(MedalTurns.tap(angle: 0, velocity: 0, side: side, current: nil))
            let run = play(.turn(turn), from: 0)
            XCTAssertEqual(run.angle, 360 * side, "rests exactly face-front, one turn on")
            XCTAssertTrue(run.past <= MedalTuning.tapSettle + 1e-9 && run.past >= MedalTuning.tapSettle - 0.05, "settle \(run.past)")
            let atTurnEnd = try XCTUnwrap(run.frames.first { $0.time >= MedalTuning.tapSeconds - 1e-9 })
            XCTAssertEqual(atTurnEnd.angle, 360 * side + MedalTuning.tapSettle * side, accuracy: 0.05, "the eased turn takes 2.4 s")
            XCTAssertTrue(monotonic(run.frames.filter { $0.time <= MedalTuning.tapSeconds }, side), "no wobble on the way")
            XCTAssertLessThan(run.peak, 460, "slow: it used to start at 864°/s")
            XCTAssertLessThan(try XCTUnwrap(run.frames.first).velocity * side, 5, "starts from rest")
            XCTAssertLessThan(run.rest, 3.6)
            XCTAssertEqual(run.glints.count, 1, "one glint")
            XCTAssertGreaterThan(try XCTUnwrap(run.glints.first).time, 0.75 * MedalTuning.tapSeconds, "as it faces front again")
        }
    }

    func testTapOnATurningMedalAddsOneTurnTheWayItMovesWithContinuousSpeed() throws {
        var angle = 0.0
        var velocity = 0.0
        var current: MedalMove? = .turn(try XCTUnwrap(MedalTurns.tap(angle: 0, velocity: 0, side: 1, current: nil)))
        for _ in 0..<60 {
            let step = MedalTurns.step(try XCTUnwrap(current), angle: angle, dt: frame)
            angle = step.angle
            velocity = step.velocity
            current = step.next
        }
        XCTAssertGreaterThan(velocity, 200, "mid-turn")
        let next = try XCTUnwrap(MedalTurns.tap(angle: angle, velocity: velocity, side: -1, current: current))
        XCTAssertEqual(next.face, 720, "one more turn ahead; the tapped side does not reverse it")
        XCTAssertEqual(next.at(0).velocity, velocity, accuracy: 1e-6, "speed is continuous at the hand-over")
        XCTAssertEqual(next.at(0).angle, angle, accuracy: 1e-9)
        XCTAssertNil(MedalTurns.tap(angle: angle, velocity: velocity, side: 1, current: .turn(next)), "at most one queued turn")
        let run = play(.turn(next), from: angle)
        XCTAssertEqual(run.angle, 720)
        XCTAssertTrue(monotonic(run.frames.filter { $0.time <= next.seconds }, 1))
        XCTAssertLessThanOrEqual(run.past, MedalTuning.tapSettle + 1e-9)
        // A very fast medal gets the rest as one ease-out, still landing at rest.
        let quick = MedalTurn(from: 0, delta: 360, seconds: 0.9, ease: .outCubic, v0: 0, elapsed: 0.05, face: 360, glintAt: nil)
        let state = quick.at(0.05)
        let fast = try XCTUnwrap(MedalTurns.tap(angle: state.angle, velocity: state.velocity, side: 1, current: .turn(quick)))
        XCTAssertLessThan(fast.seconds, MedalTuning.tapSeconds)
        XCTAssertEqual(fast.at(0).velocity, state.velocity, accuracy: 1e-6)
        let fastRun = play(.turn(fast), from: state.angle)
        XCTAssertEqual(fastRun.angle, 720)
        XCTAssertTrue(monotonic(fastRun.frames.filter { $0.time <= fast.seconds }, 1), "never runs back inside the turn")
    }

    func testRankUpDeceleratesFromTwoTurnsBackOntoTheFace() throws {
        let turn = MedalTurns.entrance()
        XCTAssertEqual(turn.from, -720)
        XCTAssertEqual(turn.from + turn.delta, 0)
        XCTAssertEqual(turn.seconds, 3.6)
        XCTAssertEqual(turn.ease, .outQuint)
        let run = play(.turn(turn), from: -720)
        XCTAssertEqual(run.angle, 0)
        XCTAssertEqual(run.rest, 3.6, accuracy: frame + 1e-9)
        XCTAssertTrue(monotonic(run.frames, 1))
        XCTAssertEqual(run.past, 0, "no overshoot")
        for index in run.frames.indices.dropFirst() {
            XCTAssertLessThanOrEqual(run.frames[index].velocity, run.frames[index - 1].velocity + 1e-9, "always slowing down")
        }
        XCTAssertEqual(run.glints.count, 1)
        XCTAssertLessThan(abs(try XCTUnwrap(run.glints.first).angle), 10, "the glint crosses near face-front")
    }

    func testShowcaseIsOneSlowTurnEitherWayGlintingAsItFacesFront() throws {
        for direction in [1.0, -1.0] {
            let run = play(.turn(MedalTurns.showcase(angle: 0, direction: direction)), from: 0)
            XCTAssertEqual(run.angle, 360 * direction)
            XCTAssertEqual(run.rest, 3.4, accuracy: frame + 1e-9)
            XCTAssertTrue(monotonic(run.frames, direction))
            XCTAssertEqual(run.peak, 360 * Double.pi / 2 / 3.4, accuracy: 1, "gentle peak speed")
            XCTAssertEqual(run.glints.count, 1)
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(run.glints.first).time, 0.85 * 3.4)
        }
        // The schedule (useMedal3D): the first showcase turns positive, the next the other way; a touch postpones it.
        let medal = MedalSpinModel(seed: 3)
        var time = 1_000.0
        _ = medal.advance(to: time)
        XCTAssertTrue((11..<16).contains(medal.showcaseDelay()))
        let first = medal.attemptShowcase(at: time, sleeping: false)
        XCTAssertTrue(first.started)
        XCTAssertTrue((11..<16).contains(first.next))
        guard case .turn(let forward)? = medal.move else { return XCTFail("a showcase turn runs") }
        XCTAssertEqual(forward.face, 360)
        let busy = medal.attemptShowcase(at: time + 1, sleeping: false)
        XCTAssertFalse(busy.started, "never on top of a turn")
        XCTAssertTrue(busy.next >= 1 && busy.next < 3)
        for _ in 0..<240 {
            time += frame
            _ = medal.advance(to: time)
        }
        XCTAssertNil(medal.move)
        XCTAssertEqual(medal.angle, 0, "rests face-front")
        XCTAssertTrue(medal.attemptShowcase(at: time, sleeping: false).started)
        guard case .turn(let backward)? = medal.move else { return XCTFail("a showcase turn runs") }
        XCTAssertEqual(backward.face, -360, "showcases alternate direction")
        medal.finish()
        XCTAssertNil(medal.move, "offscreen or covered: a turn in flight stops face-front at once")
        XCTAssertEqual(medal.angle, 0)
        medal.touchBegan(CGPoint(x: 50, y: 50), side: 100, time: time)
        medal.touchEnded(CGPoint(x: 50, y: 50), side: 100, time: time + 0.1, quick: false)
        let touched = medal.attemptShowcase(at: time + 2, sleeping: false)
        XCTAssertFalse(touched.started, "a touch postpones it")
        XCTAssertGreaterThanOrEqual(touched.next, 5.9)
        let asleep = medal.attemptShowcase(at: time + 9, sleeping: true)
        XCTAssertFalse(asleep.started, "not while offscreen or covered")
        XCTAssertTrue((11..<16).contains(asleep.next))
        XCTAssertTrue(medal.attemptShowcase(at: time + 9, sleeping: false).started)
        guard case .turn(let third)? = medal.move else { return XCTFail("a showcase turn runs") }
        XCTAssertEqual(third.face, 360, "a skipped (sleeping) attempt does not flip the direction")
    }

    func testDragReleaseIsCappedAndLandsExactlyFaceFrontWithinFourAndAHalfSeconds() {
        var turns = 0
        var springs = 0
        for velocity in stride(from: -1_200.0, through: 1_200.0, by: 45) {
            for angle in stride(from: -540.0, to: 540.0, by: 21) {
                let move = MedalTurns.release(angle: angle, velocity: velocity)
                let speed = max(-720, min(720, velocity))
                let run = play(move, from: angle)
                XCTAssertEqual(run.angle.truncatingRemainder(dividingBy: 360), 0, "rests on a face (v \(velocity), angle \(angle))")
                XCTAssertLessThanOrEqual(run.peak, 720 + 1e-6, "never faster than the cap")
                switch move {
                case .turn(let turn):
                    turns += 1
                    XCTAssertTrue(turn.seconds >= MedalTuning.throwMinSeconds - 1e-9 && turn.seconds <= MedalTuning.throwMaxSeconds + 1e-9)
                    XCTAssertEqual(turn.at(0).velocity, speed, accuracy: 1e-6, "the turn starts at the release speed")
                    XCTAssertEqual(turn.face - angle > 0, speed > 0, "it keeps going the way it was thrown")
                    XCTAssertEqual(run.past, 0, "a throw never passes its face")
                    XCTAssertTrue(monotonic(run.frames, speed > 0 ? 1 : -1))
                    XCTAssertLessThanOrEqual(run.rest, MedalTuning.throwMaxSeconds + frame + 1e-9)
                case .spring:
                    springs += 1
                    XCTAssertLessThan(abs(speed), 300, "from 300°/s up a face always fits")
                    XCTAssertLessThanOrEqual(run.rest, 3, "the face spring rests within 3 s")
                    XCTAssertLessThan(run.past, 25, "a slow release overshoots its face only a little")
                }
            }
        }
        XCTAssertGreaterThan(turns, springs, "most releases are decelerating turns")
        let slow = MedalTurns.release(angle: 100, velocity: 40)
        guard case .spring = slow else { return XCTFail("a slow release springs") }
        XCTAssertEqual(MedalTurns.restFace(slow, angle: 100), 0, "a slow release returns to the nearest face")
        XCTAssertEqual(MedalTurns.restFace(MedalTurns.release(angle: 250, velocity: 40), angle: 250), 360)
        XCTAssertEqual(MedalTurns.nearestFace(-180), 0, "JS Math.round: a half rounds up")
        XCTAssertEqual(MedalTurns.nearestFace(180), 360)
    }

    // MARK: Launch motivation (§6, lib/startup-welcome.ts)

    func testLaunchMotivationPoolFollowsTheLocalDayOfTheYear() throws {
        let utc = try calendar("UTC")
        let moscow = try calendar("Europe/Moscow")
        let now = try date("2026-10-01T21:20:00Z")
        XCTAssertEqual(LaunchMotivation.pool.count, 7)
        XCTAssertEqual(Set(LaunchMotivation.pool).count, 7)
        XCTAssertEqual(LaunchMotivation.dayOfYear(try date("2026-01-01T12:00:00Z"), calendar: utc), 1)
        XCTAssertEqual(LaunchMotivation.dayOfYear(try date("2026-12-31T12:00:00Z"), calendar: utc), 365)
        XCTAssertEqual(LaunchMotivation.dayOfYear(try date("2028-12-31T12:00:00Z"), calendar: utc), 366, "leap year")
        XCTAssertEqual(LaunchMotivation.dayOfYear(now, calendar: moscow), 275, "2 October in Moscow")
        XCTAssertEqual(LaunchMotivation.dayOfYear(now, calendar: utc), 274, "still 1 October in UTC")
        XCTAssertEqual(LaunchMotivation.poolLine(day: 1), LaunchMotivation.pool[0], "1 January → the first line")
        XCTAssertEqual(LaunchMotivation.poolLine(day: 7), LaunchMotivation.pool[6])
        XCTAssertEqual(LaunchMotivation.poolLine(day: 8), LaunchMotivation.pool[0])
        XCTAssertEqual(LaunchMotivation.poolLine(day: 366), LaunchMotivation.pool[1])
        XCTAssertEqual(LaunchMotivation.boot(now: now, calendar: moscow), "Сильный ответ начинается с главного.")
        XCTAssertEqual(LaunchMotivation.boot(now: now, calendar: utc), "Пять минут вслух — лучше часа в голове.")
        XCTAssertEqual(LaunchMotivation.boot(now: try date("2026-01-01T00:30:00+03:00"), calendar: moscow), LaunchMotivation.pool[0],
                       "local New Year, still 31 December in UTC")
        XCTAssertEqual(LaunchMotivation.boot(now: Date(timeIntervalSinceReferenceDate: .nan), calendar: utc), LaunchMotivation.pool[0],
                       "an invalid clock never breaks the line")
        XCTAssertEqual(OpeningGreeting(state: nil, now: now, calendar: moscow).motivation, "Сильный ответ начинается с главного.",
                       "before any data the line is the boot line")
    }

    func testLaunchMotivationRulesApplyInOrder() {
        let all = LaunchMotivationFacts(resumable: true, completedToday: true, duePhrases: 4, pendingCallDrill: true, practiceDays: 5, dayOfYear: 2)
        XCTAssertEqual(LaunchMotivation.line(all), "Разговор ждёт — продолжим с того же места.")
        var facts = all
        facts.resumable = false
        XCTAssertEqual(LaunchMotivation.line(facts), "Сегодня уже была практика. Дальше — в своём темпе.")
        facts.completedToday = false
        XCTAssertEqual(LaunchMotivation.line(facts), "4 фразы ждут повторения — скажем их вслух.")
        facts.duePhrases = 0
        XCTAssertEqual(LaunchMotivation.line(facts), "Есть тренировка из твоего созвона — переиграем момент.")
        facts.pendingCallDrill = false
        XCTAssertEqual(LaunchMotivation.line(facts), "5 дней практики на этой неделе. Держим ритм.")
        XCTAssertEqual(LaunchMotivation.line(LaunchMotivationFacts(practiceDays: 2, dayOfYear: 2)), LaunchMotivation.pool[1],
                       "two days are not a rhythm yet")
        XCTAssertEqual(LaunchMotivation.line(LaunchMotivationFacts(dayOfYear: 3)), LaunchMotivation.pool[2])
    }

    func testLaunchMotivationRussianPlurals() {
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(1), "1 фраза ждёт повторения — скажем её вслух.")
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(2), "2 фразы ждут повторения — скажем их вслух.")
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(5), "5 фраз ждут повторения — скажем их вслух.")
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(11), "11 фраз ждут повторения — скажем их вслух.")
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(21), "21 фраза ждёт повторения — скажем их вслух.")
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(22), "22 фразы ждут повторения — скажем их вслух.")
        XCTAssertEqual(LaunchMotivation.duePhrasesLine(112), "112 фраз ждут повторения — скажем их вслух.")
        XCTAssertEqual(LaunchMotivation.rhythmLine(3), "3 дня практики на этой неделе. Держим ритм.")
        XCTAssertEqual(LaunchMotivation.rhythmLine(4), "4 дня практики на этой неделе. Держим ритм.")
        XCTAssertEqual(LaunchMotivation.rhythmLine(5), "5 дней практики на этой неделе. Держим ритм.")
        XCTAssertEqual(LaunchMotivation.rhythmLine(7), "7 дней практики на этой неделе. Держим ритм.")
    }

    func testPracticeDaysAreDistinctDaysAmongTodayAndTheSixBefore() throws {
        let at = try date("2026-10-08T12:00:00Z")
        let days = try [
            "2026-10-08T09:00:00Z", "2026-10-08T10:00:00Z", // today twice → one day
            "2026-10-06T23:30:00Z", // 7 October in Moscow, 6 October in UTC
            "2026-10-02T08:00:00Z", // six days back: inside the window
            "2026-10-01T08:00:00Z", // seven days back: outside
            "2026-10-09T08:00:00Z", // future
        ].map { try date($0) }
        XCTAssertEqual(LaunchMotivation.practiceDays(days, now: at, calendar: try calendar("UTC")), 3)
        XCTAssertEqual(LaunchMotivation.practiceDays(days, now: at, calendar: try calendar("Europe/Moscow")), 3)
        XCTAssertEqual(LaunchMotivation.practiceDays([try date("2026-10-07T21:30:00Z")], now: at, calendar: try calendar("Europe/Moscow")), 1,
                       "after Moscow midnight it is already the 8th")
        XCTAssertEqual(LaunchMotivation.practiceDays([], now: at, calendar: try calendar("UTC")), 0)
    }

    func testOpeningGreetingPersonalLineFromSavedState() throws {
        let now = try date("2026-10-01T21:20:00Z")
        let moscow = try calendar("Europe/Moscow")
        let named = OpeningGreeting(state: try state([:]), now: now, calendar: moscow)
        XCTAssertEqual(named.greeting, "Привет, Alex.")
        XCTAssertEqual(named.motivation, "Сильный ответ начинается с главного.")
        XCTAssertEqual(OpeningGreeting(state: try state(["profile": ["name": "Learner", "dailyMinutes": 15]]), now: now, calendar: moscow).greeting,
                       "Привет.")
        let finished: [String: Any] = ["id": "done", "status": "done", "source": ["type": "call", "callId": "c1"]]
        let pattern: [String: Any] = ["id": "pattern", "status": "new", "source": ["type": "pattern", "patternId": "p1"]]
        let fresh: [String: Any] = ["id": "fresh", "status": "started", "source": ["type": "call", "callId": "c2", "at": 42]]
        XCTAssertEqual(OpeningGreeting(state: try state(["drills": [finished, pattern]]), now: now, calendar: moscow).motivation,
                       LaunchMotivation.pool[1], "a finished drill or one without a call does not count")
        XCTAssertEqual(OpeningGreeting(state: try state(["drills": [finished, pattern, fresh]]), now: now, calendar: moscow).motivation,
                       "Есть тренировка из твоего созвона — переиграем момент.")
        let waiting: [String: Any] = ["id": "waiting", "status": "active", "mode": "learning", "updatedAt": "2026-10-01T21:00:00Z",
                                      "lesson": ["title": "Synthetic conversation", "goal": "A useful reply", "why": "w", "minutes": 15],
                                      "turns": [["id": "a1", "role": "assistant", "text": "Hello."]], "retries": []]
        XCTAssertEqual(OpeningGreeting(state: try state(["sessions": [waiting], "drills": [fresh]]), now: now, calendar: moscow).motivation,
                       "Разговор ждёт — продолжим с того же места.")
    }

    // MARK: Image prewarm (§5)

    func testImagePrewarmCoversEveryRewardArtAndFallsBack() {
        XCTAssertEqual(ImagePrewarm.rewardNames.count, 13)
        XCTAssertEqual(Set(ImagePrewarm.rewardNames).count, 13)
        for rank in RewardArt.ranks {
            XCTAssertTrue(ImagePrewarm.rewardNames.contains("reward-" + rank.art + "-v041"), rank.art)
        }
        for art in Set(RewardArt.achievementArt.values) {
            XCTAssertTrue(ImagePrewarm.rewardNames.contains("reward-" + art + "-v041"), art)
        }
        XCTAssertEqual(ImagePrewarm.scenarioNames.count, 29)
        XCTAssertTrue(ImagePrewarm.scenarioNames.allSatisfy { $0.hasPrefix("scenario-") && $0.hasSuffix("-v1") })
        XCTAssertFalse(ImagePrewarm.decode("missing-art-for-tests"))
        XCTAssertNil(ImagePrewarm.uiImage(named: "missing-art-for-tests"), "unknown art falls back to the asset catalog")
        if UIImage(named: "reward-rank-gold-v041") != nil {
            XCTAssertTrue(ImagePrewarm.decode("reward-rank-gold-v041"))
            XCTAssertNotNil(ImagePrewarm.uiImage(named: "reward-rank-gold-v041"))
        }
    }
}
