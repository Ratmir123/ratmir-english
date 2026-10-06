import SwiftUI

// MARK: - Floor shadow (planning/v05/DESIGN-PASS-0.5.1.md «Тень маскота — физика»)
// Light from above-front; the floor is the body's rest bottom. Two layers: a tight contact shadow that
// vanishes quickly with height and a soft ambient one that fades slowly. Every number is identical to
// lib/mascot/shadow.ts on the PC.

struct MascotShadowStop {
    let location: Double
    /// Multiplies the theme's peak alpha of the layer.
    let alpha: Double
}

struct MascotShadowLayerTuning {
    /// Base box, ·S.
    let width: Double
    let height: Double
    /// Shift toward the lean: ·S·sin(rotation).
    let lean: Double
    /// Size 1/(1 + shrink·lift); opacity 1/(1 + fade·lift)²; lift = height above the floor, ·S.
    let shrink: Double
    let fade: Double
    /// Widening (x) and deepening (y) per unit of positive squash q.
    let squash: Double
    let depth: Double
    /// Widening when pushed into the floor (press 0–1).
    let press: Double
    /// Opacity at rest; squash and press darken up to 1.
    let rest: Double
    let darken: Double
    let pressDarken: Double
    /// Blur ·S in the layer's own (unscaled) space: (blur + blurLift·lift)·(1 − tighten·press).
    let blur: Double
    let blurLift: Double
    let tighten: Double
    /// Ink gradient, centre → edge of the box ellipse.
    let stops: [MascotShadowStop]
}

/// Neutral ink from the background and peak alphas per theme (layer opacity multiplies them).
struct MascotShadowPalette {
    let ink: MascotRGB
    let contact: Double
    let ambient: Double
    let caustic: Double
    /// Light pool in front of the body (0 = none).
    let pool: Double
}

enum MascotShadowTuning {
    /// Floor line, ·S from the canvas top: rest bottom of the body (0.5 + R0/2 = 0.89).
    static let floorY = 0.5 + MascotTuning.bodyRadius / 2
    /// Downward offset (·S) that presses the contact fully into the floor.
    static let pressSpan = 0.12
    /// A tilted body's lowest point dips below its rest bottom by ≈ tiltDip·S·sin²(rotation).
    static let tiltDip = 0.27
    static let squashLimit = 0.35
    static let contact = MascotShadowLayerTuning(
        width: 0.44, height: 0.065, lean: 0.3, shrink: 3, fade: 9, squash: 0.8, depth: 0.4, press: 0.12,
        rest: 0.75, darken: 1, pressDarken: 0.25, blur: 0.01, blurLift: 0.12, tighten: 0.5,
        stops: [MascotShadowStop(location: 0, alpha: 1), MascotShadowStop(location: 0.5, alpha: 0.62),
                MascotShadowStop(location: 1, alpha: 0)])
    static let ambient = MascotShadowLayerTuning(
        width: 0.68, height: 0.13, lean: 0.12, shrink: 1.2, fade: 1.4, squash: 0.25, depth: 0, press: 0,
        rest: 0.9, darken: 0.3, pressDarken: 0, blur: 0.025, blurLift: 0.2, tighten: 0,
        stops: [MascotShadowStop(location: 0, alpha: 1), MascotShadowStop(location: 0.55, alpha: 0.42),
                MascotShadowStop(location: 1, alpha: 0)])
    /// Light focused by the glass body: a small lime → lavender spot inside the contact box
    /// (radii and centre are fractions of that box).
    static let causticRadiusX = 0.22
    static let causticRadiusY = 0.28
    static let causticCenterY = 0.56
    static let causticInner = MascotRGB(r: 218.0 / 255.0, g: 241.0 / 255.0, b: 99.0 / 255.0)
    static let causticOuter = MascotRGB(r: 187.0 / 255.0, g: 178.0 / 255.0, b: 245.0 / 255.0)
    /// Light pool: the glass focuses light onto the floor. A third layer riding the ambient pose (follows, spreads
    /// and fades with height); box ·S centred `poolOffsetY`·S in front of (below) the floor line. Dark pages only,
    /// where darkening alone is invisible.
    static let poolWidth = 0.62
    static let poolHeight = 0.15
    static let poolOffsetY = 0.04
    static let poolInner = MascotRGB(r: 218.0 / 255.0, g: 241.0 / 255.0, b: 99.0 / 255.0)
    static let poolOuter = MascotRGB(r: 187.0 / 255.0, g: 178.0 / 255.0, b: 245.0 / 255.0)
    static let poolStops = [MascotShadowStop(location: 0, alpha: 1), MascotShadowStop(location: 0.5, alpha: 0.45),
                            MascotShadowStop(location: 1, alpha: 0)]
    static let light = MascotShadowPalette(ink: MascotRGB(r: 30.0 / 255.0, g: 30.0 / 255.0, b: 58.0 / 255.0),
                                           contact: 0.42, ambient: 0.17, caustic: 0.1, pool: 0)
    static let dark = MascotShadowPalette(ink: MascotRGB(r: 0, g: 0, b: 4.0 / 255.0),
                                          contact: 0.82, ambient: 0.55, caustic: 0.13, pool: 0.3)
}

struct MascotShadowLayerPose {
    /// Horizontal centre offset from the canvas centre, pt.
    var x: Double = 0
    /// Relative to the base box.
    var scaleX: Double = 1
    var scaleY: Double = 1
    var opacity: Double = 0
    /// pt in the layer's own space (scaleEffect applies on top, like CSS filter + transform).
    var blur: Double = 0
}

/// Shadow for one frame. Height = upward body offset (drag up + hop, offsetY < 0): the shadow stays on the rest floor
/// and shrinks, fades and softens. Pushed down (offsetY > 0) the floor follows the body's lowest point (continuous at
/// 0), so the shadow is never hidden behind the body, and the contact tightens, widens and darkens.
struct MascotShadowPose {
    /// Floor line in pt from the canvas top: the rest floor, or the body's lowest point when it is pushed below it.
    var floorY: Double
    /// Height of the body above the floor, ·S.
    var lift: Double
    var contact: MascotShadowLayerPose
    var ambient: MascotShadowLayerPose

    init(x: Double, y: Double, rotation: Double, scaleX: Double, squash: Double, side: Double) {
        let s = side.isFinite && side > 0 ? side : 1
        let px = x.isFinite ? x : 0
        let py = y.isFinite ? y : 0
        let height = max(0, -py) / s
        let press = min(1, max(0, py / (MascotShadowTuning.pressSpan * s)))
        let flat = min(MascotShadowTuning.squashLimit, max(0, squash.isFinite ? squash : 0))
        let width = max(0.5, scaleX.isFinite ? scaleX : 1)
        let lean = sin((rotation.isFinite ? rotation : 0) * Double.pi / 180)
        floorY = MascotShadowTuning.floorY * s + max(0, py + MascotShadowTuning.tiltDip * s * lean * lean)
        lift = height
        contact = MascotShadowPose.layer(MascotShadowTuning.contact, x: px, lift: height, press: press,
                                         flat: flat, width: width, lean: lean, side: s)
        ambient = MascotShadowPose.layer(MascotShadowTuning.ambient, x: px, lift: height, press: press,
                                         flat: flat, width: width, lean: lean, side: s)
    }

    /// The shadow follows the body's sideways roll shift too (PASS 0.5.3 §4); a resting frame has none.
    init(frame: MascotFrame, side: CGFloat) {
        let roll = MascotRollTuning.offset(rotation: frame.rotation, side: Double(side))
        self.init(x: frame.offsetX + roll, y: frame.offsetY, rotation: frame.rotation, scaleX: frame.scaleX,
                  squash: frame.squash, side: Double(side))
    }

    private static func layer(_ tuning: MascotShadowLayerTuning, x: Double, lift: Double, press: Double, flat: Double,
                              width: Double, lean: Double, side: Double) -> MascotShadowLayerPose {
        let shrink = 1 / (1 + tuning.shrink * lift)
        let fall = 1 + tuning.fade * lift
        var pose = MascotShadowLayerPose()
        pose.x = x + tuning.lean * side * lean
        pose.scaleX = width * (1 + tuning.squash * flat) * (1 + tuning.press * press) * shrink
        pose.scaleY = (1 + tuning.depth * flat) * shrink
        pose.opacity = min(1, tuning.rest / (fall * fall) * (1 + tuning.darken * flat + tuning.pressDarken * press))
        pose.blur = side * (tuning.blur + tuning.blurLift * lift) * (1 - tuning.tighten * press)
        return pose
    }
}

/// A blur of `blur` pt (Gaussian σ, like CSS `filter: blur()` on the PC) over a soft elliptical gradient box of
/// `width` × `height` pt, without a blur pass (PASS 0.5.3 §5). The shadow stops fall off like a cone, whose σ is about
/// half its extent / √6, so the blurred extent grows in quadrature, √(w² + 24·blur²), and the peak dims by the area
/// ratio: the same amount of ink, spread wider.
struct MascotSoftEllipse: Equatable {
    let width: Double
    let height: Double
    /// Multiplies the layer opacity (1 without blur).
    let alpha: Double

    init(width: Double, height: Double, blur: Double) {
        let w = width.isFinite ? max(0.001, width) : 0.001
        let h = height.isFinite ? max(0.001, height) : 0.001
        let b = blur.isFinite ? max(0, blur) : 0
        let spread = 24 * b * b
        let grownW = (w * w + spread).squareRoot()
        let grownH = (h * h + spread).squareRoot()
        self.width = grownW
        self.height = grownH
        alpha = (w / grownW) * (h / grownH)
    }
}

/// Gradient stops of both layers for the current theme; `dark` (0…1, animated with the theme) blends the palettes.
/// `cached(dark:)` returns one shared fill per theme, so a frame never rebuilds the stops (PASS 0.5.3 §5).
struct MascotShadowFill {
    let contact: [Gradient.Stop]
    let caustic: [Gradient.Stop]
    let ambient: [Gradient.Stop]
    let pool: [Gradient.Stop]
    /// Peak alpha of the light pool (0 on light pages: the layer is skipped).
    let poolAlpha: Double

    private static let lightFill = MascotShadowFill(dark: 0)
    private static let darkFill = MascotShadowFill(dark: 1)

    /// The light or dark fill from the cache; only the 0.3 s theme cross-fade computes in-between stops.
    static func cached(dark: Double) -> MascotShadowFill {
        guard dark.isFinite, dark > 0.001 else { return lightFill }
        if dark >= 0.999 { return darkFill }
        return MascotShadowFill(dark: dark)
    }

    init(dark: Double) {
        let d = min(1, max(0, dark.isFinite ? dark : 0))
        let light = MascotShadowTuning.light
        let night = MascotShadowTuning.dark
        let ink = MascotRGB(r: MascotShadowFill.mix(light.ink.r, night.ink.r, d),
                            g: MascotShadowFill.mix(light.ink.g, night.ink.g, d),
                            b: MascotShadowFill.mix(light.ink.b, night.ink.b, d))
        contact = MascotShadowFill.stops(MascotShadowTuning.contact.stops, ink: ink,
                                         peak: MascotShadowFill.mix(light.contact, night.contact, d))
        ambient = MascotShadowFill.stops(MascotShadowTuning.ambient.stops, ink: ink,
                                         peak: MascotShadowFill.mix(light.ambient, night.ambient, d))
        let glow = MascotShadowFill.mix(light.caustic, night.caustic, d)
        caustic = [
            Gradient.Stop(color: MascotShadowFill.color(MascotShadowTuning.causticInner, glow), location: 0),
            Gradient.Stop(color: MascotShadowFill.color(MascotShadowTuning.causticOuter, glow * 0.5), location: 0.5),
            Gradient.Stop(color: MascotShadowFill.color(MascotShadowTuning.causticOuter, 0), location: 1),
        ]
        let poolPeak = MascotShadowFill.mix(light.pool, night.pool, d)
        poolAlpha = poolPeak
        pool = MascotShadowTuning.poolStops.enumerated().map { index, stop in
            Gradient.Stop(color: MascotShadowFill.color(index == 0 ? MascotShadowTuning.poolInner : MascotShadowTuning.poolOuter,
                                                        poolPeak * stop.alpha),
                          location: CGFloat(stop.location))
        }
    }

    private static func mix(_ a: Double, _ b: Double, _ t: Double) -> Double {
        a + (b - a) * t
    }

    private static func color(_ rgb: MascotRGB, _ alpha: Double) -> Color {
        Color(red: rgb.r, green: rgb.g, blue: rgb.b, opacity: alpha)
    }

    private static func stops(_ stops: [MascotShadowStop], ink: MascotRGB, peak: Double) -> [Gradient.Stop] {
        stops.map { Gradient.Stop(color: color(ink, peak * $0.alpha), location: CGFloat($0.location)) }
    }
}
