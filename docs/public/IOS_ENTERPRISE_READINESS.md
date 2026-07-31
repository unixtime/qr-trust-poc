# iOS App Enterprise Readiness Notes

The end-user scanner should remain simple: scan, understand the signal, and decide whether to continue. Enterprise readiness should come from managed provider profiles and policy controls, not from asking average users to configure technical verifier details.

## Product Requirements

- Use signed verifier provider profiles instead of raw endpoint entry.
- Support managed provider distribution through MDM or another enterprise policy channel.
- Keep the default scan result non-technical: green, orange, red, destination, and plain-language reason.
- Preserve a decision-path view for auditors, reviewers, and trained users.
- Treat orange as "not fully verified" rather than "malicious".
- Require explicit confirmation before opening orange or red destinations.
- Keep one-time QR and reusable public QR semantics visibly distinct.
- Avoid persistent personal identifiers unless a deployment explicitly requires them.

## Security Requirements

- Pin or manage trusted provider certificates for production profiles.
- Sign provider metadata, including the trust program, endpoint, policy version, and supported decision states.
- Show verifier freshness when technical details are enabled.
- Maintain local history retention controls and a clear history action.
- Log enough local evidence for support without storing sensitive QR payloads unnecessarily.
- Fail closed for verified-trust claims when the verifier is unreachable, but still show the visible destination as an unverified link when safe to parse.

## Accessibility Requirements

- Do not rely on color alone; every state needs text and an icon.
- Support Dynamic Type without truncating the primary status, destination, or action.
- Keep touch targets at least 44 points high.
- Use native iOS list, form, sheet, and toolbar patterns where possible.
- Provide VoiceOver labels for scan status, history entries, and decision-path layers.

## Next App Improvements

- Add a signed provider profile import screen for enterprise reviewers.
- Add a first-run explanation that distinguishes reusable public QR codes from one-time QR codes.
- Add app-store-style screenshots for green, orange, red, and check-unavailable outcomes.
- Add a privacy screen explaining what is sent to the verifier and what stays on-device.
- Add localization readiness for all user-facing strings.
