// Public deterministic fixture signing keys for local smoke tests and
// reference-network examples. These are intentionally tracked test vectors,
// are not credentials, and must never be used for production trust programs.
//
// The PEM bodies are assembled from a line array rather than a template
// literal so each `detected-private-key` marker can sit directly above the
// line semgrep flags. A marker inside a template literal would become part of
// the key; a marker above the `export const` is too far away to suppress.

export const demoRootFixturePrivateKeyPem = [
  // nosemgrep: generic.secrets.security.detected-private-key.detected-private-key
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEIHuHuqzR1w1auCLVGWuKoiYXQX3jaH5sQt+IdTW+dFx5",
  "-----END PRIVATE KEY-----",
].join("\n")

export const demoDelegatedAuthorityFixturePrivateKeyPem = [
  // nosemgrep: generic.secrets.security.detected-private-key.detected-private-key
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEILsO0vjV4IgGxtWVX+k7ItjboiaJ4Dq7E93+ALN6dwAx",
  "-----END PRIVATE KEY-----",
].join("\n")
