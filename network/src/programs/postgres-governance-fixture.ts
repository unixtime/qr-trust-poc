import {
  demoDelegatedAuthorityTrustKey,
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  demoRootTrustKey,
  type PostgresGovernancePublicationBundleRow,
} from "../index.js"

export const postgresGovernancePublicationFixtureRow =
  (): PostgresGovernancePublicationBundleRow => ({
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    root_name: "QR Trust Demo Root",
    root_program_scope: "Reference trust program sourced from Postgres rows.",
    root_accepted_algorithm_ids: ["ed25519"],
    root_trust_keys: [demoRootTrustKey],
    root_policy_constraints: {
      requires_root_scoped_issuer_namespace: true,
      requires_destination_policy: true,
      requires_scanner_visible_decision_state: true,
    },
    root_status: "active",
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    delegated_authority_name: "QR Trust Demo Merchant Web Authority",
    delegated_authority_type: "merchant_operator",
    delegated_authority_scope: {
      allowed_operator_scope: ["merchant-web"],
    },
    delegated_authority_assurance_requirements: {
      domain_control_required: true,
      destination_policy_required: true,
    },
    delegated_authority_trust_keys: [demoDelegatedAuthorityTrustKey],
    delegated_authority_status: "active",
    issuer_id: demoIssuerProjection.namespace.issuer_id,
    issuer_display_name: demoIssuerProjection.issuer_display_name,
    issuer_class: "business",
    issuer_assurance_tier: demoIssuerProjection.assurance_tier,
    issuer_assurance_evidence: {
      source: "offline-postgres-governance-source-smoke",
      verified_hosts: demoIssuerProjection.allowed_hosts,
    },
    issuer_enrollment_status: "active",
    issuer_certificate_refs: ["cert:acme-demo:web-signing:v1"],
    issuer_certificate_status: "active",
    issuer_status_event_ref: "status:acme-demo:active:v1",
    issuer_status_event_status: "active",
    issuer_status_event_published_at: "2026-05-17T00:00:00.000Z",
    destination_policy_id:
      demoDestinationPolicyProjection.destination_policy_id,
    destination_policy_usage_policy: "reusable_public",
    destination_policy_approved_destinations:
      demoDestinationPolicyProjection.approved_destinations,
    destination_policy_redirect_policy: {
      resolver_urls:
        demoDestinationPolicyProjection.redirect_policy.resolver_urls,
      expected_final_destinations:
        demoDestinationPolicyProjection.redirect_policy
          .expected_final_destinations,
      allowed_redirect_hosts:
        demoDestinationPolicyProjection.redirect_policy.allowed_redirect_hosts,
      max_redirect_hops:
        demoDestinationPolicyProjection.redirect_policy.max_redirect_hops,
      nested_shorteners_allowed:
        demoDestinationPolicyProjection.redirect_policy
          .nested_shorteners_allowed,
      scanner_must_display_resolver_and_final_destination:
        demoDestinationPolicyProjection.redirect_policy
          .scanner_must_display_resolver_and_final_destination,
    },
    destination_policy_runtime_safety_policy: {
      provider: "deterministic-fixture",
      verdict_ttl_seconds: 300,
      stale_behavior: "downgrade_to_caution",
      unavailable_behavior: "downgrade_to_caution",
      publication_ttl_seconds: 86_400,
    },
    destination_policy_version: 1,
    destination_policy_status: "active",
  })
