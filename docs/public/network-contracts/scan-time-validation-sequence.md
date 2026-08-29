# Scan-Time Validation Sequence

Date: 2026-05-17

Status:
- draft reference flow
- non-normative
- aligned to the paper's scanner-visible trust model

## Purpose

This sequence describes the online scanner path for a verifier that already has
local trust state. It keeps the paper's distinction intact:

- QR decoding is not trust.
- Signature validation is not enough.
- A green scanner result requires issuer legitimacy, destination binding,
  runtime safety, and fresh enough verifier state.

## Sequence

```mermaid
sequenceDiagram
    participant Scanner as Scanner client
    participant Verifier as Verifier API
    participant Cache as Verifier cache
    participant Runtime as Runtime safety provider
    participant Audit as Scanner decision log

    Scanner->>Verifier: Submit decoded QR payload
    Verifier->>Verifier: Parse QR envelope or plain URL

    alt Plain URL or unknown envelope
        Verifier->>Verifier: Build orange unverified decision
        Verifier->>Audit: Record scanner-visible decision
        Verifier-->>Scanner: Orange, destination visible, hold/open guidance
    else Signed QR artifact
        Verifier->>Verifier: Verify signature and canonical claims
        Verifier->>Cache: Load issuer namespace and destination policy

        alt Cache missing, stale, or expired
            Verifier->>Verifier: Build orange or red freshness decision
            Verifier->>Audit: Record scanner-visible decision
            Verifier-->>Scanner: Not green; freshness reason code
        else Cache fresh
            Verifier->>Verifier: Check issuer enrollment and assurance
            Verifier->>Verifier: Check destination binding and redirect policy
            Verifier->>Runtime: Request current destination verdict

            alt Runtime unavailable
                Verifier->>Verifier: Build orange runtime-unavailable decision
                Verifier->>Audit: Record scanner-visible decision
                Verifier-->>Scanner: Orange; visible destination but not fully checked
            else Runtime risky or blocked
                Verifier->>Verifier: Build orange/red runtime-risk decision
                Verifier->>Audit: Record scanner-visible decision
                Verifier-->>Scanner: User-visible warning with destination
            else Runtime clear and binding valid
                Verifier->>Verifier: Evaluate the residual vector (freshness = validity window)
                Verifier->>Audit: Record scanner-visible decision
                Verifier-->>Scanner: Green decision with the residual vector
            end
        end
    end
```

## Decision Rules

| Condition | Scanner result | Reason |
| --- | --- | --- |
| Plain URL without trust envelope | Orange | No recognized issuer trust signal |
| Signature invalid | Red | Artifact cannot be trusted |
| Issuer missing from cache | Orange | Lack of enrollment is not proof of maliciousness |
| Issuer revoked or suspended | Red | Trust path fails before destination checks |
| Destination outside issuer policy | Red | Destination binding fails |
| Runtime service unavailable | Orange | Destination may be visible but not fully checked |
| Runtime service reports risk | Orange or red | Present-time destination safety changed |
| Expired envelope | Red | `freshness` block, cause `object-expired` |
| Envelope scanned repeatedly inside its window | Green if other checks pass | Every presentation is evaluated the same way |

## Implementation Notes

- The verifier should return a `scanner-decision.schema.json` response for every
  path, including failures.
- Scanner clients should not expose raw implementation reasons as the main user
  message. They should map reason codes to plain green, orange, or red guidance.
- Runtime safety must be fresh enough to affect a green result.
- Verifiers should be able to resynchronize cache state without blocking every
  scan on the event bus.
