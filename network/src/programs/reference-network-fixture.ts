import { Effect } from "effect"

import {
  EventBus,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeScannerDecisionService,
  makeVerifierSyncService,
  type NetworkEvent,
} from "../index.js"
import type { ScannerDecision } from "../contracts.js"
import type { NetworkError } from "../errors.js"

export interface ReferenceNetworkFixture {
  readonly events: ReadonlyArray<NetworkEvent>
  readonly scanner_decision: ScannerDecision
}

export const makeReferenceNetworkFixture = (
  observedAt: Date,
): Effect.Effect<ReferenceNetworkFixture, NetworkError, EventBus> =>
  Effect.gen(function* () {
    const eventBus = yield* EventBus
    const artifactStore = makeInMemoryArtifactStore()
    const cache = makeInMemoryVerifierCache()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const governancePublisher = makeGovernancePublicationService(publisher)
    const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
    const scanner = makeScannerDecisionService(cache, eventBus)

    yield* governancePublisher.publishReferenceBundle(observedAt)
    yield* verifierSync.syncRecent()
    const scannerDecision = yield* scanner.decide({
      payload: "https://acme.example/pay",
      observedAt,
    })

    return {
      events: yield* eventBus.recent(),
      scanner_decision: scannerDecision,
    }
  })
