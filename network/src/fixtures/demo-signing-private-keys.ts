// Public deterministic fixture signing keys for local smoke tests and
// reference-network examples. These are intentionally tracked test vectors,
// are not credentials, and must never be used for production trust programs.

export const demoRootFixturePrivateKeyPem = `
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIHuHuqzR1w1auCLVGWuKoiYXQX3jaH5sQt+IdTW+dFx5
-----END PRIVATE KEY-----
`.trim()

export const demoDelegatedAuthorityFixturePrivateKeyPem = `
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEILsO0vjV4IgGxtWVX+k7ItjboiaJ4Dq7E93+ALN6dwAx
-----END PRIVATE KEY-----
`.trim()
