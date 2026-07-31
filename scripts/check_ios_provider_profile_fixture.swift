import CryptoKit
import Foundation

private let expectedKeyID = "qrtrust-demo-provider-2026"
private let expectedPublicKey = "ebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ="
private let expectedProfileID = "qrtrust-demo-provider"

private struct SignatureEnvelope: Decodable {
    let payload: String
    let signature: Signature
}

private struct Signature: Decodable {
    let algorithm: String
    let keyID: String
    let value: String

    enum CodingKeys: String, CodingKey {
        case algorithm
        case keyID = "key_id"
        case value
    }
}

private struct ProviderProfile: Decodable {
    let id: String
    let name: String
    let trustProgram: String
    let endpoints: [String]
    let profileState: String

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case trustProgram = "trust_program"
        case endpoints
        case profileState = "profile_state"
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

guard let path = CommandLine.arguments.dropFirst().first else {
    fputs("usage: swift scripts/check_ios_provider_profile_fixture.swift <fixture.json>\n", stderr)
    exit(2)
}

private let fixtureURL = URL(fileURLWithPath: path)
private let fixtureData = try Data(contentsOf: fixtureURL)
private let decoder = JSONDecoder()
private let envelope = try decoder.decode(SignatureEnvelope.self, from: fixtureData)

guard envelope.signature.algorithm.lowercased() == "ed25519" else {
    fputs("unsupported signature algorithm: \(envelope.signature.algorithm)\n", stderr)
    exit(1)
}

guard envelope.signature.keyID == expectedKeyID else {
    fputs("unexpected key id: \(envelope.signature.keyID)\n", stderr)
    exit(1)
}

guard let payloadData = envelope.payload.base64URLDecodedData() else {
    fputs("payload is not valid base64url\n", stderr)
    exit(1)
}

guard let signatureData = envelope.signature.value.base64URLDecodedData() else {
    fputs("signature is not valid base64url\n", stderr)
    exit(1)
}

guard let publicKeyData = Data(base64Encoded: expectedPublicKey) else {
    fputs("expected public key is not valid base64\n", stderr)
    exit(1)
}

private let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData)
guard publicKey.isValidSignature(signatureData, for: payloadData) else {
    fputs("signature verification failed\n", stderr)
    exit(1)
}

private let profile = try decoder.decode(ProviderProfile.self, from: payloadData)
guard profile.id == expectedProfileID else {
    fputs("unexpected profile id: \(profile.id)\n", stderr)
    exit(1)
}

guard profile.profileState == "active" else {
    fputs("unexpected profile state: \(profile.profileState)\n", stderr)
    exit(1)
}

guard !profile.name.isEmpty,
      !profile.trustProgram.isEmpty,
      !profile.endpoints.isEmpty else {
    fputs("fixture profile is incomplete\n", stderr)
    exit(1)
}

print("PASS: verified signed provider profile \(profile.id)")
