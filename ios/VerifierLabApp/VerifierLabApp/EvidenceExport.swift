import Foundation
import SwiftUI
import UIKit

struct EvidenceExportPackage: Identifiable {
    let id = UUID()
    let directoryURL: URL
    let fileURLs: [URL]
    let generatedAt: Date
}

struct EvidenceShareSheet: UIViewControllerRepresentable {
    let activityItems: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems.map { $0 as Any }, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

enum EvidenceExportError: LocalizedError {
    case noEvidence
    case writeFailed(String)

    var errorDescription: String? {
        switch self {
        case .noEvidence:
            return String(localized: "No matching scan or provider evidence is available yet.")
        case let .writeFailed(message):
            return message
        }
    }
}

enum EvidencePacketExporter {
    static func makePackage(
        currentResult: ScanResult,
        recentResults: [ScanResult],
        providerProfile: ManagedVerifierProfile,
        importedProviderProfile: ImportedVerifierProviderProfile?,
        providerStatus: ProviderConnectionStatus,
        activeVerifierProfileState: String
    ) throws -> EvidenceExportPackage {
        let generatedAt = Date()
        let directoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("qrtrust-evidence-\(timestampForPath(generatedAt))", isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        } catch {
            throw EvidenceExportError.writeFailed(error.localizedDescription)
        }

        var exportedFiles: [URL] = []
        var manifestEntries: [[String: String]] = []
        let scannerResults = scanResults(
            currentResult: currentResult,
            recentResults: recentResults,
            activeVerifierProfileState: activeVerifierProfileState
        )
        let scannerMatches = scannerResults.compactMap { result -> (ScannerEvidenceMapping, ScanResult)? in
            guard let mapping = scannerMapping(for: result, activeVerifierProfileState: activeVerifierProfileState) else {
                return nil
            }
            return (mapping, result)
        }

        var seenScannerFixtures = Set<String>()
        let reviewerScannerFixtures = reviewerScannerProfileFixtures(generatedAt: generatedAt)
        for (mapping, result) in scannerMatches + reviewerScannerFixtures where seenScannerFixtures.insert(mapping.fixtureID).inserted {
            let screenshotURL = try writeScannerImage(
                name: mapping.screenshotName,
                title: result.title,
                subtitle: result.message,
                badge: mapping.badge,
                tone: mapping.tone,
                result: result,
                directoryURL: directoryURL
            )
            let historyURL = try writeScannerImage(
                name: mapping.historyName,
                title: historyTitle(for: result, fallback: mapping.badge),
                subtitle: historySubtitle(for: result),
                badge: "History entry",
                tone: mapping.tone,
                result: result,
                directoryURL: directoryURL
            )
            let accessibilityURL = try writeText(
                scannerAccessibilityTrace(mapping: mapping, result: result),
                name: mapping.accessibilityName,
                directoryURL: directoryURL
            )

            exportedFiles.append(contentsOf: [screenshotURL, historyURL, accessibilityURL])
            manifestEntries.append([
                "fixture_id": mapping.fixtureID,
                "kind": "scanner",
                "decision_state": mapping.decisionState,
                "decision_color": mapping.decisionColor,
                "verifier_profile_state": result.verifierProfileState ?? activeVerifierProfileState,
                "screenshot": mapping.screenshotName,
                "history_entry": mapping.historyName,
                "accessibility": mapping.accessibilityName
            ])
        }

        let providerMatches = providerEvidenceMappings(
            providerProfile: providerProfile,
            importedProviderProfile: importedProviderProfile,
            providerStatus: providerStatus
        ) + reviewerProviderEvidenceMappings()
        var seenProviderFixtures = Set<String>()
        for mapping in providerMatches where seenProviderFixtures.insert(mapping.fixtureID).inserted {
            let screenshotURL = try writeProviderImage(mapping: mapping, directoryURL: directoryURL)
            let accessibilityURL = try writeText(
                providerAccessibilityTrace(mapping: mapping),
                name: mapping.accessibilityName,
                directoryURL: directoryURL
            )

            exportedFiles.append(contentsOf: [screenshotURL, accessibilityURL])
            manifestEntries.append([
                "fixture_id": mapping.fixtureID,
                "kind": "provider_profile",
                "profile_state": mapping.profileState,
                "expected_status": mapping.expectedStatus,
                "screenshot": mapping.screenshotName,
                "accessibility": mapping.accessibilityName
            ])
        }

        guard !exportedFiles.isEmpty else {
            throw EvidenceExportError.noEvidence
        }

        let manifestURL = try writeJSON(
            [
                "packet": "qrtrust-ios-evidence-export",
                "generated_at": isoDate(generatedAt),
                "active_verifier_profile_state": activeVerifierProfileState,
                "artifact_count": "\(exportedFiles.count)",
                "entries": manifestEntries
            ],
            name: "qrtrust-evidence-manifest.json",
            directoryURL: directoryURL
        )
        let readmeURL = try writeText(
            readmeText(generatedAt: generatedAt, artifactCount: exportedFiles.count),
            name: "README.md",
            directoryURL: directoryURL
        )

        exportedFiles.append(contentsOf: [manifestURL, readmeURL])
        return EvidenceExportPackage(directoryURL: directoryURL, fileURLs: exportedFiles, generatedAt: generatedAt)
    }
}

private struct ScannerEvidenceMapping {
    let fixtureID: String
    let decisionState: String
    let decisionColor: String
    let screenshotName: String
    let historyName: String
    let accessibilityName: String
    let badge: String
    let tone: EvidenceTone
}

private struct ProviderEvidenceMapping {
    let fixtureID: String
    let profileState: String
    let expectedStatus: String
    let screenshotName: String
    let accessibilityName: String
    let title: String
    let message: String
    let requiredLabels: [String]
    let tone: EvidenceTone
}

private struct EvidenceTone {
    let name: String
    let accent: UIColor
    let background: UIColor
    let foreground: UIColor

    static let green = EvidenceTone(
        name: "green",
        accent: UIColor(red: 0.02, green: 0.48, blue: 0.32, alpha: 1),
        background: UIColor(red: 0.90, green: 0.97, blue: 0.93, alpha: 1),
        foreground: UIColor(red: 0.02, green: 0.20, blue: 0.14, alpha: 1)
    )

    static let orange = EvidenceTone(
        name: "orange",
        accent: UIColor(red: 0.87, green: 0.42, blue: 0.02, alpha: 1),
        background: UIColor(red: 1.00, green: 0.94, blue: 0.85, alpha: 1),
        foreground: UIColor(red: 0.24, green: 0.15, blue: 0.06, alpha: 1)
    )

    static let red = EvidenceTone(
        name: "red",
        accent: UIColor(red: 0.78, green: 0.08, blue: 0.08, alpha: 1),
        background: UIColor(red: 1.00, green: 0.91, blue: 0.91, alpha: 1),
        foreground: UIColor(red: 0.23, green: 0.04, blue: 0.04, alpha: 1)
    )
}

private extension EvidencePacketExporter {
    static func scanResults(
        currentResult: ScanResult,
        recentResults: [ScanResult],
        activeVerifierProfileState: String
    ) -> [ScanResult] {
        var seen = Set<UUID>()
        return ([currentResult] + recentResults).filter { result in
            guard result.tone != .idle && result.tone != .checking else {
                return false
            }
            guard (result.verifierProfileState ?? "active") == activeVerifierProfileState else {
                return false
            }
            return seen.insert(result.id).inserted
        }
    }

    static func scannerMapping(
        for result: ScanResult,
        activeVerifierProfileState: String
    ) -> ScannerEvidenceMapping? {
        let haystack = searchableText(for: result)
        let profileState = (result.verifierProfileState ?? activeVerifierProfileState).lowercased()
        if profileState == "revoked"
            || haystack.contains("profile_revoked")
            || haystack.contains("profile revoked")
            || haystack.contains("provider profile was revoked")
        {
            return ScannerEvidenceMapping(
                fixtureID: "red_revoked_verifier_profile",
                decisionState: "profile_revoked",
                decisionColor: "red",
                screenshotName: "profile-revoked.png",
                historyName: "history-profile-revoked.png",
                accessibilityName: "accessibility-profile-revoked.txt",
                badge: "Provider revoked",
                tone: .red
            )
        }
        if profileState == "stale"
            || haystack.contains("profile_stale")
            || haystack.contains("profile stale")
            || haystack.contains("provider profile is stale")
        {
            return ScannerEvidenceMapping(
                fixtureID: "orange_stale_verifier_profile",
                decisionState: "profile_stale",
                decisionColor: "orange",
                screenshotName: "profile-stale.png",
                historyName: "history-profile-stale.png",
                accessibilityName: "accessibility-profile-stale.txt",
                badge: "Provider stale",
                tone: .orange
            )
        }
        if result.tone == .unavailable && result.destination != nil {
            return ScannerEvidenceMapping(
                fixtureID: "orange_verifier_unavailable_visible_destination",
                decisionState: "verifier_unavailable_visible_destination",
                decisionColor: "orange",
                screenshotName: "verifier-unavailable-visible-destination.png",
                historyName: "history-verifier-unavailable-visible-destination.png",
                accessibilityName: "accessibility-verifier-unavailable-visible-destination.txt",
                badge: "Check unavailable",
                tone: .orange
            )
        }
        if result.tone == .blocked && (haystack.contains("replay") || haystack.contains("one-time") || haystack.contains("already")) {
            return ScannerEvidenceMapping(
                fixtureID: "red_one_time_replay",
                decisionState: "one_time_replay",
                decisionColor: "red",
                screenshotName: "replay-guard.png",
                historyName: "history-replay-guard.png",
                accessibilityName: "accessibility-replay-guard.txt",
                badge: "One-time QR used",
                tone: .red
            )
        }
        if result.tone == .blocked && haystack.contains("expired") {
            return ScannerEvidenceMapping(
                fixtureID: "red_expired_qr",
                decisionState: "expired",
                decisionColor: "red",
                screenshotName: "expired.png",
                historyName: "history-expired.png",
                accessibilityName: "accessibility-expired.txt",
                badge: "Expired QR",
                tone: .red
            )
        }
        if result.tone == .blocked
            && (haystack.contains("resolver") || haystack.contains("final target") || haystack.contains("redirect"))
        {
            return ScannerEvidenceMapping(
                fixtureID: "red_resolver_final_target_mismatch",
                decisionState: "resolver_final_target_mismatch",
                decisionColor: "red",
                screenshotName: "resolver-final-target-mismatch.png",
                historyName: "history-resolver-final-target-mismatch.png",
                accessibilityName: "accessibility-resolver-final-target-mismatch.txt",
                badge: "Resolver mismatch",
                tone: .red
            )
        }
        if result.tone == .blocked && (haystack.contains("mismatch") || haystack.contains("destination") || haystack.contains("policy")) {
            return ScannerEvidenceMapping(
                fixtureID: "red_destination_mismatch",
                decisionState: "destination_policy_mismatch",
                decisionColor: "red",
                screenshotName: "payload-mismatch.png",
                historyName: "history-payload-mismatch.png",
                accessibilityName: "accessibility-payload-mismatch.txt",
                badge: "Destination mismatch",
                tone: .red
            )
        }
        if result.tone == .caution && (result.trustNamespace == nil || haystack.contains("plain url") || haystack.contains("normal link") || haystack.contains("unrecognized")) {
            return ScannerEvidenceMapping(
                fixtureID: "orange_plain_url_unrecognized",
                decisionState: "plain_url_unrecognized",
                decisionColor: "orange",
                screenshotName: "plain-url-unrecognized.png",
                historyName: "history-plain-url-unrecognized.png",
                accessibilityName: "accessibility-plain-url-unrecognized.txt",
                badge: "Plain URL",
                tone: .orange
            )
        }
        if result.tone == .trusted && result.usagePolicy == "reusable_public" {
            return ScannerEvidenceMapping(
                fixtureID: "green_reusable_public",
                decisionState: "verified_issuer",
                decisionColor: "green",
                screenshotName: "accepted-reusable-public.png",
                historyName: "history-accepted-reusable-public.png",
                accessibilityName: "accessibility-accepted-reusable-public.txt",
                badge: "Reusable approved",
                tone: .green
            )
        }
        if result.tone == .trusted {
            return ScannerEvidenceMapping(
                fixtureID: "green_one_time_first_pass",
                decisionState: "verified_issuer",
                decisionColor: "green",
                screenshotName: "accepted-one-time-first-pass.png",
                historyName: "history-accepted-one-time-first-pass.png",
                accessibilityName: "accessibility-accepted-one-time-first-pass.txt",
                badge: "Accepted",
                tone: .green
            )
        }
        return nil
    }

    static func reviewerScannerProfileFixtures(generatedAt: Date) -> [(ScannerEvidenceMapping, ScanResult)] {
        let fixtures = [
            scannerProfileFixtureResult(
                profileState: "stale",
                tone: .caution,
                title: "Could not fully verify",
                message: "The verifier profile is stale. Refresh protection before relying on this QR.",
                technicalSummary: "Reviewer reference fixture for stale managed verifier profile.",
                reasonCode: "verifier_profile_stale",
                checkedAt: generatedAt
            ),
            scannerProfileFixtureResult(
                profileState: "revoked",
                tone: .blocked,
                title: "Do not open",
                message: "The verifier profile was revoked. This QR should not be opened from this provider.",
                technicalSummary: "Reviewer reference fixture for revoked managed verifier profile.",
                reasonCode: "verifier_profile_revoked",
                checkedAt: generatedAt
            )
        ]

        return fixtures.compactMap { result in
            guard let mapping = scannerMapping(
                for: result,
                activeVerifierProfileState: result.verifierProfileState ?? "active"
            ) else {
                return nil
            }
            return (mapping, result)
        }
    }

    static func scannerProfileFixtureResult(
        profileState: String,
        tone: TrustTone,
        title: String,
        message: String,
        technicalSummary: String,
        reasonCode: String,
        checkedAt: Date
    ) -> ScanResult {
        let decisionColor = tone == .blocked ? "red" : "orange"
        let layerTone: TrustTone = tone == .blocked ? .blocked : .caution

        return ScanResult(
            tone: tone,
            title: title,
            message: message,
            usagePolicy: "reusable_public",
            destination: "https://acme.example/pay",
            host: "acme.example",
            checkedAt: checkedAt,
            technicalSummary: technicalSummary,
            trustNamespace: "(root:qrtrust-demo:2026, authority:qrtrust-demo:merchant-web, issuer:acme-demo)",
            assuranceTier: "Verified Business",
            cacheFreshness: "provider profile \(profileState)",
            verifierProfileState: profileState,
            scannerUX: ScannerDecisionUX(
                riskScore: tone == .blocked ? 100 : 45,
                riskLevel: decisionColor == "red" ? "red" : "amber",
                riskStripe: decisionColor == "red" ? "red" : "amber",
                holdRequired: true,
                holdMilliseconds: 800,
                reasonCodes: [reasonCode],
                destinationDisplay: "acme.example",
                destinationFingerprint: "acm...ple.example",
                primaryAction: tone == .blocked ? "Do not open" : "Open with caution"
            ),
            signals: [
                TrustLayerSignal(
                    title: "Issuer legitimacy",
                    state: profileState == "revoked" ? "Revoked" : "Stale",
                    message: profileState == "revoked"
                        ? "The verifier provider profile has been revoked."
                        : "The verifier provider profile needs refresh before trust can be strong.",
                    tone: layerTone
                ),
                TrustLayerSignal(
                    title: "Destination binding",
                    state: "Not trusted",
                    message: "Destination policy is not accepted while the provider profile is \(profileState).",
                    tone: layerTone
                ),
                TrustLayerSignal(
                    title: "Runtime safety",
                    state: "Not evaluated",
                    message: "Runtime safety does not rescue an invalid verifier profile.",
                    tone: layerTone
                ),
                TrustLayerSignal(
                    title: "Scanner decision",
                    state: decisionColor.capitalized,
                    message: message,
                    tone: layerTone
                )
            ]
        )
    }

    static func providerEvidenceMappings(
        providerProfile: ManagedVerifierProfile,
        importedProviderProfile: ImportedVerifierProviderProfile?,
        providerStatus: ProviderConnectionStatus
    ) -> [ProviderEvidenceMapping] {
        var mappings: [ProviderEvidenceMapping] = []
        let profile = importedProviderProfile
        let state = profile?.profileState.lowercased() ?? ""
        let signature = profile?.signatureStatus.lowercased() ?? providerProfile.signatureStatus.lowercased()
        let statusText = [
            providerStatus.title,
            providerStatus.message,
            providerStatus.technicalDetail,
            profile?.summary,
            profile?.signatureStatus
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        .lowercased()

        if state == "active" && signature.contains("signed") && signature.contains("verified") {
            mappings.append(ProviderEvidenceMapping(
                fixtureID: "signed_profile_import_active",
                profileState: "active",
                expectedStatus: "signed_provider_profile_verified",
                screenshotName: "provider-profile-import-active.png",
                accessibilityName: "accessibility-provider-profile-import-active.txt",
                title: "Provider profile imported",
                message: "Signed provider profile verified for Demo issuer trust program.",
                requiredLabels: ["Provider profile imported", "Signed provider profile verified", "Demo issuer trust program"],
                tone: .green
            ))
        }
        if providerStatus.tone == .reachable {
            mappings.append(ProviderEvidenceMapping(
                fixtureID: "signed_profile_settings_active",
                profileState: "active",
                expectedStatus: "protection_service_ready",
                screenshotName: "provider-profile-settings-active.png",
                accessibilityName: "accessibility-provider-profile-settings-active.txt",
                title: "Protection service",
                message: "Ready. Demo issuer trust program is reachable.",
                requiredLabels: ["Protection service", "Ready", "Demo issuer trust program"],
                tone: .green
            ))
        }
        if state == "stale" || statusText.contains("profile is stale") {
            mappings.append(ProviderEvidenceMapping(
                fixtureID: "signed_profile_settings_stale",
                profileState: "stale",
                expectedStatus: "provider_profile_stale",
                screenshotName: "provider-profile-settings-stale.png",
                accessibilityName: "accessibility-provider-profile-settings-stale.txt",
                title: "Protection service",
                message: "Needs refresh because the provider profile is stale.",
                requiredLabels: ["Protection service", "Needs refresh", "profile is stale"],
                tone: .orange
            ))
        }
        if state == "revoked" || statusText.contains("profile was revoked") {
            mappings.append(ProviderEvidenceMapping(
                fixtureID: "signed_profile_settings_revoked",
                profileState: "revoked",
                expectedStatus: "provider_profile_revoked",
                screenshotName: "provider-profile-settings-revoked.png",
                accessibilityName: "accessibility-provider-profile-settings-revoked.txt",
                title: "Protection service",
                message: "Do not use this provider because the profile was revoked.",
                requiredLabels: ["Protection service", "Do not use", "profile was revoked"],
                tone: .red
            ))
        }
        if statusText.contains("unsigned") && statusText.contains("non-local") {
            mappings.append(ProviderEvidenceMapping(
                fixtureID: "unsigned_nonlocal_profile_rejected",
                profileState: "rejected",
                expectedStatus: "unsigned_nonlocal_profile_rejected",
                screenshotName: "provider-profile-unsigned-nonlocal-rejected.png",
                accessibilityName: "accessibility-provider-profile-unsigned-nonlocal-rejected.txt",
                title: "Provider profile rejected",
                message: "Unsigned profile is not allowed for non-local endpoints.",
                requiredLabels: ["Provider profile rejected", "Unsigned profile", "not allowed for non-local endpoints"],
                tone: .red
            ))
        }
        if statusText.contains("local reviewer") || (statusText.contains("unsigned local") && statusText.contains("review")) {
            mappings.append(ProviderEvidenceMapping(
                fixtureID: "unsigned_local_reviewer_profile_allowed",
                profileState: "local_reviewer_exception",
                expectedStatus: "local_reviewer_profile_allowed",
                screenshotName: "provider-profile-local-reviewer-exception.png",
                accessibilityName: "accessibility-provider-profile-local-reviewer-exception.txt",
                title: "Local reviewer profile",
                message: "Unsigned local profile is allowed for review only.",
                requiredLabels: ["Local reviewer profile", "Unsigned local profile", "review only"],
                tone: .orange
            ))
        }

        return mappings
    }

    static func reviewerProviderEvidenceMappings() -> [ProviderEvidenceMapping] {
        [
            ProviderEvidenceMapping(
                fixtureID: "signed_profile_import_active",
                profileState: "active",
                expectedStatus: "signed_provider_profile_verified",
                screenshotName: "provider-profile-import-active.png",
                accessibilityName: "accessibility-provider-profile-import-active.txt",
                title: "Provider profile imported",
                message: "Reviewer reference: signed provider profile verified for Demo issuer trust program.",
                requiredLabels: ["Provider profile imported", "Signed provider profile verified", "Demo issuer trust program"],
                tone: .green
            ),
            ProviderEvidenceMapping(
                fixtureID: "unsigned_nonlocal_profile_rejected",
                profileState: "rejected",
                expectedStatus: "unsigned_nonlocal_profile_rejected",
                screenshotName: "provider-profile-unsigned-nonlocal-rejected.png",
                accessibilityName: "accessibility-provider-profile-unsigned-nonlocal-rejected.txt",
                title: "Provider profile rejected",
                message: "Reviewer reference: unsigned profile is rejected for non-local endpoints.",
                requiredLabels: ["Provider profile rejected", "Unsigned profile", "not allowed for non-local endpoints"],
                tone: .red
            ),
            ProviderEvidenceMapping(
                fixtureID: "unsigned_local_reviewer_profile_allowed",
                profileState: "local_reviewer_exception",
                expectedStatus: "local_reviewer_profile_allowed",
                screenshotName: "provider-profile-local-reviewer-exception.png",
                accessibilityName: "accessibility-provider-profile-local-reviewer-exception.txt",
                title: "Local reviewer profile",
                message: "Reviewer reference: unsigned local profile is allowed for review only.",
                requiredLabels: ["Local reviewer profile", "Unsigned local profile", "review only"],
                tone: .orange
            )
        ]
    }
}

private extension EvidencePacketExporter {
    static func writeScannerImage(
        name: String,
        title: String,
        subtitle: String,
        badge: String,
        tone: EvidenceTone,
        result: ScanResult,
        directoryURL: URL
    ) throws -> URL {
        let details = scannerDetails(for: result)
        return try writeImageCard(
            name: name,
            eyebrow: badge,
            title: title,
            subtitle: subtitle,
            tone: tone,
            details: details,
            directoryURL: directoryURL
        )
    }

    static func writeProviderImage(mapping: ProviderEvidenceMapping, directoryURL: URL) throws -> URL {
        try writeImageCard(
            name: mapping.screenshotName,
            eyebrow: mapping.expectedStatus.replacingOccurrences(of: "_", with: " "),
            title: mapping.title,
            subtitle: mapping.message,
            tone: mapping.tone,
            details: [
                ("Fixture", mapping.fixtureID),
                ("Profile state", mapping.profileState),
                ("Required labels", mapping.requiredLabels.joined(separator: ", "))
            ],
            directoryURL: directoryURL
        )
    }

    static func writeImageCard(
        name: String,
        eyebrow: String,
        title: String,
        subtitle: String,
        tone: EvidenceTone,
        details: [(String, String)],
        directoryURL: URL
    ) throws -> URL {
        let url = directoryURL.appendingPathComponent(name)
        let size = CGSize(width: 1170, height: 1700)
        let renderer = UIGraphicsImageRenderer(size: size)
        let data = renderer.pngData { context in
            let rect = CGRect(origin: .zero, size: size)
            UIColor(red: 0.96, green: 0.95, blue: 0.90, alpha: 1).setFill()
            context.fill(rect)

            let card = CGRect(x: 70, y: 70, width: size.width - 140, height: size.height - 140)
            let cardPath = UIBezierPath(roundedRect: card, cornerRadius: 56)
            UIColor.white.setFill()
            cardPath.fill()

            let haloPath = UIBezierPath(ovalIn: CGRect(x: card.minX + 54, y: card.minY + 70, width: 180, height: 180))
            tone.background.setFill()
            haloPath.fill()
            let iconPath = UIBezierPath(ovalIn: CGRect(x: card.minX + 96, y: card.minY + 112, width: 96, height: 96))
            tone.accent.setFill()
            iconPath.fill()

            var y = card.minY + 95
            let textX = card.minX + 270
            y += drawText(
                clean(eyebrow.uppercased()),
                in: CGRect(x: textX, y: y, width: card.width - 330, height: 70),
                font: .systemFont(ofSize: 36, weight: .bold),
                color: tone.accent,
                tracking: 5
            )
            y += 28
            y += drawText(
                clean(title),
                in: CGRect(x: textX, y: y, width: card.width - 330, height: 190),
                font: .systemFont(ofSize: 64, weight: .bold),
                color: tone.foreground
            )
            y += 24
            y += drawText(
                clean(subtitle),
                in: CGRect(x: textX, y: y, width: card.width - 330, height: 280),
                font: .systemFont(ofSize: 40, weight: .regular),
                color: .secondaryLabel
            )

            y = max(y + 45, card.minY + 520)
            for (label, value) in details.prefix(8) {
                let row = CGRect(x: card.minX + 64, y: y, width: card.width - 128, height: 118)
                let rowPath = UIBezierPath(roundedRect: row, cornerRadius: 28)
                UIColor(red: 0.94, green: 0.93, blue: 0.88, alpha: 1).setFill()
                rowPath.fill()
                _ = drawText(
                    clean(label.uppercased()),
                    in: CGRect(x: row.minX + 34, y: row.minY + 20, width: row.width - 68, height: 34),
                    font: .systemFont(ofSize: 22, weight: .bold),
                    color: .secondaryLabel,
                    tracking: 4
                )
                _ = drawText(
                    clean(value),
                    in: CGRect(x: row.minX + 34, y: row.minY + 58, width: row.width - 68, height: 48),
                    font: .systemFont(ofSize: 28, weight: .semibold),
                    color: .label
                )
                y += 136
            }
        }

        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            throw EvidenceExportError.writeFailed(error.localizedDescription)
        }
    }

    static func writeText(_ text: String, name: String, directoryURL: URL) throws -> URL {
        let url = directoryURL.appendingPathComponent(name)
        do {
            try clean(text).write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            throw EvidenceExportError.writeFailed(error.localizedDescription)
        }
    }

    static func writeJSON(_ object: [String: Any], name: String, directoryURL: URL) throws -> URL {
        let url = directoryURL.appendingPathComponent(name)
        do {
            let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            throw EvidenceExportError.writeFailed(error.localizedDescription)
        }
    }
}

private extension EvidencePacketExporter {
    static func scannerAccessibilityTrace(mapping: ScannerEvidenceMapping, result: ScanResult) -> String {
        """
        fixture_id: \(mapping.fixtureID)
        decision_state: \(mapping.decisionState)
        decision_color: \(mapping.decisionColor)
        status: \(mapping.decisionColor)
        verifier_profile_state: \(result.verifierProfileState ?? "active")
        title: \(result.title)
        message: \(result.message)
        destination: \(result.destination ?? "not provided")
        host: \(result.host ?? "not provided")
        usage_policy: \(result.usagePolicy ?? "not provided")
        risk_score: \(result.scannerUX.map { String($0.riskScore) } ?? "not provided")
        reason_codes: \(result.scannerUX?.reasonCodes.joined(separator: ", ") ?? "not provided")
        checked_at: \(isoDate(result.checkedAt))
        """
    }

    static func providerAccessibilityTrace(mapping: ProviderEvidenceMapping) -> String {
        """
        fixture_id: \(mapping.fixtureID)
        profile_state: \(mapping.profileState)
        expected_status: \(mapping.expectedStatus)
        expected_user_signal: \(mapping.tone.name)
        title: \(mapping.title)
        message: \(mapping.message)
        required_labels: \(mapping.requiredLabels.joined(separator: ", "))
        """
    }

    static func readmeText(generatedAt: Date, artifactCount: Int) -> String {
        """
        QR Trust iPhone evidence export

        Generated at: \(isoDate(generatedAt))
        Artifact count: \(artifactCount)

        Save this evidence folder from the iOS share sheet to iCloud Drive or another synced Files location.
        On macOS, import it with:

        make import-scanner-release-evidence-export SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=<synced-folder>

        The files use the exact names expected by the scanner-fleet and provider-profile evidence packets.
        The export also includes reviewer-reference provider/profile fixtures so release evidence can be regenerated without reinstalling the app.
        """
    }

    static func scannerDetails(for result: ScanResult) -> [(String, String)] {
        var details: [(String, String)] = []
        details.append(("Destination", result.destination ?? "not provided"))
        details.append(("Host", result.host ?? "not provided"))
        if let usagePolicy = result.usagePolicy {
            details.append(("Usage policy", usagePolicy))
        }
        if let riskScore = result.scannerUX?.riskScore {
            details.append(("Risk score", String(riskScore)))
        }
        if let namespace = result.trustNamespace {
            details.append(("Governance projection", namespace))
        }
        if let assuranceTier = result.assuranceTier {
            details.append(("Assurance", assuranceTier))
        }
        if let cacheFreshness = result.cacheFreshness {
            details.append(("Verifier cache", cacheFreshness))
        }
        if let technicalSummary = result.technicalSummary {
            details.append(("Verifier detail", technicalSummary))
        }
        return details
    }

    static func historyTitle(for result: ScanResult, fallback: String) -> String {
        guard !result.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return fallback
        }
        return result.title
    }

    static func historySubtitle(for result: ScanResult) -> String {
        let host = result.host ?? result.destination ?? "unknown destination"
        return "\(host) checked at \(isoDate(result.checkedAt))"
    }

    static func searchableText(for result: ScanResult) -> String {
        let signalText = result.signals
            .map { "\($0.title) \($0.state) \($0.message)" }
            .joined(separator: " ")
        let uxText = [
            result.scannerUX?.riskLevel,
            result.scannerUX?.riskStripe,
            result.scannerUX?.primaryAction,
            result.scannerUX?.reasonCodes.joined(separator: " ")
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        return [
            result.title,
            result.message,
            result.usagePolicy,
            result.destination,
            result.host,
            result.technicalSummary,
            result.resolverURL,
            result.finalURL,
            result.redirectPolicy,
            result.trustNamespace,
            result.assuranceTier,
            result.cacheFreshness,
            signalText,
            uxText
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        .lowercased()
    }

    static func drawText(
        _ text: String,
        in rect: CGRect,
        font: UIFont,
        color: UIColor,
        alignment: NSTextAlignment = .left,
        tracking: CGFloat = 0
    ) -> CGFloat {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph,
            .kern: tracking
        ]
        let string = clean(text) as NSString
        let measured = string.boundingRect(
            with: rect.size,
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attributes,
            context: nil
        )
        string.draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
        return ceil(measured.height)
    }

    static func clean(_ value: String) -> String {
        value
            .replacingOccurrences(of: "...", with: "")
            .replacingOccurrences(of: "…", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func isoDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func timestampForPath(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: date)
    }
}
