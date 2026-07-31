import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { Effect } from "effect"
import type { Pool } from "pg"

import { persistenceError, type NetworkError } from "../errors.js"
import type { PostgresExecutorShape } from "../services/postgres-driver.js"
import type { SqlCommand } from "../services/postgres-persistence.js"
import {
  demoDelegatedAuthorityTrustKey,
  demoRootTrustKey,
  type TrustKeyRecord,
} from "../services/trust-key-registry.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
} from "../services/verifier-cache.js"

const NON_PRODUCTION_REFERENCE_SEED_ENV =
  "QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED"
const NON_PRODUCTION_REFERENCE_SEED_ARG =
  "--allow-non-production-reference-seed"

export const resetAndApplyReferenceSchema = (
  pool: Pool,
): Effect.Effect<void, NetworkError> =>
  Effect.gen(function* () {
    requireNonProductionReferenceSeedOptIn()
    const schemaSql = readFileSync(referenceSchemaPath(), "utf8")

    yield* runPoolCommand(
      pool,
      "reference_schema.drop",
      "drop schema if exists qr_trust cascade",
    )
    yield* runPoolCommand(
      pool,
      "reference_schema.rewind_backend_alembic_to_base",
      rewindBackendAlembicToBaseSql,
    )
    yield* runPoolCommand(pool, "reference_schema.apply", schemaSql)
  })

export const referenceSchemaPath = (): string =>
  resolve(
    process.cwd(),
    "../docs/public/network-contracts/reference-postgres-schema.sql",
  )

const rewindBackendAlembicToBaseSql = `
create table if not exists public.alembic_version (
  version_num varchar(32) not null primary key
);

insert into public.alembic_version (version_num)
values ('d4309a94dafa')
on conflict (version_num) do update set
  version_num = excluded.version_num;

delete from public.alembic_version
where version_num <> 'd4309a94dafa';
`

export const seedReferenceRows = (
  executor: PostgresExecutorShape,
): Effect.Effect<void, NetworkError> =>
  Effect.gen(function* () {
    requireNonProductionReferenceSeedOptIn()
    yield* executor.execute(seedRootProgramCommand())
    yield* executor.execute(seedDelegatedAuthorityCommand())
    yield* executor.execute(seedTrustKeyCommand(demoRootTrustKey))
    yield* executor.execute(seedTrustKeyCommand(demoDelegatedAuthorityTrustKey))
    yield* executor.execute(seedIssuerCommand())
    yield* executor.execute(seedIssuerCertificateCommand())
    yield* executor.execute(seedDestinationPolicyCommand())
  })

export const runPoolCommand = (
  pool: Pool,
  name: string,
  text: string,
): Effect.Effect<void, NetworkError> =>
  Effect.tryPromise({
    try: () => pool.query(text).then(() => undefined),
    catch: (cause) => persistenceError(`Postgres command ${name} failed.`, cause),
  })

export const requireNonProductionReferenceSeedOptIn = (): void => {
  if (
    process.env[NON_PRODUCTION_REFERENCE_SEED_ENV] === "true" ||
    process.argv.includes(NON_PRODUCTION_REFERENCE_SEED_ARG)
  ) {
    return
  }

  throw new Error(
    [
      "Refusing to apply the non-production Postgres reference seed.",
      "Set QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true or pass",
      `${NON_PRODUCTION_REFERENCE_SEED_ARG} for local smoke tests only.`,
    ].join(" "),
  )
}

const seedRootProgramCommand = (): SqlCommand => ({
  name: "reference_seed.root_program",
  text: `
insert into qr_trust.root_programs (
  root_program_id,
  name,
  program_scope,
  accepted_algorithm_ids,
  policy_constraints,
  status
) values ($1, $2, $3, $4, $5::jsonb, 'active')
on conflict (root_program_id) do update set
  name = excluded.name,
  program_scope = excluded.program_scope,
  accepted_algorithm_ids = excluded.accepted_algorithm_ids,
  policy_constraints = excluded.policy_constraints,
  status = excluded.status
`.trim(),
  values: [
    demoIssuerProjection.namespace.root_program_id,
    "QR Trust Demo Root",
    "Local scratch reference trust program for live Postgres smoke tests.",
    ["ed25519"],
    JSON.stringify({
      requires_root_scoped_issuer_namespace: true,
      requires_destination_policy: true,
      requires_scanner_visible_decision_state: true,
    }),
  ],
})

const seedDelegatedAuthorityCommand = (): SqlCommand => ({
  name: "reference_seed.delegated_authority",
  text: `
insert into qr_trust.delegated_authorities (
  root_program_id,
  delegated_authority_id,
  name,
  authority_type,
  scope,
  assurance_requirements,
  status
) values ($1, $2, $3, 'merchant_operator', $4::jsonb, $5::jsonb, 'active')
on conflict (root_program_id, delegated_authority_id) do update set
  name = excluded.name,
  authority_type = excluded.authority_type,
  scope = excluded.scope,
  assurance_requirements = excluded.assurance_requirements,
  status = excluded.status
`.trim(),
  values: [
    demoIssuerProjection.namespace.root_program_id,
    demoIssuerProjection.namespace.delegated_authority_id,
    "QR Trust Demo Merchant Web Authority",
    JSON.stringify({ allowed_operator_scope: ["merchant-web"] }),
    JSON.stringify({
      domain_control_required: true,
      destination_policy_required: true,
    }),
  ],
})

const seedTrustKeyCommand = (key: TrustKeyRecord): SqlCommand => ({
  name: "reference_seed.trust_key",
  text: `
insert into qr_trust.trust_keys (
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
on conflict (key_id) do update set
  root_program_id = excluded.root_program_id,
  delegated_authority_id = excluded.delegated_authority_id,
  signer_id = excluded.signer_id,
  algorithm_id = excluded.algorithm_id,
  public_key_material_ref = excluded.public_key_material_ref,
  public_key_material_pem = excluded.public_key_material_pem,
  scope = excluded.scope,
  key_status = excluded.key_status
`.trim(),
  values: [
    key.key_id,
    key.root_program_id,
    key.delegated_authority_id ?? null,
    key.signer_id,
    key.algorithm_id,
    key.public_key_material_ref,
    key.public_key_material_pem ?? null,
    key.scope,
    key.status,
  ],
})

const seedIssuerCommand = (): SqlCommand => ({
  name: "reference_seed.issuer",
  text: `
insert into qr_trust.issuers (
  root_program_id,
  delegated_authority_id,
  issuer_id,
  display_name,
  issuer_class,
  assurance_tier,
  assurance_evidence,
  enrollment_status
) values ($1, $2, $3, $4, 'business', $5, $6::jsonb, 'active')
on conflict (root_program_id, delegated_authority_id, issuer_id) do update set
  display_name = excluded.display_name,
  issuer_class = excluded.issuer_class,
  assurance_tier = excluded.assurance_tier,
  assurance_evidence = excluded.assurance_evidence,
  enrollment_status = excluded.enrollment_status
`.trim(),
  values: [
    demoIssuerProjection.namespace.root_program_id,
    demoIssuerProjection.namespace.delegated_authority_id,
    demoIssuerProjection.namespace.issuer_id,
    demoIssuerProjection.issuer_display_name,
    demoIssuerProjection.assurance_tier,
    JSON.stringify({
      source: "fixture-live-postgres-smoke",
      verified_hosts: demoIssuerProjection.allowed_hosts,
    }),
  ],
})

const seedIssuerCertificateCommand = (): SqlCommand => ({
  name: "reference_seed.issuer_certificate",
  text: `
insert into qr_trust.issuer_certificates (
  certificate_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  algorithm_id,
  public_key_ref,
  key_status,
  not_before,
  not_after
) values ($1, $2, $3, $4, 'ed25519', $5, 'active', $6::timestamptz, $7::timestamptz)
on conflict (certificate_id) do update set
  root_program_id = excluded.root_program_id,
  delegated_authority_id = excluded.delegated_authority_id,
  issuer_id = excluded.issuer_id,
  algorithm_id = excluded.algorithm_id,
  public_key_ref = excluded.public_key_ref,
  key_status = excluded.key_status,
  not_before = excluded.not_before,
  not_after = excluded.not_after
`.trim(),
  values: [
    "cert:acme-demo:web-signing:v1",
    demoIssuerProjection.namespace.root_program_id,
    demoIssuerProjection.namespace.delegated_authority_id,
    demoIssuerProjection.namespace.issuer_id,
    "key:acme-demo:web-signing:v1",
    demoIssuerProjection.cache_generated_at,
    demoIssuerProjection.cache_expires_at,
  ],
})

const seedDestinationPolicyCommand = (): SqlCommand => ({
  name: "reference_seed.destination_policy",
  text: `
insert into qr_trust.destination_policies (
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  usage_policy,
  approved_destinations,
  redirect_policy,
  runtime_safety_policy,
  version,
  status
) values ($1, $2, $3, $4, 'reusable_public', $5::jsonb, $6::jsonb, $7::jsonb, 1, 'active')
on conflict (
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id
) do update set
  usage_policy = excluded.usage_policy,
  approved_destinations = excluded.approved_destinations,
  redirect_policy = excluded.redirect_policy,
  runtime_safety_policy = excluded.runtime_safety_policy,
  version = excluded.version,
  status = excluded.status
`.trim(),
  values: [
    demoIssuerProjection.namespace.root_program_id,
    demoIssuerProjection.namespace.delegated_authority_id,
    demoIssuerProjection.namespace.issuer_id,
    demoDestinationPolicyProjection.destination_policy_id,
    JSON.stringify(demoDestinationPolicyProjection.approved_destinations),
    JSON.stringify(demoDestinationPolicyProjection.redirect_policy),
    JSON.stringify({
      provider: "deterministic-fixture",
      verdict_ttl_seconds: 300,
      stale_behavior: "downgrade_to_caution",
      unavailable_behavior: "downgrade_to_caution",
      publication_ttl_seconds: 86_400,
    }),
  ],
})
