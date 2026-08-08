import SwiftUI
import UIKit

/// The app's design tokens.
///
/// This lives outside `ContentView.swift` so every surface can reach it —
/// including `ScannerView`, which is a `UIViewControllerRepresentable` and
/// needs the `UIColor` twin rather than the SwiftUI `Color`.
enum AppTheme {
    static let background = Color(uiColor: .systemGroupedBackground)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let surfaceAlt = Color(uiColor: .tertiarySystemGroupedBackground)
    static let ink = Color(uiColor: .label)
    static let muted = Color(uiColor: .secondaryLabel)
    static let trust = Color(uiColor: .systemGreen)
    static let green = Color(uiColor: .systemGreen)
    static let orange = Color(uiColor: .systemOrange)
    static let red = Color(uiColor: .systemRed)
    static let securityBlue = Color(uiColor: .systemBlue)
    static let separator = Color(uiColor: .separator).opacity(0.50)
    static let gold = Color(red: 0.82, green: 0.68, blue: 0.44)
    static let scanLine = Color(red: 0.52, green: 1.00, blue: 0.76)

    /// No verdict yet. Deliberately *not* `trust`: an untouched scan must never
    /// borrow the color of a completed verification.
    static let neutral = Color(uiColor: .systemGray)

    /// Camera surfaces stay black in both appearances so the preview is the only
    /// lit thing on screen. Declared here rather than inlined in `ScannerView`
    /// so the choice is part of the design system, not a stray literal.
    static let cameraBackdropUI = UIColor.black
    static let cameraBackdrop = Color(uiColor: cameraBackdropUI)

    /// Chrome drawn on top of the camera preview.
    static let cameraChrome = Color.white
    static let cameraScrim = Color.black.opacity(0.58)
}
