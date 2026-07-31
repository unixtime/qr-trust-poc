import Foundation

struct VerifierAPI {
    private static let configuredEndpointKey = "QRTRUST_VERIFIER_BASE_URLS"
    private static let allowedProfileStates = Set(["active", "stale", "revoked"])
    private static let requestTimeoutSeconds: TimeInterval = 3
    private static let resourceTimeoutSeconds: TimeInterval = 6

    private let baseURLCandidates: [String]
    private let verifierProfileState: String?
    private let session: URLSession

    init(importedProviderProfile: ImportedVerifierProviderProfile? = nil) {
        baseURLCandidates = Self.makeBaseURLCandidates(importedProviderProfile: importedProviderProfile)
        verifierProfileState = Self.makeVerifierProfileState(importedProviderProfile: importedProviderProfile)
        session = Self.makeSession()
    }

    var endpointSummary: String {
        guard !baseURLCandidates.isEmpty else {
            return "No verifier provider configured"
        }

        return baseURLCandidates.joined(separator: ", ")
    }

    var hasProviderCandidates: Bool {
        !baseURLCandidates.isEmpty
    }

    var providerProfileState: String? {
        verifierProfileState
    }

    private static func makeBaseURLCandidates(
        importedProviderProfile: ImportedVerifierProviderProfile?
    ) -> [String] {
        var candidates = importedProviderProfile?.endpoints ?? []
        candidates += configuredCandidates()

        #if targetEnvironment(simulator)
        candidates += [
            "http://127.0.0.1:8000",
            "https://127.0.0.1:8443",
        ]
        #else
        // Physical-device and production builds should receive a signed
        // provider profile or an app-managed endpoint. Do not guess a local
        // hostname here: if it does not resolve, the user waits on a timeout.
        #endif

        return Array(orderedUnique(candidates))
    }

    private static func configuredCandidates() -> [String] {
        let environmentValue = ProcessInfo.processInfo.environment[configuredEndpointKey]
        let bundleValue = Bundle.main.object(forInfoDictionaryKey: configuredEndpointKey) as? String
        return parseCandidates(environmentValue) + parseCandidates(bundleValue)
    }

    private static func makeVerifierProfileState(
        importedProviderProfile: ImportedVerifierProviderProfile?
    ) -> String? {
        normalizedProfileState(importedProviderProfile?.profileState)
    }

    private static func normalizedProfileState(_ rawValue: String?) -> String? {
        guard let state = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !state.isEmpty,
              allowedProfileStates.contains(state) else {
            return nil
        }

        return state
    }

    private static func parseCandidates(_ rawValue: String?) -> [String] {
        guard let rawValue else {
            return []
        }

        return rawValue
            .split { character in
                character == "," || character == "\n" || character == ";"
            }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.contains("$(") }
    }

    private static func orderedUnique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { value in
            seen.insert(value).inserted
        }
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeoutSeconds
        configuration.timeoutIntervalForResource = resourceTimeoutSeconds
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }

    private var decoder: JSONDecoder {
        JSONDecoder()
    }

    private var encoder: JSONEncoder {
        JSONEncoder()
    }

    func decideScannedQR(_ payload: String) async throws -> ScannerDecisionResponse {
        let requestBody = ScannerDecisionRequest(
            qrPayload: payload,
            client: ScannerDecisionClient(
                platform: "ios",
                appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                verifierProfileState: verifierProfileState
            )
        )

        var lastError: Error?
        for baseURLString in baseURLCandidates {
            do {
                return try await request(
                    baseURLString: baseURLString,
                    path: "/scanner/decisions",
                    body: requestBody
                )
            } catch let error as URLError {
                lastError = error
                continue
            } catch {
                throw error
            }
        }

        throw lastError ?? ScannerAppError.noAvailableVerifier
    }

    func checkVerifierStatus() async throws -> VerifierStatusProbe {
        var lastError: Error?
        for baseURLString in baseURLCandidates {
            do {
                let status: VerifierRuntimeStatus = try await get(
                    baseURLString: baseURLString,
                    path: "/verifier/status"
                )
                return VerifierStatusProbe(baseURLString: baseURLString, status: status)
            } catch let error as URLError {
                lastError = error
                continue
            } catch {
                throw error
            }
        }

        throw lastError ?? ScannerAppError.noAvailableVerifier
    }

    func fetchProviderProfileDocument() async throws -> ProviderProfileDocumentProbe {
        var lastError: Error?
        for baseURLString in baseURLCandidates {
            do {
                let data = try await getData(
                    baseURLString: baseURLString,
                    path: "/scanner/provider-profile"
                )
                return ProviderProfileDocumentProbe(baseURLString: baseURLString, data: data)
            } catch let error as URLError {
                lastError = error
                continue
            } catch {
                throw error
            }
        }

        throw lastError ?? ScannerAppError.noAvailableVerifier
    }

    private func request<T: Decodable, Body: Encodable>(
        baseURLString: String,
        path: String,
        body: Body
    ) async throws -> T {
        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: trimmed), !trimmed.isEmpty else {
            throw ScannerAppError.invalidBaseURL
        }

        let normalisedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        var request = URLRequest(url: baseURL.appendingPathComponent(normalisedPath))
        request.httpMethod = "POST"
        request.timeoutInterval = Self.requestTimeoutSeconds
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ScannerAppError.invalidResponse
        }

        if !(200 ... 299).contains(httpResponse.statusCode) {
            let message = (try? decoder.decode(ServerErrorEnvelope.self, from: data).detail)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw ScannerAppError.server(status: httpResponse.statusCode, message: message)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw ScannerAppError.invalidResponse
        }
    }

    private func get<T: Decodable>(baseURLString: String, path: String) async throws -> T {
        let data = try await getData(baseURLString: baseURLString, path: path)

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw ScannerAppError.invalidResponse
        }
    }

    private func getData(baseURLString: String, path: String) async throws -> Data {
        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let baseURL = URL(string: trimmed), !trimmed.isEmpty else {
            throw ScannerAppError.invalidBaseURL
        }

        let normalisedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        var request = URLRequest(url: baseURL.appendingPathComponent(normalisedPath))
        request.httpMethod = "GET"
        request.timeoutInterval = Self.requestTimeoutSeconds
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ScannerAppError.invalidResponse
        }

        if !(200 ... 299).contains(httpResponse.statusCode) {
            let message = (try? decoder.decode(ServerErrorEnvelope.self, from: data).detail)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw ScannerAppError.server(status: httpResponse.statusCode, message: message)
        }

        return data
    }
}

private struct ServerErrorEnvelope: Decodable {
    let detail: String
}

struct VerifierStatusProbe: Equatable {
    let baseURLString: String
    let status: VerifierRuntimeStatus
}

struct ProviderProfileDocumentProbe: Equatable {
    let baseURLString: String
    let data: Data
}

struct VerifierRuntimeStatus: Decodable, Equatable {
    let verifierProfileState: String?
    let apiKeyAuthEnabled: Bool
    let adminAPIKeyManagementEnabled: Bool
    let apiKeyHeader: String
    let adminHeader: String
    let redisConnected: Bool
    let distributedRateLimitingEnabled: Bool
    let decodeImageFallbackEnabled: Bool
    let legacyExperimentalAPIEnabled: Bool
    let rateLimitWindowSeconds: Int
    let rateLimitMaxRequests: Int
    let decodeRateLimitMaxRequests: Int
    let maxQRPayloadChars: Int
    let maxDecodeImageBytes: Int

    enum CodingKeys: String, CodingKey {
        case verifierProfileState = "verifier_profile_state"
        case apiKeyAuthEnabled = "api_key_auth_enabled"
        case adminAPIKeyManagementEnabled = "admin_api_key_management_enabled"
        case apiKeyHeader = "api_key_header"
        case adminHeader = "admin_header"
        case redisConnected = "redis_connected"
        case distributedRateLimitingEnabled = "distributed_rate_limiting_enabled"
        case decodeImageFallbackEnabled = "decode_image_fallback_enabled"
        case legacyExperimentalAPIEnabled = "legacy_experimental_api_enabled"
        case rateLimitWindowSeconds = "rate_limit_window_seconds"
        case rateLimitMaxRequests = "rate_limit_max_requests"
        case decodeRateLimitMaxRequests = "decode_rate_limit_max_requests"
        case maxQRPayloadChars = "max_qr_payload_chars"
        case maxDecodeImageBytes = "max_decode_image_bytes"
    }
}
