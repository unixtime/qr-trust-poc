import AudioToolbox
import UIKit

enum Feedback {
    static func capture() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
        AudioServicesPlaySystemSound(1108)
    }

    static func decision(allowed: Bool) {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(allowed ? .success : .error)
        AudioServicesPlaySystemSound(allowed ? 1110 : 1053)
    }
}
