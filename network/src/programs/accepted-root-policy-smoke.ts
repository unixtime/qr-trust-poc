import { Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeAcceptedRootPolicy,
  makeInMemoryVerifierCache,
} from "../index.js"

const program = Effect.gen(function* () {
  const cache = makeInMemoryVerifierCache(
    [demoIssuerProjection],
    [demoDestinationPolicyProjection],
    makeAcceptedRootPolicy(["root:other:2026"]),
  )

  const resolution = yield* cache.resolveByDestination(
    new URL("https://acme.example/pay"),
  )

  if (resolution !== undefined) {
    throw new Error(
      "Accepted root policy smoke failed: unaccepted root resolved trusted verifier-cache state",
    )
  }
})

Effect.runPromise(program)
