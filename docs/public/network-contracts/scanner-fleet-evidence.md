# Scanner Fleet Evidence Contract

Date: 2026-05-20

Status:
- draft reference contract
- non-normative
- deployment handoff boundary

## Purpose

Scanner fleet evidence proves that deployed scanner clients actually apply the
paper's four-layer trust model in the user experience:

1. issuer legitimacy
2. destination binding
3. runtime destination safety
4. scanner-visible decision state

This evidence is separate from governance evidence. A root manifest or issuer
record can be valid while the deployed scanner UX still fails to warn users,
opens too quickly, hides the destination, or loses the decision path.

## Evidence Packet

The machine-readable evidence packet is defined in
`scanner-fleet-evidence.schema.json`;
`examples/scanner-fleet-evidence-reference.json` is the current reference
packet for the iOS scanner experience.

A production scanner-fleet packet should include:

- scanner app name and build version
- platform and operating-system version
- active verifier profile fingerprint
- scanner-decision endpoint fingerprint
- test date, operator, and reviewer
- fixture matrix used for the scan
- green/orange/red screenshots or recordings
- scan-decision JSON for each fixture
- hold-to-open or other friction logs when applicable
- history-entry evidence showing user-visible outcome persistence
- accessibility evidence for the decision screen

No packet should contain verifier API keys, admin tokens, private signing keys,
or raw secrets.

The reference schema and checker also require a no-secrets privacy posture and
raw URL redaction for committed scanner-fleet packets. Raw URLs belong in
test-only local artifacts, not in public deployment evidence.

The TypeScript reference package now includes an executable packet builder and
smoke check:

```sh
cd network && npm run scanner-fleet:evidence-smoke
```

The smoke check packages the minimum fixture matrix, links each row to the
active verifier profile fingerprint, requires hold-to-open evidence for every
orange or red outcome, requires non-empty reason codes, requires screenshot,
history, and accessibility references for every row, rejects raw URL-shaped
domain fingerprints, rejects reused evidence artifact references, and proves the
packet fails closed when required fixtures, profile fingerprints, hold gates,
evidence references, red-outcome behavior, or privacy redaction are wrong.

The packet smoke check validates references, not the backing files. Use the
non-blocking artifact status command while capture is still in progress:

```sh
cd network && npm run scanner-fleet:evidence-artifacts-status
```

Use the strict variant only when the native iPhone evidence package is expected
to be complete:

```sh
cd network && npm run scanner-fleet:evidence-artifacts-check
```

The strict check verifies that every screenshot, history-entry image, and
accessibility trace referenced by the packet exists under
`docs/public/evidence/iphone/` and is not an empty placeholder. It is
intentionally separate from the default network contract gate until the native
capture artifacts are committed.

## Minimum Fixture Matrix

The reference matrix should include at least:

- green accepted signed QR inside its validity window
- red expired QR (`freshness` block, cause `object-expired`)
- red destination mismatch
- red resolver final-target mismatch
- orange plain URL without a recognized trust signal
- orange verifier unavailable with visible destination
- stale verifier profile behavior
- revoked verifier profile behavior

The matrix may include additional local threats, but these outcomes are the
minimum scanner-visible contract.

The contract and service smoke checks enforce this minimum fixture set, require
at least one evidence row for each fixture, verify that row colors and states
match the fixture expectations, and require red/orange outcomes to carry
hold-to-open evidence.

## User-Visible Acceptance

For each fixture, evidence should show:

- final color
- short user-facing label
- destination fingerprint or domain summary
- whether an "open anyway" action is present
- whether hold-to-open was required
- decision-path explanation
- history entry after the scan

The scanner must preserve the distinction between:

- no recognized trust signal
- recognized issuer and approved destination
- recognized issuer but runtime risk
- active mismatch or block condition
- unavailable verifier service

## Event Requirements

Each scan evidence row should record:

- `decision_id`
- `scanner_client_id`
- `scanner_build`
- `profile_fingerprint`
- `decision_color`
- `decision_state`
- `reason_codes`
- `domain_fingerprint`
- `opened_by_user`
- `hold_required`
- `hold_completed`
- `observed_at`
- `screenshot_ref`
- `history_entry_ref`
- `accessibility_ref`

For privacy, scanner-fleet evidence should minimize raw URL retention. If a raw
destination is needed for a fixture, store it in a test-only packet or hash it
outside the user-visible history.

## Failure Conditions

A scanner fleet is not deployment-ready when:

- green can be produced without an active verifier profile
- an expired envelope still opens as green
- destination mismatch is hidden behind a generic warning
- verifier-unavailable scans are reported as safe
- red decisions can be opened by user action
- red or orange decisions open instantly without the configured user gate
- no evidence links a scan decision to a profile fingerprint
- reason codes, screenshots, history entries, or accessibility traces are absent
- two evidence rows point at the same screenshot, history entry, or
  accessibility trace
- logs contain secrets or admin tokens
- screenshots do not match persisted scanner-decision records

## Handoff Boundary

This evidence contract does not prove that the root program, delegated
authority, issuer enrollment, or destination policy is correct. It proves the
scanner fleet consumed the managed trust state and presented the decision to a
user in a disciplined way.

Governance evidence answers: "Was the trust state valid?"

Scanner fleet evidence answers: "Did the deployed scanner use that trust state
correctly at scan time?"
