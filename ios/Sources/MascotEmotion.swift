import SwiftUI

/// Every expression the mascot can show (planning/v05/MASCOT-SPEC.md §5).
/// The PC renderer uses the same table, so both platforms show the same face.
enum MascotEmotion: CaseIterable {
    case calm, happy, joy, laugh, excited, love, proud, surprised, curious, thinking
    case listening, speaking, sad, sleepy, dizzy, shy, annoyed, determined, wink, squeeze
}

/// Special eye shapes cross-fade (0.12 s); pill, smile and squint always morph geometrically.
enum MascotEyeKind {
    case pill, heart, spiral, star, cross, closed, caret
}

/// Linear RGB triple passed to the shader as three floats.
struct MascotRGB {
    var r: Double
    var g: Double
    var b: Double

    static let base = MascotRGB(r: 0.24, g: 0.86, b: 0.96)
    static let lime = MascotRGB(r: 218.0 / 255.0, g: 241.0 / 255.0, b: 99.0 / 255.0)
    static let pink = MascotRGB(r: 1.0, g: 143.0 / 255.0, b: 177.0 / 255.0)
    static let blue = MascotRGB(r: 59.0 / 255.0, g: 91.0 / 255.0, b: 219.0 / 255.0)
    static let violet = MascotRGB(r: 123.0 / 255.0, g: 108.0 / 255.0, b: 246.0 / 255.0)
    static let cyan = MascotRGB(r: 63.0 / 255.0, g: 213.0 / 255.0, b: 234.0 / 255.0)
}

/// Fixed colours of the face and of celebrations (identical in light and dark themes; PC: lib/mascot/palette.ts).
enum MascotPalette {
    static let eyeWhite = Color(red: 253.0 / 255.0, green: 254.0 / 255.0, blue: 1.0)
    /// Soft emissive halo around eyes and mouth (#E9E4FF at 55 %).
    static let faceGlow = Color(red: 233.0 / 255.0, green: 228.0 / 255.0, blue: 1.0).opacity(0.55)
    /// Open mouth on the deep opal core (#0E0A22 at 95 %).
    static let mouthInterior = Color(red: 14.0 / 255.0, green: 10.0 / 255.0, blue: 34.0 / 255.0)
    static let pink = Color(red: 1.0, green: 143.0 / 255.0, blue: 177.0 / 255.0)
    static let lime = Color(red: 218.0 / 255.0, green: 241.0 / 255.0, blue: 99.0 / 255.0)
    static let lavender = Color(red: 187.0 / 255.0, green: 178.0 / 255.0, blue: 245.0 / 255.0)
    static let cyan = Color(red: 63.0 / 255.0, green: 213.0 / 255.0, blue: 234.0 / 255.0)
    static let violet = Color(red: 123.0 / 255.0, green: 108.0 / 255.0, blue: 246.0 / 255.0)
}

/// Target face for one emotion. Eye values are per eye where the spec differs per eye.
struct MascotFaceTarget {
    var openL: Double
    var openR: Double
    var smileL: Double
    var smileR: Double
    var squint: Double
    var shapeL: MascotEyeKind
    var shapeR: MascotEyeKind
    var tiltL: Double
    var tiltR: Double
    var gazeX: Double
    var gazeY: Double
    var wide: Double
    var mouthW: Double
    var mouthO: Double
    var mouthS: Double
    var mouthR: Double
    var mouthDX: Double
    var blush: Double
    var tint: MascotRGB
    var tintAmount: Double

    init(open: Double, openR: Double? = nil, smile: Double = 0, squint: Double = 0,
         shape: MascotEyeKind = .pill, shapeR: MascotEyeKind? = nil,
         tiltL: Double = 0, tiltR: Double = 0, gazeX: Double = 0, gazeY: Double = 0, wide: Double = 1,
         w: Double, o: Double, s: Double, r: Double, mouthDX: Double = 0,
         blush: Double = 0, tint: MascotRGB = .base, tintAmount: Double = 0) {
        self.openL = open
        self.openR = openR ?? open
        self.smileL = smile
        self.smileR = smile
        self.squint = squint
        self.shapeL = shape
        self.shapeR = shapeR ?? shape
        self.tiltL = tiltL
        self.tiltR = tiltR
        self.gazeX = gazeX
        self.gazeY = gazeY
        self.wide = wide
        self.mouthW = w
        self.mouthO = o
        self.mouthS = s
        self.mouthR = r
        self.mouthDX = mouthDX
        self.blush = blush
        self.tint = tint
        self.tintAmount = tintAmount
    }
}

extension MascotEmotion {
    /// MASCOT-SPEC §5: eyes (open / smile / squint / shape), mouth (w / o / s / r), blush, tint.
    var faceTarget: MascotFaceTarget {
        switch self {
        case .calm:
            return MascotFaceTarget(open: 1.0, w: 0.07, o: 0, s: 0.35, r: 0)
        case .happy:
            return MascotFaceTarget(open: 1.0, smile: 0.55, w: 0.10, o: 0.12, s: 0.85, r: 0,
                                    blush: 0.15, tint: .lime, tintAmount: 0.10)
        case .joy:
            return MascotFaceTarget(open: 0.9, smile: 1.0, w: 0.13, o: 0.55, s: 1.0, r: 0,
                                    blush: 0.30, tint: .lime, tintAmount: 0.18)
        case .laugh:
            return MascotFaceTarget(open: 0.25, smile: 1.0, w: 0.15, o: 0.85, s: 1.0, r: 0,
                                    blush: 0.45, tint: .lime, tintAmount: 0.15)
        case .excited:
            return MascotFaceTarget(open: 1.2, smile: 0.25, shape: .star, w: 0.12, o: 0.6, s: 0.9, r: 0.2,
                                    blush: 0.25, tint: .lime, tintAmount: 0.22)
        case .love:
            return MascotFaceTarget(open: 1.0, shape: .heart, w: 0.09, o: 0.18, s: 0.9, r: 0,
                                    blush: 0.6, tint: .pink, tintAmount: 0.22)
        case .proud:
            return MascotFaceTarget(open: 0.65, smile: 0.85, w: 0.11, o: 0, s: 0.95, r: 0,
                                    blush: 0.2, tint: .lime, tintAmount: 0.12)
        case .surprised:
            return MascotFaceTarget(open: 1.35, wide: 1.15, w: 0.06, o: 0.8, s: 0, r: 1)
        case .curious:
            return MascotFaceTarget(open: 1.1, openR: 0.72, tiltL: -9, tiltR: 10, w: 0.06, o: 0.05, s: 0.2, r: 0.35)
        case .thinking:
            return MascotFaceTarget(open: 0.85, squint: 0.2, gazeX: -0.6, gazeY: -0.7, w: 0.06, o: 0, s: 0, r: 0,
                                    mouthDX: 0.03, tint: .violet, tintAmount: 0.15)
        case .listening:
            return MascotFaceTarget(open: 1.15, w: 0.06, o: 0, s: 0.3, r: 0, tint: .cyan, tintAmount: 0.10)
        case .speaking:
            // `o` is replaced by the speech envelope while lip-sync runs (0.08 + 0.85 * envelope).
            return MascotFaceTarget(open: 1.0, smile: 0.2, w: 0.10, o: 0.08, s: 0.4, r: 0.2)
        case .sad:
            return MascotFaceTarget(open: 0.75, tiltL: 12, tiltR: -12, w: 0.08, o: 0.05, s: -0.6, r: 0,
                                    tint: .blue, tintAmount: 0.12)
        case .sleepy:
            return MascotFaceTarget(open: 0.12, shape: .closed, w: 0.05, o: 0.12, s: 0, r: 0.6)
        case .dizzy:
            return MascotFaceTarget(open: 1.0, shape: .spiral, w: 0.10, o: 0.3, s: -0.2, r: 0)
        case .shy:
            return MascotFaceTarget(open: 0.8, smile: 0.3, gazeX: 0.5, gazeY: 0.5, w: 0.06, o: 0, s: 0.5, r: 0,
                                    blush: 0.7, tint: .pink, tintAmount: 0.15)
        case .annoyed:
            return MascotFaceTarget(open: 0.55, squint: 0.6, w: 0.08, o: 0, s: -0.25, r: 0)
        case .determined:
            return MascotFaceTarget(open: 0.8, squint: 0.35, w: 0.09, o: 0, s: 0.1, r: 0)
        case .wink:
            return MascotFaceTarget(open: 1.0, smile: 0.5, shapeR: .closed, w: 0.10, o: 0.1, s: 0.8, r: 0,
                                    blush: 0.2)
        case .squeeze:
            return MascotFaceTarget(open: 1.0, shape: .caret, w: 0.07, o: 0.3, s: -0.3, r: 0, blush: 0.3)
        }
    }

    /// Tap reactions cycle: wink → giggle → happy → surprised → curious → wink…
    static let tapCycleLength = 5

    static func tapReaction(at index: Int) -> (emotion: MascotEmotion, duration: Double) {
        switch abs(index) % 5 {
        case 0: return (.wink, 0.75)
        case 1: return (.laugh, 0.6)
        case 2: return (.happy, 0.9)
        case 3: return (.surprised, 0.6)
        default: return (.curious, 1.0)
        }
    }

    /// PASS 0.5.3 §4: a tilt is never a held lean but a gentle roll around 0 (the same table as lib/mascot/emotions.ts).
    /// Fast shakes (laugh, the first second of excited, annoyed) and the drag lean are not rolls.
    var roll: MascotRoll? {
        switch self {
        case .curious: return MascotRoll(amplitude: 6, period: 4.2)
        case .wink: return MascotRoll(amplitude: 4.5, period: 3.8)
        case .shy: return MascotRoll(amplitude: 4, period: 4.6)
        case .proud: return MascotRoll(amplitude: 3, period: 5.2)
        // Thinking keeps its slow sway (4.5° · sin(0.91 t), ≈ 6.9 s).
        case .thinking: return MascotRoll(amplitude: 4.5, period: 6.9)
        case .happy, .joy: return MascotRoll(amplitude: 2.5, period: 3.4)
        default: return nil
        }
    }
}

/// A roll: `sign · amplitude · sin(2π · t / period)` from the moment the emotion starts, so it begins upright, swings to
/// both sides by the same amount and is centred on 0. The sign is random per entry; tap reactions alternate it.
struct MascotRoll: Equatable {
    /// Degrees.
    let amplitude: Double
    /// Seconds per full side-to-side cycle.
    let period: Double

    func angle(elapsed: Double, sign: Double) -> Double {
        guard elapsed.isFinite, elapsed > 0, period > 0 else { return 0 }
        return (sign < 0 ? -1 : 1) * amplitude * sin(2 * Double.pi * elapsed / period)
    }
}

extension MascotEmotion {
    /// App state → context emotion. Legacy moods keep their meaning; a busy mode
    /// (listening / speaking / thinking) wins over neutral legacy flavours so the
    /// existing session screen gets lip-sync and the thinking face without changes.
    static func context(mode: VoiceOrbMode, mood: VoiceOrbMood?) -> MascotEmotion {
        guard let mood else {
            switch mode {
            case .ready: return .calm
            case .listening: return .listening
            case .speaking: return .speaking
            case .thinking: return .thinking
            }
        }
        switch mode {
        case .ready:
            return mood.mascotEmotion
        case .listening:
            switch mood {
            case .calm, .attentive, .curious, .listening: return .listening
            default: return mood.mascotEmotion
            }
        case .speaking:
            switch mood {
            case .calm, .friendly, .happy, .speaking: return .speaking
            default: return mood.mascotEmotion
            }
        case .thinking:
            switch mood {
            case .calm, .curious, .thinking: return .thinking
            default: return mood.mascotEmotion
            }
        }
    }
}

extension VoiceOrbMood {
    /// Legacy cases: attentive → listening face, friendly → happy, pleased → proud, supportive → sad.
    var mascotEmotion: MascotEmotion {
        switch self {
        case .calm: return .calm
        case .attentive: return .listening
        case .curious: return .curious
        case .friendly: return .happy
        case .pleased: return .proud
        case .supportive: return .sad
        case .happy: return .happy
        case .joy: return .joy
        case .laugh: return .laugh
        case .excited: return .excited
        case .love: return .love
        case .proud: return .proud
        case .surprised: return .surprised
        case .thinking: return .thinking
        case .listening: return .listening
        case .speaking: return .speaking
        case .sad: return .sad
        case .sleepy: return .sleepy
        case .dizzy: return .dizzy
        case .shy: return .shy
        case .annoyed: return .annoyed
        case .determined: return .determined
        case .wink: return .wink
        case .squeeze: return .squeeze
        }
    }
}
