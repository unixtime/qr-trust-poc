import Foundation

enum TrustTone: String, Codable, Equatable {
    case idle
    case checking
    case trusted
    case caution
    case blocked
    case unavailable
}

enum HistoryRetentionProfile: String, CaseIterable, Identifiable, Codable {
    case off
    case last5
    case last20
    case last50

    var id: String { rawValue }

    var label: String {
        switch self {
        case .off:
            return String(localized: "Off")
        case .last5:
            return String(localized: "Last 5 checks")
        case .last20:
            return String(localized: "Last 20 checks")
        case .last50:
            return String(localized: "Last 50 checks")
        }
    }

    var detail: String {
        switch self {
        case .off:
            return String(localized: "Do not keep recent checks on this device.")
        case .last5:
            return String(localized: "Keep only the shortest local history.")
        case .last20:
            return String(localized: "Balanced default for demos and personal review.")
        case .last50:
            return String(localized: "Useful for repeated classroom or reviewer testing.")
        }
    }

    var limit: Int {
        switch self {
        case .off:
            return 0
        case .last5:
            return 5
        case .last20:
            return 20
        case .last50:
            return 50
        }
    }
}

struct ManagedVerifierProfile: Identifiable, Equatable {
    let id: String
    let name: String
    let summary: String
    let trustProgram: String
    let policy: String
    let endpointSummary: String
    let signatureStatus: String

    static func localDemo(endpointSummary: String) -> ManagedVerifierProfile {
        ManagedVerifierProfile(
            id: "local-qr-trust-demo",
            name: String(localized: "Local QR Trust demo"),
            summary: String(localized: "A managed verifier profile for the local PoC environment."),
            trustProgram: String(localized: "Demo issuer trust program"),
            policy: String(localized: "Issuer legitimacy, destination binding, runtime safety, and scanner decision state"),
            endpointSummary: endpointSummary,
            signatureStatus: String(localized: "Demo profile, unsigned")
        )
    }
}

struct ImportedVerifierProviderProfile: Codable, Equatable {
    let id: String
    let name: String
    let summary: String
    let trustProgram: String
    let policy: String
    let endpoints: [String]
    let profileState: String
    let signatureStatus: String

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case summary
        case trustProgram = "trust_program"
        case policy
        case endpoints
        case profileState = "profile_state"
        case signatureStatus = "signature_status"
    }

    var endpointSummary: String {
        endpoints.joined(separator: ", ")
    }

    var managedProfile: ManagedVerifierProfile {
        ManagedVerifierProfile(
            id: id,
            name: name,
            summary: summary,
            trustProgram: trustProgram,
            policy: policy,
            endpointSummary: endpointSummary,
            signatureStatus: signatureStatus
        )
    }

    func replacingSignatureStatus(_ status: String) -> ImportedVerifierProviderProfile {
        ImportedVerifierProviderProfile(
            id: id,
            name: name,
            summary: summary,
            trustProgram: trustProgram,
            policy: policy,
            endpoints: endpoints,
            profileState: profileState,
            signatureStatus: status
        )
    }

    func replacingProfileState(_ state: String) -> ImportedVerifierProviderProfile {
        ImportedVerifierProviderProfile(
            id: id,
            name: name,
            summary: summary,
            trustProgram: trustProgram,
            policy: policy,
            endpoints: endpoints,
            profileState: state,
            signatureStatus: signatureStatus
        )
    }
}

struct ImportedVerifierProviderProfileEnvelope: Codable, Equatable {
    let payload: String
    let signature: ImportedVerifierProviderSignature
}

struct ImportedVerifierProviderSignature: Codable, Equatable {
    let algorithm: String
    let keyID: String
    let value: String

    enum CodingKeys: String, CodingKey {
        case algorithm
        case keyID = "key_id"
        case value
    }
}

enum ProviderConnectionTone: String, Equatable {
    case notChecked
    case checking
    case reachable
    case stale
    case revoked
    case unreachable
    case misconfigured
}

struct ProviderConnectionStatus: Equatable {
    let tone: ProviderConnectionTone
    let title: String
    let message: String
    let endpoint: String?
    let checkedAt: Date?
    let technicalDetail: String?

    static let notChecked = ProviderConnectionStatus(
        tone: .notChecked,
        title: String(localized: "Not checked yet"),
        message: String(localized: "Run a connection check to see whether the managed verifier can answer scan decisions."),
        endpoint: nil,
        checkedAt: nil,
        technicalDetail: nil
    )
}

struct ScannerDecisionRequest: Encodable {
    let qrPayload: String
    let client: ScannerDecisionClient?

    enum CodingKeys: String, CodingKey {
        case qrPayload = "qr_payload"
        case client
    }
}

struct ScannerDecisionClient: Encodable {
    let platform: String
    let appVersion: String?
    let verifierProfileState: String?

    enum CodingKeys: String, CodingKey {
        case platform
        case appVersion = "app_version"
        case verifierProfileState = "verifier_profile_state"
    }
}

struct ScannerDecisionIssuer: Decodable {
    let name: String?
    let tier: String?
    let status: String
}

struct ScannerDecisionDestination: Decodable {
    let displayURL: String
    let host: String?
    let binding: String
    let resolverURL: String?
    let finalURL: String?
    let redirectHops: Int?
    let redirectPolicy: String?

    enum CodingKeys: String, CodingKey {
        case displayURL = "display_url"
        case host
        case binding
        case resolverURL = "resolver_url"
        case finalURL = "final_url"
        case redirectHops = "redirect_hops"
        case redirectPolicy = "redirect_policy"
    }
}

struct ScannerDecisionSignal: Decodable, Identifiable {
    let id = UUID()
    let layer: String
    let state: String
    let message: String?

    enum CodingKeys: String, CodingKey {
        case layer
        case state
        case message
    }
}

struct ScannerDecisionAction: Decodable, Identifiable {
    let id: String
    let label: String
    let style: String
}

struct ScannerDecisionGovernance: Decodable {
    let rootProgramID: String
    let delegatedAuthorityID: String
    let issuerID: String
    let issuerNamespaceLabel: String
    let issuerDisplayName: String
    let assuranceTier: String
    let destinationPolicyID: String
    let cacheEntryID: String
    let cacheFreshnessState: String
    let cacheStatePublishedAt: String
    let cacheGeneratedAt: String
    let cacheExpiresAt: String
    let maxStalenessSeconds: Int
    let staleBehavior: String
    let sourceArtifacts: [String: String]

    enum CodingKeys: String, CodingKey {
        case rootProgramID = "root_program_id"
        case delegatedAuthorityID = "delegated_authority_id"
        case issuerID = "issuer_id"
        case issuerNamespaceLabel = "issuer_namespace_label"
        case issuerDisplayName = "issuer_display_name"
        case assuranceTier = "assurance_tier"
        case destinationPolicyID = "destination_policy_id"
        case cacheEntryID = "cache_entry_id"
        case cacheFreshnessState = "cache_freshness_state"
        case cacheStatePublishedAt = "cache_state_published_at"
        case cacheGeneratedAt = "cache_generated_at"
        case cacheExpiresAt = "cache_expires_at"
        case maxStalenessSeconds = "max_staleness_seconds"
        case staleBehavior = "stale_behavior"
        case sourceArtifacts = "source_artifacts"
    }
}

struct ScannerDecisionUX: Codable, Equatable {
    let riskScore: Int
    let riskLevel: String
    let riskStripe: String
    let holdRequired: Bool
    let holdMilliseconds: Int
    let reasonCodes: [String]
    let destinationDisplay: String?
    let destinationFingerprint: String?
    let primaryAction: String

    enum CodingKeys: String, CodingKey {
        case riskScore = "risk_score"
        case riskLevel = "risk_level"
        case riskStripe = "risk_stripe"
        case holdRequired = "hold_required"
        case holdMilliseconds = "hold_ms"
        case reasonCodes = "reason_codes"
        case destinationDisplay = "destination_display"
        case destinationFingerprint = "destination_fingerprint"
        case primaryAction = "primary_action"
    }

    static func unavailableFallback(for url: URL?) -> ScannerDecisionUX? {
        guard let host = url?.host, !host.isEmpty else {
            return nil
        }

        return ScannerDecisionUX(
            riskScore: 30,
            riskLevel: "amber",
            riskStripe: "amber",
            holdRequired: true,
            holdMilliseconds: 800,
            reasonCodes: ["provider_unreachable"],
            destinationDisplay: host,
            destinationFingerprint: host,
            primaryAction: String(localized: "Open with caution")
        )
    }
}

struct ScannerDecisionResponse: Decodable {
    let decisionState: String
    let openAllowed: Bool
    let usagePolicy: String?
    let primaryMessage: String
    let issuer: ScannerDecisionIssuer
    let destination: ScannerDecisionDestination
    let governance: ScannerDecisionGovernance?
    let signals: [ScannerDecisionSignal]
    let actions: [ScannerDecisionAction]
    let verifierStage: String
    let verifierReason: String
    let requestID: String?
    let scannerUX: ScannerDecisionUX?

    enum CodingKeys: String, CodingKey {
        case decisionState = "decision_state"
        case openAllowed = "open_allowed"
        case usagePolicy = "usage_policy"
        case primaryMessage = "primary_message"
        case issuer
        case destination
        case governance
        case signals
        case actions
        case verifierStage = "verifier_stage"
        case verifierReason = "verifier_reason"
        case requestID = "request_id"
        case scannerUX = "scanner_ux"
    }
}

struct TrustLayerSignal: Identifiable, Equatable, Codable {
    let id: UUID
    let title: String
    let state: String
    let message: String
    let tone: TrustTone

    init(
        id: UUID = UUID(),
        title: String,
        state: String,
        message: String,
        tone: TrustTone
    ) {
        self.id = id
        self.title = title
        self.state = state
        self.message = message
        self.tone = tone
    }
}

struct ScanResult: Identifiable, Equatable, Codable {
    let id: UUID
    let tone: TrustTone
    let title: String
    let message: String
    let usagePolicy: String?
    let destination: String?
    let host: String?
    let checkedAt: Date
    let technicalSummary: String?
    let resolverURL: String?
    let finalURL: String?
    let redirectHops: Int?
    let redirectPolicy: String?
    let trustNamespace: String?
    let assuranceTier: String?
    let cacheFreshness: String?
    let cacheExpiresAt: String?
    let verifierProfileState: String?
    let scannerUX: ScannerDecisionUX?
    let signals: [TrustLayerSignal]

    init(
        id: UUID = UUID(),
        tone: TrustTone,
        title: String,
        message: String,
        usagePolicy: String? = nil,
        destination: String?,
        host: String?,
        checkedAt: Date,
        technicalSummary: String?,
        resolverURL: String? = nil,
        finalURL: String? = nil,
        redirectHops: Int? = nil,
        redirectPolicy: String? = nil,
        trustNamespace: String? = nil,
        assuranceTier: String? = nil,
        cacheFreshness: String? = nil,
        cacheExpiresAt: String? = nil,
        verifierProfileState: String? = nil,
        scannerUX: ScannerDecisionUX? = nil,
        signals: [TrustLayerSignal] = []
    ) {
        self.id = id
        self.tone = tone
        self.title = title
        self.message = message
        self.usagePolicy = usagePolicy
        self.destination = destination
        self.host = host
        self.checkedAt = checkedAt
        self.technicalSummary = technicalSummary
        self.resolverURL = resolverURL
        self.finalURL = finalURL
        self.redirectHops = redirectHops
        self.redirectPolicy = redirectPolicy
        self.trustNamespace = trustNamespace
        self.assuranceTier = assuranceTier
        self.cacheFreshness = cacheFreshness
        self.cacheExpiresAt = cacheExpiresAt
        self.verifierProfileState = verifierProfileState
        self.scannerUX = scannerUX
        self.signals = signals
    }

    static let empty = ScanResult(
        tone: .idle,
        title: String(localized: "Ready to scan"),
        message: String(localized: "Scan a QR code to check whether it is safe to open."),
        usagePolicy: nil,
        destination: nil,
        host: nil,
        checkedAt: Date(),
        technicalSummary: nil
    )
}

enum ScannerAppError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(status: Int, message: String)
    case noAvailableVerifier

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return String(localized: "The protection service is not configured correctly.")
        case .invalidResponse:
            return String(localized: "The protection service returned an unreadable response.")
        case let .server(_, message):
            return message
        case .noAvailableVerifier:
            return String(localized: "The protection service is not reachable right now.")
        }
    }
}

func shortTime(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateStyle = .none
    formatter.timeStyle = .short
    return formatter.string(from: date)
}
