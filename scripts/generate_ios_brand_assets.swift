import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assetRoot = root.appendingPathComponent("ios/VerifierLabApp/VerifierLabApp/Assets.xcassets")
let appIconDir = assetRoot.appendingPathComponent("AppIcon.appiconset")
let appIconSpecs: [(String, Int)] = [
    ("AppIcon-20@2x.png", 40),
    ("AppIcon-20@3x.png", 60),
    ("AppIcon-29@2x.png", 58),
    ("AppIcon-29@3x.png", 87),
    ("AppIcon-40@2x.png", 80),
    ("AppIcon-40@3x.png", 120),
    ("AppIcon-60@2x.png", 120),
    ("AppIcon-60@3x.png", 180),
    ("AppIcon-1024.png", 1024),
]
let brandIconURLs: [(String, CGFloat)] = [
    ("BrandMark.imageset/BrandMark.png", 80),
    ("BrandMark.imageset/BrandMark@2x.png", 160),
    ("BrandMark.imageset/BrandMark@3x.png", 240),
]

func savePNG(_ bitmap: NSBitmapImageRep, to url: URL) throws {
    guard
        let pngData = bitmap.representation(using: .png, properties: [:])
    else {
        throw NSError(domain: "QRTrustIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not encode PNG"])
    }
    try pngData.write(to: url, options: .atomic)
}

func makeIcon(size: CGFloat, includeText: Bool) -> NSBitmapImageRep {
    let pixelSize = Int(size.rounded())
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelSize,
        pixelsHigh: pixelSize,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        fatalError("Could not allocate bitmap for icon size \(pixelSize)")
    }

    bitmap.size = NSSize(width: size, height: size)

    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Could not create graphics context for icon size \(pixelSize)")
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.shouldAntialias = true

    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    let radius = size * 0.22
    let background = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    NSGradient(
        colors: [
            NSColor(red: 0.03, green: 0.22, blue: 0.17, alpha: 1),
            NSColor(red: 0.02, green: 0.39, blue: 0.30, alpha: 1),
            NSColor(red: 0.69, green: 0.56, blue: 0.30, alpha: 1),
        ]
    )?.draw(in: background, angle: -35)

    NSColor.white.withAlphaComponent(0.08).setFill()
    NSBezierPath(ovalIn: NSRect(x: size * 0.56, y: size * 0.52, width: size * 0.48, height: size * 0.48)).fill()
    NSColor.black.withAlphaComponent(0.16).setFill()
    NSBezierPath(ovalIn: NSRect(x: -size * 0.16, y: -size * 0.16, width: size * 0.48, height: size * 0.48)).fill()

    let scannerRect = NSRect(x: size * 0.22, y: size * 0.29, width: size * 0.56, height: size * 0.48)
    let cornerLength = size * 0.13
    let inset = size * 0.025
    let strokeWidth = size * 0.035

    NSColor.white.withAlphaComponent(0.95).setStroke()
    let brackets = NSBezierPath()
    brackets.lineWidth = strokeWidth
    brackets.lineCapStyle = .round
    brackets.lineJoinStyle = .round

    let left = scannerRect.minX + inset
    let right = scannerRect.maxX - inset
    let bottom = scannerRect.minY + inset
    let top = scannerRect.maxY - inset

    brackets.move(to: NSPoint(x: left, y: top - cornerLength))
    brackets.line(to: NSPoint(x: left, y: top))
    brackets.line(to: NSPoint(x: left + cornerLength, y: top))

    brackets.move(to: NSPoint(x: right - cornerLength, y: top))
    brackets.line(to: NSPoint(x: right, y: top))
    brackets.line(to: NSPoint(x: right, y: top - cornerLength))

    brackets.move(to: NSPoint(x: left, y: bottom + cornerLength))
    brackets.line(to: NSPoint(x: left, y: bottom))
    brackets.line(to: NSPoint(x: left + cornerLength, y: bottom))

    brackets.move(to: NSPoint(x: right - cornerLength, y: bottom))
    brackets.line(to: NSPoint(x: right, y: bottom))
    brackets.line(to: NSPoint(x: right, y: bottom + cornerLength))
    brackets.stroke()

    let qrSize = size * 0.08
    let qrPositions = [
        NSPoint(x: size * 0.38, y: size * 0.53),
        NSPoint(x: size * 0.50, y: size * 0.53),
        NSPoint(x: size * 0.38, y: size * 0.42),
        NSPoint(x: size * 0.56, y: size * 0.42),
        NSPoint(x: size * 0.50, y: size * 0.37),
    ]
    for point in qrPositions {
        NSColor.white.withAlphaComponent(0.92).setFill()
        NSBezierPath(roundedRect: NSRect(x: point.x, y: point.y, width: qrSize, height: qrSize), xRadius: qrSize * 0.22, yRadius: qrSize * 0.22).fill()
    }

    NSColor(red: 0.50, green: 1.0, blue: 0.76, alpha: 1).setStroke()
    let scanLine = NSBezierPath()
    scanLine.lineWidth = size * 0.018
    scanLine.lineCapStyle = .round
    scanLine.move(to: NSPoint(x: size * 0.30, y: size * 0.60))
    scanLine.line(to: NSPoint(x: size * 0.70, y: size * 0.60))
    scanLine.stroke()

    if includeText {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: size * 0.15, weight: .bold),
            .foregroundColor: NSColor.white,
            .paragraphStyle: paragraph,
            .kern: size * 0.012,
        ]
        let textRect = NSRect(x: size * 0.12, y: size * 0.12, width: size * 0.76, height: size * 0.18)
        NSString(string: "QRT").draw(in: textRect, withAttributes: attributes)
    }

    NSGraphicsContext.restoreGraphicsState()
    return bitmap
}

try FileManager.default.createDirectory(at: appIconDir, withIntermediateDirectories: true)

for (filename, size) in appIconSpecs {
    try savePNG(makeIcon(size: CGFloat(size), includeText: true), to: appIconDir.appendingPathComponent(filename))
}

for (path, size) in brandIconURLs {
    let url = assetRoot.appendingPathComponent(path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try savePNG(makeIcon(size: size, includeText: false), to: url)
}

print("Generated QR Trust app icon and brand mark assets.")
