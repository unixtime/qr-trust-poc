# Trust Model Graph

Date: 2026-04-12

Purpose:
- show how the trust-model documents relate to each other
- make it easier to move from research to architecture to scanner behavior

!!! note "Diagram color key"
    Color encodes function, not trustworthiness: blue marks foundations and
    inputs, violet marks architecture and scanner components, amber marks
    policy or decision points, red marks blocking outcomes, and green marks a
    positive verified outcome. Select any diagram to open the interactive
    zoom-and-pan view.

## Document Dependency Graph

```mermaid
graph TD
    A[Published QR trust paper<br/>conceptual foundation] --> B[PROJECT_OVERVIEW.md<br/>PoC orientation]
    B --> T[TRUST_MODEL.md<br/>platform trust architecture]

    T --> C[TRUST_LAYERS.md<br/>issuer trust vs destination binding vs runtime safety]
    T --> D[TRUST_TIERS.md<br/>unverified to verified institution]
    T --> E[ENROLLMENT_AND_CONSENT_MODEL.md<br/>issuer onboarding and monitoring consent]
    T --> F[SCANNER_UX_STATES.md<br/>user-facing scanner states]
    T --> G[SCANNER_DECISION_MATRIX.md<br/>policy table]

    C --> F
    C --> G
    D --> F
    D --> G
    E --> T
    E --> D
    F --> G

    classDef foundation fill:#eaf2ff,stroke:#1d4ed8,color:#172033,stroke-width:2px;
    classDef architecture fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:1.5px;
    classDef governance fill:#fff6db,stroke:#d97706,color:#4a2b05,stroke-width:1.5px;
    classDef experience fill:#e8f8f5,stroke:#0f766e,color:#123c38,stroke-width:1.5px;
    classDef decision fill:#e8eefc,stroke:#334e9a,color:#172554,stroke-width:2px;

    class A foundation;
    class B,T architecture;
    class C,D,E governance;
    class F experience;
    class G decision;
```

## System Relationship Graph

```mermaid
graph LR
    Issuer[Issuer] --> Enroll[Enrollment Authority]
    Enroll --> Tier[Trust Tier]
    Enroll --> Dest[Approved Destination Set]
    Enroll --> Consent[Monitoring Consent]

    Generator[QR Generator] --> QR[Signed QR]
    Enroll --> QR
    Dest --> QR

    QR --> Scanner[Scanner Platform]
    Tier --> Scanner
    Dest --> Scanner

    Scanner --> Runtime[Runtime Safety Provider]
    Consent --> Runtime
    Runtime --> Risk[Runtime Safety Result]

    Tier --> Decision[Scanner Decision Engine]
    Dest --> Decision
    Risk --> Decision
    QR --> Decision

    Decision --> UX[Scanner UX State]

    classDef actor fill:#f8fafc,stroke:#64748b,color:#1e293b,stroke-width:1.5px;
    classDef governance fill:#eaf2ff,stroke:#2563eb,color:#172554,stroke-width:1.5px;
    classDef artifact fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:2px;
    classDef scanner fill:#e8f8f5,stroke:#0f766e,color:#123c38,stroke-width:2px;
    classDef runtime fill:#fff6db,stroke:#d97706,color:#4a2b05,stroke-width:1.5px;
    classDef decision fill:#e8eefc,stroke:#334e9a,color:#172554,stroke-width:2px;
    classDef outcome fill:#e9f8ee,stroke:#15803d,color:#153d24,stroke-width:2px;

    class Issuer,Generator actor;
    class Enroll,Tier,Dest,Consent governance;
    class QR artifact;
    class Scanner scanner;
    class Runtime,Risk runtime;
    class Decision decision;
    class UX outcome;
```

## Scanner Decision Flow

```mermaid
flowchart TD
    A[Scan QR] --> B{QR decodes?}
    B -- no --> X[Show decode failure]
    B -- yes --> C{Signature and schema valid?}
    C -- no --> Y[Blocked]
    C -- yes --> D{Issuer enrolled?}
    D -- no --> U[Unverified or signed unaccepted issuer]
    D -- yes --> E{Destination still issuer-approved?}
    E -- no --> V[Destination changed]
    E -- yes --> F{Runtime safety clear?}
    F -- no --> W[Verified issuer, destination risky]
    F -- yes --> Z[Verified issuer]

    classDef input fill:#eaf2ff,stroke:#1d4ed8,color:#172554,stroke-width:2px;
    classDef gate fill:#fff6db,stroke:#d97706,color:#4a2b05,stroke-width:1.5px;
    classDef caution fill:#fff0d8,stroke:#c2410c,color:#4b230c,stroke-width:2px;
    classDef blocked fill:#fff0f1,stroke:#dc2626,color:#4c1518,stroke-width:2px;
    classDef verified fill:#e9f8ee,stroke:#15803d,color:#153d24,stroke-width:2px;

    class A input;
    class B,C,D,E,F gate;
    class U caution;
    class X,Y,V,W blocked;
    class Z verified;
```

## How To Read This Set

1. Start with the [published paper](./CITING.md) and
   [project overview](./PROJECT_OVERVIEW.md). These separate the conceptual
   argument from what the current PoC implements and evaluates.

2. Move to [TRUST_MODEL.md](./TRUST_MODEL.md).
   This is the top-level architecture.

3. Use the specialized documents to pressure-test the model:
   - [TRUST_LAYERS.md](./TRUST_LAYERS.md)
   - [TRUST_TIERS.md](./TRUST_TIERS.md)
   - [ENROLLMENT_AND_CONSENT_MODEL.md](./ENROLLMENT_AND_CONSENT_MODEL.md)
   - [SCANNER_UX_STATES.md](./SCANNER_UX_STATES.md)
   - [SCANNER_DECISION_MATRIX.md](./SCANNER_DECISION_MATRIX.md)

## Current Gap

The main unresolved design question across all these documents is:

- who operates the enrollment authority and trust-root program for ordinary consumer QR destinations?

That is the strongest unresolved dependency in the whole model.
