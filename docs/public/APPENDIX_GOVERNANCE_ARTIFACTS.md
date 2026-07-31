# Appendix: Illustrative Governance Artifacts

Date:
- 2026-04-13

Purpose:
- make the paper's governance claims concrete without pretending to define a final standard
- show the minimum signed artifacts implied by the trust-root, delegation, enrollment, and status model
- provide non-normative example structures that match the paper's architecture

Status:
- non-normative
- illustrative only
- intended to clarify fields and relationships, not to prescribe a final wire format

## Design intent

The paper argues that a QR trust system needs more than signatures on QR payloads. It also needs signed governance and state artifacts that can be:
- published
- synchronized
- cached
- audited
- revoked

The examples below are the minimum plausible artifact set for that claim.

## 1. Root trust program manifest

Purpose:
- identify an accepted trust-root program
- publish root keys
- define delegation boundaries

Illustrative fields:
- `type`
- `trust_program_id`
- `version`
- `root_public_keys`
- `policy_url`
- `distribution_endpoints`
- `delegation_rules`
- `issued_at`
- `expires_at`
- `signed_by`

Example:

```json
{
  "type": "root_trust_program_manifest",
  "trust_program_id": "tp_root_01",
  "version": 3,
  "root_public_keys": [
    {
      "key_id": "root-key-2026-01",
      "algorithm": "Ed25519",
      "public_key": "BASE64URL..."
    }
  ],
  "policy_url": "https://trust.example/policy/v3",
  "distribution_endpoints": [
    "https://trust.example/artifacts/root.json",
    "https://trust.example/artifacts/events.json"
  ],
  "delegation_rules": {
    "allowed_operator_classes": [
      "payment_operator",
      "government_operator",
      "merchant_platform",
      "enterprise_operator"
    ],
    "max_delegation_depth": 2
  },
  "issued_at": "2026-04-12T00:00:00Z",
  "expires_at": "2027-04-12T00:00:00Z",
  "signed_by": "tp_root_01"
}
```

## 2. Delegated operator manifest

Purpose:
- define an operator authority under a root program
- limit scope and issuer classes
- publish operator keys and status

Illustrative fields:
- `type`
- `trust_program_id`
- `operator_id`
- `operator_class`
- `scope`
- `allowed_issuer_classes`
- `assurance_requirements`
- `operator_public_keys`
- `status`
- `issued_at`
- `expires_at`
- `signed_by`

Example:

```json
{
  "type": "delegated_operator_manifest",
  "trust_program_id": "tp_root_01",
  "operator_id": "gov-ca-01",
  "operator_class": "government_operator",
  "scope": [
    "public_service_qr",
    "agency_managed_navigation_qr"
  ],
  "allowed_issuer_classes": [
    "agency",
    "department",
    "contracted_service"
  ],
  "assurance_requirements": {
    "identity_proofing": "organization_verified",
    "domain_control_required": true,
    "revalidation_days": 365
  },
  "operator_public_keys": [
    {
      "key_id": "gov-ca-01-key-1",
      "algorithm": "Ed25519",
      "public_key": "BASE64URL..."
    }
  ],
  "status": "active",
  "issued_at": "2026-04-12T00:00:00Z",
  "expires_at": "2027-04-12T00:00:00Z",
  "signed_by": "tp_root_01"
}
```

## 3. Issuer record

Purpose:
- identify the enrolled issuer
- declare assurance tier and issuer keys
- bind approved destinations and resolver domains

Illustrative fields:
- `type`
- `issuer_id`
- `operator_id`
- `issuer_class`
- `assurance_tier`
- `issuer_public_keys`
- `approved_destinations`
- `approved_resolvers`
- `app_associations`
- `monitoring_consent`
- `status`
- `issued_at`
- `expires_at`
- `signed_by`

Example:

```json
{
  "type": "issuer_record",
  "issuer_id": "issuer-merchant-abc-01",
  "operator_id": "merchant-platform-01",
  "issuer_class": "merchant",
  "assurance_tier": "verified_business",
  "issuer_public_keys": [
    {
      "key_id": "issuer-merchant-abc-01-key-1",
      "algorithm": "Ed25519",
      "public_key": "BASE64URL..."
    }
  ],
  "approved_destinations": [
    "https://restaurant.example/menu"
  ],
  "approved_resolvers": [
    "https://go.restaurant.example/m1"
  ],
  "app_associations": [],
  "monitoring_consent": {
    "passive_public_checks": true,
    "runtime_safety_checks": true
  },
  "status": "active",
  "issued_at": "2026-04-12T00:00:00Z",
  "expires_at": "2026-10-12T00:00:00Z",
  "signed_by": "merchant-platform-01"
}
```

## 4. Destination policy object

Purpose:
- define what the issuer-approved navigation target actually is
- constrain redirect and resolver behavior
- define runtime-freshness requirements

Illustrative fields:
- `type`
- `issuer_id`
- `policy_id`
- `expected_final_urls`
- `allowed_resolver_urls`
- `allowed_redirect_hosts`
- `max_redirect_hops`
- `url_normalization_policy`
- `runtime_safety_policy`
- `issued_at`
- `expires_at`
- `signed_by`

Example:

```json
{
  "type": "destination_policy",
  "issuer_id": "issuer-merchant-abc-01",
  "policy_id": "dest-pol-2026-04-12-01",
  "expected_final_urls": [
    "https://restaurant.example/menu"
  ],
  "allowed_resolver_urls": [
    "https://go.restaurant.example/m1"
  ],
  "allowed_redirect_hosts": [
    "go.restaurant.example",
    "restaurant.example"
  ],
  "max_redirect_hops": 1,
  "url_normalization_policy": {
    "https_only": true,
    "default_port_equivalent": true,
    "strip_fragment": true,
    "idn_policy": "punycode_canonical"
  },
  "runtime_safety_policy": {
    "verdict_ttl_seconds": 3600,
    "stale_behavior": "downgrade_or_block"
  },
  "issued_at": "2026-04-12T00:00:00Z",
  "expires_at": "2026-07-12T00:00:00Z",
  "signed_by": "merchant-platform-01"
}
```

## 5. Revocation or status event

Purpose:
- revoke or suspend a root, operator, issuer, or destination-policy object
- distribute time-bounded status changes

Illustrative fields:
- `type`
- `target_type`
- `target_id`
- `status`
- `reason`
- `effective_at`
- `signed_by`

Example:

```json
{
  "type": "status_event",
  "target_type": "issuer_record",
  "target_id": "issuer-merchant-abc-01",
  "status": "suspended",
  "reason": "runtime_safety_compromise_investigation",
  "effective_at": "2026-04-19T09:10:00Z",
  "signed_by": "merchant-platform-01"
}
```

## 6. Verifier cache entry

Purpose:
- show how scanners and verifiers persist synchronized state locally
- make freshness behavior explicit

Illustrative fields:
- `artifact_type`
- `artifact_id`
- `version`
- `last_sync`
- `valid_until`
- `stale_behavior`

Example:

```json
{
  "artifact_type": "destination_policy",
  "artifact_id": "dest-pol-2026-04-12-01",
  "version": 1,
  "last_sync": "2026-04-19T08:00:00Z",
  "valid_until": "2026-04-19T09:00:00Z",
  "stale_behavior": "downgrade_or_block"
}
```

## Minimal verifier consumption model

At scan time, a verifier should be able to consume:
- a configured root trust program manifest
- a delegated operator manifest
- an issuer record
- a destination policy object
- any applicable revocation or status event
- a cached or fresh runtime-safety verdict
- the scanned QR artifact itself

That set is enough to evaluate:
- delegation chain validity
- issuer legitimacy
- destination binding
- runtime-safety freshness
- local decision policy

## Why this appendix matters

Without artifacts like these, `accreditation rules` and `delegation policy` remain purely rhetorical phrases in the main figure. The appendix does not solve standardization, but it does make the paper's governance model concrete enough to be reviewed as an architecture rather than as a slogan.
