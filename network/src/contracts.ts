import { Effect, Schema } from "effect"

export const DecisionColorSchema = Schema.Literal("green", "orange", "red")

export const CacheFreshnessStatusSchema = Schema.Literal(
  "fresh",
  "stale",
  "expired",
  "unavailable",
  "not_applicable",
)

export const DestinationSchema = Schema.Struct({
  display_host: Schema.String,
  fingerprint: Schema.String,
  url: Schema.String,
  resolver_url: Schema.optional(Schema.String),
  final_url: Schema.optional(Schema.String),
})

export const TrustStepSchema = Schema.Struct({
  status: Schema.String,
  label: Schema.String,
  message: Schema.String,
  reason_codes: Schema.optional(Schema.Array(Schema.String)),
})

export const TrustPathSchema = Schema.Struct({
  issuer_legitimacy: TrustStepSchema,
  destination_binding: TrustStepSchema,
  runtime_safety: TrustStepSchema,
  scanner_decision: TrustStepSchema,
})

export const HoldToOpenSchema = Schema.Struct({
  required: Schema.Boolean,
  duration_ms: Schema.Number,
  reason_codes: Schema.Array(Schema.String),
})

export const CacheFreshnessSchema = Schema.Struct({
  status: CacheFreshnessStatusSchema,
  cache_generated_at: Schema.optional(Schema.String),
  cache_expires_at: Schema.optional(Schema.String),
})

export const GovernanceProjectionSchema = Schema.Struct({
  root_program_id: Schema.String,
  delegated_authority_id: Schema.String,
  issuer_id: Schema.String,
  destination_policy_id: Schema.String,
})

export const ScannerDecisionSchema = Schema.Struct({
  decision_id: Schema.String,
  decided_at: Schema.String,
  decision_color: DecisionColorSchema,
  decision_state: Schema.String,
  reason_codes: Schema.Array(Schema.String),
  risk_score: Schema.optional(Schema.Number),
  destination: DestinationSchema,
  trust_path: TrustPathSchema,
  hold_to_open: HoldToOpenSchema,
  cache_freshness: CacheFreshnessSchema,
  governance: Schema.optional(GovernanceProjectionSchema),
})

const NonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))
const DateTimeStringSchema = Schema.String.pipe(
  Schema.filter(
    (value) => !Number.isNaN(Date.parse(value)),
    { message: () => "must be a date-time string" },
  ),
)
const RootProgramIdSchema = NonEmptyStringSchema.pipe(
  Schema.pattern(/^(root:|control-plane$)/),
)
const DelegatedAuthorityIdSchema = NonEmptyStringSchema.pipe(
  Schema.pattern(/^authority:/),
)
const IssuerIdSchema = NonEmptyStringSchema.pipe(Schema.pattern(/^issuer:/))
const DestinationPolicyIdSchema = NonEmptyStringSchema.pipe(
  Schema.pattern(/^policy:/),
)
const Sha256HashSchema = NonEmptyStringSchema.pipe(Schema.pattern(/^sha256:/))
const PositiveIntegerSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
)

export const EventEnvelopeSchema = Schema.Struct({
  event_id: NonEmptyStringSchema,
  type: NonEmptyStringSchema,
  occurred_at: DateTimeStringSchema,
  root_program_id: RootProgramIdSchema,
  delegated_authority_id: Schema.optional(DelegatedAuthorityIdSchema),
  issuer_id: Schema.optional(IssuerIdSchema),
  destination_policy_id: Schema.optional(DestinationPolicyIdSchema),
  artifact_id: NonEmptyStringSchema,
  artifact_hash: Sha256HashSchema,
  artifact_ref: Schema.optional(Schema.String),
  version: PositiveIntegerSchema,
  previous_version: Schema.optional(PositiveIntegerSchema),
  reason: Schema.optional(Schema.String),
})

export const RuntimeSafetyObservationSchema = Schema.Struct({
  artifact_type: Schema.Literal("runtime_safety_observation"),
  schema_version: NonEmptyStringSchema,
  observation_id: NonEmptyStringSchema,
  observed_at: DateTimeStringSchema,
  expires_at: Schema.optional(DateTimeStringSchema),
  provider: Schema.Struct({
    provider_id: NonEmptyStringSchema,
    provider_kind: Schema.Literal(
      "redirect_inspector",
      "reputation_provider",
      "tls_https_inspector",
      "composite_runtime_safety",
    ),
    provider_version: Schema.optional(Schema.String),
    response_status: Schema.Literal(
      "usable",
      "timeout",
      "auth_failed",
      "malformed",
      "unavailable",
    ),
    checked_at: Schema.optional(DateTimeStringSchema),
  }),
  destination: Schema.Struct({
    destination_host: NonEmptyStringSchema,
    destination_url: Schema.String,
    fingerprint: NonEmptyStringSchema,
    resolver_url: Schema.optional(Schema.String),
    final_url: Schema.optional(Schema.String),
    final_host: Schema.optional(Schema.String),
    observed_redirect_hops: Schema.optional(
      Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
    ),
    https_status: Schema.Literal(
      "valid",
      "absent",
      "invalid",
      "not_checked",
    ).pipe(Schema.optional),
  }),
  verdict: Schema.Literal("clear", "risky", "blocked", "unavailable"),
  risk_score: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.lessThanOrEqualTo(100),
  ),
  reason_codes: Schema.Array(NonEmptyStringSchema),
  privacy: Schema.Struct({
    payload_disclosure: Schema.Literal(
      "host_only",
      "normalized_url",
      "full_url",
      "provider_required",
    ),
    user_data_disclosure: Schema.Literal(
      "none",
      "pseudonymous",
      "provider_required",
    ),
    raw_provider_payload_retained: Schema.Boolean,
  }),
  decision_role: Schema.Struct({
    source_of_truth: Schema.Literal(false),
    scanner_visible_impact: Schema.Literal(
      "may_support_green_when_prior_layers_pass",
      "may_downgrade_to_orange",
      "may_block_to_red",
      "no_decision_impact",
    ),
    operator_note: Schema.optional(Schema.String),
  }),
  governance: Schema.optional(GovernanceProjectionSchema),
})

export type DecisionColor = Schema.Schema.Type<typeof DecisionColorSchema>
export type Destination = Schema.Schema.Type<typeof DestinationSchema>
export type GovernanceProjection = Schema.Schema.Type<
  typeof GovernanceProjectionSchema
>
export type TrustStep = Schema.Schema.Type<typeof TrustStepSchema>
export type TrustPath = Schema.Schema.Type<typeof TrustPathSchema>
export type ScannerDecision = Schema.Schema.Type<typeof ScannerDecisionSchema>
export type EventEnvelope = Schema.Schema.Type<typeof EventEnvelopeSchema>
export type RuntimeSafetyObservation = Schema.Schema.Type<
  typeof RuntimeSafetyObservationSchema
>

export const decodeScannerDecision = (
  input: unknown,
): Effect.Effect<ScannerDecision, unknown> =>
  Schema.decodeUnknown(ScannerDecisionSchema)(input)

export const decodeEventEnvelope = (
  input: unknown,
): Effect.Effect<EventEnvelope, unknown> =>
  Schema.decodeUnknown(EventEnvelopeSchema)(input)

export const decodeRuntimeSafetyObservation = (
  input: unknown,
): Effect.Effect<RuntimeSafetyObservation, unknown> =>
  Schema.decodeUnknown(RuntimeSafetyObservationSchema)(input)

export const fingerprintHost = (host: string): string => {
  const normalized = host.trim().toLowerCase()
  const parts = normalized.split(".")
  const tld = parts.at(-1) ?? normalized
  const first = normalized.slice(0, 3)
  const last = normalized.slice(Math.max(0, normalized.length - 3))
  return `${first}...${last}.${tld}`
}

export const destinationFromUrl = (url: URL): Destination => ({
  display_host: url.hostname,
  fingerprint: fingerprintHost(url.hostname),
  url: url.toString(),
})
