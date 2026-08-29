/**
 * Trust row colouring.
 *
 * Two services feed the same trust rows with two different status vocabularies:
 * the Node scanner service emits `contract.trust_path.*.status`, and the Python
 * verifier emits `signals[].state` plus a top-level `decision_state`. Both are
 * plain strings on the wire (`TrustStepSchema.status` is `Schema.String`), so
 * the frontend is the only place the mapping is pinned.
 *
 * The mapping is an explicit table, never substring matching. Substring rules
 * silently mis-colour every value they were not written for: `recognized`,
 * `bound`, `clear` and `clean` are passes that match no "green" keyword, while
 * `block` and `failed` are hard failures that match no "red" keyword. An
 * unmapped status resolves to amber, so a new upstream state degrades to
 * "needs a look" rather than being painted green.
 */

export type TrustTone = "green" | "amber" | "red"

/**
 * Per-layer evidence status: `contract.trust_path.*.status` (Node) and
 * `signals[].state` (Python). Green is reserved for states that positively
 * assert the layer passed.
 */
const TRUST_STATUS_TONES: Record<string, TrustTone> = {
  // passes
  recognized: "green", // issuer_legitimacy — issuer resolved in trust state
  bound: "green", // destination_binding — destination matches issuer policy
  clear: "green", // runtime_safety — Node wording
  clean: "green", // runtime_safety — Python wording
  pass: "green", // artifact_integrity
  fresh: "green", // cache_freshness
  verified_issuer: "green",
  green: "green", // scanner_decision

  // cautions
  orange: "amber", // scanner_decision — Node wording
  caution: "amber", // scanner_decision — Python wording
  warn: "amber", // artifact_integrity
  risky: "amber", // runtime_safety — advisory, not a block
  stale: "amber",
  secondary: "amber",
  unknown: "amber",
  unverified: "amber",
  unavailable: "amber",
  none: "amber",
  not_evaluated: "amber",
  not_applicable: "amber",
  not_opened: "amber",

  // failures
  red: "red", // scanner_decision
  blocked: "red",
  block: "red", // artifact_integrity — note: not a prefix of "blocked"
  failed: "red", // issuer_legitimacy — signature verification failed
  mismatch: "red",
  redirect_mismatch: "red",
  revoked: "red",
  profile_revoked: "red",
  expired: "red",
}

/**
 * Top-level `decision_state` (Python). Only read when the response carries no
 * contract; a contract supplies `decision_color` directly.
 */
const DECISION_STATE_TONES: Record<string, TrustTone> = {
  verified_issuer: "green",
  verified_issuer_destination_risky: "amber", // issuer is fine; destination warrants care
  stale_trust_state: "amber",
  profile_stale: "amber",
  signed_unknown_issuer: "amber",
  unverified: "amber",
  profile_revoked: "red",
  blocked: "red",
}

function lookup(table: Record<string, TrustTone>, value: string): TrustTone {
  return table[value.trim().toLowerCase()] ?? "amber"
}

/** Tone for one trust-path step or per-layer signal. */
export function trustStatusTone(status: string): TrustTone {
  return lookup(TRUST_STATUS_TONES, status)
}

/** Tone for a `decision_state` on a response with no contract. */
export function decisionStateTone(state: string): TrustTone {
  return lookup(DECISION_STATE_TONES, state)
}
