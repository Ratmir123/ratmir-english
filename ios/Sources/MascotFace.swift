import SwiftUI

// MARK: - Render tree: floor shadow + body (shader and face share one transform)

/// Draws one simulation frame inside a square canvas of side S.
struct MascotRenderView: View {
    let pose: MascotFrame
    let side: CGFloat

    var body: some View {
        ZStack {
            MascotFloorShadow(pose: pose, side: side)
            MascotBodyView(pose: pose, side: side)
        }
        .frame(width: side, height: side)
    }
}

/// Stays on the floor (never follows drag) and shrinks while the body hops.
struct MascotFloorShadow: View {
    let pose: MascotFrame
    let side: CGFloat

    var body: some View {
        ZStack {
            Ellipse()
                .fill(RadialGradient(colors: [MascotPalette.floorLight.opacity(0.24), MascotPalette.floorLight.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: side * 0.34))
                .opacity(1 - darkness)
            Ellipse()
                .fill(RadialGradient(colors: [MascotPalette.floorDark.opacity(0.2), MascotPalette.floorDark.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: side * 0.34))
                .opacity(darkness)
        }
        .frame(width: side * 0.68, height: side * 0.12)
        .scaleEffect(x: CGFloat(pose.shadowScaleX), y: CGFloat(pose.shadowScaleY))
        .offset(y: side * 0.405)
    }

    private var darkness: Double {
        min(1, max(0, Double(pose.dark)))
    }
}

/// Liquid-glass body (Metal) with the face riding along the same squash, tilt and offset.
struct MascotBodyView: View {
    let pose: MascotFrame
    let side: CGFloat

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Color.white)
                .colorEffect(liquidShader)
            MascotFaceView(pose: pose, side: side)
        }
        .frame(width: side, height: side)
        // Squash is anchored at the bottom of the body (R0 = 0.78 of the half canvas).
        .scaleEffect(x: CGFloat(pose.scaleX), y: CGFloat(pose.scaleY), anchor: UnitPoint(x: 0.5, y: 0.89))
        .rotationEffect(.degrees(pose.rotation), anchor: UnitPoint(x: 0.5, y: 0.62))
        .offset(x: CGFloat(pose.offsetX), y: CGFloat(pose.offsetY))
    }

    /// Argument order matches `liquidCompanion` in LiquidCompanion.metal exactly.
    private var liquidShader: Shader {
        ShaderLibrary.liquidCompanion(
            .boundingRect,
            .float(pose.time),
            .float(pose.energy),
            .float(Float(pose.gazeX)),
            .float(Float(pose.gazeY)),
            .floatArray(pose.displacements),
            .float(pose.dark),
            .float(pose.tintR),
            .float(pose.tintG),
            .float(pose.tintB),
            .float(pose.tintAmount)
        )
    }
}

// MARK: - Face

/// Eyes, mouth, blush and sleep letters. All geometry is relative to S and shifts with gaze.
struct MascotFaceView: View {
    let pose: MascotFrame
    let side: CGFloat

    var body: some View {
        ZStack {
            if pose.blush > 0.01 {
                blushSpot(x: -0.205)
                blushSpot(x: 0.205)
            }
            MascotEyeView(eye: pose.leftEye, isLeft: true, side: side, spiralAngle: pose.spiralAngle,
                          heartScale: pose.heartScale, starScale: pose.starScale)
                .offset(x: -side * 0.135, y: -side * 0.035)
            MascotEyeView(eye: pose.rightEye, isLeft: false, side: side, spiralAngle: -pose.spiralAngle,
                          heartScale: pose.heartScale, starScale: pose.starScale)
                .offset(x: side * 0.135, y: -side * 0.035)
            MascotMouthView(mouth: pose.mouth, side: side)
            if pose.sleepZ > 0.01 {
                sleepLetter(phase: pose.sleepPhase, scale: 1)
                sleepLetter(phase: (pose.sleepPhase + 0.5).truncatingRemainder(dividingBy: 1), scale: 0.72)
            }
        }
        .frame(width: side, height: side)
        .offset(x: gazeOffsetX, y: gazeOffsetY)
    }

    private var gazeOffsetX: CGFloat {
        CGFloat(pose.gazeX) * side * 0.038
    }

    private var gazeOffsetY: CGFloat {
        CGFloat(pose.gazeY) * side * 0.024
    }

    private func blushSpot(x: CGFloat) -> some View {
        Ellipse()
            .fill(MascotPalette.pink)
            .frame(width: side * 0.075, height: side * 0.042)
            .blur(radius: side * 0.012)
            .opacity(pose.blush)
            .offset(x: side * x, y: side * 0.06)
    }

    private func sleepLetter(phase: Double, scale: CGFloat) -> some View {
        let rise = CGFloat(phase)
        let visibility = pose.sleepZ * (1 - phase) * min(1, phase * 4)
        return Text(verbatim: "z")
            .font(.system(size: max(6, side * 0.075 * scale), weight: .heavy, design: .rounded))
            .foregroundStyle(MascotPalette.violet)
            .opacity(visibility)
            .offset(x: side * (0.2 + 0.07 * rise), y: -side * (0.17 + 0.2 * rise))
    }
}

/// One eye: the morphing pill plus cross-fading special shapes.
struct MascotEyeView: View {
    let eye: MascotEyeFrame
    let isLeft: Bool
    let side: CGFloat
    let spiralAngle: Double
    let heartScale: Double
    let starScale: Double

    var body: some View {
        ZStack {
            if pillOpacity > 0.001 {
                MascotEyeShape(open: eye.open, smile: eye.smile, squint: eye.squint)
                    .fill(MascotPalette.eyeWhite)
                    .frame(width: side * 0.078 * CGFloat(eye.wide), height: side * 0.115)
                    .opacity(pillOpacity)
            }
            if eye.shape != .pill {
                special(eye.shape)
                    .opacity(eye.fade)
            }
            if eye.previousShape != .pill && eye.previousShape != eye.shape && eye.fade < 1 {
                special(eye.previousShape)
                    .opacity(1 - eye.fade)
            }
        }
        .frame(width: side * 0.17, height: side * 0.17)
        .rotationEffect(.degrees(eye.tilt))
        .shadow(color: Color.white.opacity(0.6), radius: side * 0.014)
    }

    private var pillOpacity: Double {
        var weight = 0.0
        if eye.shape == .pill { weight += eye.fade }
        if eye.previousShape == .pill { weight += 1 - eye.fade }
        return min(1, weight)
    }

    @ViewBuilder
    private func special(_ kind: MascotEyeKind) -> some View {
        switch kind {
        case .pill:
            EmptyView()
        case .heart:
            MascotHeartShape()
                .fill(MascotPalette.eyeWhite)
                .frame(width: side * 0.118, height: side * 0.104)
                .scaleEffect(CGFloat(heartScale))
        case .spiral:
            MascotSpiralShape()
                .stroke(MascotPalette.eyeWhite, style: StrokeStyle(lineWidth: side * 0.012, lineCap: .round, lineJoin: .round))
                .frame(width: side * 0.105, height: side * 0.105)
                .rotationEffect(.degrees(spiralAngle))
        case .star:
            ZStack {
                MascotStarShape()
                    .fill(MascotPalette.eyeWhite)
                MascotStarShape()
                    .stroke(MascotPalette.eyeWhite, style: StrokeStyle(lineWidth: side * 0.02, lineCap: .round, lineJoin: .round))
            }
            .frame(width: side * 0.108, height: side * 0.108)
            .scaleEffect(CGFloat(starScale))
        case .cross:
            MascotCrossShape()
                .stroke(MascotPalette.eyeWhite, style: StrokeStyle(lineWidth: side * 0.016, lineCap: .round))
                .frame(width: side * 0.075, height: side * 0.075)
        case .closed:
            MascotClosedEyeShape()
                .stroke(MascotPalette.eyeWhite, style: StrokeStyle(lineWidth: side * 0.015, lineCap: .round))
                .frame(width: side * 0.088, height: side * 0.032)
        case .caret:
            MascotCaretShape(pointsRight: isLeft)
                .stroke(MascotPalette.eyeWhite, style: StrokeStyle(lineWidth: side * 0.017, lineCap: .round, lineJoin: .round))
                .frame(width: side * 0.062, height: side * 0.084)
        }
    }
}

/// Small mouth: white line when closed, dark interior with a white rim when open, tongue in laughter.
struct MascotMouthView: View {
    let mouth: MascotMouthFrame
    let side: CGFloat

    var body: some View {
        ZStack {
            outline
                .fill(interiorColor)
            if mouth.tongue > 0.01 {
                MascotTongueShape(width: mouth.width, open: mouth.open, smile: mouth.smile, round: mouth.round)
                    .fill(MascotPalette.pink.opacity(mouth.tongue))
                    .clipShape(outline)
            }
            outline
                .stroke(MascotPalette.eyeWhite, style: StrokeStyle(lineWidth: max(0.8, side * 0.006), lineCap: .round, lineJoin: .round))
        }
        .frame(width: side, height: side)
        .offset(x: CGFloat(mouth.offsetX) * side, y: side * 0.105)
    }

    private var outline: MascotMouthShape {
        MascotMouthShape(width: mouth.width, open: mouth.open, smile: mouth.smile, round: mouth.round)
    }

    /// #FDFEFF when closed → #2A1F5E at 85 % once the mouth opens (o > 0.08).
    private var interiorColor: Color {
        let k = min(1, max(0, (mouth.open - 0.04) / 0.08))
        let red = 0.992 + (0.165 - 0.992) * k
        let green = 0.996 + (0.122 - 0.996) * k
        let blue = 1.0 + (0.369 - 1.0) * k
        return Color(red: red, green: green, blue: blue).opacity(1.0 - 0.15 * k)
    }
}

// MARK: - Shapes

/// Identical four-curve topology: a pill bends into a happy arc, squint flattens its top.
struct MascotEyeShape: Shape {
    var open: Double
    var smile: Double
    var squint: Double

    var animatableData: AnimatablePair<Double, AnimatablePair<Double, Double>> {
        get { AnimatablePair(open, AnimatablePair(smile, squint)) }
        set {
            open = newValue.first
            smile = newValue.second.first
            squint = newValue.second.second
        }
    }

    func path(in rect: CGRect) -> Path {
        let j = min(1, max(0, smile))
        let o = max(0.08, open)
        let flatten = 1 - 0.6 * min(1, max(0, squint))
        func point(_ px: Double, _ py: Double, _ sx: Double, _ sy: Double) -> CGPoint {
            let x = px + (sx - px) * j
            var y = py + (sy - py) * j
            if y < 0.5 {
                y = 0.5 + (y - 0.5) * flatten
            }
            let scaled = 0.5 + (y - 0.5) * o
            return CGPoint(x: rect.minX + rect.width * CGFloat(x), y: rect.minY + rect.height * CGFloat(scaled))
        }
        var path = Path()
        path.move(to: point(0.05, 0.5, 0.0, 0.68))
        path.addCurve(to: point(0.5, 0.0, 0.5, 0.28), control1: point(0.05, 0.16, 0.08, 0.43), control2: point(0.20, 0.0, 0.28, 0.28))
        path.addCurve(to: point(0.95, 0.5, 1.0, 0.68), control1: point(0.80, 0.0, 0.72, 0.28), control2: point(0.95, 0.16, 0.92, 0.43))
        path.addCurve(to: point(0.5, 1.0, 0.5, 0.48), control1: point(0.95, 0.84, 0.96, 0.87), control2: point(0.80, 1.0, 0.72, 0.48))
        path.addCurve(to: point(0.05, 0.5, 0.0, 0.68), control1: point(0.20, 1.0, 0.28, 0.48), control2: point(0.05, 0.84, 0.04, 0.87))
        path.closeSubpath()
        return path
    }
}

/// Mouth per the shared reference path: lip shape ↔ oval, both as four cubic segments.
/// The rect is the whole canvas (S × S) centred on the mouth.
struct MascotMouthShape: Shape {
    var width: Double
    var open: Double
    var smile: Double
    var round: Double

    var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>> {
        get { AnimatablePair(AnimatablePair(width, open), AnimatablePair(smile, round)) }
        set {
            width = newValue.first.first
            open = newValue.first.second
            smile = newValue.second.first
            round = newValue.second.second
        }
    }

    func path(in rect: CGRect) -> Path {
        MascotMouthGeometry.path(width: width, open: open, smile: smile, round: round,
                                 side: Double(min(rect.width, rect.height)),
                                 center: CGPoint(x: rect.midX, y: rect.midY))
    }
}

/// Pink tongue: an ellipse in the lower 35 % of the opening (clipped by the mouth).
struct MascotTongueShape: Shape {
    var width: Double
    var open: Double
    var smile: Double
    var round: Double

    func path(in rect: CGRect) -> Path {
        let mouth = MascotMouthGeometry.path(width: width, open: open, smile: smile, round: round,
                                             side: Double(min(rect.width, rect.height)),
                                             center: CGPoint(x: rect.midX, y: rect.midY))
        let box = mouth.boundingRect
        guard box.width > 0.5 && box.height > 0.5 else { return Path() }
        let tongue = CGRect(x: box.minX + box.width * 0.14,
                            y: box.maxY - box.height * 0.35,
                            width: box.width * 0.72,
                            height: box.height * 0.6)
        return Path(ellipseIn: tongue)
    }
}

enum MascotMouthGeometry {
    struct Point {
        var x: Double
        var y: Double
    }

    struct Cubic {
        var p0: Point
        var c1: Point
        var c2: Point
        var p3: Point
    }

    /// W = w·S; cy = −0.26·s·W; t = 0.09·W; u = 0.16·s·W − 0.22·o·W;
    /// l = u + t + 1.05·o·W + 0.22·max(0, s)·W; oval: centre (0, 0.15·o·W),
    /// rx = 0.30·W, ry = 0.30·W·(0.55 + 0.9·o); final = lerp(lip, oval, r).
    static func path(width: Double, open: Double, smile: Double, round: Double, side: Double, center: CGPoint) -> Path {
        let w = max(0, width) * side
        let o = min(1, max(0, open))
        let s = min(1, max(-1, smile))
        let r = min(1, max(0, round))
        let cy = -0.26 * s * w
        let thickness = 0.09 * w
        let u = 0.16 * s * w - 0.22 * o * w
        let l = u + thickness + 1.05 * o * w + 0.22 * max(0, s) * w
        let upper = Cubic(p0: Point(x: -w / 2, y: cy), c1: Point(x: -w / 4, y: cy + u),
                          c2: Point(x: w / 4, y: cy + u), p3: Point(x: w / 2, y: cy))
        let lower = Cubic(p0: Point(x: w / 2, y: cy), c1: Point(x: w / 4, y: cy + l),
                          c2: Point(x: -w / 4, y: cy + l), p3: Point(x: -w / 2, y: cy))
        let upperHalves = split(upper)
        let lowerHalves = split(lower)

        let ovalY = 0.15 * o * w
        let rx = 0.30 * w
        let ry = 0.30 * w * (0.55 + 0.9 * o)
        let k = 0.5523
        let left = Point(x: -rx, y: ovalY)
        let top = Point(x: 0, y: ovalY - ry)
        let right = Point(x: rx, y: ovalY)
        let bottom = Point(x: 0, y: ovalY + ry)
        let oval1 = Cubic(p0: left, c1: Point(x: -rx, y: ovalY - k * ry), c2: Point(x: -k * rx, y: ovalY - ry), p3: top)
        let oval2 = Cubic(p0: top, c1: Point(x: k * rx, y: ovalY - ry), c2: Point(x: rx, y: ovalY - k * ry), p3: right)
        let oval3 = Cubic(p0: right, c1: Point(x: rx, y: ovalY + k * ry), c2: Point(x: k * rx, y: ovalY + ry), p3: bottom)
        let oval4 = Cubic(p0: bottom, c1: Point(x: -k * rx, y: ovalY + ry), c2: Point(x: -rx, y: ovalY + k * ry), p3: left)

        let first = mix(upperHalves.0, oval1, r)
        let second = mix(upperHalves.1, oval2, r)
        let third = mix(lowerHalves.0, oval3, r)
        let fourth = mix(lowerHalves.1, oval4, r)

        let originX = Double(center.x)
        let originY = Double(center.y)
        func cg(_ point: Point) -> CGPoint {
            CGPoint(x: originX + point.x, y: originY + point.y)
        }
        var path = Path()
        path.move(to: cg(first.p0))
        path.addCurve(to: cg(first.p3), control1: cg(first.c1), control2: cg(first.c2))
        path.addCurve(to: cg(second.p3), control1: cg(second.c1), control2: cg(second.c2))
        path.addCurve(to: cg(third.p3), control1: cg(third.c1), control2: cg(third.c2))
        path.addCurve(to: cg(fourth.p3), control1: cg(fourth.c1), control2: cg(fourth.c2))
        path.closeSubpath()
        return path
    }

    private static func mix(_ a: Point, _ b: Point, _ t: Double) -> Point {
        Point(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }

    private static func mix(_ a: Cubic, _ b: Cubic, _ t: Double) -> Cubic {
        Cubic(p0: mix(a.p0, b.p0, t), c1: mix(a.c1, b.c1, t), c2: mix(a.c2, b.c2, t), p3: mix(a.p3, b.p3, t))
    }

    /// de Casteljau split at t = 0.5.
    private static func split(_ curve: Cubic) -> (Cubic, Cubic) {
        let m01 = mix(curve.p0, curve.c1, 0.5)
        let m12 = mix(curve.c1, curve.c2, 0.5)
        let m23 = mix(curve.c2, curve.p3, 0.5)
        let m012 = mix(m01, m12, 0.5)
        let m123 = mix(m12, m23, 0.5)
        let middle = mix(m012, m123, 0.5)
        return (Cubic(p0: curve.p0, c1: m01, c2: m012, p3: middle),
                Cubic(p0: middle, c1: m123, c2: m23, p3: curve.p3))
    }
}

struct MascotHeartShape: Shape {
    func path(in rect: CGRect) -> Path {
        let x = rect.minX
        let y = rect.minY
        let w = rect.width
        let h = rect.height
        var path = Path()
        path.move(to: CGPoint(x: x + 0.5 * w, y: y + 0.96 * h))
        path.addCurve(to: CGPoint(x: x + 0.02 * w, y: y + 0.34 * h),
                      control1: CGPoint(x: x + 0.30 * w, y: y + 0.80 * h),
                      control2: CGPoint(x: x + 0.02 * w, y: y + 0.60 * h))
        path.addCurve(to: CGPoint(x: x + 0.5 * w, y: y + 0.22 * h),
                      control1: CGPoint(x: x + 0.02 * w, y: y + 0.04 * h),
                      control2: CGPoint(x: x + 0.40 * w, y: y))
        path.addCurve(to: CGPoint(x: x + 0.98 * w, y: y + 0.34 * h),
                      control1: CGPoint(x: x + 0.60 * w, y: y),
                      control2: CGPoint(x: x + 0.98 * w, y: y + 0.04 * h))
        path.addCurve(to: CGPoint(x: x + 0.5 * w, y: y + 0.96 * h),
                      control1: CGPoint(x: x + 0.98 * w, y: y + 0.60 * h),
                      control2: CGPoint(x: x + 0.70 * w, y: y + 0.80 * h))
        path.closeSubpath()
        return path
    }
}

struct MascotStarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let centerX = Double(rect.midX)
        let centerY = Double(rect.midY)
        let outer = Double(min(rect.width, rect.height)) * 0.5
        let inner = outer * 0.48
        var path = Path()
        for index in 0..<10 {
            let radius = index % 2 == 0 ? outer : inner
            let angle = -Double.pi / 2 + Double(index) * Double.pi / 5
            let point = CGPoint(x: centerX + radius * cos(angle), y: centerY + radius * sin(angle))
            if index == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        path.closeSubpath()
        return path
    }
}

struct MascotSpiralShape: Shape {
    func path(in rect: CGRect) -> Path {
        let centerX = Double(rect.midX)
        let centerY = Double(rect.midY)
        let maxRadius = Double(min(rect.width, rect.height)) * 0.5
        let turns = 2.3
        let steps = 64
        var path = Path()
        for step in 0...steps {
            let progress = Double(step) / Double(steps)
            let angle = progress * turns * 2 * Double.pi
            let radius = maxRadius * (0.08 + 0.92 * progress)
            let point = CGPoint(x: centerX + radius * cos(angle), y: centerY + radius * sin(angle))
            if step == 0 {
                path.move(to: point)
            } else {
                path.addLine(to: point)
            }
        }
        return path
    }
}

struct MascotCrossShape: Shape {
    func path(in rect: CGRect) -> Path {
        let inset = min(rect.width, rect.height) * 0.12
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + inset, y: rect.minY + inset))
        path.addLine(to: CGPoint(x: rect.maxX - inset, y: rect.maxY - inset))
        path.move(to: CGPoint(x: rect.maxX - inset, y: rect.minY + inset))
        path.addLine(to: CGPoint(x: rect.minX + inset, y: rect.maxY - inset))
        return path
    }
}

/// Thin arc ‿ (sleep, wink).
struct MascotClosedEyeShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + rect.height * 0.25))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.25),
                          control: CGPoint(x: rect.midX, y: rect.maxY + rect.height * 0.35))
        return path
    }
}

/// `>` for the left eye and `<` for the right eye (>_< squeeze).
struct MascotCaretShape: Shape {
    var pointsRight: Bool

    func path(in rect: CGRect) -> Path {
        let tipX = pointsRight ? rect.maxX : rect.minX
        let baseX = pointsRight ? rect.minX : rect.maxX
        var path = Path()
        path.move(to: CGPoint(x: baseX, y: rect.minY))
        path.addLine(to: CGPoint(x: tipX, y: rect.midY))
        path.addLine(to: CGPoint(x: baseX, y: rect.maxY))
        return path
    }
}
