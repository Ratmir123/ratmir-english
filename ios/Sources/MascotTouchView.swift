import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// Raw touch events in canvas coordinates (square canvas of side S centred in the view).
enum MascotTouchEvent {
    case began(CGPoint, CGFloat)
    case moved(CGPoint, CGFloat)
    /// Last parameter: a quick tap (short and nearly still), used by the static pose.
    case ended(CGPoint, CGFloat, Bool)
    case cancelled
}

/// Square canvas inside a possibly non-square view, plus the touchable body area.
struct MascotTouchGeometry {
    let side: CGFloat
    let originX: CGFloat
    let originY: CGFloat

    init(bounds: CGRect) {
        let length = max(1, min(bounds.width, bounds.height))
        side = length
        originX = bounds.minX + (bounds.width - length) / 2
        originY = bounds.minY + (bounds.height - length) / 2
    }

    func canvasPoint(_ location: CGPoint) -> CGPoint {
        CGPoint(x: location.x - originX, y: location.y - originY)
    }

    /// Body radius R0 (0.78 of the half canvas) with a generous margin for fingers.
    func isOnBody(_ point: CGPoint) -> Bool {
        let dx = point.x - side / 2
        let dy = point.y - side / 2
        let radius = side * 0.5 * 0.78 * 1.25
        return dx * dx + dy * dy <= radius * radius
    }
}

/// Transparent overlay that feeds touches to the physics without blocking scrolling:
/// the recognizer never cancels touches and recognizes simultaneously with everything.
struct MascotTouchLayer: UIViewRepresentable {
    let handler: (MascotTouchEvent) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(handler: handler)
    }

    func makeUIView(context: Context) -> MascotTouchSurface {
        let surface = MascotTouchSurface()
        surface.backgroundColor = .clear
        surface.isOpaque = false
        surface.isMultipleTouchEnabled = false
        surface.isAccessibilityElement = false
        surface.accessibilityElementsHidden = true
        let recognizer = MascotTouchRecognizer(target: nil, action: nil)
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.delegate = context.coordinator
        let coordinator = context.coordinator
        recognizer.onEvent = { [weak coordinator] event in
            coordinator?.handler(event)
        }
        surface.addGestureRecognizer(recognizer)
        return surface
    }

    func updateUIView(_ uiView: MascotTouchSurface, context: Context) {
        context.coordinator.handler = handler
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var handler: (MascotTouchEvent) -> Void

        init(handler: @escaping (MascotTouchEvent) -> Void) {
            self.handler = handler
            super.init()
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            true
        }
    }
}

/// Hit-tests only the round body, so taps on the canvas corners reach whatever is behind.
final class MascotTouchSurface: UIView {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let geometry = MascotTouchGeometry(bounds: bounds)
        return geometry.isOnBody(geometry.canvasPoint(point))
    }
}

/// Reports one finger as began / changed / ended / cancelled. Extra fingers are ignored.
final class MascotTouchRecognizer: UIGestureRecognizer {
    var onEvent: ((MascotTouchEvent) -> Void)?
    private var trackedID: ObjectIdentifier?
    private var startPoint = CGPoint.zero
    private var startTimestamp: TimeInterval = 0
    private var travelled: CGFloat = 0

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard trackedID == nil, let touch = touches.first, let host = view else {
            for extra in touches {
                ignore(extra, for: event)
            }
            return
        }
        for extra in touches where extra !== touch {
            ignore(extra, for: event)
        }
        let geometry = MascotTouchGeometry(bounds: host.bounds)
        let point = geometry.canvasPoint(touch.location(in: host))
        guard geometry.isOnBody(point) else {
            state = .failed
            return
        }
        trackedID = ObjectIdentifier(touch)
        startPoint = point
        startTimestamp = touch.timestamp
        travelled = 0
        state = .began
        onEvent?(.began(point, geometry.side))
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard let touch = tracked(in: touches), let host = view else { return }
        let geometry = MascotTouchGeometry(bounds: host.bounds)
        let point = geometry.canvasPoint(touch.location(in: host))
        let dx = point.x - startPoint.x
        let dy = point.y - startPoint.y
        travelled = max(travelled, (dx * dx + dy * dy).squareRoot())
        state = .changed
        onEvent?(.moved(point, geometry.side))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        guard let touch = tracked(in: touches), let host = view else { return }
        let geometry = MascotTouchGeometry(bounds: host.bounds)
        let point = geometry.canvasPoint(touch.location(in: host))
        let quick = touch.timestamp - startTimestamp < 0.3 && travelled < 10
        trackedID = nil
        state = .ended
        onEvent?(.ended(point, geometry.side, quick))
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        guard tracked(in: touches) != nil else { return }
        trackedID = nil
        state = .cancelled
        onEvent?(.cancelled)
    }

    override func reset() {
        super.reset()
        if trackedID != nil {
            // The system ended recognition without delivering the end of our touch.
            trackedID = nil
            onEvent?(.cancelled)
        }
        travelled = 0
    }

    private func tracked(in touches: Set<UITouch>) -> UITouch? {
        guard let identifier = trackedID else { return nil }
        return touches.first { ObjectIdentifier($0) == identifier }
    }
}
