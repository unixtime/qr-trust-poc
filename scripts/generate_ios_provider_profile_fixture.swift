import CryptoKit
import Foundation

private let keyID = "qrtrust-demo-provider-2026"
private let rawPrivateKey = Data((1...32).map { UInt8($0) })
private let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: rawPrivateKey)

private let payloadJSON = [
    "{",
    #"  "endpoints": ["https://qrtrust.local:8443"],"#,
    #"  "id": "qrtrust-demo-provider","#,
    #"  "name": "QR Trust Demo Provider","#,
    #"  "policy": "Issuer legitimacy, destination binding, runtime safety, and scanner decision state","#,
    #"  "profile_state": "active","#,
    #"  "signature_status": "Signed fixture generated for reviewer import","#,
    #"  "summary": "Signed verifier provider profile for QR Trust reviewer demos.","#,
    #"  "trust_program": "Demo issuer trust program""#,
    "}",
].joined(separator: "\n")

private struct SignatureEnvelope: Encodable {
    let payload: String
    let signature: Signature
}

private struct Signature: Encodable {
    let algorithm: String
    let keyID: String
    let value: String

    enum CodingKeys: String, CodingKey {
        case algorithm
        case keyID = "key_id"
        case value
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private let payloadData = Data(payloadJSON.utf8)
private let signature = try privateKey.signature(for: payloadData)
private let envelope = SignatureEnvelope(
    payload: payloadData.base64URLEncodedString(),
    signature: Signature(
        algorithm: "ed25519",
        keyID: keyID,
        value: signature.base64URLEncodedString()
    )
)

private let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
private var envelopeData = try encoder.encode(envelope)
envelopeData.append(0x0A)

private let outputPath = CommandLine.arguments.dropFirst().first
    ?? "docs/public/fixtures/ios/signed-provider-profile.demo.json"
private let outputURL = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try envelopeData.write(to: outputURL, options: .atomic)

print("Wrote \(outputPath)")
print("Public key: \(privateKey.publicKey.rawRepresentation.base64EncodedString())")
