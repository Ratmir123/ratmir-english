import SwiftUI
import CoreMotion

/// Rank medal as a physical object (DESIGN-PASS-0.5.1 «Медали рангов — объём»).
/// Same constants as `MEDAL` in components/ui/medal-3d.ts — change both together.
enum MedalTuning {
    /// Below this side the medal is flat art: no thickness, light, foil or gestures.
    static let solidMin: CGFloat = 48
    static let depth: CGFloat = 0.09
    static let perspective: CGFloat = 4
    static let tiltYaw = 16.0
    static let tiltPitch = 12.0
    /// Horizontal drag across the full medal width turns it this many degrees.
    static let dragDegrees = 200.0
    static let maxSpeed = 2000.0
    /// Free spin decays as v·e^(−friction·t); per throw it is bent within [min, max] to land face-front.
    static let friction = 2.4
    static let minFriction = 1.5
    static let maxFriction = 4.5
    /// Slower than this the face-front spring ramps in over `ramp` seconds.
    static let settleSpeed = 300.0
    static let stiffness = 50.0
    static let damping = 8.5
    static let ramp = 0.4
    /// A tap adds one decelerating turn; rank-up starts back-facing and makes 1.5 turns.
    static let tapTurn = 360.0
    static let entranceTurn = 540.0
    static let step = 1.0 / 240
    /// Idle: ±yaw over `turnPeriod` seconds each way, a glint crossing the face once per `glintPeriod`.
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

/// One throw: free spin with friction bent to land face-front, then a ramped spring with a small overshoot.
struct MedalThrow {
    var angle: Double
    var velocity: Double
    var target: Double
    var friction: Double
    var settling: Double?
    var age = 0.0

    init(angle: Double, velocity: Double) {
        let speed = max(-MedalTuning.maxSpeed, min(MedalTuning.maxSpeed, velocity))
        var face = ((angle + speed / MedalTuning.friction) / 360).rounded() * 360
        var decay = MedalTuning.friction
        if abs(speed) > MedalTuning.settleSpeed {
            let options = [face - 360, face, face + 360]
                .filter { ($0 - angle) * speed > 0 }
                .map { candidate -> (face: Double, friction: Double) in (candidate, speed / (candidate - angle)) }
                .filter { $0.friction >= MedalTuning.minFriction && $0.friction <= MedalTuning.maxFriction }
            if let best = options.min(by: { abs($0.friction - MedalTuning.friction) < abs($1.friction - MedalTuning.friction) }) {
                face = best.face
                decay = best.friction
            }
        }
        self.angle = angle
        self.velocity = speed
        self.target = face
        self.friction = decay
        self.settling = nil
    }

    /// Returns true once the medal rests face-front (angle snapped to the target).
    mutating func step(_ dt: Double) -> Bool {
        var left = min(max(dt, 0), 0.1)
        while left > 1e-6 {
            let h = min(MedalTuning.step, left)
            if settling == nil && abs(velocity) < MedalTuning.settleSpeed { settling = age }
            var acceleration = -friction * velocity
            if let settling {
                let weight = min(1, (age - settling) / MedalTuning.ramp)
                acceleration += weight * (MedalTuning.stiffness * (target - angle) - MedalTuning.damping * velocity)
            }
            velocity += acceleration * h
            angle += velocity * h
            age += h
            left -= h
        }
        let rested = settling != nil && abs(angle - target) < 0.25 && abs(velocity) < 4
        if rested || age > 4 {
            angle = target
            velocity = 0
            return true
        }
        return false
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

/// Touch tilt, drag-spin with inertia, tap-turn and the rank-up entrance for one medal. Main thread only;
/// advanced by the medal's TimelineView, so it never schedules work of its own.
final class MedalSpinModel {
    private struct Drag {
        var x0: CGFloat
        var y0: CGFloat
        var a0 = 0.0
        var moved = false
        var samples: [(time: TimeInterval, angle: Double)] = []
    }

    private var angle = 0.0
    private var spin: MedalThrow?
    private var drag: Drag?
    private var touching = false
    private var lastTime: TimeInterval = 0
    private var tilt: (yaw: Double, pitch: Double) = (0, 0)
    private var aim: (yaw: Double, pitch: Double) = (0, 0)
    private var flashStart: TimeInterval?

    /// Yaw and pitch in degrees at `time` (sway is added by the caller).
    func advance(to time: TimeInterval) -> (yaw: Double, pitch: Double) {
        let dt = lastTime == 0 ? 1.0 / 60 : min(0.05, max(0, time - lastTime))
        lastTime = time
        if var current = spin {
            if current.step(dt) {
                angle = 0
                spin = nil
            } else {
                angle = current.angle
                spin = current
            }
        }
        let follow = 1 - exp(-dt * 14)
        tilt.yaw += (aim.yaw - tilt.yaw) * follow
        tilt.pitch += (aim.pitch - tilt.pitch) * follow
        return (angle + tilt.yaw, tilt.pitch)
    }

    func isBusy(at time: TimeInterval) -> Bool {
        spin != nil || touching || abs(tilt.yaw) > 0.05 || abs(tilt.pitch) > 0.05
            || (flashStart.map { time < $0 + MedalTuning.flashDuration } ?? false)
    }

    /// Progress of a light flash across the face, nil when none runs.
    func flash(at time: TimeInterval) -> Double? {
        guard let start = flashStart else { return nil }
        let progress = (time - start) / MedalTuning.flashDuration
        return progress >= 0 && progress <= 1 ? progress : nil
    }

    func enter(at time: TimeInterval) {
        angle = -MedalTuning.entranceTurn
        spin = MedalThrow(angle: angle, velocity: MedalTuning.entranceTurn * MedalTuning.friction)
        flashStart = time + 0.62
        lastTime = 0
    }

    func touchBegan(_ point: CGPoint, side: CGFloat) {
        touching = true
        lean(toward: point, side: side)
        drag = Drag(x0: point.x, y0: point.y)
    }

    func touchMoved(_ point: CGPoint, side: CGFloat, time: TimeInterval) {
        guard var current = drag else { return }
        let dx = point.x - current.x0, dy = point.y - current.y0
        if !current.moved {
            if abs(dx) >= 6 && abs(dx) > abs(dy) {
                // A caught throw keeps its angle; the touch yaw folds into the spin so nothing jumps.
                current.moved = true
                if let caught = spin { angle = caught.angle }
                spin = nil
                angle += tilt.yaw
                tilt.yaw = 0
                aim.yaw = 0
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
        aim = (0, 0)
        guard let current = drag else { return }
        drag = nil
        if current.moved {
            var velocity = 0.0
            if let first = current.samples.first, let last = current.samples.last, time - last.time <= 0.07, last.time > first.time {
                velocity = (last.angle - first.angle) / (last.time - first.time)
            }
            spin = MedalThrow(angle: angle, velocity: velocity)
        } else if quick {
            let direction: Double = point.x < side / 2 ? -1 : 1
            let carried = spin?.velocity ?? 0
            if let running = spin { angle = running.angle }
            angle += tilt.yaw
            tilt.yaw = 0
            spin = MedalThrow(angle: angle, velocity: carried + direction * MedalTuning.tapTurn * MedalTuning.friction)
        }
    }

    func touchCancelled() {
        touching = false
        aim = (0, 0)
        if let current = drag, current.moved { spin = MedalThrow(angle: angle, velocity: 0) }
        drag = nil
    }

    private func lean(toward point: CGPoint, side: CGFloat) {
        let x = max(-0.5, min(0.5, Double(point.x / max(side, 1)) - 0.5))
        let y = max(-0.5, min(0.5, Double(point.y / max(side, 1)) - 0.5))
        aim = (x * 2 * MedalTuning.tiltYaw, -y * 2 * MedalTuning.tiltPitch)
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
        Image(asset).resizable().scaledToFit().frame(width: size, height: size)
    }

    /// The art's alpha only: rim layers are flat metal with no detail of the face to double.
    private var silhouette: some View {
        Image(asset).renderingMode(.template).resizable().scaledToFit().frame(width: size, height: size)
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
                    ForEach(0..<3, id: \.self) { _ in Image(asset).resizable().frame(width: depth * 3.2, height: size) }
                }
            }
            .projectionEffect(MedalProjection.plane(origin: SIMD3(0, 0, 0), a: SIMD3(0, 0, 1), b: SIMD3(0, 1, 0), yaw: yaw, pitch: pitch,
                                                    distance: distance, center: CGPoint(x: depth / 2, y: size / 2)))
    }

    private var face: some View {
        let light = MedalLight(yaw: lightYaw, pitch: lightPitch, size: size)
        let artwork = Image(asset).resizable().scaledToFit()
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
