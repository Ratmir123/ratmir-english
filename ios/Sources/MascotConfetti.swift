import SwiftUI

/// One confetti piece. Positions are computed analytically from time (no per-frame state).
struct MascotConfettiParticle {
    var velocityX: Double
    var velocityY: Double
    var spin: Double
    var angle: Double
    var size: Double
    var aspect: Double
    var colour: Int
    var delay: Double
    var sway: Double
}

/// Celebration burst: lime / lavender / cyan / pink, 120 particles, 1.6 s (DESIGN-SYSTEM §2).
/// Overlay it on a large container and increment `trigger` together with the mascot's
/// `celebrate` counter. Reduce Motion shows a brief static sparkle instead.
struct MascotConfetti: View {
    let trigger: Int
    var origin: UnitPoint

    @State private var particles: [MascotConfettiParticle] = []
    @State private var startedAt: Date? = nil
    @State private var burst = 0
    @State private var sparkleVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(trigger: Int, origin: UnitPoint = UnitPoint(x: 0.5, y: 0.32)) {
        self.trigger = trigger
        self.origin = origin
    }

    var body: some View {
        ZStack {
            if reduceMotion {
                sparkle
            } else if let startedAt {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { context in
                    confettiCanvas(elapsed: context.date.timeIntervalSince(startedAt))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: trigger) { oldValue, newValue in
            guard newValue > oldValue else { return }
            if reduceMotion {
                sparkleVisible = true
            } else {
                particles = MascotConfettiPainter.makeParticles(count: 120)
                startedAt = Date()
            }
            burst += 1
        }
        .task(id: burst) {
            guard burst > 0 else { return }
            do { try await Task.sleep(for: .milliseconds(1700)) } catch { return }
            startedAt = nil
            particles = []
            sparkleVisible = false
        }
    }

    private func confettiCanvas(elapsed: Double) -> some View {
        let items = particles
        let anchor = origin
        return Canvas { graphics, size in
            MascotConfettiPainter.draw(in: graphics, size: size, particles: items, elapsed: elapsed, origin: anchor)
        }
    }

    private var sparkle: some View {
        GeometryReader { proxy in
            Image(systemName: "sparkles")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(MascotPalette.violet)
                .position(x: proxy.size.width * origin.x, y: proxy.size.height * origin.y)
                .opacity(sparkleVisible ? 1 : 0)
                .animation(.easeInOut(duration: 0.25), value: sparkleVisible)
        }
    }
}

extension View {
    /// Confetti burst over this view whenever `trigger` increases.
    func mascotConfetti(trigger: Int, origin: UnitPoint = UnitPoint(x: 0.5, y: 0.32)) -> some View {
        overlay {
            MascotConfetti(trigger: trigger, origin: origin)
        }
    }
}

enum MascotConfettiPainter {
    static let duration = 1.6

    static func makeParticles(count: Int) -> [MascotConfettiParticle] {
        var result: [MascotConfettiParticle] = []
        result.reserveCapacity(count)
        for index in 0..<count {
            // Upward fan, slightly wider than a half circle so pieces also drift sideways.
            let direction = Double.random(in: (-Double.pi * 0.94)...(-Double.pi * 0.06))
            let speed = Double.random(in: 380...860)
            let particle = MascotConfettiParticle(
                velocityX: cos(direction) * speed,
                velocityY: sin(direction) * speed,
                spin: Double.random(in: -9...9),
                angle: Double.random(in: 0...(2 * Double.pi)),
                size: Double.random(in: 5...9),
                aspect: Double.random(in: 0.45...1.6),
                colour: index % 4,
                delay: Double.random(in: 0...0.08),
                sway: Double.random(in: 0...14)
            )
            result.append(particle)
        }
        return result
    }

    static func draw(in context: GraphicsContext, size: CGSize, particles: [MascotConfettiParticle],
                     elapsed: Double, origin: UnitPoint) {
        guard elapsed >= 0 && elapsed <= duration else { return }
        let fade = elapsed > duration - 0.45 ? max(0, (duration - elapsed) / 0.45) : 1
        let startX = Double(size.width) * Double(origin.x)
        let startY = Double(size.height) * Double(origin.y)
        let drag = 1.9
        let gravity = 520.0
        for particle in particles {
            let t = max(0, elapsed - particle.delay)
            let travel = (1 - exp(-drag * t)) / drag
            let x = startX + particle.velocityX * travel + particle.sway * sin(particle.angle + 7 * t)
            let y = startY + particle.velocityY * travel + 0.5 * gravity * t * t
            let width = CGFloat(particle.size)
            let height = CGFloat(particle.size * particle.aspect)
            var piece = context
            piece.opacity = fade
            piece.translateBy(x: CGFloat(x), y: CGFloat(y))
            piece.rotate(by: .radians(particle.angle + particle.spin * t))
            let rect = CGRect(x: -width / 2, y: -height / 2, width: width, height: height)
            piece.fill(Path(roundedRect: rect, cornerRadius: min(width, height) * 0.3), with: .color(colour(particle.colour)))
        }
    }

    static func colour(_ index: Int) -> Color {
        switch abs(index) % 4 {
        case 0: return MascotPalette.lime
        case 1: return MascotPalette.lavender
        case 2: return MascotPalette.cyan
        default: return MascotPalette.pink
        }
    }
}
