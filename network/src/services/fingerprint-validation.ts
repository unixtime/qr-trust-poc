const SHA256_FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/
const DOMAIN_FINGERPRINT_MAX_LENGTH = 80
const RAW_DOMAIN_FINGERPRINT_TOKENS = ["://", "/", "?", "#", "@", " "] as const

export type CompactDomainFingerprintFailureReason =
  | "not_string"
  | "invalid_shape"
  | "raw_url_token"

export type CompactDomainFingerprintValidation =
  | { readonly valid: true }
  | {
    readonly valid: false
    readonly reason: CompactDomainFingerprintFailureReason
  }

export const isSha256Fingerprint = (value: unknown): value is string =>
  typeof value === "string" && SHA256_FINGERPRINT_RE.test(value)

export const validateCompactDomainFingerprint = (
  value: unknown,
): CompactDomainFingerprintValidation => {
  if (typeof value !== "string") {
    return { valid: false, reason: "not_string" }
  }

  if (
    value.length === 0 ||
    value.length > DOMAIN_FINGERPRINT_MAX_LENGTH ||
    !value.includes("...")
  ) {
    return { valid: false, reason: "invalid_shape" }
  }

  if (RAW_DOMAIN_FINGERPRINT_TOKENS.some((token) => value.includes(token))) {
    return { valid: false, reason: "raw_url_token" }
  }

  return { valid: true }
}

export const isCompactDomainFingerprint = (value: unknown): value is string =>
  validateCompactDomainFingerprint(value).valid
