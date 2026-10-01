import AppKit
import Foundation

let output = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(srgbRed: 218.0 / 255, green: 241.0 / 255, blue: 99.0 / 255, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1024, height: 1024)).fill()
let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 580, weight: .semibold),
    .foregroundColor: NSColor(srgbRed: 34.0 / 255, green: 33.0 / 255, blue: 36.0 / 255, alpha: 1)
]
NSString(string: "R·").draw(at: NSPoint(x: 160, y: 160), withAttributes: attributes)
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Icon generation failed") }
try png.write(to: URL(fileURLWithPath: output))
