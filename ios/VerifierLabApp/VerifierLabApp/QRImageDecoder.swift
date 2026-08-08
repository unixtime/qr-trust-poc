import CoreImage
import Foundation

/// Reads QR payloads out of a still image.
///
/// The camera path can only check a code that is physically in front of the
/// user. A large share of the codes worth checking arrive as screenshots or
/// forwarded images — and those are exactly the ones a person cannot inspect by
/// eye — so importing is threat coverage, not convenience.
enum QRImageDecoder {
    /// `CIDetector` allocates a Core Image context, so it is built once and
    /// reused rather than per import.
    private static let detector = CIDetector(
        ofType: CIDetectorTypeQRCode,
        context: nil,
        options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]
    )

    /// Every non-empty QR payload found in `data`, in detection order.
    ///
    /// The count is returned rather than a single best guess on purpose. An
    /// image with several codes is ambiguous, and picking one would be a trust
    /// decision made on the user's behalf — callers should treat a multi-code
    /// image the same as a miss and ask for a cleaner capture.
    static func payloads(in data: Data) -> [String] {
        guard let image = CIImage(data: data), let detector else { return [] }
        return detector
            .features(in: image)
            .compactMap { ($0 as? CIQRCodeFeature)?.messageString }
            .filter { !$0.isEmpty }
    }
}
