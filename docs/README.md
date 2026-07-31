# QR Trust PoC documentation

This documentation explains the research boundary, verifier semantics,
implementation, evidence, and operating paths for the QR Trust PoC.

!!! important
    The repository demonstrates controlled decision semantics. It does not
    establish a production trust authority, universal standard, field detection
    rate, or user-comprehension result.

## Start by role

| Reader | Recommended path |
| --- | --- |
| Professor or researcher | [Project overview](public/PROJECT_OVERVIEW.md) → [published paper and citation](public/CITING.md) → [evaluation](public/evaluation/README.md) |
| Security or protocol engineer | [Trust layers](public/TRUST_LAYERS.md) → [security requirements](public/QR_TRUST_SECURITY_REQUIREMENTS.md) → [scanner decisions](public/SCANNER_DECISION_MATRIX.md) |
| Application developer | [Run guide](public/RUN_GUIDE.md) → [verifier profile](public/VERIFIER_PROFILE.md) → [test vectors](public/TEST_VECTORS.md) |
| Platform or infrastructure engineer | [Network architecture](public/NETWORK_ARCHITECTURE_PLAN.md) → [network contracts](public/network-contracts/README.md) → [evidence](public/evidence/README.md) |
| Contributor or reviewer | [Contributing](../CONTRIBUTING.md) → [public checklist](public/PUBLIC_RELEASE_CHECKLIST.md) → [release-candidate status](public/RELEASE_CANDIDATE_STATUS.md) |

## Project orientation

- [Project overview](public/PROJECT_OVERVIEW.md) — problem statement,
  architecture, service catalog, resource estimates, and supported workflows.
- [Published paper and citation](public/CITING.md) — current SSRN paper,
  preferred citation, DOI, and BibTeX.
- [Run guide](public/RUN_GUIDE.md) — environment setup, Compose profiles,
  frontend, backend, network, and iOS commands.
- [Open-source direction](public/OPEN_SOURCE_DIRECTION.md) — public scope and
  contribution direction.

## Trust and decision semantics

- [Trust model](public/TRUST_MODEL.md) — high-level managed-trust architecture.
- [Trust layers](public/TRUST_LAYERS.md) — artifact, cryptographic, issuer,
  destination, and runtime-safety questions.
- [Trust tiers](public/TRUST_TIERS.md) — assurance categories and their limits.
- [Enrollment and consent](public/ENROLLMENT_AND_CONSENT_MODEL.md) — issuer
  enrollment and monitoring boundaries.
- [Verifier profile](public/VERIFIER_PROFILE.md) — current verifier contract.
- [Scanner decision matrix](public/SCANNER_DECISION_MATRIX.md) — evidence-to-
  decision mapping.
- [Scanner UX states](public/SCANNER_UX_STATES.md) — user-visible green,
  orange, and red behavior.
- [Short-URL and redirect policy](public/SHORT_URL_REDIRECT_POLICY.md) —
  resolver and final-destination handling.
- [Security requirements](public/QR_TRUST_SECURITY_REQUIREMENTS.md) — stable
  requirements derived from adversarial review.
- [Failure modes](public/TRUST_MODEL_FAILURE_MODES.md) — ecosystem,
  governance, privacy, and adoption pressure tests.

## Implementation and architecture

- [Network architecture](public/NETWORK_ARCHITECTURE_PLAN.md) — reference
  topology and service responsibilities.
- [Network contracts](public/network-contracts/README.md) — schemas, example
  events, cache entries, scanner decisions, and operator evidence.
- [Governance artifacts](public/APPENDIX_GOVERNANCE_ARTIFACTS.md) —
  non-normative examples used by the PoC.
- [iOS end-user design](public/IOS_END_USER_APP_DESIGN.md) — native scanner
  boundary and UX direction.
- [iOS enterprise readiness](public/IOS_ENTERPRISE_READINESS.md) — deployment
  constraints for managed-device use.

## Evaluation and evidence

- [Trust-residual evaluation](public/evaluation/README.md) — controlled corpus,
  generated results, and claim limits.
- [Test vectors](public/TEST_VECTORS.md) — behavior-level verifier cases.
- [Browser and device matrix](public/BROWSER_TEST_MATRIX.md) — supported
  validation surfaces.
- [Evidence manifest](public/evidence/README.md) — what the tracked browser and
  iPhone artifacts prove.
- [iPhone test plan](public/IPHONE_TEST_PLAN.md) — physical-device procedure.

## Diagrams

- [Trust-model graph](public/TRUST_MODEL_GRAPH.md)
- [Authority flow](public/QR_TRUST_AUTHORITY_FLOW_ASCII.md)
- [Problem framing](public/QR_TRUST_PROBLEM_DIAGRAM_ASCII.md)
- [Deployment rollout](public/DEPLOYMENT_ROLLOUT_GRAPH.md)

## Policies and contribution

- [Security policy](../SECURITY.md)
- [Contribution guide](../CONTRIBUTING.md)
- [Support policy](../SUPPORT.md)
- [Roadmap](../ROADMAP.md)

## Local documentation server

From the repository root:

```bash
make docs-build
make docs-serve
```

Open <http://127.0.0.1:8088/>. The maintainer target builds a filtered static
site before serving it, so excluded paper-development and local-only material
is not exposed by the documentation server.
