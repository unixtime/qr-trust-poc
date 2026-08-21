# QR Trust Problem Diagram

Date: 2026-08-21

Purpose:
- render the paper's Figure 1 as a diagram the docs site can display and zoom
- show why successful decoding is not the same thing as trust

Source figure:
- `Figure 1` in the [published QR trust paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- published visual asset: [QR_TRUST_PROBLEM_DIAGRAM.svg](./QR_TRUST_PROBLEM_DIAGRAM.svg)
- semantic reference: [QR_TRUST_PROBLEM_DIAGRAM_ASCII.md](./QR_TRUST_PROBLEM_DIAGRAM_ASCII.md)

The SVG remains the authoritative published artwork. The diagrams below restate
the same relationships in the docs' own diagram style; if the two ever diverge,
the paper's figure governs.

!!! note "Diagram color key"
    Color encodes function, not trustworthiness: blue marks the framing columns,
    red marks the failure this figure is about, amber marks a limit of the
    current approach, violet marks the architectural conclusion, and green marks
    the decision layer the trust stack builds toward. Select any diagram to open
    the interactive zoom-and-pan view.

## Why Decoding Is Mistaken for Trust

```mermaid
graph TD
    S["What scanners do today<br/>convenience pipeline<br/>1. detect QR<br/>2. decode payload<br/>3. surface URL or app intent<br/>4. let the user absorb the risk"]
    I["What the industry keeps focusing on<br/>integrity layer<br/>signed payloads<br/>certificate checks<br/>HTTPS transport<br/>cleaner warning UI"]
    U["What users actually need<br/>trust questions<br/>1. who issued this code?<br/>2. is the issuer trusted?<br/>3. is the destination still approved?<br/>4. is opening it safe right now?"]

    S --> I
    I --> U

    SF["Failure<br/>successful decoding is mistaken for trust;<br/>the scanner answers what is this,<br/>never should I trust it"]
    IL["Limit<br/>a QR can be syntactically valid,<br/>cryptographically valid,<br/>and still unsafe"]
    UC["Consequence<br/>trust is a managed platform signal,<br/>not a property of successful decoding"]

    S --> SF
    I --> IL
    U --> UC

    classDef framing fill:#eaf2ff,stroke:#1d4ed8,color:#172033,stroke-width:2px;
    classDef failure fill:#fee2e2,stroke:#b91c1c,color:#450a0a,stroke-width:2px;
    classDef limit fill:#fff6db,stroke:#d97706,color:#4a2b05,stroke-width:1.5px;
    classDef conclusion fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:1.5px;

    class S,I,U framing;
    class SF failure;
    class IL limit;
    class UC conclusion;
```

The three columns read left to right as an escalation: what scanners ship, what
the industry has invested in, and what a user is actually trying to find out.
Each column drops to the problem it leaves unsolved.

## Required Trust Stack

```mermaid
graph LR
    T1["1. Issuer legitimacy<br/>who is authorized to issue this QR<br/>under a trusted program?"] --> T2["2. Destination binding<br/>is the QR still bound to the<br/>issuer-approved destination?"]
    T2 --> T3["3. Runtime safety<br/>is the destination safe now?<br/>compromise can happen after issuance"]
    T3 --> T4["4. Scanner decision UX<br/>user-visible outcomes that separate<br/>unverified, signed unaccepted issuer,<br/>verified issuer, risky destination, blocked"]

    classDef layer fill:#f1edff,stroke:#7c3aed,color:#2e2153,stroke-width:1.5px;
    classDef decision fill:#e8f8f5,stroke:#0f766e,color:#123c38,stroke-width:2px;

    class T1,T2,T3 layer;
    class T4 decision;
```

Issuer legitimacy
:   Examples of what a trusted program accredits: verified individual, verified
    business, verified institution, payment operator.

Destination binding
:   Checks: exact URL, normalization, subdomain policy, post-issuance changes.

Runtime safety
:   Inputs: redirects, reputation, malware, phishing, injected content.

Scanner decision UX
:   The five outcomes above are specified in
    [SCANNER_UX_STATES.md](./SCANNER_UX_STATES.md) and mapped to policy in
    [SCANNER_DECISION_MATRIX.md](./SCANNER_DECISION_MATRIX.md).
