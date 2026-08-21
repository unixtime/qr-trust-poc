# QR Trust Authority Flow

Date: 2026-08-21

Purpose:
- render the paper's Figure 2 as a diagram the docs site can display and zoom
- separate governance (who may delegate to whom) from validation (what a
  verifier does at scan time)

Source figure:
- `Figure 2` in the [published QR trust paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- published visual asset: [QR_TRUST_AUTHORITY_FLOW.svg](./QR_TRUST_AUTHORITY_FLOW.svg)
- semantic reference: [QR_TRUST_AUTHORITY_FLOW_ASCII.md](./QR_TRUST_AUTHORITY_FLOW_ASCII.md)

The SVG remains the authoritative published artwork. The diagrams below restate
the same governance semantics in the docs' own diagram style; if the two ever
diverge, the paper's figure governs.

!!! note "Diagram color key"
    Color encodes function, not trustworthiness: blue marks the root of the
    trust program, amber marks delegated governance, violet marks issued and
    published artifacts, and green marks the verifier side that consumes them.
    Select any diagram to open the interactive zoom-and-pan view.

## Governance and Delegation

```mermaid
graph TD
    ROOT["Root trust program<br/>root keys<br/>accreditation rules<br/>delegation policy<br/>distribution endpoints"]

    ROOT -->|delegates| PAY["Payment operator<br/>delegated tree"]
    ROOT -->|delegates| GOV["Government / public service<br/>delegated tree"]
    ROOT -->|delegates| MER["Merchant / enterprise operator<br/>delegated tree"]

    PAY -->|enroll / govern issuer| ISS
    GOV -->|enroll / govern issuer| ISS
    MER -->|enroll / govern issuer| ISS

    ISS["Enrolled issuer node<br/>issuer identifier<br/>assurance tier<br/>key refs<br/>approved domains / resolvers / app"]
    ISS -->|issues| ART["Signed QR artifact<br/>issuer reference<br/>destination / resolver claims"]

    classDef root fill:#eaf2ff,stroke:#1d4ed8,color:#172033,stroke-width:2px;
    classDef operator fill:#fff6db,stroke:#d97706,color:#4a2b05,stroke-width:1.5px;
    classDef issuer fill:#e8eefc,stroke:#334e9a,color:#172554,stroke-width:2px;
    classDef artifact fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:1.5px;

    class ROOT root;
    class PAY,GOV,MER operator;
    class ISS issuer;
    class ART artifact;
```

Delegation is the only path to issuing authority: an issuer node exists because
an operator enrolled it under rules the root program set, and the signed
artifact carries a reference back up that chain rather than standing on its own.

## Shared State Publication

```mermaid
graph LR
    ROOT["Root trust program"] -->|publishes| STATE["Signed artifacts / shared state<br/>delegation manifests<br/>issuer manifests<br/>destination policy updates<br/>revocation / suspension events<br/>freshness metadata"]
    OPS["Delegated operators"] -->|publishes| STATE

    classDef root fill:#eaf2ff,stroke:#1d4ed8,color:#172033,stroke-width:2px;
    classDef operator fill:#fff6db,stroke:#d97706,color:#4a2b05,stroke-width:1.5px;
    classDef artifact fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:1.5px;

    class ROOT root;
    class OPS operator;
    class STATE artifact;
```

Both tiers publish into the same shared state. Revocation and freshness travel
this path, which is what lets a verifier reach a different decision tomorrow
about an artifact that has not changed.

## State Synchronization and Validation

```mermaid
graph LR
    STATE["Signed artifacts / shared state"] -->|sync / cache| CACHE["Scanner / verifier cache<br/>root / operator state<br/>issuer state<br/>destination policy state<br/>revocation / freshness state"]
    CACHE -->|provides current state| DEC["Verifier decision path<br/>1. validate root → authority → issuer chain<br/>2. validate issuer status / tier<br/>3. validate current destination / resolver policy<br/>4. check runtime safety freshness or query<br/>5. apply local policy and emit trust state"]
    ART["Signed QR artifact"] --> DEC

    classDef artifact fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:1.5px;
    classDef verifier fill:#e8f8f5,stroke:#0f766e,color:#123c38,stroke-width:1.5px;
    classDef decision fill:#e8eefc,stroke:#334e9a,color:#172554,stroke-width:2px;

    class STATE,ART artifact;
    class CACHE verifier;
    class DEC decision;
```

The decision path takes two inputs, not one: the scanned artifact and the cached
current state. That second input is the whole point of the figure — a verifier
that only reads the artifact can validate a signature but cannot answer whether
the destination is still approved or whether the issuer is still in good
standing.
