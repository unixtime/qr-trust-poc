# Scanner Decision Matrix

Date: 2026-04-12

Purpose:
- map verifier and trust outcomes to scanner-visible decisions
- give platform and SDK discussions a concrete policy table

## Decision Table

| Issuer enrolled | Signature valid | Destination bound | Runtime safe | Suggested state | Suggested action |
|---|---|---|---|---|---|
| No | No | Unknown | Unknown | Unverified | Show normalized destination and caution |
| No | Yes | Unknown | Unknown | Signed, unaccepted issuer | Show caution, no trusted badge |
| Yes | Yes | Yes | Yes | Verified issuer | Allow with positive trust signal |
| Yes | Yes | No | Unknown | Destination changed | Strong warning or block |
| Yes | Yes | Yes | No | Verified issuer, destination risky | Caution or block depending on severity |
| Yes | No | Unknown | Unknown | Blocked | Block or high-severity warning |
| Yes | Revoked | Unknown | Unknown | Blocked | Block |

## Example Mappings

### Music teacher flyer

- enrolled as verified individual
- QR binds to `music.teacher.example`
- destination still approved
- no current runtime danger

State:
- `Verified individual`

### Restaurant menu

- enrolled as verified business
- QR binds to approved menu host
- host is later compromised

State:
- `Verified business, destination risky`

### Random street poster

- no enrollment
- plain URL QR

State:
- `Unverified QR`

### Self-signed ecosystem QR

- signature valid
- scanner does not recognize issuer trust root

State:
- `Signed, unaccepted issuer`

## Policy Principle

Do not conflate:
- lack of trust enrollment
with
- active maliciousness

Those are different user states and should produce different UX.
