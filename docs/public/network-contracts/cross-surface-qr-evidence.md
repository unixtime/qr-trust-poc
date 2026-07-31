# Cross-Surface QR Evidence

This contract proves that one QR scenario carries the same scanner-visible
decision across the reference network, worker drills, web lab, backend scanner
decision endpoint, and native iOS scanner.

It is intentionally not a production telemetry format. It is a review packet for
committee, professor, operator, and engineer handoff.

## Required Surfaces

Rows must appear in this order:

1. `contract_fixture`
2. `worker_drill`
3. `web_lab`
4. `backend_scanner_decision`
5. `ios_scanner`

The order follows the paper's handoff path: specification, propagation and
validation drill, web explanation, backend decision, then user-visible native
scanner result.

## Invariants

- Every row must reference the same `qr_artifact.artifact_ref`.
- Every row must match the packet `final_decision.decision_color`.
- Every row must match the packet `final_decision.decision_state`.
- Every row must carry non-empty `reason_codes`.
- Every `proof_ref` must be unique.
- The iOS proof must live under `docs/public/evidence/iphone/`.
- Public packets must redact raw URLs and exclude secrets.
- The destination is represented as a compact fingerprint, not a full URL.

## Why This Exists

The paper argues that QR trust is not created by decoding or cryptography alone.
The implementation must show that issuer legitimacy, destination binding,
runtime safety, and scanner-visible decision state survive across system
boundaries.

This packet is the bridge between the research claim and the implementation
claim. It answers one review question:

> Can the same QR be explained consistently by the contracts, services, web lab,
> backend scanner decision, and native scanner?

If the answer is no, the system may still be useful as a demo, but it should not
be presented as a reference network.

## Reference Artifact

- Schema: `cross-surface-qr-evidence.schema.json`
- Example: `examples/cross-surface-qr-evidence-reference.json`
- Smoke test: `make check-network-cross-surface-evidence`
