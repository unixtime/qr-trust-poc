# QR Trust Security Requirements

Date:
- 2026-04-12

Purpose:
- convert adversarial findings into explicit design requirements
- provide stable requirement identifiers for paper, PoC, and future architecture work
- separate mandatory controls from desirable improvements

Source review:
- internal adversarial design review (not distributed in this repository)

Scope:
- navigation QR trust
- trusted resolver and redirect flows
- scanner-visible trust states
- trust-operator governance requirements

Out of scope:
- presentation QR verifier flows such as boarding passes or tickets, except where hybrid payloads create overlap

## Requirement levels

- `MUST`
  - required for any design that claims meaningful trust protection
- `SHOULD`
  - strongly recommended; omission creates material risk
- `MAY`
  - useful enhancement, but not required for a minimally defensible design

## Requirement set

### Enrollment and issuer assurance

`QR-SEC-001` `MUST`
- The system must define issuer-assurance tiers separately from scanner trust tiers.

Reason:
- issuer proofing strength and user-facing trust state are not the same control surface

Addresses:
- adversarial findings 1 and 2

`QR-SEC-002` `MUST`
- Public trust states must require explicit issuer proofing requirements, revalidation cadence, suspension triggers, and reinstatement rules.

Reason:
- enrollment is the primary trust-acquisition attack path

Addresses:
- adversarial finding 2

`QR-SEC-003` `SHOULD`
- The trust operator should define issuance quotas, anomaly detection, and fraud-review escalation for enrolled issuers.

Reason:
- low-friction malicious enrollment and mass abuse are predictable attack paths

Addresses:
- adversarial finding 2

`QR-SEC-003A` `MUST`
- The design must define a trust-root hierarchy and explicit delegation boundaries.

Minimum structure:
- accepted root trust program(s)
- delegated operator authorities
- enrolled issuer nodes
- issuer-bound destination or resolver policy nodes

Reason:
- trust acquisition cannot rely on flat local allowlists if independent verifiers are expected to reach compatible conclusions

Addresses:
- adversarial findings 1, 2, and 6

`QR-SEC-003B` `MUST`
- The design must define how current trust state is published and synchronized across entities.

Minimum shared artifacts:
- delegation manifests
- issuer manifests
- revocation or suspension events
- destination-policy updates
- freshness metadata for each signed artifact class

Reason:
- one verifier cannot safely depend on another verifier's private knowledge; current state must be distributable, cacheable, and auditable

Addresses:
- adversarial findings 2 and 3

`QR-SEC-003C` `SHOULD`
- The design should define offline-validation behavior and failure semantics for stale state.

At minimum:
- acceptable cache TTLs
- downgrade rules
- hard-block rules for expired critical artifacts

Reason:
- distributed trust systems fail ambiguously if they do not define what happens when the verifier cannot fetch current state

Addresses:
- adversarial findings 3 and 6

### Runtime-safety freshness

`QR-SEC-004` `MUST`
- Runtime-safety verdicts must carry explicit freshness metadata.

Minimum fields:
- verdict timestamp
- verdict TTL
- stale/expired state

Reason:
- without freshness semantics, a positive verdict can be socially overread as durable trust

Addresses:
- adversarial finding 3

`QR-SEC-005` `MUST`
- The scanner must have explicit states for:
- runtime safe
- runtime risky
- runtime unavailable
- runtime stale

Reason:
- “unknown” and “safe” cannot be collapsed without creating overclaim

Addresses:
- adversarial findings 1 and 3

`QR-SEC-006` `SHOULD`
- High-risk categories should support mediated or re-checked navigation rather than relying solely on cached runtime verdicts.

Reason:
- time-of-check/time-of-use abuse is otherwise straightforward

Addresses:
- adversarial finding 3

`QR-SEC-006A` `SHOULD`
- Managed deployments should integrate existing runtime-defense controls where available, such as:
- web application firewalls
- secure web gateways
- enterprise browsers
- conditional access
- destination-specific monitoring

Reason:
- these controls can strengthen runtime destination safety for organization-controlled targets, but they do not replace issuer trust or destination binding

Addresses:
- adversarial findings 1 and 3

### Redirect and destination binding

`QR-SEC-007` `MUST`
- The trust object must bind the full redirect flow, not only the first resolver URL.

Minimum fields:
- resolver URL
- expected final URL
- allowed redirect hosts
- maximum redirect hops

Reason:
- shorteners and trusted-looking first hops are common abuse surfaces

Addresses:
- adversarial finding 4

`QR-SEC-008` `MUST`
- The design must define canonical URL normalization and comparison rules.

At minimum:
- scheme normalization policy
- host normalization policy
- IDN handling
- query and fragment handling
- treatment of trailing slash and default-port variants

Reason:
- host and hop checks alone do not define final-destination equivalence

Addresses:
- adversarial finding 4

`QR-SEC-009` `MUST`
- The design must define how client-side redirects and post-load navigation affect destination binding.

Examples:
- JavaScript redirects
- meta refresh
- service-worker navigation
- delayed route changes

Reason:
- attackers will pivot after a benign first page if the policy ignores post-load behavior

Addresses:
- adversarial finding 4

`QR-SEC-010` `SHOULD`
- Nested shorteners should be blocked by default in trusted mode.

Reason:
- nested resolvers increase ambiguity and abuse opportunity with little trust benefit

Addresses:
- adversarial finding 4

### Scanner-visible trust states

`QR-SEC-011` `MUST`
- Positive issuer trust must not be shown as a strong green state when runtime safety is stale, unavailable, or low-confidence.

Reason:
- issuer legitimacy and current destination safety are different signals

Addresses:
- adversarial findings 1 and 3

`QR-SEC-012` `MUST`
- The state currently described as `signed, unaccepted issuer` must be presented as an untrusted caution state rather than as partial legitimacy.

Preferred wording:
- `Untrusted signed QR`
- `Signature present, issuer not trusted`

Reason:
- attackers exploit technically correct but socially misleading language

Addresses:
- adversarial finding 5

`QR-SEC-013` `SHOULD`
- The scanner should present both resolver and final destination when a trusted QR uses a resolver flow.

Reason:
- first-hop legitimacy is insufficient for user understanding

Addresses:
- adversarial finding 4

`QR-SEC-014` `SHOULD`
- Trust-state presentation should be evaluated with QR-specific warning-comprehension and adherence studies before broad deployment.

Reason:
- browser warning literature supports the importance of warning design, but does not validate QR-specific trust-state UX directly

Addresses:
- adversarial finding 5 and evidence-gap findings

### Platform and deployment constraints

`QR-SEC-015` `MUST`
- Any proposal for open-consumer QR trust must state whether it depends on default scanner-path integration.

Reason:
- an optional trust scanner is easy to bypass socially and operationally

Addresses:
- adversarial finding 6

`QR-SEC-016` `SHOULD`
- Initial deployment should be bounded to ecosystems that control at least one of:
- issuer enrollment
- destination set
- relying-party workflow
- default scan path

Reason:
- structured ecosystems are more realistic first markets than broad public-web deployment

Addresses:
- adversarial findings 2 and 6

### Privacy and telemetry

`QR-SEC-017` `MUST`
- Analytics collection for trusted QR resolvers must follow a documented minimization policy.

Reason:
- safety infrastructure that behaves like ad-tech will undermine user and regulator trust

Addresses:
- adversarial finding 7

`QR-SEC-018` `SHOULD`
- Safety telemetry should be logically separated from marketing analytics.

Reason:
- mixed telemetry purposes create both privacy risk and credibility risk

Addresses:
- adversarial finding 7

### Hybrid payload handling

`QR-SEC-019` `MUST`
- The design must define policy precedence for hybrid payloads that can both navigate and present a credential.

Examples:
- app link with browser fallback
- pass or ticket that opens a web portal
- presentation code that includes an external recovery URL

Reason:
- otherwise attackers will target the boundary between navigation and presentation trust classes

Addresses:
- adversarial finding 8

`QR-SEC-020` `SHOULD`
- Hybrid payloads should be treated as a distinct policy category if they cannot be safely reduced to one class.

Reason:
- mixed-mode flows create ambiguity that is easy to exploit

Addresses:
- adversarial finding 8

### Governance and operator controls

`QR-SEC-021` `MUST`
- A deployable trust program must define governance artifacts equivalent in function to:
- a trust-root policy
- issuer accreditation or onboarding rules
- suspension and revocation rules
- appeal and remediation paths

Reason:
- a trust architecture without governance artifacts is incomplete

Addresses:
- adversarial findings 1, 2, and 6

`QR-SEC-022` `MUST`
- Positive trust states must have documented scope limits stating what is and is not being promised.

Examples:
- issuer legitimacy does not imply destination safety forever
- runtime safe does not imply absence of future compromise

Reason:
- this limits UI overclaim and liability ambiguity

Addresses:
- adversarial findings 1 and 6

`QR-SEC-023` `SHOULD`
- The trust program should define emergency response procedures for:
- issuer compromise
- resolver compromise
- false positive block
- false negative miss
- mass malicious enrollment event

Reason:
- operational response is part of the security boundary

Addresses:
- adversarial findings 1, 2, and 3

## Minimum defensible subset

The smallest set of requirements needed for a design to claim meaningful trust protection is:
- `QR-SEC-001`
- `QR-SEC-002`
- `QR-SEC-004`
- `QR-SEC-005`
- `QR-SEC-007`
- `QR-SEC-008`
- `QR-SEC-009`
- `QR-SEC-011`
- `QR-SEC-012`
- `QR-SEC-015`
- `QR-SEC-017`
- `QR-SEC-019`
- `QR-SEC-021`
- `QR-SEC-022`

If those are not satisfied, the design should not be described as a meaningful trust system for navigation QR.

## Bottom line

The highest-value attacks in this design are not cryptographic breaks. They are:
- trust acquisition through weak enrollment
- trust borrowing through compromise of legitimate issuers
- stale or weak runtime verdicts
- redirect ambiguity
- socially misleading scanner states
- optional deployment paths that attackers can route around

These requirements are intended to close those gaps before the design is treated as deployment-grade.
