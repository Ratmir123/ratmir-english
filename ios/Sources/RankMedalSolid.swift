import SwiftUI
import CoreMotion

/// Rank medal as a physical object (DESIGN-PASS-0.5.1 «Медали рангов — объём»), turning slowly and smoothly
/// (PASS 0.5.3 §8). Every turn is an eased curve with a known end, so nothing whips round or creeps for long.
/// Same constants and model as `MEDAL` in components/ui/medal-3d.ts — change both together.
enum MedalTuning {
    /// Below this side the medal is flat art: no thickness, light, foil or gestures.
    static let solidMin: CGFloat = 48
    static let depth: CGFloat = 0.09
    static let perspective: CGFloat = 4
    static let tiltYaw = 16.0
    static let tiltPitch = 12.0
    /// Horizontal drag across the full medal width turns it this many degrees.
    static let dragDegrees = 200.0
    /// Tap: one turn over `tapSeconds` (ease-in-out cubic) that runs `tapSettle`° past face-front and springs back.
    static let tapTurn = 360.0
    static let tapSeconds = 2.4
    static let tapSettle = 1.5
    /// The glint crosses the face at this share of a tap turn (it faces front again).
    static let tapGlint = 0.82
    /// Rank-up: from −720° to face-front over `entranceSeconds` (ease-out quint), glint at `entranceGlint` of it.
    static let entranceTurn = 720.0
    static let entranceSeconds = 3.6
    static let entranceGlint = 0.6
    /// Drag release, capped at `maxSpeed` °/s. From `throwMinSpeed` up it decays as an ease-out cubic that starts at the
    /// release speed (no jump) and stops exactly on a face ahead: of the faces whose landing time 3·distance/speed lies in
    /// [throwMinSeconds, throwMaxSeconds], the one nearest `throwSeconds`. Slower releases, or no face in range, spring.
    static let maxSpeed = 720.0
    static let throwMinSpeed = 120.0
    static let throwMinSeconds = 0.9
    static let throwSeconds = 2.4
    static let throwMaxSeconds = 4.5
    /// The face spring (slow releases and the tap settle): target = the face nearest angle + speed·coast.
    static let coast = 0.4
    static let stiffness = 20.0
    static let damping = 8.0
    static let springMaxSeconds = 3.0
    /// Showcase: a visible idle hero medal (≥ `showcaseMin` pt, untouched for `showcaseIdle` s) turns once by
    /// `showcaseTurn`° over `showcaseSeconds` (ease-in-out sine), starts `showcaseEveryMin`–`showcaseEveryMax` s apart,
    /// alternating direction (the first one positive); the glint crosses at `showcaseGlint` of the turn.
    static let showcaseMin: CGFloat = 64
    static let showcaseIdle = 8.0
    static let showcaseEveryMin = 11.0
    static let showcaseEveryMax = 16.0
    static let showcaseTurn = 360.0
    static let showcaseSeconds = 3.4
    static let showcaseGlint = 0.86
    /// Spring integration step.
    static let step = 1.0 / 240
    /// iPhone idle look (the PC draws it in CSS): ±yaw over `turnPeriod` seconds each way; a medal too small for the
    /// showcase glints once per `glintPeriod`; one glint crosses the face in `flashDuration`.
    static let turnPeriod = 9.6
    static let glintPeriod = 7.2
    static let glintShare = 0.14
    static let flashDuration = 0.82

    static func yaw(for art: String) -> Double {
        switch art {
        case "rank-sky": return 11
        case "rank-rose", "rank-gold": return 12
        default: return 10
        }
    }

    /// Rim metal per rank (dark, light) in sRGB, the same as --rim-dark / --rim-light on the web.
    static func rim(for art: String) -> (dark: SIMD3<Double>, light: SIMD3<Double>) {
        switch art {
        case "rank-mint": return (SIMD3<Double>(0x1d, 0x64, 0x50) / 255, SIMD3<Double>(0x9b, 0xe8, 0xcc) / 255)
        case "rank-sky": return (SIMD3<Double>(0x1b, 0x55, 0x7f) / 255, SIMD3<Double>(0x9a, 0xd3, 0xf6) / 255)
        case "rank-violet": return (SIMD3<Double>(0x41, 0x2a, 0x7c) / 255, SIMD3<Double>(0xc8, 0xb0, 0xff) / 255)
        case "rank-rose": return (SIMD3<Double>(0x7c, 0x26, 0x40) / 255, SIMD3<Double>(0xf3, 0xa7, 0xbd) / 255)
        case "rank-gold": return (SIMD3<Double>(0x6e, 0x42, 0x0f) / 255, SIMD3<Double>(0xf2, 0xc8, 0x73) / 255)
        default: return (SIMD3<Double>(0x5f, 0x63, 0x74) / 255, SIMD3<Double>(0xdd, 0xe0, 0xea) / 255)
        }
    }

    static func color(_ rgb: SIMD3<Double>) -> Color { Color(red: rgb.x, green: rgb.y, blue: rgb.z) }

    /// One rim layer: its metal lit from above (22 % white at the top, 28 % black at the bottom).
    static func rimGradient(_ rgb: SIMD3<Double>) -> LinearGradient {
        let white = SIMD3<Double>(repeating: 1)
        let top = rgb + (white - rgb) * 0.22
        let bottom = rgb * 0.72
        return LinearGradient(stops: [.init(color: color(top), location: 0), .init(color: color(rgb), location: 0.4), .init(color: color(bottom), location: 1)],
                              startPoint: .top, endPoint: .bottom)
    }
}

/// Easing curves of medal turns: progress (0 → 1) and its slope d/ds (web `MEDAL_EASE`).
enum MedalEase: Equatable, CaseIterable {
    case inOutCubic, outQuint, inOutSine, outCubic

    func at(_ s: Double) -> Double {
        switch self {
        case .inOutCubic: return s < 0.5 ? 4 * s * s * s : 1 - pow(2 - 2 * s, 3) / 2
        case .outQuint: return 1 - pow(1 - s, 5)
        case .inOutSine: return (1 - cos(Double.pi * s)) / 2
        case .outCubic: return 1 - pow(1 - s, 3)
        }
    }

    func slope(_ s: Double) -> Double {
        switch self {
        case .inOutCubic: return s < 0.5 ? 12 * s * s : 3 * pow(2 - 2 * s, 2)
        case .outQuint: return 5 * pow(1 - s, 4)
        case .inOutSine: return Double.pi * sin(Double.pi * s) / 2
        case .outCubic: return 3 * pow(1 - s, 2)
        }
    }
}

/// One eased turn from `from` by `delta` over `seconds` (web `MedalTurn`). A turn that takes over a moving medal starts
/// at `v0` °/s: an ease-out cubic carries v0·T/3 of the distance, the eased curve the rest — position and speed stay
/// continuous. It rests on `face`; when `delta` ends past it (the tap settle) the face spring brings it back.
struct MedalTurn: Equatable {
    var from: Double
    var delta: Double
    var seconds: Double
    var ease: MedalEase
    var v0: Double
    var elapsed: Double
    var face: Double
    /// Share of `seconds` at which the glint crosses the face; nil = no glint.
    var glintAt: Double?

    /// Angle and speed (°/s) `t` seconds in (web `turnAt`).
    func at(_ t: Double) -> (angle: Double, velocity: Double) {
        let total = seconds
        let s = min(1, max(0, t / total))
        let carry = v0 * total / 3
        let angle = from + carry * MedalEase.outCubic.at(s) + (delta - carry) * ease.at(s)
        let velocity = s >= 1 ? 0 : v0 * (1 - s) * (1 - s) + (delta - carry) * ease.slope(s) / total
        return (angle, velocity)
    }
}

/// The face spring (web `MedalSpring`).
struct MedalSpring: Equatable {
    var target: Double
    var velocity: Double
    var age: Double
}

/// What turns the medal right now (web `MedalMotion`; `MedalMotion` here is the device-tilt reader below).
enum MedalMove: Equatable {
    case turn(MedalTurn)
    case spring(MedalSpring)
}

/// One step of a move: the angle and speed, the move that continues (nil once it rests, the angle exactly on its face)
/// and whether the glint is due in this step.
struct MedalStep: Equatable {
    var angle: Double
    var velocity: Double
    var next: MedalMove?
    var glint: Bool
}

/// The pure medal model: the same functions as components/ui/medal-3d.ts (vectors in ios/Tests/MotionTests.swift,
/// mirroring tests/medal-turns.test.ts).
enum MedalTurns {
    /// Face-front angles are whole turns: JS `Math.round` (a half rounds up), never −0.
    static func nearestFace(_ angle: Double) -> Double {
        (angle / 360 + 0.5).rounded(.down) * 360 + 0
    }

    /// The face a move rests on (the nearest one when there is no move) — web `motionFace`.
    static func restFace(_ move: MedalMove?, angle: Double) -> Double {
        switch move {
        case .none: return nearestFace(angle)
        case .turn(let turn)?: return turn.face
        case .spring(let spring)?: return spring.target
        }
    }

    /// A tap at rest turns once towards the tapped `side` (±1). On a moving medal it adds one turn in the direction it
    /// already moves, keeping its speed; at most one turn is queued (nil while more than a turn remains) — web `tapTurn`.
    static func tap(angle: Double, velocity: Double, side: Double, current: MedalMove?) -> MedalTurn? {
        let moving = current != nil && abs(velocity) > 20
        let direction: Double = moving ? (velocity > 0 ? 1 : -1) : (side < 0 ? -1 : 1)
        let base = restFace(current, angle: angle)
        if moving && abs(base - angle) > MedalTuning.tapTurn { return nil }
        let face = base + direction * MedalTuning.tapTurn
        let delta = face + direction * MedalTuning.tapSettle - angle
        let v0 = moving ? velocity : 0
        // A fast medal would overshoot inside the eased curve: then the whole rest is its own ease-out (still lands at rest).
        let seconds = v0 != 0 && abs(v0) * MedalTuning.tapSeconds / 3 > abs(delta) ? 3 * delta / v0 : MedalTuning.tapSeconds
        return MedalTurn(from: angle, delta: delta, seconds: seconds, ease: .inOutCubic, v0: v0, elapsed: 0, face: face,
                         glintAt: MedalTuning.tapGlint)
    }

    /// Rank-up: two turns from behind, decelerating onto the face — web `entranceTurn`.
    static func entrance() -> MedalTurn {
        MedalTurn(from: -MedalTuning.entranceTurn, delta: MedalTuning.entranceTurn, seconds: MedalTuning.entranceSeconds,
                  ease: .outQuint, v0: 0, elapsed: 0, face: 0, glintAt: MedalTuning.entranceGlint)
    }

    /// The idle showcase: one slow turn from rest — web `showcaseTurn`.
    static func showcase(angle: Double, direction: Double) -> MedalTurn {
        let face = nearestFace(angle) + (direction < 0 ? -1 : 1) * MedalTuning.showcaseTurn
        return MedalTurn(from: angle, delta: face - angle, seconds: MedalTuning.showcaseSeconds, ease: .inOutSine, v0: 0,
                         elapsed: 0, face: face, glintAt: MedalTuning.showcaseGlint)
    }

    /// A drag release: a decelerating turn onto a face ahead, or the face spring for a slow release — web `releaseThrow`.
    static func release(angle: Double, velocity: Double) -> MedalMove {
        let speed = max(-MedalTuning.maxSpeed, min(MedalTuning.maxSpeed, velocity.isFinite ? velocity : 0))
        if abs(speed) >= MedalTuning.throwMinSpeed {
            let direction: Double = speed > 0 ? 1 : -1
            var first = direction > 0 ? (angle / 360).rounded(.up) * 360 : (angle / 360).rounded(.down) * 360
            if abs(first - angle) < 1e-6 { first += direction * 360 }
            var best: (face: Double, seconds: Double)?
            for turn in 0..<3 {
                let face = first + direction * 360 * Double(turn)
                let seconds = 3 * abs(face - angle) / abs(speed)
                if seconds < MedalTuning.throwMinSeconds || seconds > MedalTuning.throwMaxSeconds { continue }
                if let chosen = best, abs(seconds - MedalTuning.throwSeconds) >= abs(chosen.seconds - MedalTuning.throwSeconds) { continue }
                best = (face, seconds)
            }
            if let best {
                return .turn(MedalTurn(from: angle, delta: best.face - angle, seconds: best.seconds, ease: .outCubic, v0: 0,
                                       elapsed: 0, face: best.face, glintAt: nil))
            }
        }
        return .spring(MedalSpring(target: nearestFace(angle + speed * MedalTuning.coast), velocity: speed, age: 0))
    }

    /// Advances a move by `dt` seconds — web `stepMotion`.
    static func step(_ move: MedalMove, angle start: Double, dt: Double) -> MedalStep {
        switch move {
        case .turn(var turn):
            let before = turn.elapsed
            turn.elapsed += dt
            var glint = false
            if let share = turn.glintAt {
                let moment = share * turn.seconds
                glint = before < moment && turn.elapsed >= moment
            }
            if turn.elapsed < turn.seconds {
                let now = turn.at(turn.elapsed)
                return MedalStep(angle: now.angle, velocity: now.velocity, next: .turn(turn), glint: glint)
            }
            let end = turn.from + turn.delta
            if abs(end - turn.face) < 1e-6 { return MedalStep(angle: turn.face, velocity: 0, next: nil, glint: glint) }
            return MedalStep(angle: end, velocity: 0, next: .spring(MedalSpring(target: turn.face, velocity: 0, age: 0)), glint: glint)
        case .spring(var spring):
            var angle = start
            var velocity = spring.velocity
            var left = dt
            while left > 1e-9 {
                let h = min(MedalTuning.step, left)
                velocity += (MedalTuning.stiffness * (spring.target - angle) - MedalTuning.damping * velocity) * h
                angle += velocity * h
                left -= MedalTuning.step
            }
            spring.velocity = velocity
            spring.age += dt
            if (abs(angle - spring.target) < 0.05 && abs(velocity) < 1) || spring.age > MedalTuning.springMaxSeconds {
                return MedalStep(angle: spring.target, velocity: 0, next: nil, glint: false)
            }
            return MedalStep(angle: angle, velocity: velocity, next: .spring(spring), glint: false)
        }
    }
}

/// Light, foil, floor shadow and edge glint for a yaw/pitch: reflections move against the turn.
struct MedalLight {
    var glare: CGSize
    var holo: CGSize
    var shadowX: CGFloat
    var shadowWidth: CGFloat
    var edge: Double
    /// Thickness planes fade within ~10° of edge-on, where the side band carries the rim.
    var faceOn: Double

    init(yaw: Double, pitch: Double, size: CGFloat) {
        let s = sin(yaw * .pi / 180), c = cos(yaw * .pi / 180), p = sin(pitch * .pi / 180)
        glare = CGSize(width: CGFloat(-s) * size * 0.45, height: CGFloat(p) * size * 0.45)
        holo = CGSize(width: CGFloat(-s) * size * 0.6, height: CGFloat(p) * size * 0.5)
        shadowX = -CGFloat(s) * size * 0.07
        shadowWidth = 0.62 + 0.38 * CGFloat(abs(c))
        edge = pow(min(1, abs(s) * 1.15), 2)
        faceOn = min(1, abs(c) * 5)
    }
}

/// Perspective for one flat layer of the medal (y down, z toward the viewer, CSS rotateX·rotateY order).
enum MedalProjection {
    static func rotate(_ point: SIMD3<Double>, yaw: Double, pitch: Double) -> SIMD3<Double> {
        let (sy, cy) = (sin(yaw), cos(yaw))
        let (sp, cp) = (sin(pitch), cos(pitch))
        let x1 = point.x * cy + point.z * sy
        let z1 = -point.x * sy + point.z * cy
        return SIMD3(x1, point.y * cp - z1 * sp, point.y * sp + z1 * cp)
    }

    /// The plane `origin + u·a + v·b` (a, b in points) turned and seen from `distance`; `center` is the layer
    /// view's own centre, which sits on the medal centre.
    static func plane(origin: SIMD3<Double>, a: SIMD3<Double>, b: SIMD3<Double>, yaw: Double, pitch: Double,
                      distance: Double, center: CGPoint) -> ProjectionTransform {
        let yawRad = yaw * .pi / 180, pitchRad = pitch * .pi / 180
        let u = rotate(a, yaw: yawRad, pitch: pitchRad)
        let v = rotate(b, yaw: yawRad, pitch: pitchRad)
        let o = rotate(origin, yaw: yawRad, pitch: pitchRad)
        // Row vectors: (u, v, 1) · M = (x·w, y·w, w) with w = 1 − z/distance.
        let m11 = u.x, m12 = u.y, m13 = -u.z / distance
        let m21 = v.x, m22 = v.y, m23 = -v.z / distance
        let m31 = o.x, m32 = o.y, m33 = 1 - o.z / distance
        let cx = Double(center.x), cy = Double(center.y)
        // Local → plane coordinates before, plane → local after.
        let r31 = -cx * m11 - cy * m21 + m31
        let r32 = -cx * m12 - cy * m22 + m32
        let r33 = -cx * m13 - cy * m23 + m33
        var transform = ProjectionTransform()
        transform.m11 = CGFloat(m11 + m13 * cx)
        transform.m12 = CGFloat(m12 + m13 * cy)
        transform.m13 = CGFloat(m13)
        transform.m21 = CGFloat(m21 + m23 * cx)
        transform.m22 = CGFloat(m22 + m23 * cy)
        transform.m23 = CGFloat(m23)
        transform.m31 = CGFloat(r31 + r33 * cx)
        transform.m32 = CGFloat(r32 + r33 * cy)
        transform.m33 = CGFloat(r33)
        return transform
    }
}

/// Device tilt nudges the highlight like a reflection. One shared CMMotionManager, ~30 Hz, polled by the
/// medals' own frames and running only while at least one medal moves on screen.
final class MedalMotion {
    static let shared = MedalMotion()
    private let manager = CMMotionManager()
    private var users = 0
    private var baseline: (x: Double, z: Double)?
    private var lastTime: TimeInterval = 0
    private var current: (yaw: Double, pitch: Double) = (0, 0)

    func acquire() {
        users += 1
        guard users == 1, manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30
        manager.startDeviceMotionUpdates()
    }

    func release() {
        guard users > 0 else { return }
        users -= 1
        guard users == 0 else { return }
        if manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
        baseline = nil
        lastTime = 0
        current = (0, 0)
    }

    /// Light offset in degrees against the way the phone has been held for the last couple of seconds.
    func light(at time: TimeInterval) -> (yaw: Double, pitch: Double) {
        guard users > 0, let gravity = manager.deviceMotion?.gravity else { return (0, 0) }
        if time == lastTime { return current }
        let dt = lastTime == 0 ? 0 : min(0.25, max(0, time - lastTime))
        lastTime = time
        let base = baseline ?? (x: gravity.x, z: gravity.z)
        let follow = 1 - exp(-dt / 2)
        baseline = (base.x + (gravity.x - base.x) * follow, base.z + (gravity.z - base.z) * follow)
        // Right edge away raises gravity.x (face looks right); screen tipping up lowers gravity.z (face looks up).
        current = (max(-14, min(14, (gravity.x - base.x) * 57)), max(-12, min(12, -(gravity.z - base.z) * 57)))
        return current
    }
}

/// Touch tilt, drag-spin, tap-turn, the rank-up entrance and the idle showcase for one medal (web `useMedal3D`, the same
/// `MedalTurns` model). Main thread only; advanced by the medal's TimelineView, so it never schedules work of its own.
final class MedalSpinModel {
    private struct Drag {
        var x0: CGFloat
        var y0: CGFloat
        var a0 = 0.0
        var moved = false
        var samples: [(time: TimeInterval, angle: Double)] = []
    }

    private(set) var angle = 0.0
    private(set) var velocity = 0.0
    private(set) var move: MedalMove?
    private var drag: Drag?
    private var touching = false
    private var lastTime: TimeInterval = 0
    private var tilt: (yaw: Double, pitch: Double) = (0, 0)
    private var aim: (yaw: Double, pitch: Double) = (0, 0)
    private var flashStart: TimeInterval?
    /// The last touch: a showcase waits `showcaseIdle` after it.
    private var touched = -Double.infinity
    /// Showcases alternate direction; the first one turns positive.
    private var showcaseDirection = -1.0
    private var rng: UInt64

    init(seed: UInt64 = UInt64.random(in: 1...UInt64.max)) {
        rng = MascotPhysics.mixSeed(seed)
    }

    /// Yaw and pitch in degrees at `time` (sway is added by the caller).
    func advance(to time: TimeInterval) -> (yaw: Double, pitch: Double) {
        let dt = lastTime == 0 ? 1.0 / 60 : min(0.05, max(0, time - lastTime))
        lastTime = time
        if let current = move {
            let step = MedalTurns.step(current, angle: angle, dt: dt)
            angle = step.angle
            velocity = step.velocity
            move = step.next
            if step.glint { flashStart = time }
            if move == nil { settle() }
        }
        let follow = 1 - exp(-dt * 14)
        tilt.yaw += (aim.yaw - tilt.yaw) * follow
        tilt.pitch += (aim.pitch - tilt.pitch) * follow
        return (angle + tilt.yaw, tilt.pitch)
    }

    func isBusy(at time: TimeInterval) -> Bool {
        move != nil || touching || abs(tilt.yaw) > 0.05 || abs(tilt.pitch) > 0.05
            || (flashStart.map { time < $0 + MedalTuning.flashDuration } ?? false)
    }

    /// Progress of a light flash across the face, nil when none runs.
    func flash(at time: TimeInterval) -> Double? {
        guard let start = flashStart else { return nil }
        let progress = (time - start) / MedalTuning.flashDuration
        return progress >= 0 && progress <= 1 ? progress : nil
    }

    /// Ends a move in flight on its face at once (offscreen, backgrounded, covered, Reduce Motion): web `finish`.
    func finish() {
        guard let current = move else { return }
        angle = MedalTurns.restFace(current, angle: angle)
        settle()
    }

    /// Rank-up: two decelerating turns from behind onto the face; the glint crosses as it lands.
    func enter(at time: TimeInterval) {
        let turn = MedalTurns.entrance()
        angle = turn.from
        velocity = 0
        run(.turn(turn))
    }

    // MARK: Showcase (web: the `showcase` effect of useMedal3D)

    /// Seconds before the first showcase attempt once the medal shows (11–16 s).
    func showcaseDelay() -> Double {
        between(MedalTuning.showcaseEveryMin, MedalTuning.showcaseEveryMax)
    }

    /// One attempt: an idle medal untouched for `showcaseIdle` turns once (unless `sleeping`); a busy or recently touched
    /// one tries again a little later. Returns whether a turn started and the seconds to the next attempt.
    func attemptShowcase(at time: TimeInterval, sleeping: Bool) -> (started: Bool, next: Double) {
        let idle = time - touched
        let active = touching || abs(tilt.yaw) > 0.05 || abs(tilt.pitch) > 0.05
        if move != nil || drag != nil || active || idle < MedalTuning.showcaseIdle {
            return (false, max(1, MedalTuning.showcaseIdle - idle) + between(0, 2))
        }
        var started = false
        if !sleeping {
            showcaseDirection = showcaseDirection == 1 ? -1 : 1
            run(.turn(MedalTurns.showcase(angle: angle, direction: showcaseDirection)))
            started = true
        }
        return (started, between(MedalTuning.showcaseEveryMin, MedalTuning.showcaseEveryMax))
    }

    // MARK: Touch

    func touchBegan(_ point: CGPoint, side: CGFloat, time: TimeInterval) {
        touching = true
        touched = time
        lean(toward: point, side: side)
        drag = Drag(x0: point.x, y0: point.y)
    }

    func touchMoved(_ point: CGPoint, side: CGFloat, time: TimeInterval) {
        touched = time
        guard var current = drag else { return }
        let dx = point.x - current.x0, dy = point.y - current.y0
        if !current.moved {
            if abs(dx) >= 6 && abs(dx) > abs(dy) {
                // A caught turn keeps its angle; the touch yaw folds into the spin so nothing jumps.
                current.moved = true
                angle += tilt.yaw
                tilt.yaw = 0
                aim.yaw = 0
                move = nil
                velocity = 0
                current.a0 = angle
                current.x0 = point.x
            } else if abs(dy) > 10 {
                // The page scrolls: let go of the medal.
                drag = nil
                touching = false
                aim = (0, 0)
                return
            } else {
                drag = current
                return
            }
        }
        angle = current.a0 + Double(point.x - current.x0) * MedalTuning.dragDegrees / Double(max(side, 1))
        current.samples.append((time, angle))
        while current.samples.count > 2, let first = current.samples.first, time - first.time > 0.09 {
            current.samples.removeFirst()
        }
        drag = current
    }

    func touchEnded(_ point: CGPoint, side: CGFloat, time: TimeInterval, quick: Bool) {
        touching = false
        touched = time
        aim = (0, 0)
        guard let current = drag else { return }
        drag = nil
        if current.moved {
            var release = 0.0
            if let first = current.samples.first, let last = current.samples.last, time - last.time <= 0.07, last.time > first.time {
                release = (last.angle - first.angle) / (last.time - first.time)
            }
            run(MedalTurns.release(angle: angle, velocity: release))
        } else if quick {
            // One slow turn towards the tapped side; on a moving medal one more turn the way it already goes.
            let tapped: Double = point.x < side / 2 ? -1 : 1
            angle += tilt.yaw
            tilt.yaw = 0
            if let turn = MedalTurns.tap(angle: angle, velocity: velocity, side: tapped, current: move) {
                run(.turn(turn))
            }
        }
    }

    func touchCancelled() {
        touching = false
        aim = (0, 0)
        if let current = drag, current.moved { run(MedalTurns.release(angle: angle, velocity: 0)) }
        drag = nil
    }

    // MARK: Private

    /// Starts a move from the medal's current angle (web `run`): the next frame steps 1/60 s.
    private func run(_ next: MedalMove) {
        move = next
        lastTime = 0
    }

    /// At rest face-front: faces are whole turns, so the angle is 0 again (web `settle`).
    private func settle() {
        move = nil
        angle = 0
        velocity = 0
    }

    private func lean(toward point: CGPoint, side: CGFloat) {
        let x = max(-0.5, min(0.5, Double(point.x / max(side, 1)) - 0.5))
        let y = max(-0.5, min(0.5, Double(point.y / max(side, 1)) - 0.5))
        aim = (x * 2 * MedalTuning.tiltYaw, -y * 2 * MedalTuning.tiltPitch)
    }

    /// xorshift64 in [min, max): the showcase timing.
    private func between(_ lower: Double, _ upper: Double) -> Double {
        rng ^= rng << 13
        rng ^= rng >> 7
        rng ^= rng << 17
        let unit = Double(rng >> 11) / Double(UInt64(1) << 53)
        return lower + (upper - lower) * unit
    }
}

/// The medal art as a solid: the silhouette filled with flat rim metal, repeated behind the face, forms the edge; a mirrored copy
/// is the back, a side band carries the edge-on view. Layers behind the face are drawn only while turned.
struct MedalSolid: View {
    let art: String
    let size: CGFloat
    let yaw: Double
    let pitch: Double
    /// Light direction: the medal's turn plus the phone's tilt; only the highlight and foil follow it.
    let lightYaw: Double
    let lightPitch: Double
    let holo: Bool
    let glint: Double?

    private var asset: String { "reward-" + art + "-v041" }
    /// The art decoded during the launch (`ImagePrewarm`), or the asset catalog.
    private var artImage: Image { ImagePrewarm.image(asset) }
    private var depth: CGFloat { size * MedalTuning.depth }
    private var distance: Double { Double(size * MedalTuning.perspective) }
    private static let foil: [Color] = {
        let cycle = [Color(red: 1, green: 0.55, blue: 0.81), Color(red: 1, green: 0.82, blue: 0.48), Color(red: 0.54, green: 0.96, blue: 0.81),
                     Color(red: 0.49, green: 0.73, blue: 1), Color(red: 0.78, green: 0.61, blue: 1)]
        return cycle + cycle + [cycle[0]]
    }()

    /// Thickness layers between the face (+depth/2) and the back (−depth/2), about 0.6 pt apart so no step
    /// shows (8 at 64 pt, 16 at 104 pt, 20 from 112 pt). `mix` blends rim dark → light: dark at both faces.
    static func edges(size: CGFloat) -> [(z: CGFloat, mix: Double)] {
        let depth = size * MedalTuning.depth
        let count = max(8, min(20, Int((depth / 0.6).rounded())))
        return (0..<count).map { index -> (z: CGFloat, mix: Double) in
            let t = Double(index + 1) / Double(count + 1)
            return (depth / 2 - depth * CGFloat(t), 0.08 + 0.42 * pow(sin(.pi * t), 1.5))
        }
    }

    var body: some View {
        let s = sin(yaw * .pi / 180), sp = sin(pitch * .pi / 180)
        let facing = cos(yaw * .pi / 180) * cos(pitch * .pi / 180) >= 0
        let turned = abs(s) > 0.004 || abs(sp) > 0.004
        let shape = MedalLight(yaw: yaw, pitch: pitch, size: size)
        let layers = Self.edges(size: size)
        // Far to near: facing front the back-most copy comes first.
        let order = facing ? Array(layers.indices.reversed()) : Array(layers.indices)
        let half = order.count / 2
        return ZStack {
            if turned {
                band
                if facing { back }
                ForEach(order.prefix(half), id: \.self) { index in edge(layers[index], faceOn: shape.faceOn) }
                silhouette
                    .foregroundStyle(MedalTuning.color(rim.light))
                    .opacity(shape.edge * 0.55 * shape.faceOn)
                    .projectionEffect(project(z: 0))
                ForEach(order.suffix(from: half), id: \.self) { index in edge(layers[index], faceOn: shape.faceOn) }
            }
            if facing { face } else { back }
        }
        .frame(width: size, height: size)
    }

    private func project(z: CGFloat) -> ProjectionTransform {
        MedalProjection.plane(origin: SIMD3(0, 0, Double(z)), a: SIMD3(1, 0, 0), b: SIMD3(0, 1, 0), yaw: yaw, pitch: pitch,
                              distance: distance, center: CGPoint(x: size / 2, y: size / 2))
    }

    private var plate: some View {
        artImage.resizable().scaledToFit().frame(width: size, height: size)
    }

    /// The art's alpha only: rim layers are flat metal with no detail of the face to double.
    private var silhouette: some View {
        artImage.renderingMode(.template).resizable().scaledToFit().frame(width: size, height: size)
    }

    private var rim: (dark: SIMD3<Double>, light: SIMD3<Double>) { MedalTuning.rim(for: art) }

    private func edge(_ layer: (z: CGFloat, mix: Double), faceOn: Double) -> some View {
        silhouette
            .foregroundStyle(MedalTuning.rimGradient(rim.dark + (rim.light - rim.dark) * layer.mix))
            .opacity(faceOn)
            .projectionEffect(project(z: layer.z))
    }

    private var back: some View {
        plate
            .colorMultiply(Color(white: 0.5)).saturation(0.55).contrast(0.9)
            .projectionEffect(project(z: -depth / 2))
    }

    /// Cross-section through the middle in the side profile of the art: the rounded metal rim seen edge-on.
    private var band: some View {
        let dark = MedalTuning.color(rim.dark), light = MedalTuning.color(rim.light)
        return LinearGradient(stops: [.init(color: dark, location: 0), .init(color: light, location: 0.42), .init(color: dark, location: 1)],
                              startPoint: .leading, endPoint: .trailing)
            .frame(width: depth, height: size)
            .mask {
                ZStack {
                    ForEach(0..<3, id: \.self) { _ in artImage.resizable().frame(width: depth * 3.2, height: size) }
                }
            }
            .projectionEffect(MedalProjection.plane(origin: SIMD3(0, 0, 0), a: SIMD3(0, 0, 1), b: SIMD3(0, 1, 0), yaw: yaw, pitch: pitch,
                                                    distance: distance, center: CGPoint(x: depth / 2, y: size / 2)))
    }

    private var face: some View {
        let light = MedalLight(yaw: lightYaw, pitch: lightPitch, size: size)
        let artwork = artImage.resizable().scaledToFit()
        return artwork
            .overlay {
                RadialGradient(stops: [.init(color: .white.opacity(0.9), location: 0), .init(color: .white.opacity(0.3), location: 0.5),
                                       .init(color: .white.opacity(0), location: 1)], center: .center, startRadius: 0, endRadius: size * 0.33)
                    .frame(width: size * 0.66, height: size * 0.66)
                    .offset(x: -size * 0.13 + light.glare.width, y: -size * 0.19 + light.glare.height)
                    .frame(width: size, height: size)
                    .mask { artwork }
                    .blendMode(.softLight)
                    .opacity(0.9)
            }
            .overlay {
                if holo {
                    LinearGradient(colors: Self.foil, startPoint: UnitPoint(x: 0.058, y: 0.265), endPoint: UnitPoint(x: 0.942, y: 0.735))
                        .frame(width: size * 2.4, height: size * 2.4)
                        .offset(light.holo)
                        .frame(width: size, height: size)
                        .mask { artwork }
                        .blendMode(.overlay)
                        .opacity(art == "rank-violet" ? 0.22 : 0.26)
                }
            }
            .overlay {
                if let glint {
                    LinearGradient(colors: [.clear, .white.opacity(0.08), .white.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: size * 0.30, height: size * 1.6)
                        .rotationEffect(.degrees(24))
                        .offset(x: size * CGFloat(glint * 3.2 - 1.6))
                        .frame(width: size, height: size)
                        .mask { artwork }
                }
            }
            .frame(width: size, height: size)
            .compositingGroup()
            .projectionEffect(project(z: depth / 2))
    }
}
