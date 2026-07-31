import { Console, Effect } from "effect"

import { makeInMemoryVerifierCache } from "../index.js"
import type {
  DestinationPolicyProjection,
  IssuerNamespace,
  IssuerProjection,
} from "../services/verifier-cache.js"

const sharedDestinationPolicyId = "policy:shared:web-payments:v1"
const cacheGeneratedAt = "2026-05-17T00:00:00Z"
const cacheExpiresAt = "2026-12-31T23:59:59Z"

const namespaceA: IssuerNamespace = {
  root_program_id: "root:alpha:2026",
  delegated_authority_id: "authority:alpha:web",
  issuer_id: "issuer:alpha:checkout",
}

const namespaceB: IssuerNamespace = {
  root_program_id: "root:beta:2026",
  delegated_authority_id: "authority:beta:web",
  issuer_id: "issuer:beta:checkout",
}

const issuerA = makeIssuer(namespaceA, "Alpha Checkout")
const issuerB = makeIssuer(namespaceB, "Beta Checkout")
const policyA = makePolicy(namespaceA, "https://a.example/pay", "a.example")
const policyB = makePolicy(namespaceB, "https://b.example/pay", "b.example")

const program = Effect.gen(function* () {
  const cache = makeInMemoryVerifierCache([issuerA, issuerB], [policyA, policyB])

  const alpha = yield* cache.resolveByDestination(
    new URL("https://a.example/pay"),
  )
  const beta = yield* cache.resolveByDestination(new URL("https://b.example/pay"))

  yield* assertSmoke(
    alpha?.issuer.namespace.root_program_id === namespaceA.root_program_id,
    "shared policy id resolved alpha destination to the wrong namespace root",
  )
  yield* assertSmoke(
    beta?.issuer.namespace.root_program_id === namespaceB.root_program_id,
    "shared policy id resolved beta destination to the wrong namespace root",
  )

  yield* Console.log(
    JSON.stringify(
      {
        alpha_root: alpha?.issuer.namespace.root_program_id,
        beta_root: beta?.issuer.namespace.root_program_id,
        shared_destination_policy_id: sharedDestinationPolicyId,
      },
      null,
      2,
    ),
  )
})

function makeIssuer(
  namespace: IssuerNamespace,
  issuerDisplayName: string,
): IssuerProjection {
  return {
    namespace,
    issuer_display_name: issuerDisplayName,
    assurance_tier: "verified_business",
    destination_policy_id: sharedDestinationPolicyId,
    allowed_hosts: [],
    cache_generated_at: cacheGeneratedAt,
    cache_expires_at: cacheExpiresAt,
  }
}

function makePolicy(
  namespace: IssuerNamespace,
  expectedFinalUrl: string,
  allowedHost: string,
): DestinationPolicyProjection {
  return {
    namespace,
    destination_policy_id: sharedDestinationPolicyId,
    approved_destinations: [
      {
        destination_id: `dest:${namespace.root_program_id}:pay`,
        expected_final_url: expectedFinalUrl,
        allowed_hosts: [allowedHost],
        allow_subdomains: false,
        path_prefixes: ["/pay"],
        query_policy: "none",
      },
    ],
    redirect_policy: {
      resolver_urls: [],
      expected_final_destinations: [expectedFinalUrl],
      allowed_redirect_hosts: [allowedHost],
      max_redirect_hops: 0,
      nested_shorteners_allowed: false,
      scanner_must_display_resolver_and_final_destination: true,
    },
    allowed_hosts: [allowedHost],
    allow_subdomains: false,
    cache_generated_at: cacheGeneratedAt,
    cache_expires_at: cacheExpiresAt,
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Verifier cache namespace isolation smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
