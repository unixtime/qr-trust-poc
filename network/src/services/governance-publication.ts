import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type {
  ArtifactPublicationInput,
  ArtifactPublicationServiceShape,
} from "./artifact-publication.js"
import { destinationPolicyArtifactBody } from "./destination-policy-publication.js"
import {
  makeFixtureTrustArtifactSigner,
  type TrustArtifactSignerShape,
} from "./signing-custody.js"
import {
  demoDelegatedAuthorityTrustKey,
  demoRootTrustKey,
} from "./trust-key-registry.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
} from "./verifier-cache.js"

export interface GovernancePublicationReport {
  readonly root_manifest_artifact_id: string
  readonly delegated_authority_artifact_id: string
  readonly issuer_record_artifact_id: string
  readonly destination_policy_artifact_id: string
  readonly published_artifacts: number
}

export interface GovernancePublicationServiceShape {
  readonly publishReferenceBundle: (
    observedAt: Date,
  ) => Effect.Effect<GovernancePublicationReport, NetworkError>
}

export type GovernancePublicationPlanArtifacts = readonly [
  ArtifactPublicationInput,
  ArtifactPublicationInput,
  ArtifactPublicationInput,
  ArtifactPublicationInput,
]

export interface GovernancePublicationPlan {
  readonly artifacts: GovernancePublicationPlanArtifacts
}

export const planReferenceGovernancePublication = (
  occurredAt: Date,
): GovernancePublicationPlan => ({
  artifacts: [
    rootManifestPublicationInput(occurredAt),
    delegatedAuthorityPublicationInput(occurredAt),
    issuerRecordPublicationInput(occurredAt),
    destinationPolicyPublicationInput(occurredAt),
  ],
})

export const makeGovernancePublicationService = (
  publisher: ArtifactPublicationServiceShape,
  signer: TrustArtifactSignerShape = makeFixtureTrustArtifactSigner(),
): GovernancePublicationServiceShape => ({
  publishReferenceBundle: (observedAt) =>
    Effect.gen(function* () {
      const plan = planReferenceGovernancePublication(observedAt)
      const signedArtifacts = yield* signGovernancePublicationPlan(plan, signer)
      const rootManifest = yield* publisher.publishArtifact(signedArtifacts[0])
      const delegatedAuthority = yield* publisher.publishArtifact(
        signedArtifacts[1],
      )
      const issuerRecord = yield* publisher.publishArtifact(signedArtifacts[2])
      const destinationPolicy = yield* publisher.publishArtifact(
        signedArtifacts[3],
      )

      return {
        root_manifest_artifact_id: rootManifest.artifact.artifact_id,
        delegated_authority_artifact_id:
          delegatedAuthority.artifact.artifact_id,
        issuer_record_artifact_id: issuerRecord.artifact.artifact_id,
        destination_policy_artifact_id:
          destinationPolicy.artifact.artifact_id,
        published_artifacts: 4,
      }
    }),
})

export const signGovernancePublicationPlan = (
  plan: GovernancePublicationPlan,
  signer: TrustArtifactSignerShape,
): Effect.Effect<GovernancePublicationPlanArtifacts, NetworkError> =>
  Effect.gen(function* () {
    const rootManifest = yield* signPublicationInput(
      plan.artifacts[0],
      signer,
      {
        signed_by: plan.artifacts[0].root_program_id,
        root_program_id: plan.artifacts[0].root_program_id,
      },
    )
    const delegatedAuthority = yield* signPublicationInput(
      plan.artifacts[1],
      signer,
      {
        signed_by: plan.artifacts[1].root_program_id,
        root_program_id: plan.artifacts[1].root_program_id,
      },
    )
    const issuerRecord = yield* signPublicationInput(
      plan.artifacts[2],
      signer,
      {
        signed_by:
          plan.artifacts[2].delegated_authority_id ??
          plan.artifacts[2].root_program_id,
        root_program_id: plan.artifacts[2].root_program_id,
        ...(plan.artifacts[2].delegated_authority_id
          ? { delegated_authority_id: plan.artifacts[2].delegated_authority_id }
          : {}),
      },
    )
    const destinationPolicy = yield* signPublicationInput(
      plan.artifacts[3],
      signer,
      {
        signed_by:
          plan.artifacts[3].delegated_authority_id ??
          plan.artifacts[3].root_program_id,
        root_program_id: plan.artifacts[3].root_program_id,
        ...(plan.artifacts[3].delegated_authority_id
          ? { delegated_authority_id: plan.artifacts[3].delegated_authority_id }
          : {}),
      },
    )

    return [
      rootManifest,
      delegatedAuthority,
      issuerRecord,
      destinationPolicy,
    ] as const
  })

const signPublicationInput = (
  input: ArtifactPublicationInput,
  signer: TrustArtifactSignerShape,
  signing: {
    readonly signed_by: string
    readonly root_program_id: string
    readonly delegated_authority_id?: string
  },
): Effect.Effect<ArtifactPublicationInput, NetworkError> =>
  Effect.gen(function* () {
    const signed = yield* signer.signTrustArtifact({
      body: input.body as Record<string, unknown>,
      signed_by: signing.signed_by,
      root_program_id: signing.root_program_id,
      ...(signing.delegated_authority_id
        ? { delegated_authority_id: signing.delegated_authority_id }
        : {}),
    })

    return {
      ...input,
      body: signatureAlignedPublicationBody(signed.body),
    }
  })

const signatureAlignedPublicationBody = (
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const publication = body.publication
  if (
    !publication ||
    typeof publication !== "object" ||
    Array.isArray(publication)
  ) {
    return body
  }

  return {
    ...body,
    publication: {
      ...publication,
      signed_by: body.signed_by,
      signature_status: body.signature_status,
    },
  }
}

export const referenceRootManifestBody = () => ({
  artifact_type: "root_manifest",
  schema_version: "0.1.0",
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  name: "QR Trust Demo Root",
  program_scope:
    "Reference implementation for managed issuer verification, destination binding, and scanner-visible decisions.",
  accepted_algorithm_ids: ["ed25519"],
  trust_keys: [
    {
      key_id: demoRootTrustKey.key_id,
      signer_id: demoRootTrustKey.signer_id,
      algorithm_id: demoRootTrustKey.algorithm_id,
      public_key_material_ref: demoRootTrustKey.public_key_material_ref,
      status: demoRootTrustKey.status,
    },
  ],
  policy_constraints: {
    allows_unenrolled_qr_as_unverified: true,
    requires_root_scoped_issuer_namespace: true,
    requires_destination_policy: true,
    requires_cache_freshness_metadata: true,
    requires_scanner_visible_decision_state: true,
  },
  delegated_authorities: [
    {
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      name: "QR Trust Demo Merchant Web Authority",
      manifest_ref: "art_authority_qrtrust_demo_merchant_web_v1",
      status: "active",
    },
  ],
  publication: {
    published_at: demoIssuerProjection.cache_generated_at,
    valid_until: demoIssuerProjection.cache_expires_at,
    signed_by: demoIssuerProjection.namespace.root_program_id,
    signature_status: "ed25519-signed",
  },
})

export const referenceDelegatedAuthorityBody = () => ({
  artifact_type: "delegated_authority_manifest",
  schema_version: "0.1.0",
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id:
    demoIssuerProjection.namespace.delegated_authority_id,
  operator_name: "QR Trust Demo Merchant Web Authority",
  operator_class: "merchant_operator",
  scope: ["merchant-web"],
  trust_keys: [
    {
      key_id: demoDelegatedAuthorityTrustKey.key_id,
      signer_id: demoDelegatedAuthorityTrustKey.signer_id,
      algorithm_id: demoDelegatedAuthorityTrustKey.algorithm_id,
      public_key_material_ref:
        demoDelegatedAuthorityTrustKey.public_key_material_ref,
      status: demoDelegatedAuthorityTrustKey.status,
    },
  ],
  assurance_requirements: {
    domain_control_required: true,
    business_identity_proofing: "fixture-verified-business",
    destination_policy_required: true,
    runtime_safety_policy_required: true,
  },
  enrolled_issuers: [
    {
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      issuer_record_ref: "art_issuer_acme_demo_v1",
      assurance_tier: demoIssuerProjection.assurance_tier,
      status: "active",
    },
  ],
  publication: {
    published_at: demoIssuerProjection.cache_generated_at,
    valid_until: demoIssuerProjection.cache_expires_at,
    signed_by: demoIssuerProjection.namespace.root_program_id,
    signature_status: "ed25519-signed",
  },
})

export const referenceIssuerRecordBody = () => ({
  artifact_type: "issuer_record",
  schema_version: "0.1.0",
  issuer_namespace: demoIssuerProjection.namespace,
  issuer_display_name: demoIssuerProjection.issuer_display_name,
  issuer_class: "business",
  assurance_tier: demoIssuerProjection.assurance_tier,
  certificate_refs: ["cert:acme-demo:web-signing:v1"],
  destination_policies: [
    {
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      policy_ref: "art_policy_acme_demo_v1",
      status: "active",
    },
  ],
  inspection_scope: {
    passive_public_checks: true,
    runtime_reputation_checks: "fixture-only",
    authenticated_or_invasive_testing: false,
  },
  status: {
    issuer_status: "active",
    certificate_status: "active",
    status_event_ref: "status:acme-demo:active:v1",
  },
  publication: {
    published_at: demoIssuerProjection.cache_generated_at,
    valid_until: demoIssuerProjection.cache_expires_at,
    signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    signature_status: "ed25519-signed",
  },
})

export const referenceDestinationPolicyBody = () =>
  destinationPolicyArtifactBody(demoDestinationPolicyProjection)

const rootManifestPublicationInput = (
  occurredAt: Date,
): ArtifactPublicationInput => ({
  artifact_type: "root_manifest",
  artifact_id: "art_root_qrtrust_demo_2026_v1",
  version: 1,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  body: referenceRootManifestBody(),
  occurredAt,
  eventType: "root.manifest.published",
  reason: "fixture root manifest publication",
})

const delegatedAuthorityPublicationInput = (
  occurredAt: Date,
): ArtifactPublicationInput => ({
  artifact_type: "delegated_authority_manifest",
  artifact_id: "art_authority_qrtrust_demo_merchant_web_v1",
  version: 1,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id: demoIssuerProjection.namespace.delegated_authority_id,
  body: referenceDelegatedAuthorityBody(),
  occurredAt,
  eventType: "delegated_authority.manifest.published",
  reason: "fixture delegated authority publication",
})

const issuerRecordPublicationInput = (
  occurredAt: Date,
): ArtifactPublicationInput => ({
  artifact_type: "issuer_record",
  artifact_id: "art_issuer_acme_demo_v1",
  version: 1,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id: demoIssuerProjection.namespace.delegated_authority_id,
  issuer_id: demoIssuerProjection.namespace.issuer_id,
  destination_policy_id: demoIssuerProjection.destination_policy_id,
  body: referenceIssuerRecordBody(),
  occurredAt,
  eventType: "issuer.record.published",
  reason: "fixture issuer publication",
})

const destinationPolicyPublicationInput = (
  occurredAt: Date,
): ArtifactPublicationInput => ({
  artifact_type: "destination_policy",
  artifact_id: "art_policy_acme_demo_v1",
  version: 1,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id: demoIssuerProjection.namespace.delegated_authority_id,
  issuer_id: demoIssuerProjection.namespace.issuer_id,
  destination_policy_id: demoIssuerProjection.destination_policy_id,
  body: referenceDestinationPolicyBody(),
  occurredAt,
  eventType: "destination.policy.published",
  reason: "fixture destination policy publication",
})
