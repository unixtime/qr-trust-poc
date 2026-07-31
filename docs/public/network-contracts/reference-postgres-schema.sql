-- QR Trust Network reference schema.
-- Status: draft, non-normative; mirrored into backend Alembic for compose
-- startup and still applied through the TypeScript migration ledger for
-- shared-infra smoke drills and drift checks.
--
-- Design intent:
-- - Postgres is the durable source of truth.
-- - Events are emitted from the outbox after durable state commits.
-- - Issuer identity is scoped by root program and delegated authority.
-- - Scanner decisions are user-visible evidence records, not trust roots.

create extension if not exists pgcrypto;

create schema if not exists qr_trust;

create table if not exists qr_trust.root_programs (
  root_program_id text primary key,
  name text not null,
  program_scope text not null,
  accepted_algorithm_ids text[] not null default '{}',
  policy_constraints jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists qr_trust.delegated_authorities (
  root_program_id text not null references qr_trust.root_programs(root_program_id),
  delegated_authority_id text not null,
  name text not null,
  authority_type text not null
    check (
      authority_type in (
        'payment_operator',
        'public_service_operator',
        'merchant_operator',
        'enterprise_operator',
        'registry_operator'
      )
    ),
  scope jsonb not null default '{}'::jsonb,
  assurance_requirements jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (root_program_id, delegated_authority_id)
);

create index if not exists delegated_authorities_root_status_idx
  on qr_trust.delegated_authorities (root_program_id, status);

create table if not exists qr_trust.trust_keys (
  key_id text primary key,
  root_program_id text not null references qr_trust.root_programs(root_program_id),
  delegated_authority_id text,
  signer_id text not null,
  algorithm_id text not null,
  public_key_material_ref text not null,
  public_key_material_pem text,
  scope text not null
    check (scope in ('root_program', 'delegated_authority')),
  key_status text not null default 'active'
    check (key_status in ('active', 'suspended', 'revoked', 'expired')),
  not_before timestamptz,
  not_after timestamptz,
  created_at timestamptz not null default now(),
  foreign key (root_program_id, delegated_authority_id)
    references qr_trust.delegated_authorities(root_program_id, delegated_authority_id)
);

create index if not exists trust_keys_signer_status_idx
  on qr_trust.trust_keys (root_program_id, signer_id, key_status);

create table if not exists qr_trust.issuers (
  root_program_id text not null,
  delegated_authority_id text not null,
  issuer_id text not null,
  display_name text not null,
  issuer_class text not null
    check (
      issuer_class in (
        'individual',
        'business',
        'institution',
        'public_service',
        'payment_operator',
        'platform'
      )
    ),
  assurance_tier text not null
    check (
      assurance_tier in (
        'self_asserted',
        'domain_controlled',
        'verified_business',
        'regulated_operator',
        'public_authority'
      )
    ),
  assurance_evidence jsonb not null default '{}'::jsonb,
  enrollment_status text not null default 'pending'
    check (enrollment_status in ('pending', 'active', 'suspended', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (root_program_id, delegated_authority_id, issuer_id),
  foreign key (root_program_id, delegated_authority_id)
    references qr_trust.delegated_authorities(root_program_id, delegated_authority_id)
);

create index if not exists issuers_authority_status_idx
  on qr_trust.issuers (root_program_id, delegated_authority_id, enrollment_status);

create table if not exists qr_trust.issuer_domain_proofs (
  domain_proof_id uuid primary key default gen_random_uuid(),
  root_program_id text not null,
  delegated_authority_id text not null,
  issuer_id text not null,
  domain text not null,
  proof_method text not null
    check (
      proof_method in (
        'dns_txt',
        'https_well_known',
        'payment_processor',
        'enterprise_directory',
        'manual_review'
      )
    ),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'failed', 'expired', 'revoked')),
  verified_at timestamptz,
  expires_at timestamptz,
  evidence_ref text,
  created_at timestamptz not null default now(),
  foreign key (root_program_id, delegated_authority_id, issuer_id)
    references qr_trust.issuers(root_program_id, delegated_authority_id, issuer_id)
);

create unique index if not exists issuer_domain_proofs_active_domain_idx
  on qr_trust.issuer_domain_proofs (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    domain
  )
  where verification_status in ('pending', 'verified');

create index if not exists issuer_domain_proofs_domain_status_idx
  on qr_trust.issuer_domain_proofs (domain, verification_status);

create table if not exists qr_trust.issuer_certificates (
  certificate_id text primary key,
  root_program_id text not null,
  delegated_authority_id text not null,
  issuer_id text not null,
  algorithm_id text not null,
  public_key_ref text not null,
  key_status text not null default 'active'
    check (key_status in ('active', 'rotated', 'suspended', 'revoked', 'expired')),
  not_before timestamptz not null,
  not_after timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (root_program_id, delegated_authority_id, issuer_id)
    references qr_trust.issuers(root_program_id, delegated_authority_id, issuer_id)
);

create index if not exists issuer_certificates_issuer_status_idx
  on qr_trust.issuer_certificates (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    key_status
  );

create table if not exists qr_trust.destination_policies (
  root_program_id text not null,
  delegated_authority_id text not null,
  issuer_id text not null,
  destination_policy_id text not null,
  usage_policy text not null default 'reusable_public'
    check (usage_policy in ('reusable_public', 'one_time', 'time_limited')),
  approved_destinations jsonb not null default '[]'::jsonb,
  redirect_policy jsonb not null default '{}'::jsonb,
  runtime_safety_policy jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    destination_policy_id
  ),
  foreign key (root_program_id, delegated_authority_id, issuer_id)
    references qr_trust.issuers(root_program_id, delegated_authority_id, issuer_id)
);

create index if not exists destination_policies_issuer_status_idx
  on qr_trust.destination_policies (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    status
  );

create table if not exists qr_trust.published_artifacts (
  artifact_id text primary key,
  artifact_type text not null
    check (
      artifact_type in (
        'root_manifest',
        'delegated_authority_manifest',
        'issuer_record',
        'destination_policy',
        'revocation_status_event',
        'assurance_status_event',
        'verifier_cache_entry'
      )
    ),
  root_program_id text not null,
  delegated_authority_id text,
  issuer_id text,
  destination_policy_id text,
  canonical_json jsonb not null,
  artifact_hash text not null unique,
  signature text,
  version bigint not null default 1,
  publication_status text not null default 'published'
    check (publication_status in ('draft', 'published', 'superseded', 'revoked')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists published_artifacts_scope_type_idx
  on qr_trust.published_artifacts (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    artifact_type,
    publication_status
  );

create table if not exists qr_trust.artifact_publication_work_items (
  work_item_id uuid primary key default gen_random_uuid(),
  artifact_type text not null
    check (
      artifact_type in (
        'root_manifest',
        'delegated_authority_manifest',
        'issuer_record',
        'destination_policy',
        'revocation_status_event',
        'assurance_status_event',
        'verifier_cache_entry'
      )
    ),
  artifact_id text not null,
  version bigint not null default 1,
  root_program_id text not null,
  delegated_authority_id text,
  issuer_id text,
  destination_policy_id text,
  canonical_json jsonb not null,
  event_type text not null,
  artifact_ref text,
  previous_version bigint,
  reason text,
  occurred_at timestamptz not null default now(),
  work_status text not null default 'pending'
    check (work_status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  last_error text,
  published_artifact_id text,
  published_artifact_hash text,
  published_event_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists artifact_publication_work_items_pending_idx
  on qr_trust.artifact_publication_work_items (
    work_status,
    claim_expires_at,
    created_at
  )
  where work_status in ('pending', 'processing');

create unique index if not exists artifact_publication_work_items_artifact_version_idx
  on qr_trust.artifact_publication_work_items (artifact_id, version)
  where work_status <> 'failed';

create table if not exists qr_trust.status_events (
  status_event_id text primary key,
  root_program_id text not null,
  delegated_authority_id text,
  issuer_id text,
  destination_policy_id text,
  target_type text not null
    check (
      target_type in (
        'root_program',
        'delegated_authority',
        'issuer',
        'issuer_record',
        'certificate',
        'destination_policy',
        'trust_key'
      )
    ),
  target_id text not null,
  status text not null
    check (status in ('active', 'suspended', 'revoked', 'expired', 'retired')),
  reason_code text not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists status_events_target_effective_idx
  on qr_trust.status_events (target_type, target_id, effective_at desc);

create table if not exists qr_trust.verifier_cache_work_items (
  work_item_id uuid primary key default gen_random_uuid(),
  verifier_id text not null,
  root_manifest_artifact_id text not null
    references qr_trust.published_artifacts(artifact_id),
  delegated_authority_manifest_artifact_id text not null
    references qr_trust.published_artifacts(artifact_id),
  issuer_record_artifact_id text not null
    references qr_trust.published_artifacts(artifact_id),
  destination_policy_artifact_id text not null
    references qr_trust.published_artifacts(artifact_id),
  status_event_artifact_id text not null
    references qr_trust.published_artifacts(artifact_id),
  materialized_at timestamptz not null default now(),
  scanner_probes jsonb not null default '[]'::jsonb,
  work_status text not null default 'pending'
    check (work_status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists verifier_cache_work_items_pending_idx
  on qr_trust.verifier_cache_work_items (work_status, claim_expires_at, created_at)
  where work_status in ('pending', 'processing');

create index if not exists verifier_cache_work_items_source_idx
  on qr_trust.verifier_cache_work_items (
    issuer_record_artifact_id,
    destination_policy_artifact_id,
    status_event_artifact_id
  );

create table if not exists qr_trust.verifier_cache_entries (
  verifier_id text not null,
  root_program_id text not null,
  delegated_authority_id text not null,
  issuer_id text not null,
  destination_policy_id text not null,
  source_artifact_hashes text[] not null default '{}',
  scanner_trust_projection jsonb not null default '{}'::jsonb,
  cache_generated_at timestamptz not null,
  cache_expires_at timestamptz not null,
  freshness_status text not null
    check (freshness_status in ('fresh', 'stale', 'expired', 'unavailable')),
  created_at timestamptz not null default now(),
  primary key (
    verifier_id,
    root_program_id,
    delegated_authority_id,
    issuer_id,
    destination_policy_id
  ),
  foreign key (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    destination_policy_id
  )
    references qr_trust.destination_policies(
      root_program_id,
      delegated_authority_id,
      issuer_id,
      destination_policy_id
    )
);

create index if not exists verifier_cache_entries_expiry_idx
  on qr_trust.verifier_cache_entries (verifier_id, freshness_status, cache_expires_at);

create table if not exists qr_trust.runtime_observations (
  runtime_observation_id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  destination_host text not null,
  destination_url text not null,
  final_url text,
  verdict text not null
    check (verdict in ('clear', 'risky', 'blocked', 'unknown', 'unavailable')),
  risk_score integer not null default 0
    check (risk_score >= 0 and risk_score <= 100),
  reason_codes text[] not null default '{}',
  observed_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists runtime_observations_host_observed_idx
  on qr_trust.runtime_observations (destination_host, observed_at desc);

create table if not exists qr_trust.scanner_decisions (
  scanner_decision_id uuid primary key default gen_random_uuid(),
  decision_id text not null unique,
  verifier_id text not null,
  decision_color text not null
    check (decision_color in ('green', 'orange', 'red')),
  decision_state text not null,
  reason_codes text[] not null default '{}',
  risk_score integer
    check (risk_score is null or (risk_score >= 0 and risk_score <= 100)),
  destination_url text,
  destination_fingerprint text,
  root_program_id text,
  delegated_authority_id text,
  issuer_id text,
  destination_policy_id text,
  usage_policy text
    check (
      usage_policy is null
      or usage_policy in ('reusable_public', 'one_time', 'time_limited')
    ),
  hold_to_open_required boolean not null default false,
  hold_to_open_duration_ms integer not null default 0
    check (hold_to_open_duration_ms >= 0),
  decision_path jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scanner_decisions_verifier_created_idx
  on qr_trust.scanner_decisions (verifier_id, created_at desc);

create index if not exists scanner_decisions_destination_created_idx
  on qr_trust.scanner_decisions (destination_fingerprint, created_at desc);

create table if not exists qr_trust.event_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  artifact_id text not null,
  artifact_hash text not null,
  root_program_id text,
  delegated_authority_id text,
  issuer_id text,
  destination_policy_id text,
  payload jsonb not null,
  publish_status text not null default 'pending'
    check (publish_status in ('pending', 'publishing', 'published', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists event_outbox_pending_idx
  on qr_trust.event_outbox (publish_status, claim_expires_at, created_at)
  where publish_status in ('pending', 'publishing');

create index if not exists event_outbox_artifact_idx
  on qr_trust.event_outbox (artifact_id);
