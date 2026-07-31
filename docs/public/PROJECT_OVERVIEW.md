# Project overview

## Purpose

The QR Trust PoC is a reference implementation for navigation QR decisions. It
asks whether a scanner has enough current evidence to justify opening a
destination, warning the user, holding for more evidence, or blocking the
action.

The project exists because four facts can all be true at once:

- a QR artifact decodes correctly;
- its payload is signed correctly;
- the issuer was once legitimate; and
- the destination is unsafe or no longer issuer-approved at scan time.

The implementation therefore treats decoding, signature verification, issuer
state, destination binding, and runtime safety as separate evidence families.

!!! note
    “Green” is not a claim that a destination is universally safe. It means the
    configured verifier profile has the required positive evidence and no
    blocking residual for that decision.

## System and decision relationship

[![Trust-model relationship graph showing research inputs, trust layers,
onboarding, the decision engine, and scanner
outcomes](TRUST_MODEL_GRAPH.svg)](TRUST_MODEL_GRAPH.md)

*Figure: the trust model separates issuer legitimacy, destination binding, and
runtime safety before the decision engine emits a scanner-visible state. Open
the [annotated graph](TRUST_MODEL_GRAPH.md) for its reading order and source
documents.*

At scan time, the verifier applies that model in a fail-closed sequence:

1. require an unambiguous, decodable artifact;
2. verify the canonical payload signature;
3. evaluate current issuer and destination-policy state;
4. require the runtime evidence mandated by the active profile; and
5. emit green, orange, or red from the remaining trust residuals.

The shared decision core is implemented in
[`backend/app/services/trust_residuals_decision.py`](../../backend/app/services/trust_residuals_decision.py).
The controlled evaluation and expected residual vectors are documented in the
[evaluation guide](evaluation/README.md).

## Main implementation surfaces

| Surface | Primary user | Responsibility | Default access |
| --- | --- | --- | --- |
| React workbench | Researcher, developer, operator | Guided explanation, scenario generation, camera/upload experiments, and operator state | <http://127.0.0.1:5173/> |
| FastAPI verifier | Scanner and workbench clients | Decode, validate, re-evaluate policy state, apply replay controls, and return scanner decisions | <http://127.0.0.1:8000/> |
| SwiftUI scanner | iPhone test user | Real-device QR capture and end-user decision presentation | Xcode project |
| Reference network package | Protocol and infrastructure engineer | Publish governance artifacts, propagate events, materialize verifier caches, and record runtime observations | Optional local profiles |
| Deterministic evaluation | Researcher and reviewer | Compare the shared decision core and weaker baselines against controlled expected outcomes | Offline command |

## Services and local resource estimates

### Default services

| Service | Technology | Default port | Used for | Required in the basic Compose path? |
| --- | --- | ---: | --- | --- |
| `frontend` | React 19 and Vite | 5173 | Browser workbench and scanner-facing interaction | Yes |
| `api` | FastAPI and Uvicorn | 8000, or 8443 with local TLS | Verifier endpoints, management surface, artifact analysis, and status | Yes |
| `postgres` | PostgreSQL 17 | 5432 | Durable issuer/policy state, audit data, outbox state, and management records | Yes |
| `redis` | Redis 7 | 6379 | Replay coordination, rate limiting, and short-lived hot-path state | Yes |
| `nats` | NATS JetStream | 4222; monitor 8222 | Optional propagation of governance and runtime events | No |
| Network workers | Node.js and Effect TypeScript | No public port | Optional outbox publication, subscriptions, artifact publication, and cache materialization | No |
| Secondary verifier | FastAPI | 8001 by default | Optional federation and stale-cache experiments | No |
| Documentation server | MkDocs build plus Python static server | 8088 | Local browsable technical documentation | No |

### Hardware planning estimates

These figures are engineering estimates for local work. They have not been
measured as capacity limits and should not be used for production sizing.

| Workload | CPU | Memory | Free disk | Expected use |
| --- | ---: | ---: | ---: | --- |
| Documentation and deterministic evaluation | 2 cores | 4 GB | 5 GB | Reading, MkDocs build, and the offline corpus checker |
| Default Compose profile | 4 cores | 8 GB | 15 GB | API, frontend, Postgres, and Redis |
| Full reference-network and browser workflow | 6–8 cores | 16 GB | 25 GB | Adds NATS, workers, Chromium, and build caches |
| iOS simulator plus full stack | Apple silicon recommended | 16 GB | 35 GB | Adds Xcode and simulator runtimes |

No GPU is required. Persistent production deployment sizing is deliberately out
of scope; it requires workload, retention, latency, availability, and runtime-
provider measurements that this PoC does not supply.

## Storage and message-flow boundaries

- **Postgres is authoritative.** Durable governance, issuer, destination,
  audit, and outbox state belongs in Postgres.
- **Redis is transient.** It accelerates replay and rate-limit paths but is not
  the source of truth for issuer trust.
- **NATS distributes changes.** It carries events to subscribers and cache
  workers; it does not decide trust.
- **Verifier caches are explicit evidence.** Cache freshness and accepted-root
  policy affect scanner decisions rather than being hidden implementation
  details.
- **Runtime observations are scoped inputs.** Provider state can clear, warn,
  block, become stale, or become unavailable; no provider is treated as an
  infallible oracle.

See the [network architecture plan](NETWORK_ARCHITECTURE_PLAN.md) and
[network-contract index](network-contracts/README.md) for the detailed model.

## Supported workflows

### Fast controlled evaluation

```bash
make check-trust-residuals-evaluation
```

Use this when reviewing decision semantics without running containers. It
checks 37 controlled cases and the exported report.

### Interactive browser demonstration

```bash
make up-admin
make smoke-compose
```

Use this to generate scenarios, display QR artifacts, scan/upload them, and
inspect verifier outcomes in the React workbench.

### Native scanner evidence

```bash
make smoke-ios
make iphone-evidence-preflight
```

Use this before physical-device capture. The native app is an end-user scanner
test surface, not an administrator console.

### Reference-network experiments

Start with the [network package README](../../network/README.md) and
[network contracts](network-contracts/README.md). Optional profiles exercise
publication, NATS propagation, verifier caches, runtime observations, and
second-verifier behavior.

## Evidence and claim boundaries

| Evidence | Supports | Does not support |
| --- | --- | --- |
| Unit and integration tests | Implemented behavior under tested inputs | Universal correctness or production resilience |
| 37-case residual corpus | Conformance to specified expected outcomes | Field detection accuracy or prevalence estimates |
| Browser screenshots | Rendered states in the recorded browser flows | Cross-browser universality or user comprehension |
| iPhone artifacts | Deterministic ios-reference reviewer exports of the native decision surfaces and accessibility output | Physical-device capture evidence, App Store readiness, or population-level usability |
| Network smoke drills | Contract and local propagation behavior | Multi-operator governance legitimacy or internet-scale capacity |

For the underlying conceptual argument, read and cite the
[published SSRN paper](CITING.md). For implementation, continue with the
[run guide](RUN_GUIDE.md).
