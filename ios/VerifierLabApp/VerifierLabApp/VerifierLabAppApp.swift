import SwiftUI

@main
struct VerifierLabAppApp: App {
    @StateObject private var viewModel = VerifierLabViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(viewModel: viewModel)
        }
    }
}
