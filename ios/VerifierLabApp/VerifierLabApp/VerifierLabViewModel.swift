import CryptoKit
import Foundation

@MainActor
final class VerifierLabViewModel: ObservableObject {
    @Published var result: ScanResult = .empty
    @Published var recentResults: [ScanResult] {
        didSet {
            persistHistory()
        }
    }
    @Published var historyRetention: HistoryRetentionProfile {
        didSet {
            defaults.set(historyRetention.rawValue, forKey: Keys.historyRetention)
            applyHistoryRetention()
        }
    }
    @Published var isScanning = false
    @Published var isChecking = false
    @Published var providerConnectionStatus: ProviderConnectionStatus = .notChecked
    @Published var isCheckingProviderConnection = false
    @Published var isRefreshingProviderProfile = false
    @Published var installedProviderProfile: ImportedVerifierProviderProfile?

    private var api: VerifierAPI
    private var activeProviderProfileFingerprint = ""
    private let defaults: UserDefaults
    private let encoder = JSONEncoder()

    // Demo trust anchor for signed provider-profile fixtures; production apps should
    // receive this key set from an approved trust program or managed device policy.
    private static let trustedProviderProfileSigningKeys = [
        "qrtrust-demo-provider-2026": "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ=",
    ]
    private static let allowedProviderProfileStates = Set(["active", "stale", "revoked"])

    private enum Keys {
        static let recentResults = "qrtrust.recentResults.v1"
        static let historyRetention = "qrtrust.historyRetention"
        static let importedProviderProfile = "qrtrust.importedProviderProfile.v1"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let importedProviderProfile = Self.loadImportedProviderProfile(from: defaults)
        installedProviderProfile = importedProviderProfile
        api = VerifierAPI(importedProviderProfile: importedProviderProfile)
        historyRetention = HistoryRetentionProfile(
            rawValue: defaults.string(forKey: Keys.historyRetention) ?? ""
        ) ?? .last20
        let initialProfileState = Self.normalizedProviderProfileState(api.providerProfileState) ?? "active"
        recentResults = Self.loadHistory(from: defaults)
            .filter { Self.scanResult($0, matchesProfileState: initialProfileState) }
        recentResults = Array(recentResults.prefix(historyRetention.limit))
        activeProviderProfileFingerprint = Self.providerProfileFingerprint(
            profile: importedProviderProfile,
            api: api
        )
    }

    var providerProfile: ManagedVerifierProfile {
        installedProviderProfile?.managedProfile ?? .localDemo(endpointSummary: api.endpointSummary)
    }

    var activeVerifierProfileState: String {
        Self.normalizedProviderProfileState(api.providerProfileState) ?? "active"
    }

    var canOpenDestination: Bool {
        result.destination != nil
    }

    private static func normalizedProviderProfileState(_ rawValue: String?) -> String? {
        guard let state = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !state.isEmpty,
              allowedProviderProfileStates.contains(state) else {
            return nil
        }

        return state
    }

    private static func scanResult(
        _ scanResult: ScanResult,
        matchesProfileState profileState: String
    ) -> Bool {
        let resultState = normalizedProviderProfileState(scanResult.verifierProfileState) ?? "active"
        return resultState == profileState
    }

    private static func providerProfileFingerprint(
        profile: ImportedVerifierProviderProfile?,
        api: VerifierAPI
    ) -> String {
        // Endpoint changes are deliberately excluded: switching verifier URLs
        // does not change which provider signed past results, so scan history
        // must survive an endpoint-only reconfiguration.
        [
            profile?.id ?? "no-runtime-provider-profile",
            normalizedProviderProfileState(profile?.profileState)
                ?? normalizedProviderProfileState(api.providerProfileState)
                ?? "active",
        ].joined(separator: "|")
    }

    private func providerProfileFingerprint() -> String {
        Self.providerProfileFingerprint(profile: installedProviderProfile, api: api)
    }

    func refreshProviderConnectionIfNeeded() async {
        guard providerConnectionStatus.tone == .notChecked else {
            return
        }
        await checkProviderConnection()
    }

    func checkProviderConnection() async {
        guard !isCheckingProviderConnection else {
            return
        }

        guard api.hasProviderCandidates else {
            providerConnectionStatus = ProviderConnectionStatus(
                tone: .misconfigured,
                title: String(localized: "No provider profile"),
                message: String(localized: "This app does not have a managed verifier provider installed."),
                endpoint: nil,
                checkedAt: Date(),
                technicalDetail: nil
            )
            return
        }

        isCheckingProviderConnection = true
        defer {
            isCheckingProviderConnection = false
        }
        providerConnectionStatus = ProviderConnectionStatus(
            tone: .checking,
            title: String(localized: "Checking provider"),
            message: String(localized: "Checking whether the protection service can answer QR decisions."),
            endpoint: nil,
            candidateEndpoints: api.endpointSummary,
            checkedAt: nil,
            technicalDetail: nil
        )

        do {
            let probe = try await api.checkVerifierStatus()
            applyRuntimeProviderProfileState(from: probe.status)
            providerConnectionStatus = reachableProviderStatus(from: probe)
        } catch {
            providerConnectionStatus = unreachableProviderStatus(from: error)
        }
    }

    func refreshProviderProfile() async {
        guard !isRefreshingProviderProfile else {
            return
        }

        guard api.hasProviderCandidates else {
            providerConnectionStatus = ProviderConnectionStatus(
                tone: .misconfigured,
                title: String(localized: "No provider endpoint"),
                message: String(localized: "This app needs a provider endpoint before it can refresh a managed provider profile."),
                endpoint: nil,
                checkedAt: Date(),
                technicalDetail: nil
            )
            return
        }

        isRefreshingProviderProfile = true
        providerConnectionStatus = ProviderConnectionStatus(
            tone: .checking,
            title: String(localized: "Refreshing provider profile"),
            message: String(localized: "Asking the protection service for the current managed provider profile."),
            endpoint: nil,
            candidateEndpoints: api.endpointSummary,
            checkedAt: nil,
            technicalDetail: nil
        )
        defer {
            isRefreshingProviderProfile = false
        }

        do {
            let probe = try await api.fetchProviderProfileDocument()
            let profile = try Self.readImportedProviderProfile(from: probe.data)
            let previousFingerprint = activeProviderProfileFingerprint
            installedProviderProfile = profile
            persistImportedProviderProfile(profile)
            api = VerifierAPI(importedProviderProfile: profile)
            reconcileProviderProfileChange(previousFingerprint: previousFingerprint)
            providerConnectionStatus = ProviderConnectionStatus(
                tone: .notChecked,
                title: String(localized: "Provider profile refreshed"),
                message: String(localized: "Installed the latest provider profile from \(profile.name). Checking whether it can answer QR decisions."),
                endpoint: probe.baseURLString,
                candidateEndpoints: api.endpointSummary,
                checkedAt: Date(),
                technicalDetail: nil
            )
            await checkProviderConnection()
        } catch {
            providerConnectionStatus = ProviderConnectionStatus(
                tone: .misconfigured,
                title: String(localized: "Profile refresh failed"),
                message: String(localized: "The app could not install the latest provider profile from the protection service."),
                endpoint: nil,
                candidateEndpoints: api.endpointSummary,
                checkedAt: Date(),
                technicalDetail: error.localizedDescription
            )
        }
    }

    func resetForNewScan() {
        result = .empty
    }

    func clearHistory() {
        recentResults.removeAll()
    }

    private func reconcileProviderProfileChange(previousFingerprint: String) {
        let currentFingerprint = providerProfileFingerprint()
        guard currentFingerprint != previousFingerprint else {
            return
        }

        result = .empty
        recentResults.removeAll()
        activeProviderProfileFingerprint = currentFingerprint
    }

    private func applyRuntimeProviderProfileState(from status: VerifierRuntimeStatus) {
        guard let runtimeState = Self.normalizedProviderProfileState(status.verifierProfileState),
              let installedProviderProfile,
              Self.normalizedProviderProfileState(installedProviderProfile.profileState) != runtimeState else {
            return
        }

        let previousFingerprint = activeProviderProfileFingerprint
        let updatedProfile = installedProviderProfile.replacingProfileState(runtimeState)
        self.installedProviderProfile = updatedProfile
        persistImportedProviderProfile(updatedProfile)
        api = VerifierAPI(importedProviderProfile: updatedProfile)
        reconcileProviderProfileChange(previousFingerprint: previousFingerprint)
    }

    func setHistoryRetention(_ retention: HistoryRetentionProfile) {
        historyRetention = retention
    }

    func importProviderProfile(from url: URL) async {
        do {
            let profile = try Self.readImportedProviderProfile(from: url)
            let previousFingerprint = activeProviderProfileFingerprint
            installedProviderProfile = profile
            persistImportedProviderProfile(profile)
            api = VerifierAPI(importedProviderProfile: profile)
            reconcileProviderProfileChange(previousFingerprint: previousFingerprint)
            providerConnectionStatus = ProviderConnectionStatus(
                tone: .notChecked,
                title: String(localized: "Provider profile imported"),
                message: String(localized: "The app installed \(profile.name). Checking whether it can answer QR decisions."),
                endpoint: nil,
                candidateEndpoints: api.endpointSummary,
                checkedAt: nil,
                technicalDetail: nil
            )
            await checkProviderConnection()
        } catch {
            recordProviderProfileImportFailure(error)
        }
    }

    func removeImportedProviderProfile() {
        let previousFingerprint = activeProviderProfileFingerprint
        installedProviderProfile = nil
        defaults.removeObject(forKey: Keys.importedProviderProfile)
        api = VerifierAPI()
        reconcileProviderProfileChange(previousFingerprint: previousFingerprint)
        providerConnectionStatus = ProviderConnectionStatus(
            tone: .notChecked,
            title: String(localized: "Provider profile removed"),
            message: String(localized: "The provider profile was removed from app state. Refresh or import a provider profile before production use."),
            endpoint: nil,
            candidateEndpoints: api.endpointSummary,
            checkedAt: nil,
            technicalDetail: nil
        )
    }

    func recordProviderProfileImportFailure(_ error: Error) {
        providerConnectionStatus = ProviderConnectionStatus(
            tone: .misconfigured,
            title: String(localized: "Profile import failed"),
            message: String(localized: "The selected provider profile could not be installed."),
            endpoint: nil,
            checkedAt: Date(),
            technicalDetail: error.localizedDescription
        )
    }

    func handleCameraFailure(_ reason: String) {
        result = ScanResult(
            tone: .unavailable,
            title: String(localized: "Camera unavailable"),
            message: reason,
            destination: nil,
            host: nil,
            checkedAt: Date(),
            technicalSummary: nil,
            verifierProfileState: activeVerifierProfileState
        )
    }

    func handleScannedPayload(_ payload: String) async {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            publish(
                ScanResult(
                    tone: .caution,
                    title: String(localized: "QR not readable"),
                    message: String(localized: "Try scanning again with better lighting or a clearer code."),
                    destination: nil,
                    host: nil,
                    checkedAt: Date(),
                    technicalSummary: nil,
                    verifierProfileState: activeVerifierProfileState
                )
            )
            return
        }

        isChecking = true
        result = ScanResult(
            tone: .checking,
            title: String(localized: "Checking QR"),
            message: String(localized: "We are checking the issuer and destination before you continue."),
            destination: nil,
            host: nil,
            checkedAt: Date(),
            technicalSummary: nil,
            verifierProfileState: activeVerifierProfileState
        )
        Feedback.capture()

        if let profileGateResult = localProfileStateResult(
            for: activeVerifierProfileState,
            payload: trimmed
        ) {
            publish(profileGateResult)
            Feedback.decision(allowed: false)
            isChecking = false
            return
        }

        do {
            let decision = try await api.decideScannedQR(trimmed)
            let scanResult = result(from: decision)
            publish(scanResult)
            Feedback.decision(allowed: scanResult.tone == .trusted)
        } catch {
            let fallbackURL = fallbackDestinationURL(from: trimmed)
            publish(
                ScanResult(
                    tone: .unavailable,
                    title: String(localized: "Could not check this QR"),
                    message: userFacingError(error, fallbackURL: fallbackURL),
                    destination: fallbackURL?.absoluteString,
                    host: fallbackURL?.host,
                    checkedAt: Date(),
                    technicalSummary: error.localizedDescription,
                    verifierProfileState: activeVerifierProfileState,
                    scannerUX: ScannerDecisionUX.unavailableFallback(for: fallbackURL),
                    signals: unavailableTrustLayers(fallbackURL: fallbackURL)
                )
            )
            Feedback.decision(allowed: false)
        }

        isChecking = false
    }

    private func publish(_ scanResult: ScanResult) {
        result = scanResult
        guard scanResult.tone != .idle && scanResult.tone != .checking else {
            return
        }
        guard historyRetention.limit > 0 else {
            return
        }
        recentResults.insert(scanResult, at: 0)
        recentResults = Array(recentResults.prefix(historyRetention.limit))
    }

    private func persistHistory() {
        guard historyRetention.limit > 0 else {
            defaults.removeObject(forKey: Keys.recentResults)
            return
        }

        let trimmed = Array(recentResults.prefix(historyRetention.limit))
        if let data = try? encoder.encode(trimmed) {
            defaults.set(data, forKey: Keys.recentResults)
        }
    }

    private func applyHistoryRetention() {
        guard historyRetention.limit > 0 else {
            recentResults.removeAll()
            defaults.removeObject(forKey: Keys.recentResults)
            return
        }

        if recentResults.count > historyRetention.limit {
            recentResults = Array(recentResults.prefix(historyRetention.limit))
        } else {
            persistHistory()
        }
    }

    private static func loadHistory(from defaults: UserDefaults) -> [ScanResult] {
        guard let data = defaults.data(forKey: Keys.recentResults) else {
            return []
        }
        return (try? JSONDecoder().decode([ScanResult].self, from: data)) ?? []
    }

    private static func loadImportedProviderProfile(
        from defaults: UserDefaults
    ) -> ImportedVerifierProviderProfile? {
        guard let data = defaults.data(forKey: Keys.importedProviderProfile) else {
            return nil
        }
        guard let profile = try? JSONDecoder().decode(ImportedVerifierProviderProfile.self, from: data),
              (try? validateImportedProviderProfile(profile)) != nil else {
            return nil
        }
        return profile
    }

    private func persistImportedProviderProfile(_ profile: ImportedVerifierProviderProfile) {
        if let data = try? encoder.encode(profile) {
            defaults.set(data, forKey: Keys.importedProviderProfile)
        }
    }

    private static func readImportedProviderProfile(from url: URL) throws -> ImportedVerifierProviderProfile {
        let didStartAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didStartAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let data = try Data(contentsOf: url)
        return try readImportedProviderProfile(from: data)
    }

    private static func readImportedProviderProfile(from data: Data) throws -> ImportedVerifierProviderProfile {
        let decoder = JSONDecoder()

        if let envelope = try? decoder.decode(ImportedVerifierProviderProfileEnvelope.self, from: data) {
            return try readSignedProviderProfile(from: envelope, decoder: decoder)
        }

        let profile = try decoder.decode(ImportedVerifierProviderProfile.self, from: data)
        try validateImportedProviderProfile(profile)
        guard allowsUnsignedLocalReviewerProfile(profile) else {
            throw ProviderProfileImportError.unsignedProductionProfile
        }
        return profile
    }

    private static func readSignedProviderProfile(
        from envelope: ImportedVerifierProviderProfileEnvelope,
        decoder: JSONDecoder
    ) throws -> ImportedVerifierProviderProfile {
        guard envelope.signature.algorithm.lowercased() == "ed25519" else {
            throw ProviderProfileImportError.unsupportedSignatureAlgorithm
        }
        guard let payloadData = envelope.payload.base64URLDecodedData() else {
            throw ProviderProfileImportError.invalidSignedPayload
        }
        guard let signatureData = envelope.signature.value.base64URLDecodedData() else {
            throw ProviderProfileImportError.invalidSignature
        }
        guard let publicKeyBase64 = trustedProviderProfileSigningKeys[envelope.signature.keyID],
              let publicKeyData = Data(base64Encoded: publicKeyBase64) else {
            throw ProviderProfileImportError.untrustedSigningKey
        }

        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData)
        guard publicKey.isValidSignature(signatureData, for: payloadData) else {
            throw ProviderProfileImportError.invalidSignature
        }

        let profile = try decoder.decode(ImportedVerifierProviderProfile.self, from: payloadData)
        try validateImportedProviderProfile(profile)
        return profile.replacingSignatureStatus(String(localized: "Signed provider profile verified"))
    }

    private static func validateImportedProviderProfile(
        _ profile: ImportedVerifierProviderProfile
    ) throws {
        guard !profile.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !profile.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ProviderProfileImportError.missingIdentity
        }

        let allowedStates = Set(["active", "stale", "revoked"])
        guard allowedStates.contains(profile.profileState.lowercased()) else {
            throw ProviderProfileImportError.invalidState
        }

        guard !profile.endpoints.isEmpty else {
            throw ProviderProfileImportError.missingEndpoint
        }

        for endpoint in profile.endpoints {
            let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let url = URL(string: trimmed),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "https" || scheme == "http",
                  url.host != nil else {
                throw ProviderProfileImportError.invalidEndpoint
            }
        }
    }

    private static func allowsUnsignedLocalReviewerProfile(
        _ profile: ImportedVerifierProviderProfile
    ) -> Bool {
        let id = profile.id.lowercased()
        let signatureStatus = profile.signatureStatus.lowercased()
        guard id.hasPrefix("local-"),
              signatureStatus.contains("local") || signatureStatus.contains("unsigned") || signatureStatus.contains("not production-verified") else {
            return false
        }

        return profile.endpoints.allSatisfy(isLocalReviewerEndpoint)
    }

    private static func isLocalReviewerEndpoint(_ endpoint: String) -> Bool {
        let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let host = url.host?.lowercased() else {
            return false
        }

        if host == "localhost" || host == "::1" || host.hasSuffix(".local") || host.hasPrefix("127.") {
            return true
        }
        if host.hasPrefix("10.") || host.hasPrefix("192.168.") {
            return true
        }

        let octets = host.split(separator: ".").compactMap { Int($0) }
        return octets.count == 4 && octets[0] == 172 && (16...31).contains(octets[1])
    }

    private func reachableProviderStatus(from probe: VerifierStatusProbe) -> ProviderConnectionStatus {
        let status = probe.status
        let credentialCopy = status.apiKeyAuthEnabled
            ? String(localized: "The provider is reachable and expects managed scanner credentials.")
            : String(localized: "The provider is reachable in open demo mode.")
        let runtimeCopy = status.redisConnected
            ? String(localized: "Shared runtime state is available.")
            : String(localized: "Shared runtime state is using the local demo fallback.")
        let technicalDetail = [
            "scanner auth: \(status.apiKeyAuthEnabled ? "enabled" : "disabled")",
            "admin flow: \(status.adminAPIKeyManagementEnabled ? "enabled" : "disabled")",
            "redis: \(status.redisConnected ? "connected" : "not connected")",
            "rate limit: \(status.rateLimitMaxRequests)/\(status.rateLimitWindowSeconds)s",
        ].joined(separator: "\n")
        let profileState = activeVerifierProfileState

        if profileState == "stale" {
            return ProviderConnectionStatus(
                tone: .stale,
                title: String(localized: "Provider profile stale"),
                message: String(localized: "Needs refresh because the provider profile is stale. Scanner decisions should use caution until the managed profile is refreshed."),
                endpoint: probe.baseURLString,
                candidateEndpoints: api.endpointSummary,
                checkedAt: Date(),
                technicalDetail: technicalDetail + "\nprofile is stale"
            )
        }

        if profileState == "revoked" {
            return ProviderConnectionStatus(
                tone: .revoked,
                title: String(localized: "Provider profile revoked"),
                message: String(localized: "Do not use this provider because the profile was revoked. Scanner decisions should not rely on this trust program."),
                endpoint: probe.baseURLString,
                candidateEndpoints: api.endpointSummary,
                checkedAt: Date(),
                technicalDetail: technicalDetail + "\nprofile was revoked"
            )
        }

        return ProviderConnectionStatus(
            tone: .reachable,
            title: String(localized: "Provider reachable"),
            message: "\(credentialCopy) \(runtimeCopy)",
            endpoint: probe.baseURLString,
            candidateEndpoints: api.endpointSummary,
            checkedAt: Date(),
            technicalDetail: technicalDetail
        )
    }

    private func unreachableProviderStatus(from error: Error) -> ProviderConnectionStatus {
        let title: String
        let message: String
        let tone: ProviderConnectionTone

        if let scannerError = error as? ScannerAppError {
            switch scannerError {
            case .noAvailableVerifier:
                title = String(localized: "No provider profile")
                message = String(localized: "This app does not have a managed verifier provider installed.")
                tone = .misconfigured
            case .invalidBaseURL:
                title = String(localized: "Provider setup needs attention")
                message = String(localized: "The provider address is not valid. Import a signed provider profile before production use.")
                tone = .misconfigured
            case .invalidResponse:
                title = String(localized: "Provider response unreadable")
                message = String(localized: "The provider answered, but the app could not understand its status response.")
                tone = .unreachable
            case .server:
                title = String(localized: "Provider returned a problem")
                message = String(localized: "The provider is present, but it could not complete the status check.")
                tone = .unreachable
            }
        } else if let urlError = error as? URLError {
            switch urlError.code {
            case .serverCertificateUntrusted, .secureConnectionFailed, .serverCertificateHasUnknownRoot:
                title = String(localized: "Provider identity not trusted")
                message = String(localized: "The phone could reach the provider, but could not trust its certificate.")
                tone = .misconfigured
            case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost:
                title = String(localized: "Provider not reachable")
                message = String(localized: "The phone cannot reach the protection service right now. Check Wi-Fi, VPN, or provider availability.")
                tone = .unreachable
            default:
                title = String(localized: "Provider check failed")
                message = String(localized: "The app could not confirm that the protection service is available.")
                tone = .unreachable
            }
        } else {
            title = String(localized: "Provider check failed")
            message = String(localized: "The app could not confirm that the protection service is available.")
            tone = .unreachable
        }

        return ProviderConnectionStatus(
            tone: tone,
            title: title,
            message: message,
            endpoint: nil,
            candidateEndpoints: api.endpointSummary,
            checkedAt: Date(),
            technicalDetail: error.localizedDescription
        )
    }

    private func directWebURL(from payload: String) -> URL? {
        guard let url = URL(string: payload),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              url.host != nil else {
            return nil
        }
        return url
    }

    private func fallbackDestinationURL(from qrPayload: String) -> URL? {
        directWebURL(from: qrPayload) ?? signedEnvelopeDestinationURL(from: qrPayload)
    }

    private func localProfileStateResult(for profileState: String, payload: String) -> ScanResult? {
        let normalizedProfileState = profileState.lowercased()
        guard normalizedProfileState == "stale" || normalizedProfileState == "revoked" else {
            return nil
        }

        let fallbackURL = fallbackDestinationURL(from: payload)
        let isRevoked = normalizedProfileState == "revoked"
        let tone: TrustTone = isRevoked ? .blocked : .caution

        return ScanResult(
            tone: tone,
            title: isRevoked
                ? String(localized: "Do not open")
                : String(localized: "Provider profile needs refresh"),
            message: isRevoked
                ? String(localized: "This verifier provider profile was revoked. Use another trusted scanner or update the provider profile before continuing.")
                : String(localized: "The verifier provider profile is stale. A destination may be visible, but this scanner should not show a green result until the profile is refreshed."),
            destination: fallbackURL?.absoluteString,
            host: fallbackURL?.host,
            checkedAt: Date(),
            technicalSummary: normalizedProfileState == "revoked" ? "profile_revoked" : "profile_stale",
            verifierProfileState: normalizedProfileState,
            signals: localProfileStateTrustLayers(
                profileState: normalizedProfileState,
                fallbackURL: fallbackURL
            )
        )
    }

    private func signedEnvelopeDestinationURL(from qrPayload: String) -> URL? {
        guard let data = qrPayload.data(using: .utf8),
              let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let claims = envelope["claims"] as? [String: Any],
              let destination = claims["payload"] as? String else {
            return nil
        }

        return directWebURL(from: destination)
    }

    private func unavailableTrustLayers(fallbackURL: URL?) -> [TrustLayerSignal] {
        let hasDestination = fallbackURL != nil
        return [
            TrustLayerSignal(
                title: String(localized: "Issuer legitimacy"),
                state: String(localized: "Not checked"),
                message: String(localized: "The verifier could not be reached, so issuer enrollment was not confirmed."),
                tone: .unavailable
            ),
            TrustLayerSignal(
                title: String(localized: "Destination binding"),
                state: hasDestination ? String(localized: "Unverified") : String(localized: "Not available"),
                message: hasDestination
                    ? String(localized: "A destination was read from the QR, but it was not checked against issuer policy.")
                    : String(localized: "No openable destination could be safely extracted on-device."),
                tone: .caution
            ),
            TrustLayerSignal(
                title: String(localized: "Runtime safety"),
                state: String(localized: "Not evaluated"),
                message: String(localized: "Current destination safety was not evaluated because the protection service was unreachable."),
                tone: .unavailable
            ),
            TrustLayerSignal(
                title: String(localized: "Scanner decision"),
                state: String(localized: "Orange"),
                message: hasDestination
                    ? String(localized: "The destination is visible but unverified. Continue only if you trust where the QR came from.")
                    : String(localized: "The QR could not be checked. Try again when the protection service is reachable."),
                tone: .unavailable
            ),
        ]
    }

    private func localProfileStateTrustLayers(
        profileState: String,
        fallbackURL: URL?
    ) -> [TrustLayerSignal] {
        let isRevoked = profileState == "revoked"
        let decisionTone: TrustTone = isRevoked ? .blocked : .caution
        let issuerState = isRevoked ? String(localized: "Revoked") : String(localized: "Stale")
        let issuerMessage = isRevoked
            ? String(localized: "The local provider profile is revoked, so issuer enrollment cannot be trusted.")
            : String(localized: "The local provider profile is stale and must be refreshed before issuing a green trust signal.")
        let hasDestination = fallbackURL != nil

        return [
            TrustLayerSignal(
                title: String(localized: "Issuer legitimacy"),
                state: issuerState,
                message: issuerMessage,
                tone: decisionTone
            ),
            TrustLayerSignal(
                title: String(localized: "Destination binding"),
                state: hasDestination ? String(localized: "Not evaluated") : String(localized: "Not available"),
                message: hasDestination
                    ? String(localized: "A destination was read from the QR, but issuer policy was not evaluated because the provider profile gate failed first.")
                    : String(localized: "No openable destination could be safely extracted on-device."),
                tone: decisionTone
            ),
            TrustLayerSignal(
                title: String(localized: "Runtime safety"),
                state: String(localized: "Not evaluated"),
                message: String(localized: "Runtime destination safety was not evaluated after the provider profile gate failed."),
                tone: decisionTone
            ),
            TrustLayerSignal(
                title: String(localized: "Scanner decision"),
                state: isRevoked ? String(localized: "Red") : String(localized: "Orange"),
                message: isRevoked
                    ? String(localized: "Do not rely on this verifier profile. Update the provider profile or use another trusted scanner.")
                    : String(localized: "Use caution until the provider profile is refreshed."),
                tone: decisionTone
            ),
        ]
    }

    private func result(from decision: ScannerDecisionResponse) -> ScanResult {
        let tone = tone(from: decision)
        return ScanResult(
            tone: tone,
            title: title(for: tone, decision: decision),
            message: message(for: tone, decision: decision),
            usagePolicy: decision.usagePolicy,
            destination: decision.destination.displayURL,
            host: decision.destination.host,
            checkedAt: Date(),
            technicalSummary: decision.verifierReason,
            resolverURL: decision.destination.resolverURL,
            finalURL: decision.destination.finalURL,
            redirectHops: decision.destination.redirectHops,
            redirectPolicy: decision.destination.redirectPolicy,
            trustNamespace: decision.governance?.issuerNamespaceLabel,
            assuranceTier: decision.governance?.assuranceTier,
            cacheFreshness: decision.governance?.cacheFreshnessState,
            cacheExpiresAt: decision.governance?.cacheExpiresAt,
            verifierProfileState: activeVerifierProfileState,
            scannerUX: decision.scannerUX,
            signals: trustLayers(for: decision, tone: tone)
        )
    }

    private func tone(from decision: ScannerDecisionResponse) -> TrustTone {
        switch decision.decisionState {
        case "verified_issuer":
            return .trusted
        case "verified_issuer_destination_risky":
            return .caution
        case "signed_unknown_issuer", "unverified", "stale_trust_state", "profile_stale":
            return .caution
        case "profile_revoked":
            return .blocked
        default:
            return .blocked
        }
    }

    private func trustLayers(for decision: ScannerDecisionResponse, tone: TrustTone) -> [TrustLayerSignal] {
        if decision.verifierStage == "verifier_profile" {
            return verifierProfileTrustLayers(for: decision, tone: tone)
        }

        let issuerTone = issuerLayerTone(for: decision, overallTone: tone)
        let issuerState = issuerLayerState(for: decision)

        let destinationTone = destinationLayerTone(for: decision, overallTone: tone)
        let destinationState = destinationLayerState(for: decision)

        let runtimeState = runtimeLayerState(for: decision)
        let runtimeTone = runtimeLayerTone(for: decision, overallTone: tone)

        return [
            TrustLayerSignal(
                title: String(localized: "Issuer legitimacy"),
                state: issuerState,
                message: signal(in: decision, layer: "issuer_legitimacy")?.message
                    ?? signalMessage(in: decision, matching: ["issuer", "certificate"])
                    ?? issuerLayerMessage(for: decision, tone: issuerTone),
                tone: issuerTone
            ),
            TrustLayerSignal(
                title: String(localized: "Destination binding"),
                state: destinationState,
                message: destinationSignalMessage(for: decision, tone: destinationTone),
                tone: destinationTone
            ),
            TrustLayerSignal(
                title: String(localized: "Runtime safety"),
                state: runtimeState,
                message: signal(in: decision, layer: "runtime_safety")?.message
                    ?? signalMessage(in: decision, matching: ["runtime", "replay", "time", "signature"])
                    ?? runtimeLayerMessage(for: decision),
                tone: runtimeTone
            ),
            TrustLayerSignal(
                title: String(localized: "Scanner decision"),
                state: scannerDecisionState(for: tone, scannerUX: decision.scannerUX),
                message: decision.primaryMessage.isEmpty
                    ? message(for: tone, decision: decision)
                    : decision.primaryMessage,
                tone: tone
            ),
        ]
    }

    /// The only per-layer states the verifier emits for a layer it actually reached
    /// and passed. Everything else — `not_evaluated`, `not_opened`, `revoked`,
    /// `mismatch`, `replay_blocked`, `risky`, `stale`, `unavailable` — means the
    /// layer was skipped or failed, and must never be presented as trusted.
    private static let passingLayerStates: Set<String> = ["recognized", "bound", "clean"]

    private func layerPassed(_ state: String?) -> Bool {
        guard let state else {
            return false
        }

        return Self.passingLayerStates.contains(
            state.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        )
    }

    /// States that mean the layer itself is blocking, not merely unconfirmed. A layer
    /// reporting one of these must never be softened to a caution by a shared tone.
    private static let blockingLayerStates: Set<String> = [
        "revoked",
        "blocked",
        "replay_blocked",
        "mismatch",
        "redirect_mismatch",
        "not_opened",
    ]

    private func layerBlocked(_ state: String?) -> Bool {
        guard let state else {
            return false
        }

        return Self.blockingLayerStates.contains(
            state.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        )
    }

    /// Trust is granted by evidence, never by the absence of a matching stage case.
    /// A layer the verifier short-circuited past carries no positive evidence, so an
    /// optimistic `.trusted` candidate is downgraded rather than rendered green.
    private func clamped(_ candidate: TrustTone, evidence: String?) -> TrustTone {
        guard candidate == .trusted, !layerPassed(evidence) else {
            return candidate
        }

        return .caution
    }

    private func issuerLayerEvidence(for decision: ScannerDecisionResponse) -> String {
        signal(in: decision, layer: "issuer_legitimacy")?.state ?? decision.issuer.status
    }

    private func destinationLayerEvidence(for decision: ScannerDecisionResponse) -> String {
        signal(in: decision, layer: "destination_binding")?.state ?? decision.destination.binding
    }

    private func issuerNotEstablished(for decision: ScannerDecisionResponse) -> Bool {
        decision.decisionState == "signed_unknown_issuer" || decision.decisionState == "unverified"
    }

    private func issuerLayerTone(for decision: ScannerDecisionResponse, overallTone: TrustTone) -> TrustTone {
        if decision.verifierStage == "certificate_status" {
            return .blocked
        }
        if issuerNotEstablished(for: decision) || decision.verifierStage == "governance_cache" {
            return overallTone
        }

        return clamped(.trusted, evidence: issuerLayerEvidence(for: decision))
    }

    private func issuerLayerState(for decision: ScannerDecisionResponse) -> String {
        if decision.verifierStage == "certificate_status" {
            return String(localized: "Not trusted")
        }
        if issuerNotEstablished(for: decision) {
            return String(localized: "Unknown")
        }
        if decision.verifierStage == "governance_cache" {
            return String(localized: "Stale")
        }

        let evidence = issuerLayerEvidence(for: decision)
        return layerPassed(evidence)
            ? String(localized: "Recognized")
            : humanizedState(evidence, fallback: String(localized: "Not evaluated"))
    }

    private func destinationLayerTone(for decision: ScannerDecisionResponse, overallTone: TrustTone) -> TrustTone {
        if decision.verifierStage == "payload_revalidation" || decision.verifierStage == "redirect_policy" {
            return .blocked
        }
        if issuerNotEstablished(for: decision) || decision.verifierStage == "governance_cache" {
            return overallTone
        }

        return clamped(.trusted, evidence: destinationLayerEvidence(for: decision))
    }

    private func destinationLayerState(for decision: ScannerDecisionResponse) -> String {
        if decision.verifierStage == "redirect_policy" {
            return String(localized: "Redirect mismatch")
        }
        if decision.verifierStage == "payload_revalidation" {
            return String(localized: "Mismatch")
        }

        let evidence = destinationLayerEvidence(for: decision)
        return layerPassed(evidence)
            ? String(localized: "Bound")
            : humanizedState(evidence, fallback: String(localized: "Not evaluated"))
    }

    private func verifierProfileTrustLayers(
        for decision: ScannerDecisionResponse,
        tone: TrustTone
    ) -> [TrustLayerSignal] {
        let isRevoked = decision.decisionState == "profile_revoked"
        let cautionOrBlocked: TrustTone = isRevoked ? .blocked : .caution

        // A stale or revoked verifier profile means no layer can be trusted, but an
        // individual layer may still report a harder verdict than the shared tone.
        func profileLayerTone(_ layer: String) -> TrustTone {
            layerBlocked(signal(in: decision, layer: layer)?.state) ? .blocked : cautionOrBlocked
        }

        return [
            TrustLayerSignal(
                title: String(localized: "Issuer legitimacy"),
                state: humanizedState(
                    signal(in: decision, layer: "issuer_legitimacy")?.state,
                    fallback: isRevoked ? String(localized: "Revoked") : String(localized: "Not checked")
                ),
                message: signal(in: decision, layer: "issuer_legitimacy")?.message
                    ?? (isRevoked
                        ? String(localized: "The verifier profile is revoked, so issuer enrollment cannot be trusted.")
                        : String(localized: "The verifier profile is stale, so issuer enrollment was not confirmed.")),
                tone: profileLayerTone("issuer_legitimacy")
            ),
            TrustLayerSignal(
                title: String(localized: "Destination binding"),
                state: humanizedState(
                    signal(in: decision, layer: "destination_binding")?.state,
                    fallback: isRevoked ? String(localized: "Not evaluated") : String(localized: "Unverified")
                ),
                message: signal(in: decision, layer: "destination_binding")?.message
                    ?? (isRevoked
                        ? String(localized: "Destination binding was not evaluated because the verifier profile is revoked.")
                        : String(localized: "A destination was read from the QR, but it was not checked against current issuer policy.")),
                tone: profileLayerTone("destination_binding")
            ),
            TrustLayerSignal(
                title: String(localized: "Runtime safety"),
                state: humanizedState(
                    signal(in: decision, layer: "runtime_safety")?.state,
                    fallback: String(localized: "Not evaluated")
                ),
                message: signal(in: decision, layer: "runtime_safety")?.message
                    ?? (isRevoked
                        ? String(localized: "Runtime safety is not evaluated with a revoked verifier profile.")
                        : String(localized: "Current destination safety was not evaluated because the verifier profile is stale.")),
                tone: profileLayerTone("runtime_safety")
            ),
            TrustLayerSignal(
                title: String(localized: "Scanner decision"),
                state: scannerDecisionState(for: tone, scannerUX: decision.scannerUX),
                message: decision.primaryMessage.isEmpty
                    ? message(for: tone, decision: decision)
                    : decision.primaryMessage,
                tone: tone
            ),
        ]
    }

    private func signal(
        in decision: ScannerDecisionResponse,
        layer: String
    ) -> ScannerDecisionSignal? {
        decision.signals.first { $0.layer == layer }
    }

    private func signalMessage(in decision: ScannerDecisionResponse, matching tokens: [String]) -> String? {
        decision.signals.first { signal in
            let haystack = [
                signal.layer,
                signal.state,
                signal.message ?? "",
            ]
                .joined(separator: " ")
                .lowercased()
            return tokens.contains { haystack.contains($0) }
        }?.message
    }

    private func destinationSignalMessage(for decision: ScannerDecisionResponse, tone: TrustTone) -> String {
        let rawMessage = signalMessage(
            in: decision,
            matching: ["destination", "binding", "payload", "resolver", "redirect", "final"]
        )

        if isPlainURLWithoutTrustEnvelope(decision),
           rawMessage?.localizedCaseInsensitiveContains("valid JSON") ?? false {
            return String(localized: "This is a regular URL QR. No recognized QR Trust signal was found, so the destination cannot be issuer-verified.")
        }

        return rawMessage ?? destinationLayerMessage(for: decision, tone: tone)
    }

    private func isPlainURLWithoutTrustEnvelope(_ decision: ScannerDecisionResponse) -> Bool {
        let destination = decision.destination.displayURL.lowercased()
        return decision.decisionState == "unverified"
            && (destination.hasPrefix("http://") || destination.hasPrefix("https://"))
    }

    private func issuerLayerMessage(for decision: ScannerDecisionResponse, tone: TrustTone) -> String {
        switch tone {
        case .trusted:
            if let issuerName = decision.issuer.name, !issuerName.isEmpty {
                return String(localized: "\(issuerName) is recognized by the verifier profile.")
            }
            return String(localized: "The issuer is recognized by the verifier profile.")
        case .caution:
            return String(localized: "The verifier could not map this issuer to a recognized trust program.")
        case .blocked:
            return String(localized: "The issuer trust state does not currently satisfy verifier policy.")
        default:
            return String(localized: "Issuer trust state was evaluated before showing the result.")
        }
    }

    private func destinationLayerMessage(for decision: ScannerDecisionResponse, tone: TrustTone) -> String {
        if decision.destination.resolverURL != nil {
            switch tone {
            case .trusted:
                return String(localized: "The resolver and final destination both match issuer redirect policy.")
            case .caution:
                return String(localized: "The QR uses a resolver, but the app lacks a recognized issuer signal for it.")
            case .blocked:
                return String(localized: "The resolver flow does not match the issuer-approved final destination.")
            default:
                return String(localized: "Resolver and final destination binding were evaluated before showing the result.")
            }
        }

        switch tone {
        case .trusted:
            return String(localized: "The destination is still inside the issuer-approved binding.")
        case .caution:
            return String(localized: "The destination exists, but the app lacks a recognized issuer signal for it.")
        case .blocked:
            return String(localized: "The destination no longer matches the issuer-approved binding.")
        default:
            return String(localized: "Destination binding was evaluated before showing the result.")
        }
    }

    private func runtimeLayerState(for decision: ScannerDecisionResponse) -> String {
        if decision.decisionState == "unverified" || decision.decisionState == "signed_unknown_issuer" {
            return String(localized: "Not evaluated")
        }
        if decision.verifierStage == "runtime_safety",
           let runtimeSignal = decision.signals.first(where: { $0.layer == "runtime_safety" }) {
            return humanizedState(runtimeSignal.state, fallback: String(localized: "Review"))
        }

        switch decision.verifierStage {
        case "governance_cache":
            return decision.decisionState == "blocked" ? String(localized: "Expired") : String(localized: "Stale")
        case "replay_guard":
            return String(localized: "Already used")
        case "time_window":
            return String(localized: "Expired")
        case "signed_schema":
            return String(localized: "Integrity failed")
        case "payload_revalidation":
            return String(localized: "Policy mismatch")
        case "redirect_policy":
            return String(localized: "Redirect blocked")
        case "certificate_status":
            return String(localized: "Issuer blocked")
        default:
            let evidence = signal(in: decision, layer: "runtime_safety")?.state
            return layerPassed(evidence)
                ? String(localized: "Clear")
                : humanizedState(evidence, fallback: String(localized: "Not evaluated"))
        }
    }

    private func runtimeLayerTone(for decision: ScannerDecisionResponse, overallTone: TrustTone) -> TrustTone {
        switch decision.verifierStage {
        case "runtime_safety":
            return decision.decisionState == "blocked" ? .blocked : .caution
        case "governance_cache":
            return overallTone
        case "replay_guard", "time_window", "signed_schema", "payload_revalidation", "redirect_policy", "certificate_status":
            return .blocked
        default:
            return clamped(
                overallTone == .caution ? .caution : .trusted,
                evidence: signal(in: decision, layer: "runtime_safety")?.state
            )
        }
    }

    private func runtimeLayerMessage(for decision: ScannerDecisionResponse) -> String {
        switch decision.verifierStage {
        case "governance_cache":
            return decision.primaryMessage.isEmpty
                ? String(localized: "Required trust state is not fresh enough to produce a positive scanner decision.")
                : decision.primaryMessage
        case "replay_guard":
            return String(localized: "The verifier detected a one-time QR replay condition.")
        case "time_window":
            return String(localized: "The QR is outside its valid time window.")
        case "signed_schema":
            return String(localized: "The signed claim could not be verified as intact.")
        case "payload_revalidation":
            return String(localized: "The current destination does not satisfy the active policy.")
        case "redirect_policy":
            return String(localized: "The resolver or final destination did not satisfy issuer redirect policy.")
        case "certificate_status":
            return String(localized: "Runtime policy blocked the issuer state before opening.")
        case "runtime_safety":
            return decision.primaryMessage.isEmpty
                ? String(localized: "Runtime safety changed the final scanner decision.")
                : decision.primaryMessage
        default:
            return layerPassed(signal(in: decision, layer: "runtime_safety")?.state)
                ? String(localized: "No runtime block condition was reported by the verifier.")
                : String(localized: "Runtime safety was not confirmed for this scan.")
        }
    }

    private func scannerDecisionState(for tone: TrustTone, scannerUX: ScannerDecisionUX?) -> String {
        if let scannerUX {
            switch scannerUX.riskLevel {
            case "green":
                return String(localized: "Green")
            case "amber":
                return String(localized: "Orange")
            case "red":
                return String(localized: "Red")
            default:
                break
            }
        }

        switch tone {
        case .trusted:
            return String(localized: "Green")
        case .caution:
            return String(localized: "Orange")
        case .blocked:
            return String(localized: "Red")
        case .unavailable:
            return String(localized: "Unavailable")
        case .checking:
            return String(localized: "Checking")
        case .idle:
            return String(localized: "Not scanned")
        }
    }

    private func humanizedState(_ value: String?, fallback: String) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            return fallback
        }

        return trimmed
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
    }

    private func title(for tone: TrustTone, decision: ScannerDecisionResponse) -> String {
        switch tone {
        case .idle:
            return String(localized: "Ready to scan")
        case .checking:
            return String(localized: "Checking QR")
        case .trusted:
            return String(localized: "Looks safe")
        case .caution:
            if decision.decisionState == "profile_stale" {
                return String(localized: "Verifier profile stale")
            }
            if decision.decisionState == "stale_trust_state" {
                return String(localized: "Trust state stale")
            }
            if decision.decisionState == "signed_unknown_issuer" {
                return String(localized: "Issuer not recognized")
            }
            return String(localized: "Use caution")
        case .blocked:
            if decision.decisionState == "profile_revoked" {
                return String(localized: "Verifier profile revoked")
            }
            switch decision.verifierStage {
            case "governance_cache":
                return String(localized: "Trust state expired")
            case "replay_guard":
                return String(localized: "One-time QR used")
            case "payload_revalidation":
                return String(localized: "Destination changed")
            case "redirect_policy":
                return String(localized: "Final destination changed")
            case "time_window":
                return String(localized: "Expired QR")
            case "certificate_status":
                return String(localized: "Issuer not trusted")
            case "signed_schema":
                return String(localized: "QR integrity failed")
            default:
                return String(localized: "High-risk QR")
            }
        case .unavailable:
            return String(localized: "Check unavailable")
        }
    }

    private func message(for tone: TrustTone, decision: ScannerDecisionResponse) -> String {
        switch tone {
        case .trusted:
            switch decision.usagePolicy {
            case "reusable_public":
                return String(localized: "This shared QR is still approved by the issuer and can be opened.")
            case "time_limited":
                return String(localized: "This QR is still within its valid time window and matches the approved destination.")
            case "one_time":
                return String(localized: "This one-time QR matched a recognized issuer and approved destination.")
            default:
                return String(localized: "This QR matched a recognized issuer and approved destination.")
            }
        case .caution:
            if decision.decisionState == "profile_stale" {
                return String(localized: "The app's verifier profile needs refresh. A destination was found, but current issuer and destination trust were not confirmed.")
            }
            if decision.decisionState == "stale_trust_state" {
                return String(localized: "This issuer was previously recognized, but the app's trust state is stale. Continue only if you trust the context.")
            }
            if decision.decisionState == "unverified" {
                return String(localized: "This QR is a normal link without a recognized trust signal. Only continue if you trust where it came from.")
            }
            if decision.decisionState == "verified_issuer_destination_risky" {
                return decision.primaryMessage
            }
            return String(localized: "We could not fully verify this QR. Only continue if you trust where it came from.")
        case .blocked:
            if decision.decisionState == "profile_revoked" {
                return String(localized: "The app's verifier profile was revoked. Do not rely on this QR result until a trusted profile is installed.")
            }
            switch decision.verifierStage {
            case "governance_cache":
                return String(localized: "Required trust state has expired. Ask for a fresh or trusted QR before continuing.")
            case "replay_guard":
                return String(localized: "This one-time QR may already have been used. Ask for a fresh QR before continuing.")
            case "payload_revalidation":
                return String(localized: "The destination no longer matches what the issuer approved. Opening anyway may not be safe.")
            case "redirect_policy":
                return String(localized: "The resolver led to a final destination that the issuer did not approve. Opening anyway may not be safe.")
            case "time_window":
                return String(localized: "This QR is expired or not valid yet. Ask for a fresh QR.")
            case "certificate_status":
                return String(localized: "The issuer is no longer trusted by the verifier. Opening anyway may not be safe.")
            case "signed_schema":
                return String(localized: "The QR signature check failed, which can mean the QR was changed.")
            case "runtime_safety":
                return decision.primaryMessage.isEmpty
                    ? String(localized: "Runtime safety reported a high-risk destination. Opening anyway may not be safe.")
                    : decision.primaryMessage
            default:
                return decision.primaryMessage.isEmpty
                    ? String(localized: "This QR failed a safety check. Opening anyway may not be safe.")
                    : decision.primaryMessage
            }
        default:
            return decision.primaryMessage
        }
    }

    private func userFacingError(_ error: Error, fallbackURL: URL?) -> String {
        let fallbackCopy = fallbackURL == nil
            ? ""
            : String(localized: " A destination was found in the QR, but it was not verified. Open only if you trust where it came from.")

        if let scannerError = error as? ScannerAppError,
           let description = scannerError.errorDescription {
            return description + fallbackCopy
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .serverCertificateUntrusted, .secureConnectionFailed, .serverCertificateHasUnknownRoot:
                return String(localized: "The protection service could not be trusted. Try again later.") + fallbackCopy
            case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost:
                return String(localized: "The protection service is not reachable right now. Try again in a moment.") + fallbackCopy
            default:
                break
            }
        }
        return String(localized: "The QR could not be checked right now. Try again in a moment.") + fallbackCopy
    }
}

private enum ProviderProfileImportError: LocalizedError {
    case missingIdentity
    case missingEndpoint
    case invalidEndpoint
    case invalidState
    case unsignedProductionProfile
    case unsupportedSignatureAlgorithm
    case invalidSignedPayload
    case untrustedSigningKey
    case invalidSignature

    var errorDescription: String? {
        switch self {
        case .missingIdentity:
            return String(localized: "The provider profile must include an id and name.")
        case .missingEndpoint:
            return String(localized: "The provider profile must include at least one endpoint.")
        case .invalidEndpoint:
            return String(localized: "Every provider endpoint must be a valid http or https URL.")
        case .invalidState:
            return String(localized: "The provider profile state must be active, stale, or revoked.")
        case .unsignedProductionProfile:
            return String(localized: "Unsigned provider profiles are only allowed for local reviewer endpoints.")
        case .unsupportedSignatureAlgorithm:
            return String(localized: "The provider profile signature algorithm is not supported.")
        case .invalidSignedPayload:
            return String(localized: "The signed provider profile payload is not valid.")
        case .untrustedSigningKey:
            return String(localized: "The provider profile was signed by an unrecognized key.")
        case .invalidSignature:
            return String(localized: "The provider profile signature could not be verified.")
        }
    }
}

private extension String {
    func base64URLDecodedData() -> Data? {
        var normalized = replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let padding = normalized.count % 4
        if padding > 0 {
            normalized.append(String(repeating: "=", count: 4 - padding))
        }

        return Data(base64Encoded: normalized)
    }
}
