import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ContentView: View {
    @ObservedObject var viewModel: VerifierLabViewModel
    @Environment(\.openURL) private var openURL

    @AppStorage("qrtrust.showTechnicalDetails") private var showTechnicalDetails = false
    @AppStorage("qrtrust.hasSeenQRUseGuide") private var hasSeenQRUseGuide = false

    @State private var selectedSection: AppSection = .scan
    @State private var showingScanner = false
    @State private var showingClearHistoryConfirmation = false
    @State private var showingQRUseGuide = false
    @State private var showingProviderProfileImporter = false
    @State private var selectedDetailResult: ScanResult?
    @State private var pendingOpenResult: ScanResult?
    @State private var evidenceExportPackage: EvidenceExportPackage?
    @State private var evidenceExportError: String?

    // Scanner sheet chrome. Torch availability is reported up from the capture
    // controller rather than assumed — the front camera and the Simulator both
    // have none, and a dead button is worse than an absent one.
    @State private var isTorchOn = false
    @State private var isTorchAvailable = false
    @State private var scannerPhotoItem: PhotosPickerItem?
    @State private var scannerImportError: String?

    var body: some View {
        TabView(selection: $selectedSection) {
            NavigationStack {
                scanScreen
                    .navigationTitle("QR Trust")
                    .navigationBarTitleDisplayMode(.large)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button {
                                viewModel.resetForNewScan()
                                showingScanner = true
                            } label: {
                                Label("Scan", systemImage: "qrcode.viewfinder")
                            }
                            .disabled(viewModel.isChecking)
                        }
                    }
            }
            .tabItem {
                Label("Scan", systemImage: "qrcode.viewfinder")
            }
            .tag(AppSection.scan)

            NavigationStack {
                historyScreen
                    .navigationTitle("History")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        if !viewModel.recentResults.isEmpty {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Clear") {
                                    showingClearHistoryConfirmation = true
                                }
                            }
                        }
                    }
            }
            .tabItem {
                Label("History", systemImage: "clock.arrow.circlepath")
            }
            .tag(AppSection.history)

            NavigationStack {
                learnScreen
                    .navigationTitle("Learn")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem {
                Label("Learn", systemImage: "book.closed")
            }
            .tag(AppSection.learn)

            NavigationStack {
                settingsScreen
                    .navigationTitle("Settings")
                    .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(AppSection.settings)
        }
        .tint(AppTheme.trust)
        .fileImporter(
            isPresented: $showingProviderProfileImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else {
                    return
                }
                Task {
                    await viewModel.importProviderProfile(from: url)
                }
            case .failure(let error):
                viewModel.recordProviderProfileImportFailure(error)
            }
        }
        .sheet(isPresented: $showingScanner) {
            scannerSheet
        }
        .sheet(isPresented: $showingQRUseGuide) {
            QRUseGuideSheet {
                showingQRUseGuide = false
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $selectedDetailResult) { result in
            ResultDetailView(result: result, showTechnicalDetails: showTechnicalDetails)
        }
        .sheet(item: $pendingOpenResult) { result in
            if let destinationURL = openableURL(for: result) {
                OpenDestinationReviewSheet(
                    result: result,
                    destinationURL: destinationURL,
                    onCancel: {
                        pendingOpenResult = nil
                    },
                    onOpen: {
                        openURL(destinationURL)
                        pendingOpenResult = nil
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(item: $evidenceExportPackage) { package in
            EvidenceShareSheet(activityItems: [package.directoryURL])
        }
        .alert(
            "Evidence export failed",
            isPresented: Binding(
                get: { evidenceExportError != nil },
                set: { isPresented in
                    if !isPresented {
                        evidenceExportError = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                evidenceExportError = nil
            }
        } message: {
            Text(evidenceExportError ?? "Could not create the evidence packet.")
        }
        .confirmationDialog(
            "Clear scan history?",
            isPresented: $showingClearHistoryConfirmation,
            titleVisibility: .visible
        ) {
            Button("Clear history", role: .destructive) {
                viewModel.clearHistory()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the recent checks stored in this app session.")
        }
        .onChange(of: viewModel.result.id) { _, _ in
            showQRUseGuideAfterFirstResultIfNeeded()
        }
    }

    private var scanScreen: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    if viewModel.result.tone == .idle {
                        idleScanState
                    } else {
                        resultSurface
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
        }
    }

    private var idleScanState: some View {
        VStack(spacing: 18) {
            // `ContentUnavailableView` used to sit here. It is the platform's
            // empty-and-error primitive — "No Results", "No Internet" — and
            // using it as the first-run call to action told the reader in
            // Apple's own vocabulary that nothing was here, on the one screen
            // whose job is to invite the first scan.
            scanHero

            VStack(alignment: .leading, spacing: 12) {
                Label("Simple signal, managed trust", systemImage: "shield.checkered")
                    .font(.headline)
                Text("Green means approved, orange means review first, and red means a verifier warning was found. The app informs; you still choose what to open.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var scanHero: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 12) {
                Image("BrandMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .accessibilityLabel("QR Trust logo")

                VStack(alignment: .leading, spacing: 3) {
                    Text("Protected QR Scanner")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                    Text("Scan first. Decide with context.")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
            }

            Text("Check a QR before you open it.")
                .font(.system(size: 38, weight: .bold, design: .rounded))
                .foregroundStyle(AppTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text("QR Trust turns the verifier decision into a plain green, orange, or red signal. The final choice stays with the user.")
                .font(.body)
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                viewModel.resetForNewScan()
                showingScanner = true
            } label: {
                Label(viewModel.isChecking ? "Checking QR" : "Start scan", systemImage: "camera.viewfinder")
                    .font(.headline)
            }
            .buttonStyle(FilledCapsuleButtonStyle(tint: AppTheme.trust, foreground: .white))
            .disabled(viewModel.isChecking)
            .accessibilityHint("Opens the camera to scan a QR code.")
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 34)
                .fill(AppTheme.surface)
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [AppTheme.scanLine.opacity(0.35), AppTheme.gold.opacity(0.32)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 170, height: 170)
                        .blur(radius: 8)
                        .offset(x: 54, y: -58)
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: 34))
        .shadow(color: Color.black.opacity(0.08), radius: 24, x: 0, y: 16)
    }

    private var resultSurface: some View {
        let result = viewModel.result
        let visual = visual(for: result.tone)

        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                ResultIndicator(tone: result.tone, size: 58)

                VStack(alignment: .leading, spacing: 8) {
                    Text(visual.eyebrow)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(visual.color)
                        .textCase(.uppercase)
                        .tracking(1.5)
                    Text(result.title)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(result.message)
                        .font(.callout)
                        .foregroundStyle(AppTheme.muted)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }

            if let scannerUX = result.scannerUX {
                scannerRiskSummary(scannerUX, tone: result.tone)
            }

            usagePolicyCard(for: result)

            if result.destination != nil {
                destinationCard(for: result)
            }

            if result.trustNamespace != nil {
                trustSourceCard(for: result)
            }

            if showTechnicalDetails, let summary = result.technicalSummary {
                technicalCard(summary)
            }

            if result.tone != .checking {
                Button {
                    selectedDetailResult = result
                } label: {
                    Label("View decision path", systemImage: "list.bullet.rectangle.portrait")
                        .font(.headline)
                }
                .buttonStyle(OutlineCapsuleButtonStyle())
            }

            actionRow(for: result)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(visual.color.opacity(0.22), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func usagePolicyCard(for result: ScanResult) -> some View {
        if let usagePolicy = result.usagePolicy {
            let copy = usagePolicyCopy(for: usagePolicy, tone: result.tone)

            HStack(alignment: .top, spacing: 12) {
                Image(systemName: copy.symbol)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(copy.color)
                    .frame(width: 36, height: 36)
                    .background(copy.color.opacity(0.14), in: Circle())
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(copy.title)
                            .font(.headline.weight(.bold))
                            .foregroundStyle(AppTheme.ink)
                        Spacer(minLength: 0)
                        Text(copy.badge)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(copy.color)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(copy.color.opacity(0.12), in: Capsule())
                    }

                    Text(copy.body)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(copy.color.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(copy.title). \(copy.badge). \(copy.body)")
        }
    }

    private func destinationCard(for result: ScanResult) -> some View {
        let displayHost = result.scannerUX?.destinationDisplay ?? resultDisplayHost(for: result)
        let fingerprint = result.scannerUX?.destinationFingerprint ?? displayHost

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(result.tone == .trusted ? "Destination checked" : "Destination to review")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
                    .tracking(1.2)
                Spacer(minLength: 8)
                Image(systemName: result.tone == .trusted ? "checkmark.shield" : "link.badge.plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(detailColor(for: result.tone))
                    .accessibilityHidden(true)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(fingerprint)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.86)
                    .textSelection(.enabled)
                if fingerprint != displayHost {
                    Text("Domain: \(displayHost)")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }
                if showTechnicalDetails, let destination = result.destination {
                    Text(destination)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }

            if let resolverURL = result.resolverURL {
                Divider()
                redirectEvidenceRows(for: result, resolverURL: resolverURL)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func scannerRiskSummary(_ scannerUX: ScannerDecisionUX, tone: TrustTone) -> some View {
        let color = scannerRiskColor(scannerUX, fallbackTone: tone)

        return VStack(alignment: .leading, spacing: 10) {
            Capsule()
                .fill(color)
                .frame(height: 5)
                .accessibilityLabel("Risk stripe \(scannerUX.riskLevel)")

            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(scannerRiskLabel(scannerUX))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(color)
                    .textCase(.uppercase)
                    .tracking(1.1)
                Text("\(scannerUX.riskScore)/100")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                if scannerUX.holdRequired {
                    Label("Hold to open", systemImage: "hand.tap")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(color)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(color.opacity(0.12), in: Capsule())
                }
                Spacer(minLength: 0)
            }

            if !scannerUX.reasonCodes.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(scannerUX.reasonCodes, id: \.self) { code in
                            Label(reasonCodeLabel(code), systemImage: reasonCodeSymbol(code))
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(AppTheme.ink)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(AppTheme.surfaceAlt, in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func trustSourceCard(for result: ScanResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Trust source")
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(1.2)
            if let assuranceTier = result.assuranceTier {
                evidenceRow("Assurance", humanizedGovernanceValue(assuranceTier))
            }
            if let cacheFreshness = result.cacheFreshness {
                evidenceRow("Verifier cache", humanizedGovernanceValue(cacheFreshness))
            }
            if let cacheExpiresAt = result.cacheExpiresAt {
                evidenceRow("Cache expires", cacheExpiresAt)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private func redirectEvidenceRows(for result: ScanResult, resolverURL: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            evidenceRow("Resolver", resolverURL)
            if let finalURL = result.finalURL {
                evidenceRow("Final target", finalURL)
            }
            if let hops = result.redirectHops {
                evidenceRow("Redirect hops", "\(hops)")
            }
            if let policy = result.redirectPolicy {
                evidenceRow("Policy", policy.replacingOccurrences(of: "_", with: " "))
            }
        }
    }

    private func evidenceRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(0.8)
            Text(value)
                .font(.footnote)
                .foregroundStyle(AppTheme.muted)
                .lineLimit(3)
                .textSelection(.enabled)
        }
    }

    private func resultDisplayHost(for result: ScanResult) -> String {
        if let destinationDisplay = result.scannerUX?.destinationDisplay, !destinationDisplay.isEmpty {
            return destinationDisplay
        }
        if let finalURL = result.finalURL,
           let host = URL(string: finalURL)?.host {
            return host
        }
        return result.host ?? result.destination ?? "Unknown destination"
    }

    private func technicalCard(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Verifier detail")
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(1.2)
            Text(summary)
                .font(.footnote.monospaced())
                .foregroundStyle(AppTheme.muted)
                .textSelection(.enabled)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.035), in: RoundedRectangle(cornerRadius: 18))
    }

    private func humanizedGovernanceValue(_ value: String) -> String {
        value
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    @ViewBuilder
    private func actionRow(for result: ScanResult) -> some View {
        switch result.tone {
        case .trusted:
            HStack(spacing: 10) {
                if openableURL(for: result) != nil {
                    Button("Open site") {
                        prepareOpenDestination(result)
                    }
                    .buttonStyle(FilledCapsuleButtonStyle(tint: AppTheme.green, foreground: .white))
                }

                Button("Scan again") {
                    viewModel.resetForNewScan()
                    showingScanner = true
                }
                .buttonStyle(OutlineCapsuleButtonStyle())
            }
        case .caution, .blocked:
            VStack(spacing: 10) {
                if openableURL(for: result) != nil {
                    Button(openActionTitle(for: result)) {
                        prepareOpenDestination(result)
                    }
                    .buttonStyle(
                        FilledCapsuleButtonStyle(
                            tint: result.tone == .blocked ? AppTheme.red : AppTheme.orange,
                            foreground: .white
                        )
                    )
                }

                Button("Scan another QR") {
                    viewModel.resetForNewScan()
                    showingScanner = true
                }
                .buttonStyle(OutlineCapsuleButtonStyle())
            }
        case .unavailable:
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Button("Try again") {
                        viewModel.resetForNewScan()
                        showingScanner = true
                    }
                    .buttonStyle(FilledCapsuleButtonStyle(tint: AppTheme.orange, foreground: .white))

                    if openableURL(for: result) != nil {
                        Button("Open anyway") {
                            prepareOpenDestination(result)
                        }
                        .buttonStyle(OutlineCapsuleButtonStyle())
                    }
                }

                Button {
                    selectedSection = .settings
                    Task {
                        await viewModel.checkProviderConnection()
                    }
                } label: {
                    Label("Check service status", systemImage: "wifi.exclamationmark")
                        .font(.headline)
                }
                .buttonStyle(OutlineCapsuleButtonStyle())
            }
        case .checking:
            HStack(spacing: 10) {
                ProgressView()
                    .tint(AppTheme.trust)
                Text("Checking issuer, destination, and current policy.")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .idle:
            EmptyView()
        }
    }

    private var historyScreen: some View {
        List {
            Section {
                if viewModel.recentResults.isEmpty {
                    emptyHistoryCard
                } else {
                    ForEach(viewModel.recentResults) { item in
                        historyRow(item)
                    }
                }
            } header: {
                Text("Recent checks")
            } footer: {
                Text("History stays local to the app session. It helps users compare decisions without turning this scanner into an operator dashboard.")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
    }

    private var emptyHistoryCard: some View {
        ContentUnavailableView {
            Label("No checks yet", systemImage: "clock.badge.questionmark")
        } description: {
            Text("Scan a QR first. The result will appear here after the verifier returns a decision.")
        }
        .padding(.vertical, 24)
    }

    private func historyRow(_ item: ScanResult) -> some View {
        let visual = visual(for: item.tone)

        return Button {
            selectedDetailResult = item
        } label: {
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    Circle()
                        .fill(visual.color.opacity(0.16))
                        .frame(width: 36, height: 36)
                    Circle()
                        .fill(visual.color)
                        .frame(width: 12, height: 12)
                }
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                    Text(item.host ?? item.destination ?? item.message)
                        .font(.callout)
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text(shortTime(item.checkedAt))
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted.opacity(0.65))
                }
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if openableURL(for: item) != nil {
                Button {
                    prepareOpenDestination(item)
                } label: {
                    Label(item.tone == .trusted ? "Open" : "Review", systemImage: "safari")
                }
                .tint(visual.color)
            }

            // Copy stays available even when the verifier refused the open --
            // that is the server's own fallback pairing ("Do not open" plus a
            // copy action), and it leaves the user a way to inspect or report a
            // destination they must not visit.
            if item.destination != nil {
                Button {
                    UIPasteboard.general.string = item.destination
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                .tint(AppTheme.securityBlue)
            }
        }
        .accessibilityHint("Opens the decision path for this scan.")
    }

    private var learnScreen: some View {
        List {
            Section {
                learnInfoRow(
                    symbol: "shield.lefthalf.filled",
                    title: "Managed trust, not just decoding",
                    body: "The app checks who issued the QR, whether the destination is still approved, and whether current safety signals change the answer."
                )
            }

            Section("Signal colors") {
                colorMeaning(color: AppTheme.green, title: "Green", body: "The issuer, destination, and current policy line up for this use.")
                colorMeaning(color: AppTheme.orange, title: "Orange", body: "The app could not fully verify the QR. Continue only if the source is trusted.")
                colorMeaning(color: AppTheme.red, title: "Red", body: "A verifier check raised a high-risk warning. Opening is still your choice, but it needs extra caution.")
            }

            Section("Trust path") {
                layerRow(number: "1", title: "Issuer legitimacy", body: "Is the organization recognized by the trust program?")
                layerRow(number: "2", title: "Destination binding", body: "Does the URL still match what the issuer approved?")
                layerRow(number: "3", title: "Runtime safety", body: "Is the destination safe at scan time?")
                layerRow(number: "4", title: "Scanner decision", body: "Can the scanner explain the outcome clearly?")
            }

            Section("Shared QR codes") {
                Button {
                    presentQRUseGuide()
                } label: {
                    Label("Review reusable and one-time QR types", systemImage: "qrcode")
                }
                .foregroundStyle(AppTheme.trust)

                learnInfoRow(
                    symbol: "qrcode",
                    title: "Printed QR codes can be reusable",
                    body: "Reusable public QR codes should not fail because another person scanned them first. One-time QR codes are different and should ask for a fresh QR after use."
                )
                learnInfoRow(
                    symbol: "wifi.exclamationmark",
                    title: "Unavailable does not mean malicious",
                    body: "If the protection service cannot be reached, the app can show an orange warning and the visible destination. That means unverified, not proven dangerous."
                )
                learnInfoRow(
                    symbol: "hand.raised",
                    title: "The app informs; you decide",
                    body: "QR Trust makes the trust state visible. It should not silently replace user judgment, so warned links require explicit review before opening."
                )
            }

            Section("Provider and privacy") {
                learnInfoRow(
                    symbol: "building.columns.fill",
                    title: "A provider is more than a server",
                    body: "A managed provider represents issuer enrollment, approved destinations, runtime policy, and the rules that turn those checks into a user-visible signal."
                )
                learnInfoRow(
                    symbol: "lock.shield",
                    title: "What the app shares",
                    body: "To check a QR, the app sends the scanned QR payload or destination to the active verifier. Recent checks stay on this device unless you choose to share them."
                )
                learnInfoRow(
                    symbol: "person.crop.circle",
                    title: "No keys for everyday users",
                    body: "A production app should install signed provider profiles from approved programs. It should not ask average users to paste API keys or raw verifier endpoints."
                )
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
    }

    private var colorMeaningCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Color guide")
                .font(.headline)
                .foregroundStyle(AppTheme.ink)

            VStack(spacing: 10) {
                colorMeaning(color: AppTheme.green, title: "Green", body: "The issuer, destination, and current policy line up for this use.")
                colorMeaning(color: AppTheme.orange, title: "Orange", body: "The app could not fully verify the QR. Continue only if the source is trusted.")
                colorMeaning(color: AppTheme.red, title: "Red", body: "A verifier check raised a high-risk warning. Opening is still your choice, but it needs extra caution.")
            }
        }
        .padding(18)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private var trustLayersCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("The four checks")
                .font(.headline)
                .foregroundStyle(AppTheme.ink)
            layerRow(number: "1", title: "Issuer", body: "Is the organization recognized by the trust program?")
            layerRow(number: "2", title: "Destination", body: "Does the URL still match what the issuer approved?")
            layerRow(number: "3", title: "Runtime safety", body: "Is the destination safe at scan time?")
            layerRow(number: "4", title: "User signal", body: "Can the scanner explain the outcome clearly?")
        }
        .padding(18)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private var printedQRCodeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Printed and shared QR codes", systemImage: "qrcode")
                .font(.headline)
                .foregroundStyle(AppTheme.ink)
            Text("Reusable public QR codes should not fail just because another person scanned them first. One-time QR codes are different: they are designed for a single use, such as login or payment approval.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private var userChoiceCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("The app informs, the user decides", systemImage: "person.crop.circle.badge.exclamationmark")
                .font(.headline)
                .foregroundStyle(AppTheme.ink)
            Text("QR Trust should make the trust state visible and understandable. It should not silently replace user judgment. That is why warned links can still be opened after an explicit confirmation.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private var unavailableVerifierCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("When the verifier is unreachable", systemImage: "wifi.exclamationmark")
                .font(.headline)
                .foregroundStyle(AppTheme.ink)
            Text("A normal web link can still be shown with an orange warning if the protection service cannot be reached. That means the link was not verified, not that it was proven malicious.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 26))
    }

    private var settingsScreen: some View {
        let provider = viewModel.providerProfile

        return Form {
            Section("Display") {
                Toggle("Show verifier details", isOn: $showTechnicalDetails)
                Text("Keeps the default experience non-technical, while allowing reviewers and researchers to inspect the verifier reason.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button {
                    presentQRUseGuide()
                } label: {
                    Label("Show QR use guide", systemImage: "qrcode")
                }
            }

            Section("Local history") {
                Picker("History retention", selection: $viewModel.historyRetention) {
                    ForEach(HistoryRetentionProfile.allCases) { profile in
                        Text(profile.label).tag(profile)
                    }
                }

                Text(viewModel.historyRetention.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if !viewModel.recentResults.isEmpty {
                    Button("Clear recent checks", role: .destructive) {
                        showingClearHistoryConfirmation = true
                    }
                }
            }

            Section("Evidence export") {
                settingsInfoCard(
                    symbol: "icloud.and.arrow.up",
                    title: "Export reviewer evidence",
                    body: "Creates one evidence folder with correctly named screenshots, history cards, accessibility traces, and a manifest. Save it to iCloud Drive, then import it on macOS.",
                    tint: AppTheme.securityBlue
                )

                Button {
                    exportEvidencePacket()
                } label: {
                    Label("Export current evidence packet", systemImage: "square.and.arrow.up")
                }
                .disabled(!hasExportableEvidence)

                Text(hasExportableEvidence ? "No API keys, admin tokens, or signing keys are included." : "Scan a QR or check the protection service before exporting.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Verifier provider") {
                verifierProviderCard(provider, profileState: viewModel.activeVerifierProfileState)
                providerConnectionCard(viewModel.providerConnectionStatus)

                Button {
                    Task {
                        await viewModel.checkProviderConnection()
                    }
                } label: {
                    HStack {
                        Text(viewModel.isCheckingProviderConnection ? "Checking connection" : "Check protection service")
                        Spacer()
                        if viewModel.isCheckingProviderConnection {
                            ProgressView()
                        }
                    }
                }
                .disabled(viewModel.isCheckingProviderConnection)

                Button {
                    Task {
                        await viewModel.refreshProviderProfile()
                    }
                } label: {
                    HStack {
                        Text(viewModel.isRefreshingProviderProfile ? "Refreshing provider profile" : "Refresh provider profile")
                        Spacer()
                        if viewModel.isRefreshingProviderProfile {
                            ProgressView()
                        }
                    }
                }
                .disabled(viewModel.isRefreshingProviderProfile || viewModel.isCheckingProviderConnection)

                settingsInfoCard(
                    symbol: "building.columns.fill",
                    title: "Managed provider profile",
                    body: "The verifier provider is the managed trust surface. Refreshing the profile updates issuer enrollment, destination binding, runtime policy, and scanner-visible decision rules without reinstalling the app.",
                    tint: AppTheme.trust
                )

                Button {
                    showingProviderProfileImporter = true
                } label: {
                    Label("Import provider profile", systemImage: "square.and.arrow.down")
                }

                if viewModel.installedProviderProfile != nil {
                    Button("Remove imported provider profile", role: .destructive) {
                        viewModel.removeImportedProviderProfile()
                    }

                    Text("Provider profiles remain on this device until replaced, refreshed, or removed. Revocation and stale-profile recovery should happen through this app state, not by deleting the app.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                settingsInfoCard(
                    symbol: "lock.shield",
                    title: "Signed profiles in production",
                    body: "This PoC can import a local JSON profile for reviewer testing. A production app should cryptographically verify signed provider profiles from approved programs before trusting them.",
                    tint: AppTheme.securityBlue
                )
            }

            Section("Privacy") {
                settingsInfoCard(
                    symbol: "qrcode.viewfinder",
                    title: "Scan data used for the decision",
                    body: "When you scan, the QR payload or destination is sent to the active verifier so it can return a green, orange, or red decision. This demo does not require a personal account.",
                    tint: AppTheme.trust
                )
                settingsInfoCard(
                    symbol: "clock.arrow.circlepath",
                    title: "Recent checks stay local",
                    body: "The history tab is an on-device convenience for comparing decisions. It is not an operator audit log, and you can clear it from this app.",
                    tint: AppTheme.orange
                )
            }

            Section("Future production settings") {
                settingsInfoCard(
                    symbol: "slider.horizontal.3",
                    title: "Enterprise-ready controls",
                    body: "Future versions should support approved provider profiles, managed enterprise policy, local history retention, and accessibility preferences. Everyday users should not manage API keys.",
                    tint: AppTheme.securityBlue
                )
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .task {
            await viewModel.refreshProviderConnectionIfNeeded()
        }
    }

    private var hasExportableEvidence: Bool {
        if viewModel.result.tone != .idle && viewModel.result.tone != .checking {
            return true
        }
        if viewModel.providerConnectionStatus.tone != .notChecked && viewModel.providerConnectionStatus.tone != .checking {
            return true
        }
        return viewModel.installedProviderProfile != nil
    }

    private func exportEvidencePacket() {
        do {
            evidenceExportPackage = try EvidencePacketExporter.makePackage(
                currentResult: viewModel.result,
                recentResults: viewModel.recentResults,
                providerProfile: viewModel.providerProfile,
                importedProviderProfile: viewModel.installedProviderProfile,
                providerStatus: viewModel.providerConnectionStatus,
                activeVerifierProfileState: viewModel.activeVerifierProfileState
            )
        } catch {
            evidenceExportError = error.localizedDescription
        }
    }

    private func verifierProviderCard(
        _ provider: ManagedVerifierProfile,
        profileState: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "building.columns.fill")
                    .font(.headline)
                    .foregroundStyle(AppTheme.trust)
                    .frame(width: 38, height: 38)
                    .background(AppTheme.trust.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(provider.name)
                        .font(.headline)
                        .foregroundStyle(AppTheme.ink)
                    Text(provider.summary)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Divider()

            providerRow("Trust program", provider.trustProgram)
            providerRow("Policy", provider.policy)
            providerRow("Endpoints", provider.endpointSummary)
            providerRow("Profile state", profileState.capitalized)
            providerRow("Profile status", provider.signatureStatus)
        }
        .padding(.vertical, 6)
    }

    private func settingsInfoCard(symbol: String, title: String, body: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.headline.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(tint.opacity(0.12), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                Text(body)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(tint.opacity(0.15), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func providerConnectionCard(_ status: ProviderConnectionStatus) -> some View {
        let color = providerConnectionColor(status.tone)

        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: providerConnectionSymbol(status.tone))
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(color, in: Circle())

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Protection service")
                            .font(.headline)
                            .foregroundStyle(AppTheme.ink)
                        Spacer(minLength: 8)
                        Text(providerConnectionBadge(status.tone))
                            .font(.caption.weight(.bold))
                            .foregroundStyle(color)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(color.opacity(0.12), in: Capsule())
                    }

                    Text(status.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                    Text(status.message)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let endpoint = status.endpoint {
                providerRow("Active endpoint", endpoint)
            }

            if let candidates = status.candidateEndpoints, candidates != status.endpoint {
                providerRow("Configured endpoints", candidates)
            }

            if let checkedAt = status.checkedAt {
                providerRow("Last checked", shortTime(checkedAt))
            }

            if showTechnicalDetails, let detail = status.technicalDetail {
                providerRow("Technical detail", detail)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(color.opacity(0.18), lineWidth: 1)
        }
    }

    private func providerConnectionColor(_ tone: ProviderConnectionTone) -> Color {
        switch tone {
        case .reachable:
            return AppTheme.green
        case .stale:
            return AppTheme.orange
        case .revoked:
            return AppTheme.red
        case .unreachable:
            return AppTheme.orange
        case .misconfigured:
            return AppTheme.red
        case .checking, .notChecked:
            return AppTheme.trust
        }
    }

    private func providerConnectionSymbol(_ tone: ProviderConnectionTone) -> String {
        switch tone {
        case .reachable:
            return "checkmark.shield.fill"
        case .stale:
            return "clock.fill"
        case .revoked:
            return "xmark.octagon.fill"
        case .unreachable:
            return "wifi.exclamationmark"
        case .misconfigured:
            return "exclamationmark.triangle.fill"
        case .checking:
            return "arrow.triangle.2.circlepath"
        case .notChecked:
            return "questionmark.circle.fill"
        }
    }

    private func providerConnectionBadge(_ tone: ProviderConnectionTone) -> String {
        switch tone {
        case .reachable:
            return "Reachable"
        case .stale:
            return "Needs refresh"
        case .revoked:
            return "Revoked"
        case .unreachable:
            return "Unavailable"
        case .misconfigured:
            return "Needs setup"
        case .checking:
            return "Checking"
        case .notChecked:
            return "Not checked"
        }
    }

    private func providerRow(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(0.8)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(AppTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func colorMeaning(color: Color, title: String, body: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.14))
                    .frame(width: 34, height: 34)
                Circle()
                    .fill(color)
                    .frame(width: 12, height: 12)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                Text(body)
                    .font(.callout)
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private func layerRow(number: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(number)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(AppTheme.trust)
                .frame(width: 32, height: 32)
                .background(AppTheme.trust.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                Text(body)
                    .font(.callout)
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private func learnInfoRow(symbol: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AppTheme.trust)
                .frame(width: 34, height: 34)
                .background(AppTheme.trust.opacity(0.12), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                Text(body)
                    .font(.callout)
                    .foregroundStyle(AppTheme.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    /// Side of the scan window, shared by the drawn reticle, the scrim cutout,
    /// and the capture controller's `rectOfInterest`. One number so the three
    /// cannot drift apart — the frame is now load-bearing, not decoration.
    private var scannerReticleSide: CGFloat { 260 }

    private var scannerSheet: some View {
        NavigationStack {
            ZStack {
                ScannerView(
                    onPayload: { payload in
                        showingScanner = false
                        Task {
                            await viewModel.handleScannedPayload(payload)
                        }
                    },
                    onFailure: { reason in
                        showingScanner = false
                        viewModel.handleCameraFailure(reason)
                    },
                    reticleSide: scannerReticleSide,
                    isTorchOn: isTorchOn,
                    onTorchAvailabilityChange: { isTorchAvailable = $0 }
                )

                scannerScrim

                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .strokeBorder(AppTheme.cameraChrome, lineWidth: 4)
                    .frame(width: scannerReticleSide, height: scannerReticleSide)
                    .overlay {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .strokeBorder(AppTheme.scanLine, lineWidth: 2)
                            .padding(8)
                    }
                    .shadow(color: AppTheme.scanLine.opacity(0.45), radius: 18, x: 0, y: 0)
                    .accessibilityHidden(true)
            }
            // Applied to the whole stack rather than to `ScannerView` alone.
            // Otherwise the preview fills the sheet while the reticle centres
            // inside the safe area, and the drawn frame sits roughly half the
            // navigation bar's height below the region the camera is reading.
            .ignoresSafeArea()
            .overlay(alignment: .bottom) { scannerChrome }
            .onChange(of: scannerPhotoItem) { _, newItem in
                guard let newItem else { return }
                scannerImportError = nil
                Task { await importScannedImage(newItem) }
            }
            .onDisappear {
                isTorchOn = false
                scannerPhotoItem = nil
                scannerImportError = nil
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") {
                        showingScanner = false
                    }
                    .foregroundStyle(AppTheme.cameraChrome)
                }
            }
        }
    }

    /// Dims everything outside the reticle.
    ///
    /// The dimming is a statement of fact, not atmosphere: detection really is
    /// confined to the cutout now, so the scrim shows the reader's field of
    /// view. `.destinationOut` punches the hole, and `.compositingGroup()` is
    /// what keeps that erasure inside this stack instead of taking the camera
    /// preview with it.
    private var scannerScrim: some View {
        ZStack {
            Rectangle()
                .fill(AppTheme.cameraScrim)

            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .frame(width: scannerReticleSide, height: scannerReticleSide)
                .blendMode(.destinationOut)
        }
        .compositingGroup()
        .accessibilityHidden(true)
    }

    private var scannerChrome: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Place the QR inside the frame")
                    .font(.headline)
                    .foregroundStyle(AppTheme.cameraChrome)
                Text("Only codes inside the frame are read. The camera closes automatically once one is found.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.cameraChrome.opacity(0.76))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

            if let scannerImportError {
                Label(scannerImportError, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.cameraChrome)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.red.opacity(0.92), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 12) {
                // Only offered where the hardware answered yes — a torch button
                // that does nothing teaches the user to distrust the chrome.
                if isTorchAvailable {
                    Button {
                        isTorchOn.toggle()
                    } label: {
                        Label(
                            isTorchOn ? "Torch on" : "Torch",
                            systemImage: isTorchOn ? "bolt.fill" : "bolt.slash.fill"
                        )
                    }
                    .buttonStyle(ScannerChromeButtonStyle(isOn: isTorchOn))
                    .accessibilityHint("Lights the scene for scanning in low light.")
                }

                PhotosPicker(selection: $scannerPhotoItem, matching: .images, photoLibrary: .shared()) {
                    Label("Import image", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(ScannerChromeButtonStyle())
                .accessibilityHint("Reads a QR code out of a screenshot or a saved photo.")

                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 34)
        .animation(.easeInOut(duration: 0.18), value: scannerImportError)
    }

    /// Runs a picked image through the same verification path as the camera.
    ///
    /// A multi-code image is reported as a miss rather than resolved by taking
    /// the first hit. Choosing between two destinations on the user's behalf is
    /// precisely the decision this app exists to leave with them.
    @MainActor
    private func importScannedImage(_ item: PhotosPickerItem) async {
        // Clearing the selection lets the same photo be picked again after a
        // miss; `onChange` would otherwise see no change and stay silent.
        defer { scannerPhotoItem = nil }

        guard let data = try? await item.loadTransferable(type: Data.self) else {
            scannerImportError = "That image could not be read."
            return
        }

        switch QRImageDecoder.payloads(in: data) {
        case let payloads where payloads.count == 1:
            scannerImportError = nil
            showingScanner = false
            await viewModel.handleScannedPayload(payloads[0])
        case let payloads where payloads.isEmpty:
            scannerImportError = "No QR code found in that image."
        default:
            scannerImportError = "That image has more than one QR code. Crop it to a single code and try again."
        }
    }

    private func prepareOpenDestination(_ result: ScanResult) {
        if openableURL(for: result) != nil {
            pendingOpenResult = result
        }
    }

    private func presentQRUseGuide() {
        hasSeenQRUseGuide = true
        showingQRUseGuide = true
    }

    private func showQRUseGuideAfterFirstResultIfNeeded() {
        guard !hasSeenQRUseGuide else {
            return
        }
        guard viewModel.result.tone != .idle, viewModel.result.tone != .checking else {
            return
        }

        hasSeenQRUseGuide = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            guard !showingScanner, selectedDetailResult == nil, pendingOpenResult == nil else {
                return
            }
            showingQRUseGuide = true
        }
    }

    /// The URL this result may be opened with, or nil if it must not be opened.
    ///
    /// Single chokepoint for every open path: it decides whether the affordance
    /// renders at all (`actionRow`, the history swipe action), whether the
    /// review sheet presents (`prepareOpenDestination`), and whether the sheet
    /// body draws. Both questions -- "are we permitted?" and "with what URL?" --
    /// answer here on purpose, so no caller can obtain the URL without also
    /// clearing the permission check.
    private func openableURL(for result: ScanResult) -> URL? {
        // An explicit verifier refusal outranks everything below. The server
        // returns no open action in this case and the web client renders none;
        // a scanner that offers "open anyway" after its own verifier said no is
        // the client-side trust widening this project argues against.
        guard !result.verifierRefusedOpen else {
            return nil
        }

        let candidates = [result.destination, result.finalURL].compactMap { $0 }
        for value in candidates {
            guard
                let url = URL(string: value),
                let scheme = url.scheme?.lowercased(),
                scheme == "http" || scheme == "https"
            else {
                continue
            }
            return url
        }
        return nil
    }

    private func visual(for tone: TrustTone) -> ResultVisual {
        switch tone {
        case .idle:
            return ResultVisual(eyebrow: "No result yet", color: AppTheme.trust)
        case .checking:
            return ResultVisual(eyebrow: "Checking", color: AppTheme.trust)
        case .trusted:
            return ResultVisual(eyebrow: "Green status", color: AppTheme.green)
        case .caution:
            return ResultVisual(eyebrow: "Orange status", color: AppTheme.orange)
        case .blocked:
            return ResultVisual(eyebrow: "Red status", color: AppTheme.red)
        case .unavailable:
            return ResultVisual(eyebrow: "Orange status", color: AppTheme.orange)
        }
    }

    private func openActionTitle(for result: ScanResult) -> String {
        if result.tone == .trusted {
            return "Open site"
        }
        if result.tone == .blocked {
            return "Review and open anyway"
        }
        if let primaryAction = result.scannerUX?.primaryAction,
           primaryAction.localizedCaseInsensitiveContains("caution") {
            return primaryAction
        }
        return "Open with caution"
    }
}

private enum AppSection: Hashable {
    case scan
    case history
    case learn
    case settings
}

private struct ResultVisual {
    let eyebrow: String
    let color: Color
}

private struct DestinationEvidence: Identifiable {
    var id: String { "\(label)-\(value)" }
    let label: String
    let value: String
    let symbol: String
}

private struct ResultIndicator: View {
    let tone: TrustTone
    var size: CGFloat = 76

    var body: some View {
        ZStack {
            Circle()
                .fill(visualColor.opacity(0.14))
                .frame(width: size, height: size)

            if isHollow {
                Circle()
                    .strokeBorder(
                        visualColor,
                        style: StrokeStyle(
                            lineWidth: max(size * 0.05, 2),
                            dash: [size * 0.10, size * 0.07]
                        )
                    )
                    .frame(width: size * 0.63, height: size * 0.63)
                Image(systemName: symbol)
                    .font(.system(size: size * 0.24, weight: .bold))
                    .foregroundStyle(visualColor)
            } else {
                Circle()
                    .fill(visualColor)
                    .frame(width: size * 0.63, height: size * 0.63)
                Image(systemName: symbol)
                    .font(.system(size: size * 0.24, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .accessibilityLabel(accessibilityLabel)
    }

    /// `.unavailable` is the only tone drawn as an outline.
    ///
    /// Color cannot separate it from `.caution`: both are warnings and both
    /// have to stay orange, because downgrading "we could not check" to grey
    /// would quietly demote a warning to an absence. So shape carries the
    /// difference — a broken ring for the check that never completed, a solid
    /// disc for the verdict we actually reached.
    private var isHollow: Bool { tone == .unavailable }

    // The switches below are deliberately exhaustive rather than falling
    // through a `default:`. A `default:` is how `.checking` and `.idle` came to
    // render in the verified green — the compiler should refuse to build the
    // next tone someone adds until it has been given a distinct signal.

    private var visualColor: Color {
        switch tone {
        case .idle:
            return AppTheme.neutral
        case .checking:
            return AppTheme.securityBlue
        case .trusted:
            return AppTheme.green
        case .caution, .unavailable:
            return AppTheme.orange
        case .blocked:
            return AppTheme.red
        }
    }

    private var symbol: String {
        switch tone {
        case .idle:
            return "qrcode.viewfinder"
        case .checking:
            return "hourglass"
        case .trusted:
            return "checkmark.shield.fill"
        case .caution:
            return "exclamationmark.triangle.fill"
        case .unavailable:
            return "wifi.exclamationmark"
        case .blocked:
            return "xmark.octagon.fill"
        }
    }

    private var accessibilityLabel: String {
        switch tone {
        case .idle:
            return "Ready to scan"
        case .checking:
            return "Blue, checking"
        case .trusted:
            return "Green, verified"
        case .caution:
            return "Orange, not fully verified"
        case .unavailable:
            return "Orange outline, protection service unavailable"
        case .blocked:
            return "Red, high-risk warning"
        }
    }
}

private struct OpenDestinationReviewSheet: View {
    let result: ScanResult
    let destinationURL: URL
    let onCancel: () -> Void
    let onOpen: () -> Void

    private var color: Color {
        detailColor(for: result.tone)
    }

    private var title: String {
        switch result.tone {
        case .trusted:
            return "Open verified destination"
        case .caution:
            return "Review before opening"
        case .blocked:
            return "High-risk warning"
        case .unavailable:
            return "Check unavailable"
        case .checking:
            return "Still checking"
        case .idle:
            return "Review destination"
        }
    }

    private var message: String {
        switch result.tone {
        case .trusted:
            return "QR Trust verified the issuer signal, destination binding, and current safety checks for this QR."
        case .caution:
            return "This QR was not fully verified. Continue only if you trust where it came from and recognize the destination."
        case .blocked:
            return "QR Trust found a concrete warning. Opening anyway may take you to a destination the issuer did not approve."
        case .unavailable:
            return "The protection service could not complete the check. The destination is visible, but it was not verified."
        case .checking:
            return "Wait for the check to finish before deciding whether to open this destination."
        case .idle:
            return "Review the destination before leaving the app."
        }
    }

    private var openTitle: String {
        if holdRequired {
            return result.tone == .blocked ? "Hold to open anyway" : "Hold to open"
        }
        switch result.tone {
        case .trusted:
            return "Open in Safari"
        case .blocked:
            return "Open anyway"
        default:
            return "Open with caution"
        }
    }

    private var holdRequired: Bool {
        guard result.tone != .trusted else {
            return false
        }
        if result.tone == .blocked {
            return true
        }
        return result.scannerUX?.holdRequired == true
    }

    private var holdDuration: Double {
        Double(max(result.scannerUX?.holdMilliseconds ?? 800, 800)) / 1000.0
    }

    private var symbol: String {
        switch result.tone {
        case .trusted:
            return "checkmark.shield.fill"
        case .blocked:
            return "xmark.octagon.fill"
        case .unavailable:
            return "wifi.exclamationmark"
        case .caution:
            return "exclamationmark.triangle.fill"
        case .checking:
            return "hourglass"
        case .idle:
            return "link"
        }
    }

    private var host: String {
        destinationURL.host ?? result.host ?? "Unknown destination"
    }

    private var destinationDisplayHost: String {
        result.scannerUX?.destinationDisplay ?? host
    }

    private var destinationFingerprint: String {
        result.scannerUX?.destinationFingerprint ?? destinationDisplayHost
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: symbol)
                            .font(.title2.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 54, height: 54)
                            .background(color, in: Circle())
                            .shadow(color: color.opacity(0.22), radius: 18, x: 0, y: 10)

                        VStack(alignment: .leading, spacing: 7) {
                            Text(detailState(for: result.tone))
                                .font(.caption.weight(.bold))
                                .foregroundStyle(color)
                                .textCase(.uppercase)
                                .tracking(1.2)
                            Text(title)
                                .font(.title2.weight(.bold))
                                .foregroundStyle(AppTheme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(message)
                                .font(.body)
                                .foregroundStyle(AppTheme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 28))

                    destinationPanel

                    if result.resolverURL != nil || result.finalURL != nil {
                        redirectPanel
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label("You stay in control", systemImage: "hand.raised")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(AppTheme.ink)
                        Text("QR Trust gives a managed trust signal. Safari opens the destination only if you choose to continue.")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 22))

                    VStack(spacing: 10) {
                        if holdRequired {
                            VStack(alignment: .leading, spacing: 8) {
                                HoldToOpenButton(
                                    title: openTitle,
                                    tint: color,
                                    duration: holdDuration,
                                    onComplete: onOpen
                                )
                                Text("Press and hold briefly. This prevents accidental blind opens while keeping the final choice with you.")
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        } else {
                            Button(openTitle) {
                                onOpen()
                            }
                            .buttonStyle(FilledCapsuleButtonStyle(tint: color, foreground: .white))
                            .disabled(result.tone == .checking || result.tone == .idle)
                        }

                        Button("Cancel") {
                            onCancel()
                        }
                        .buttonStyle(OutlineCapsuleButtonStyle())
                    }
                }
                .padding(20)
                .padding(.bottom, 20)
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("Open destination")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") {
                        onCancel()
                    }
                }
            }
        }
    }

    private var destinationPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Destination to open")
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(1.2)

            Text(
                DomainEmphasis.emphasized(
                    destinationFingerprint,
                    host: destinationDisplayHost,
                    strongFont: .title3.weight(.heavy),
                    strong: AppTheme.ink,
                    muted: AppTheme.muted
                )
            )
            .font(.title3.weight(.bold))
            .lineLimit(2)
            .minimumScaleFactor(0.82)

            if destinationFingerprint != destinationDisplayHost {
                Text("Domain: \(destinationDisplayHost)")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppTheme.muted)
            }

            Text(
                DomainEmphasis.emphasized(
                    destinationURL.absoluteString,
                    host: destinationURL.host,
                    strongFont: .footnote.weight(.bold),
                    strong: AppTheme.ink,
                    muted: AppTheme.muted
                )
            )
            .font(.footnote)
            .textSelection(.enabled)
            .lineLimit(4)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 24))
    }

    private var redirectPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Redirect evidence", systemImage: "arrow.triangle.branch")
                .font(.headline.weight(.bold))
                .foregroundStyle(AppTheme.ink)

            if let resolverURL = result.resolverURL {
                sheetEvidenceRow("QR address", resolverURL)
            }

            if let finalURL = result.finalURL {
                sheetEvidenceRow("Observed final target", finalURL)
            }

            if let redirectPolicy = result.redirectPolicy {
                sheetEvidenceRow("Issuer rule", policySummary(redirectPolicy))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 24))
    }

    private func sheetEvidenceRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(0.8)
            Text(value)
                .font(.footnote)
                .foregroundStyle(AppTheme.ink)
                .textSelection(.enabled)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func policySummary(_ value: String) -> String {
        switch value {
        case "resolver_to_final:max_1_hop":
            return "Resolver may forward once, but the final target must stay approved."
        default:
            return value
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: ":", with: " - ")
        }
    }
}

private struct QRUseGuideSheet: View {
    let onDone: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 52, height: 52)
                            .background(AppTheme.trust, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                        Text("QR use types matter")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(AppTheme.ink)

                        Text("A QR is not safe or unsafe just because it scans. The intended use controls whether repeat scans are normal or suspicious.")
                            .font(.body)
                            .foregroundStyle(AppTheme.muted)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                    QRUseGuideRow(
                        symbol: "qrcode",
                        title: "Shared public QR",
                        badge: "Reusable",
                        detail: "Menus, posters, signs, and public web links can be scanned by many people. They should stay green only while the issuer still approves the destination.",
                        tint: AppTheme.securityBlue
                    )

                    QRUseGuideRow(
                        symbol: "1.circle",
                        title: "One-time QR",
                        badge: "Single use",
                        detail: "Login, payment, and approval QRs can be valid once and then turn red. A second user should ask for a fresh QR.",
                        tint: AppTheme.orange
                    )

                    QRUseGuideRow(
                        symbol: "timer",
                        title: "Time-limited QR",
                        badge: "Expires",
                        detail: "Tickets, short sessions, and temporary access can be reusable only inside their validity window.",
                        tint: AppTheme.orange
                    )

                    VStack(alignment: .leading, spacing: 10) {
                        Label("The four checks still apply", systemImage: "shield.lefthalf.filled")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(AppTheme.ink)
                        Text("Use type does not replace issuer legitimacy, destination binding, runtime safety, or the final scanner decision. It only tells the verifier how repeat scans should be interpreted.")
                            .font(.footnote)
                            .foregroundStyle(AppTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
                .padding(20)
                .padding(.bottom, 20)
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("QR use guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        onDone()
                    }
                }
            }
        }
    }
}

private struct QRUseGuideRow: View {
    let symbol: String
    let title: String
    let badge: String
    let detail: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.headline.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 42, height: 42)
                .background(tint.opacity(0.12), in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(AppTheme.ink)
                    Spacer(minLength: 0)
                    Text(badge)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(tint)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(tint.opacity(0.12), in: Capsule())
                }

                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(tint.opacity(0.14), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(badge). \(detail)")
    }
}

private struct HoldToOpenButton: View {
    let title: String
    let tint: Color
    let duration: Double
    let onComplete: () -> Void

    @State private var isHolding = false

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule()
                .fill(tint.opacity(0.95))

            GeometryReader { proxy in
                Capsule()
                    .fill(Color.white.opacity(0.24))
                    .frame(width: isHolding ? proxy.size.width : 0)
                    .animation(.linear(duration: isHolding ? duration : 0.12), value: isHolding)
            }
            .clipShape(Capsule())
            .allowsHitTesting(false)

            Label(title, systemImage: "hand.tap")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 52)
        .contentShape(Capsule())
        .onLongPressGesture(
            minimumDuration: duration,
            maximumDistance: 44,
            pressing: { pressing in
                isHolding = pressing
            },
            perform: {
                isHolding = false
                onComplete()
            }
        )
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(title)
        .accessibilityHint(holdHint)
    }

    /// VoiceOver users cannot see the fill animation, so the hint has to carry
    /// the actual required duration — an upper bound ("less than one second")
    /// makes a deliberate interlock sound like an accident of timing.
    private var holdHint: String {
        let seconds = (duration * 10).rounded() / 10
        let formatted = seconds == seconds.rounded()
            ? String(format: "%.0f", seconds)
            : String(format: "%.1f", seconds)
        return "Press and hold for \(formatted) second\(seconds == 1 ? "" : "s") to open the destination."
    }
}

private struct DestinationReviewCard: View {
    let result: ScanResult
    let destination: String
    let host: String

    private var statusTitle: String {
        switch result.tone {
        case .trusted:
            return "Approved"
        case .caution:
            return "Review"
        case .blocked:
            return "Blocked"
        case .unavailable:
            return "Unavailable"
        case .checking:
            return "Checking"
        case .idle:
            return "Not checked"
        }
    }

    private var destinationMessage: String {
        if result.resolverURL != nil {
            switch result.tone {
            case .trusted:
                return "The resolver and final destination both stayed within issuer policy."
            case .blocked:
                return "The visible resolver was recognized, but it ended at a destination outside issuer policy."
            default:
                return "Review both the resolver and final destination before opening."
            }
        }

        switch result.tone {
        case .trusted:
            return "This is the destination QR Trust approved for this scan."
        case .caution, .unavailable:
            return "A destination was found, but it was not fully verified."
        case .blocked:
            return "This destination failed a required trust check."
        case .checking:
            return "QR Trust is checking this destination."
        case .idle:
            return "No destination has been checked yet."
        }
    }

    private var visibleDestination: String {
        result.finalURL ?? destination
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: result.resolverURL == nil ? "link" : "arrow.triangle.branch")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(detailColor(for: result.tone), in: Circle())

                VStack(alignment: .leading, spacing: 5) {
                    Text(result.resolverURL == nil ? "Destination" : "Redirect destination")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                        .textCase(.uppercase)
                        .tracking(1.1)
                    Text(
                        DomainEmphasis.emphasized(
                            host,
                            strongFont: .title3.weight(.heavy),
                            strong: AppTheme.ink,
                            muted: AppTheme.muted
                        )
                    )
                    .font(.title3.weight(.bold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                    Text(destinationMessage)
                        .font(.footnote)
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Text(statusTitle)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(detailColor(for: result.tone))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(detailColor(for: result.tone).opacity(0.12), in: Capsule())
            }

            if let resolverURL = result.resolverURL {
                resolverFlow(resolverURL: resolverURL, finalURL: result.finalURL ?? visibleDestination)
            } else {
                urlEvidence(label: "Address checked", value: destination, symbol: "safari")
            }

            let evidence = compactEvidence
            if !evidence.isEmpty {
                VStack(spacing: 8) {
                    ForEach(evidence) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: item.symbol)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(detailColor(for: result.tone))
                                .frame(width: 24, height: 24)
                                .background(detailColor(for: result.tone).opacity(0.10), in: Circle())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.label)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(AppTheme.muted)
                                    .textCase(.uppercase)
                                    .tracking(0.7)
                                Text(item.value)
                                    .font(.footnote)
                                    .foregroundStyle(AppTheme.ink)
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
                .padding(12)
                .background(AppTheme.surfaceAlt.opacity(0.70), in: RoundedRectangle(cornerRadius: 16))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [
                    AppTheme.surface,
                    detailColor(for: result.tone).opacity(0.06),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 22)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .stroke(detailColor(for: result.tone).opacity(0.16), lineWidth: 1)
        }
    }

    private var compactEvidence: [DestinationEvidence] {
        var items: [DestinationEvidence] = []
        if let redirectHops = result.redirectHops {
            items.append(
                DestinationEvidence(
                    label: "Redirect hops",
                    value: "\(redirectHops)",
                    symbol: "arrow.turn.down.right"
                )
            )
        }
        if let redirectPolicy = result.redirectPolicy {
            items.append(
                DestinationEvidence(
                    label: "Policy rule",
                    value: policySummary(redirectPolicy),
                    symbol: "checklist.checked"
                )
            )
        }
        return items
    }

    private func resolverFlow(resolverURL: String, finalURL: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            urlEvidence(label: "QR resolver", value: resolverURL, symbol: "point.3.connected.trianglepath.dotted")

            HStack(spacing: 8) {
                Rectangle()
                    .fill(detailColor(for: result.tone).opacity(0.18))
                    .frame(width: 2, height: 18)
                    .padding(.leading, 19)
                Image(systemName: "arrow.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(detailColor(for: result.tone))
                Text("final destination after resolver policy")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
                    .tracking(0.5)
            }

            urlEvidence(label: "Final target", value: finalURL, symbol: "flag.checkered")
        }
        .padding(12)
        .background(AppTheme.surfaceAlt.opacity(0.72), in: RoundedRectangle(cornerRadius: 18))
    }

    private func urlEvidence(label: String, value: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(detailColor(for: result.tone))
                .frame(width: 30, height: 30)
                .background(detailColor(for: result.tone).opacity(0.10), in: Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
                    .tracking(0.7)
                Text(
                    DomainEmphasis.emphasized(
                        hostForURL(value) ?? value,
                        strongFont: .subheadline.weight(.heavy),
                        strong: AppTheme.ink,
                        muted: AppTheme.muted
                    )
                )
                .font(.subheadline.weight(.bold))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                Text(
                    DomainEmphasis.emphasized(
                        value,
                        host: hostForURL(value),
                        strongFont: .caption.weight(.bold),
                        strong: AppTheme.ink,
                        muted: AppTheme.muted
                    )
                )
                .font(.caption)
                .textSelection(.enabled)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    private func hostForURL(_ value: String) -> String? {
        URL(string: value)?.host
    }

    private func policySummary(_ value: String) -> String {
        switch value {
        case "resolver_to_final:max_1_hop":
            return "Resolver may forward once, but the final target must stay approved."
        default:
            return value
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: ":", with: " - ")
        }
    }
}

private struct CompactInfoChip: View {
    let title: String
    let symbol: String
    let tone: TrustTone

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.caption.weight(.bold))
            .foregroundStyle(detailColor(for: tone))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(detailColor(for: tone).opacity(0.12), in: Capsule())
            .lineLimit(1)
            .minimumScaleFactor(0.82)
    }
}

private struct ResultDetailView: View {
    let result: ScanResult
    let showTechnicalDetails: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var showGovernanceDetails = false

    private var signals: [TrustLayerSignal] {
        if result.signals.isEmpty {
            return [
                TrustLayerSignal(
                    title: "Issuer legitimacy",
                    state: "Not shown",
                    message: "This scan did not include layer-level issuer detail.",
                    tone: result.tone
                ),
                TrustLayerSignal(
                    title: "Destination binding",
                    state: "Not shown",
                    message: "This scan did not include layer-level destination detail.",
                    tone: result.tone
                ),
                TrustLayerSignal(
                    title: "Runtime safety",
                    state: "Not shown",
                    message: "This scan did not include layer-level runtime detail.",
                    tone: result.tone
                ),
                TrustLayerSignal(
                    title: "Scanner decision",
                    state: detailState(for: result.tone),
                    message: result.message,
                    tone: result.tone
                ),
            ]
        }

        return result.signals.map(normalizedSignalForDisplay)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        header
                        DecisionPathFlowView(signals: signals)
                        contextSummary

                        if showTechnicalDetails, let summary = result.technicalSummary {
                            technicalSummary(summary)
                        }
                    }
                    .padding(16)
                    .padding(.bottom, 20)
                }
            }
            .navigationTitle("Decision path")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            ResultIndicator(tone: result.tone, size: 42)

            VStack(alignment: .leading, spacing: 5) {
                Text(detailState(for: result.tone))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(detailColor(for: result.tone))
                    .textCase(.uppercase)
                    .tracking(1.1)
                Text(result.title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(AppTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(result.message)
                    .font(.footnote)
                    .lineSpacing(1)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private var contextSummary: some View {
        if result.destination != nil || result.trustNamespace != nil {
            VStack(alignment: .leading, spacing: 12) {
                destinationSummary
                trustSourceSummary
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var destinationSummary: some View {
        if let destination = result.destination {
            DestinationReviewCard(
                result: result,
                destination: destination,
                host: detailDisplayHost(for: result, fallback: destination)
            )
        }
    }

    @ViewBuilder
    private var trustSourceSummary: some View {
        if let namespace = result.trustNamespace {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "building.columns")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(detailColor(for: result.tone))
                        .frame(width: 34, height: 34)
                        .background(detailColor(for: result.tone).opacity(0.12), in: Circle())

                    VStack(alignment: .leading, spacing: 3) {
                        Text("Trust source")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(AppTheme.ink)
                        Text(trustSourceDescription)
                            .font(.footnote)
                            .foregroundStyle(AppTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)
                }

                HStack(spacing: 8) {
                    if let assuranceTier = result.assuranceTier {
                        CompactInfoChip(
                            title: humanizedGovernanceValue(assuranceTier),
                            symbol: "checkmark.seal",
                            tone: result.tone
                        )
                    }
                    if let cacheFreshness = result.cacheFreshness {
                        CompactInfoChip(
                            title: "\(humanizedGovernanceValue(cacheFreshness)) cache",
                            symbol: "clock.arrow.circlepath",
                            tone: result.tone
                        )
                    }
                }
                .fixedSize(horizontal: false, vertical: true)

                if showTechnicalDetails {
                    DisclosureGroup(isExpanded: $showGovernanceDetails) {
                        VStack(alignment: .leading, spacing: 8) {
                            detailEvidenceRow("Namespace", namespace)
                            if let cacheExpiresAt = result.cacheExpiresAt {
                                detailEvidenceRow("Cache expires", cacheExpiresAt)
                            }
                        }
                        .padding(.top, 6)
                    } label: {
                        Text("Technical governance details")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AppTheme.ink)
                    }
                    .tint(detailColor(for: result.tone))
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private var trustSourceDescription: String {
        if result.trustNamespace == nil {
            return "No recognized issuer trust source was attached to this scan."
        }
        if let cacheFreshness = result.cacheFreshness {
            return "The verifier used a \(humanizedGovernanceValue(cacheFreshness).lowercased()) issuer record to interpret this QR."
        }
        return "The verifier used an issuer trust record to interpret this QR."
    }

    private func detailEvidenceRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(0.8)
            Text(value)
                .font(.footnote)
                .foregroundStyle(AppTheme.muted)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    private func detailDisplayHost(for result: ScanResult, fallback: String) -> String {
        if let finalURL = result.finalURL,
           let host = URL(string: finalURL)?.host {
            return host
        }
        return result.host ?? fallback
    }

    private func humanizedGovernanceValue(_ value: String) -> String {
        value
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private func technicalSummary(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Verifier detail")
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
                .textCase(.uppercase)
                .tracking(1.1)
            Text(summary)
                .font(.footnote.monospaced())
                .foregroundStyle(AppTheme.muted)
                .textSelection(.enabled)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 22))
    }

    private func normalizedSignalForDisplay(_ signal: TrustLayerSignal) -> TrustLayerSignal {
        guard signal.title == "Destination binding",
              result.tone == .caution,
              result.destination?.lowercased().hasPrefix("http") == true,
              signal.message.localizedCaseInsensitiveContains("valid JSON") else {
            return signal
        }

        return TrustLayerSignal(
            id: signal.id,
            title: signal.title,
            state: signal.state,
            message: "This is a regular URL QR. No recognized QR Trust signal was found, so the destination cannot be issuer-verified.",
            tone: signal.tone
        )
    }
}

private struct DecisionPathFlowView: View {
    let signals: [TrustLayerSignal]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Trust path")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Text("first issue explains result")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
                    .tracking(0.6)
            }

            VStack(spacing: 8) {
                ForEach(Array(signals.enumerated()), id: \.element.id) { index, signal in
                    TrustLayerStepView(
                        index: index + 1,
                        signal: signal,
                        isLast: index == signals.count - 1
                    )
                }
            }
        }
        .padding(14)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 20))
    }
}

private struct TrustLayerStepView: View {
    let index: Int
    let signal: TrustLayerSignal
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle()
                    .fill(detailColor(for: signal.tone).opacity(0.16))
                    .frame(width: 28, height: 28)
                Text("\(index)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(detailColor(for: signal.tone))
            }

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline) {
                    Text(signal.title)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(AppTheme.ink)
                    Spacer()
                    Text(signal.state)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(detailColor(for: signal.tone))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(detailColor(for: signal.tone).opacity(0.12), in: Capsule())
                }

                Text(signal.message)
                    .font(.footnote)
                    .lineSpacing(1)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .background(AppTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 14))
    }
}

private func detailColor(for tone: TrustTone) -> Color {
    switch tone {
    case .trusted:
        return AppTheme.green
    case .caution, .unavailable:
        return AppTheme.orange
    case .blocked:
        return AppTheme.red
    case .idle, .checking:
        return AppTheme.trust
    }
}

private func detailState(for tone: TrustTone) -> String {
    switch tone {
    case .trusted:
        return "Green status"
    case .caution:
        return "Orange status"
    case .blocked:
        return "Red status"
    case .unavailable:
        return "Check unavailable"
    case .checking:
        return "Checking"
    case .idle:
        return "No result yet"
    }
}

private func usagePolicyCopy(
    for usagePolicy: String,
    tone: TrustTone
) -> (title: String, badge: String, body: String, symbol: String, color: Color) {
    switch usagePolicy {
    case "reusable_public":
        return (
            title: "Shared QR",
            badge: "Reusable",
            body: "Meant for posters, menus, and public links. Many people can scan it while the issuer still approves this destination.",
            symbol: "qrcode",
            color: AppTheme.securityBlue
        )
    case "one_time":
        return (
            title: "One-time QR",
            badge: tone == .blocked ? "Used once" : "Single use",
            body: tone == .blocked
                ? "Designed for one person or session. If it was already used, ask for a fresh QR instead of reusing it."
                : "Designed for one person or session. A later scan of the same code should be blocked for safety.",
            symbol: "1.circle",
            color: tone == .blocked ? AppTheme.red : AppTheme.orange
        )
    case "time_limited":
        return (
            title: "Time-limited QR",
            badge: "Expires",
            body: "Reusable only inside its validity window. Ask for a fresh QR after the time window closes.",
            symbol: "timer",
            color: tone == .blocked ? AppTheme.red : AppTheme.orange
        )
    default:
        return (
            title: "QR use type",
            badge: usagePolicy.replacingOccurrences(of: "_", with: " ").capitalized,
            body: "The issuer attached a use policy to this QR. Review the result before opening.",
            symbol: "info.circle",
            color: detailColor(for: tone)
        )
    }
}

private func scannerRiskColor(_ scannerUX: ScannerDecisionUX, fallbackTone: TrustTone) -> Color {
    switch scannerUX.riskStripe {
    case "green":
        return AppTheme.green
    case "amber":
        return AppTheme.orange
    case "red":
        return AppTheme.red
    default:
        return detailColor(for: fallbackTone)
    }
}

private func scannerRiskLabel(_ scannerUX: ScannerDecisionUX) -> String {
    switch scannerUX.riskLevel {
    case "green":
        return "Low risk"
    case "amber":
        return "Medium risk"
    case "red":
        return "High risk"
    default:
        return "Risk signal"
    }
}

private func reasonCodeLabel(_ code: String) -> String {
    switch code {
    case "plain_url":
        return "Normal link"
    case "provider_unreachable":
        return "Service unavailable"
    case "net_new_domain":
        return "New destination"
    case "embedded_credentials":
        return "Hidden login text"
    case "suspicious_tld":
        return "Unusual domain"
    case "redirect_chain":
        return "Redirect chain"
    case "https_absent":
        return "No HTTPS"
    case "known_bad":
        return "Known risky"
    case "newly_registered":
        return "New domain"
    case "caption_domain_mismatch":
        return "Text mismatch"
    case "runtime_risky":
        return "Runtime risk"
    case "stale_trust_state":
        return "Stale trust"
    case "issuer_unknown":
        return "Issuer unknown"
    case "destination_mismatch":
        return "Destination changed"
    case "one_time_used":
        return "One-time used"
    case "redirect_policy_block":
        return "Redirect blocked"
    case "runtime_blocked":
        return "Runtime blocked"
    case "trust_cache_unavailable":
        return "Trust cache unavailable"
    case "signature_invalid":
        return "Signature failed"
    case "unreadable_payload":
        return "Unreadable QR"
    default:
        return code
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }
}

private func reasonCodeSymbol(_ code: String) -> String {
    switch code {
    case "plain_url":
        return "link"
    case "provider_unreachable", "trust_cache_unavailable":
        return "wifi.exclamationmark"
    case "embedded_credentials":
        return "key"
    case "suspicious_tld", "known_bad", "runtime_risky", "runtime_blocked":
        return "exclamationmark.triangle"
    case "redirect_chain", "redirect_policy_block":
        return "arrow.triangle.branch"
    case "https_absent":
        return "lock.slash"
    case "one_time_used":
        return "clock"
    case "signature_invalid":
        return "pencil.and.outline"
    default:
        return "info.circle"
    }
}

private struct FilledCapsuleButtonStyle: ButtonStyle {
    let tint: Color
    let foreground: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.semibold))
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 50)
            .background(tint.opacity(configuration.isPressed ? 0.84 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.82), value: configuration.isPressed)
    }
}

private struct OutlineCapsuleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.semibold))
            .foregroundStyle(AppTheme.ink)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 50)
            .background(AppTheme.surfaceAlt.opacity(configuration.isPressed ? 0.72 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppTheme.separator, lineWidth: 1)
            }
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.82), value: configuration.isPressed)
    }
}

/// Controls drawn on top of the live camera preview.
///
/// `minHeight: 44` is Apple's minimum target, and it is not cosmetic here: a
/// missed tap over a running preview costs the user the framing they were
/// holding, not just a second attempt.
private struct ScannerChromeButtonStyle: ButtonStyle {
    var isOn = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(isOn ? AppTheme.cameraBackdrop : AppTheme.cameraChrome)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(
                isOn ? AnyShapeStyle(AppTheme.cameraChrome) : AnyShapeStyle(.ultraThinMaterial),
                in: Capsule()
            )
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

/// Renders a host or URL with its registrable domain set apart from the rest.
///
/// The attack this defends against is `paypal.com.evil.ru`: every label before
/// the last two is attacker-controlled, and a flat single-color string invites
/// the reader to stop at the first familiar word. Emphasising only the
/// registrable domain puts the weight on the part that actually decides who is
/// answering.
private enum DomainEmphasis {
    /// Suffixes that take a third label to reach a registrable name
    /// (`bbc.co.uk`, not `co.uk`).
    ///
    /// A deliberate heuristic, not the Public Suffix List — shipping and
    /// refreshing the full list is out of scope for the lab app. It is tuned so
    /// that misses *under*-emphasise (showing `uk.com` for `something.uk.com`)
    /// and never emphasise a label the registrant does not control, which would
    /// be the only failure mode that misleads.
    private static let secondLevelSuffixes: Set<String> = [
        "co", "com", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "mil"
    ]

    static func registrableDomain(of host: String) -> String? {
        let cleaned = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        guard !cleaned.isEmpty else { return nil }

        let labels = cleaned.split(separator: ".").map(String.init)
        guard labels.count > 1 else { return labels.first }

        // A bare IP address has no registrable domain; splitting it would
        // emphasise "113.5" out of "203.0.113.5", which reads as a domain and
        // isn't one. The example is from the RFC 5737 documentation range on
        // purpose: the release audit bans private-range literals tree-wide,
        // because a hardcoded LAN address here is how a developer's home
        // network reaches a public repo.
        if labels.allSatisfy({ $0.allSatisfy(\.isNumber) }) { return cleaned }

        if labels.count >= 3, secondLevelSuffixes.contains(labels[labels.count - 2]) {
            return labels.suffix(3).joined(separator: ".")
        }
        return labels.suffix(2).joined(separator: ".")
    }

    /// `text` rendered in `muted`, with its registrable domain in `strong`.
    ///
    /// Pass `host` when `text` is a full URL — the domain is located inside the
    /// displayed string, so the caller's host is what decides which run to lift.
    static func emphasized(
        _ text: String,
        host: String? = nil,
        strongFont: Font,
        strong: Color,
        muted: Color
    ) -> AttributedString {
        var attributed = AttributedString(text)
        attributed.foregroundColor = muted

        guard
            let domain = registrableDomain(of: host ?? text),
            let range = attributed.range(of: domain, options: [.caseInsensitive])
        else {
            // Nothing we can isolate — show the whole string at full weight
            // rather than leaving the destination uniformly de-emphasised.
            attributed.foregroundColor = strong
            attributed.font = strongFont
            return attributed
        }

        attributed[range].foregroundColor = strong
        attributed[range].font = strongFont
        return attributed
    }
}
