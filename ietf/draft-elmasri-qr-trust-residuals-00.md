---
title: "Trust Residuals for Navigation QR Codes"
abbrev: "QR Trust Residuals"
docname: draft-elmasri-qr-trust-residuals-00
category: info
submissiontype: IETF
consensus: false
v: 3
area: sec
workgroup: Dispatch
keyword:
 - QR code
 - trust residuals
 - quishing
 - phishing
 - issuer verification
 - destination binding
venue:
  group: Dispatch
  mail: dispatch@ietf.org

author:
 -  fullname: Hassan El-Masri
    organization: Independent Researcher
    country: United States of America
    email: hassan@unixtime.com

normative:
  RFC3986:
  RFC8259:

informative:
  RFC5280:
  RFC6480:
  RFC6973:
  RFC7493:
  RFC7515:
  RFC7517:
  RFC7942:
  RFC8032:
  RFC8725:
  RFC8785:
  RFC9052:
  RFC9053:
  RFC9334:
  RFC9525:
  RFC9597:
  RFC9711:
  RFC9943:
  RFC9999:
  AR4SI:
    title: "Attestation Results for Secure Interactions"
    author:
      - name: E. Voit
      - name: H. Birkholz
      - name: T. Hardjono
      - name: T. Fossati
      - name: V. Scarlata
    date: 2026-05
    refcontent: Work in progress
    target: https://datatracker.ietf.org/doc/html/draft-ietf-rats-ar4si-10
  VCDM:
    title: "Verifiable Credentials Data Model v2.0"
    author:
      - org: W3C
    date: 2025
    refcontent: W3C Recommendation
    target: https://www.w3.org/TR/vc-data-model-2.0/
  VCJOSECOSE:
    title: "Securing Verifiable Credentials using JOSE and COSE"
    author:
      - org: W3C
    date: 2025
    refcontent: W3C Recommendation
    target: https://www.w3.org/TR/2025/REC-vc-jose-cose-20250515/
  VCSTATUS:
    title: "Bitstring Status List v1.0"
    author:
      - org: W3C
    date: 2025
    refcontent: W3C Recommendation
    target: https://www.w3.org/TR/2025/REC-vc-bitstring-status-list-20250515/
  QRTRUST:
    title: "QR Navigation Security Is Not Primarily a Cryptography Problem: A Trust-Model Framework for Managed Issuer Verification, Destination Binding, and Runtime Safety"
    author:
      - name: Hassan El-Masri
    date: 2026
    refcontent: SSRN Working Paper 6577478
    seriesinfo:
      DOI: 10.2139/ssrn.6577478
    target: https://ssrn.com/abstract=6577478
  RESIDUALS:
    title: "Trust Residuals for Navigation QR Codes: Decision Semantics for Issuer, Destination, and Runtime Safety State"
    author:
      - name: Hassan El-Masri
    date: 2026
    refcontent: SSRN Working Paper 7225699
    target: https://ssrn.com/abstract=7225699
  VIDAS:
    title: "QRishing: The Susceptibility of Smartphone Users to QR Code Phishing Attacks"
    author:
      - name: T. Vidas
      - name: E. Owusu
      - name: S. Wang
      - name: C. Zeng
      - name: L. F. Cranor
      - name: N. Christin
    date: 2013
    refcontent: Financial Cryptography and Data Security, LNCS 7862, Springer
    seriesinfo:
      DOI: 10.1007/978-3-642-41320-9_4
  KOWALEWSKI:
    title: "Scanned and Scammed: Insecurity by ObsQRity? Measuring User Susceptibility and Awareness of QR Code-Based Attacks"
    author:
      - name: M. Kowalewski
      - name: L. Lassak
      - name: M. Duermuth
      - name: T. Schnitzler
    date: 2025
    refcontent: 34th USENIX Security Symposium, pp. 1415-1434
  SEQR:
    title: "Development, Evaluation, and Implementation of SEQR - a Usable Secure QR Code Scanner"
    author:
      - name: M. Mossano
      - name: M. F. Veit
      - name: T. Laenge
      - name: B. M. Berens
      - name: F. Sharevski
      - name: M. Volkamer
    date: 2026
    refcontent: Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems (CHI '26), ACM
    seriesinfo:
      DOI: 10.1145/3772318.3793213
  ISO18004:
    title: "Information Technology - Automatic Identification and Data Capture Techniques - QR Code Bar Code Symbology Specification"
    author:
      - org: ISO/IEC
    date: 2024
    refcontent: ISO/IEC 18004:2024

--- abstract

Navigation QR codes carrying absolute HTTP or HTTPS URIs initiate web
interactions, including payment, ordering, and institutional workflows.
Selected deployed scanners decode and hand off those URIs without an
interoperable account of whether the navigation is authorized.  This
document defines an Informational architecture and candidate decision-
semantics surface based on trust residuals: typed, evidence-bearing
deviations between a scanned artifact and issuer-chain, destination-
policy, redirect-flow, runtime-safety, freshness, and artifact-integrity
constraints.  Given a residual vector and a declared verification
profile, explicit precedence rules map the result to a bounded set of
scanner decision states.  Security invariants prevent reputation, HTTPS
transport, or runtime-safety signals from upgrading an otherwise
untrusted issuer path.  This document does not define a payload carrier
or a final wire format for signed governance objects; those belong in a
future binding specification.

--- middle

# Introduction

Navigation QR codes are a routine interface between the physical and
digital worlds.  They appear on restaurant tables, payment terminals,
parking meters, public notices, posters, invoices, and enterprise
workflows.  Their success comes from frictionless interaction: a user
points a camera at a code and is offered navigation to an HTTP or HTTPS
resource.

That same frictionlessness creates a trust problem.  A QR code can be
syntactically valid {{ISO18004}}, visually plausible, and hosted
behind HTTPS while still directing a user to a malicious,
unauthorized, compromised, or contextually misleading destination.
The scanner may decode the payload correctly, and the browser may
establish an encrypted connection, yet the user's central trust
question remains unanswered: should this scanned destination be
trusted in this context?

Measured user behavior supports the concern.  An early field
experiment found smartphone users willing to scan unsolicited QR codes
out of curiosity {{VIDAS}}.  A study with 1,876 participants found
that only 13% recognized fraudulent QR-based payment requests,
compared with 46% for the same requests entered manually
{{KOWALEWSKI}}.  A 556-participant evaluation of a secure scanner
reported 93.35% correct trust decisions with the secure scanner versus
75.24% and 65.11% with two widely deployed stock scanners {{SEQR}}.
Decoding-centric scanner interfaces leave users to make trust
decisions without trust evidence, and scanner interfaces that display
a decoded URL can be mistaken for having validated it.

Prior work argued that navigation QR security is not primarily a
cryptography problem: signed payloads, certificate checks, and HTTPS
transport are necessary but insufficient to establish issuer
legitimacy, continued destination authorization, or present-time
destination safety {{QRTRUST}}.  That work proposed a hierarchical but
federated trust model in which root trust programs, delegated
authorities,
issuer records, destination policies, and signed status artifacts
allow verifiers to evaluate QR trust without relying on payload
decoding alone.

A scanner needs machine-checkable inputs, failure conditions,
cache-freshness rules, deterministic decision semantics, and a
user-visible state that does not overclaim what has been proven.
Interoperability also requires issuers and status publishers to identify
what a verifier appraises, verifiers to use a common residual model, and
relying parties to receive the same bounded result for equivalent facts.
A private scanner label or user-interface convention cannot provide that
agreement.  This document calls the appraising component the QR verifier
and the component consuming its result the relying party; one scanner can
implement both roles.

This document specifies that decision-semantics layer.  It defines trust
residuals -- typed, evidence-bearing deviations between a scanned QR
artifact and the constraints that must hold for a positive trust state
-- and maps residual outcomes through explicit precedence rules to a
bounded set of scanner decision states.  "Residual" is used in the
ordinary constraint-checking sense: a residual records what remains
unsatisfied after applying a verifier policy.  Nothing in this
document requires machine learning.  Evidence acquisition, complete
signed-object encodings, and carrier bindings are separate layers.

This -00 asks DISPATCH to advise where the decision-semantics work belongs
and whether a Standards Track signed-object and carrier binding should
remain a separate document.  It does not ask the IETF to modify QR
symbology or standardize scanner user interfaces.

## Relationship to the Research Papers

The model and evaluation methodology were developed in {{RESIDUALS}},
building on the trust-model framework of {{QRTRUST}}.  This document
specifies the residual input model, states, invariants, profiles, and
decision procedure.  {{RESIDUALS}} reports the measured comparison
against weaker baselines, the ablation analysis, and the full evaluation
methodology.
Independent implementation, longitudinal operation, privacy
measurement, issuance-time witness experiments, and human-subject
evaluation remain research work rather than protocol guarantees.

## Scope and Non-Goals

The conformance scope of this version is a Navigation QR Code whose
decoded payload contains an absolute HTTP or HTTPS URI.  Native app
intents, deep links, non-HTTP payment schemes, and other action types
require separate, versioned mappings and are outside this version.

The conformance claim is narrow and testable.  Given a residual vector
constructed from issuer, destination, status, freshness, safety, and
artifact evidence, a decision engine maps it to a scanner state through
the precedence rules in {{decision-table}}.

This version defines decision-semantics conformance.  It does not
define a QR payload carrier, complete signed governance-object schemas,
cryptographic envelope, discovery or distribution protocol, media
type, or registry.  The object examples and binding requirements in
{{gov-objects}} are design input to a future Standards Track binding.
Evidence acquisition and the complete mapping from observations to
residual severities likewise are not claimed as interoperable by the
Delta conformance corpus.

The following remain outside the conformance claim:

- Enrollment coverage, business identity from a bare signature or URL
  reputation, universal maliciousness detection, and any requirement for
  machine learning.
- DNS resolution, hosting continuity, resource bytes, page content, and
  post-navigation browser state.  R_D authorizes normalized URL
  components only; R_S and separately specified content-integrity
  mechanisms answer different questions.
- App intents, native deep links, payment URI schemes, complete governance
  objects, and an interoperable wire protocol.
- Improved user behavior without empirical testing of scanner states and
  warnings.

Deployment also requires root selection, issuer enrollment, revocation
authority, scanner adoption, and tested user-interface behavior.  This
document does not specify those functions, presentation-mode QR payments
inside closed ecosystems, brand recognition, governance selection, or
liability.

## Relationship to Existing Mechanisms

The RATS architecture {{RFC9334}} is the closest role-level
comparison.  A RATS Verifier appraises Evidence and emits Attestation
Results; a Relying Party applies its own policy to decide an action.
Here a QR verifier appraises the decoded payload and available signed
state into R, then Delta produces `(S,A,L)` for the QR relying party
that offers or blocks navigation.  One scanner process can combine
those two roles, but their policy responsibilities remain distinct.

This is an analogy, not a RATS profile.  RATS Evidence is produced by
an Attester about an attested environment.  A merchant organization or
authorized URL is not an EAT entity: EAT {{RFC9711}} reserves that
notion for hardware or software, although a scanner's own platform
attestation could separately use EAT.  The active AR4SI work
{{AR4SI}} defines reusable Attestation Result elements, categories,
tiers, and JSON/CBOR serializations for consistent relying-party
policy.  QR Trust instead defines six navigation-specific residuals
and Delta; it does not claim to extend AR4SI.  The RATS Conceptual
Message Wrapper {{RFC9999}} also demonstrates that an architecture's
conceptual messages can remain separate from their typed wire wrapper;
this document does not claim that CMW already types QR messages.

W3C Verifiable Credentials {{VCDM}} define a general credential data
model.  Separate W3C Recommendations define JOSE/COSE securing
{{VCJOSECOSE}} and privacy-conscious suspension or revocation via
Bitstring Status Lists {{VCSTATUS}}.  A future QR binding could
evaluate a VC representation or status mechanism, but VC alone does
not define accepted-root policy, destination authorization, redirect
observation, runtime-safety residuals, or Delta.  QR capacity,
processing cost, and privacy need measurement before such a binding
is selected.

JWS {{RFC7515}} and COSE {{RFC9052}} are established signature
envelopes, with their own protected-header, key, and algorithm
machinery {{RFC7517}} {{RFC8725}} {{RFC9053}}.  A future binding needs
to select and fully profile one primary envelope rather than require
both or invent a parallel generic signature envelope.  JWS signs a
JWS Signing Input, while COSE signs its `Sig_structure`; even when
they carry the same application payload octets, their signature
inputs and values are not byte-identical.

The Internet X.509 profile {{RFC5280}}, TLS service-identity rules
{{RFC9525}}, and browser root-program governance are three separate
layers.  Together they can authenticate a TLS service under a locally
accepted public root, but do not establish QR publisher legitimacy,
authorize a path or query, or supply the decision semantics here.
Domain-control evidence can support enrollment without turning a TLS
certificate into business identity.  Browser safe-browsing feeds
likewise answer destination-reputation questions; invariants I1 and
I2 prevent either signal from creating issuer trust.

RPKI {{RFC6480}} is a narrower design analogy.  It uses resource
certificates and CRLs, route-origin authorizations, signed manifests,
untrusted repositories, and relying-party caches to constrain
authorization over hierarchically allocated Internet number
resources.  QR Trust can learn from signed-object publication,
revocation, manifest completeness, and cache freshness, but RPKI does
not define QR status-event streams or `previous_sequence` chains, and
QR issuer and destination identity do not inherit Internet-number
allocation semantics.

SCITT {{RFC9943}} is the candidate substrate if a later QR binding
needs statement transparency.  SCITT defines COSE-enveloped Signed
Statements, protected issuer and subject claims {{RFC9597}},
registration with a Transparency Service, receipts, and verifiable
history.  A receipt can support audit and equivocation detection; it
does not decide current QR trust, distribute urgent revocation, or
replace local root acceptance and Delta.  This -00 therefore defines
no parallel transparency-log protocol.

A future binding should select one primary cryptographic envelope and
application schema instead of stacking JOSE, COSE, VC, EAT, SCITT, and
RPKI.  Optional ecosystem and transparency bindings need separate
implementation evidence.

ISO/IEC JTC 1/SC 31 owns QR symbology {{ISO18004}}, which this document
does not modify.  Scanner user interfaces remain platform concerns.
The DISPATCH question concerns the security architecture and decision
semantics between issuers, status publishers, verifiers, and relying
parties.  A separate document can define signed-object and carrier
bindings using established IETF mechanisms.

# Conventions and Definitions

{::boilerplate bcp14-tagged}

This document is submitted as Informational for dispatch discussion;
the category is a placeholder pending that discussion.  Normative
keywords are used so that the decision semantics are stated testably
-- the conformance corpus of {{impl-status}} exercises them today.
This document does not define wire-format conformance.  If the work is
adopted, a separate binding specification would be a candidate for
Standards Track.

Navigation QR code:
: A QR code {{ISO18004}} whose payload initiates navigation to an
  absolute URI {{RFC3986}} with scheme `http` or `https`, as opposed
  to a presentation-mode code that merely displays data to a
  counterparty device.  Other action types are outside this version.

Governance producer:
: A root program, delegated operator, issuer, status publisher, or
  runtime-safety provider that makes evidence available for appraisal.
  This role describes production of state, not whether a particular
  wire object or transport has been standardized.

Verifier:
: The component (in a scanner app, operating-system service, or
  gateway) that appraises a scanned artifact and available trust state,
  constructs the residual input, applies Delta, and emits a structured
  decision result.

Relying party:
: The component that consumes the verifier's structured result and
  decides whether navigation is offered or blocked under local policy.
  A scanner application can combine the Verifier and Relying Party
  roles, but their policy responsibilities remain distinct.

Accepted root:
: A trust anchor that the verifier's local policy accepts as a root
  trust program.  Acceptance is a local policy decision; no global
  root list is assumed.

Delegation path:
: The chain from an accepted root through zero or more delegated
  operators to the issuer that signed a managed trust claim.

Managed trust claim:
: A signed claim carried with (or referenced by) a QR payload that
  binds the payload's destination to an issuer enrolled under a root
  trust program (see {{payload-claim}}).

Trust residual:
: A typed, evidence-bearing record of what remains unsatisfied after
  evaluating one family of constraints against a scanned artifact.

Residual family:
: One of the six constraint families evaluated by the verifier:
  issuer chain, destination policy, redirect flow, runtime safety,
  freshness, and artifact integrity.

Mandatory family:
: A residual family that the active profile (or deployment policy)
  marks as requiring decision-grade, positive-eligible evidence before
  any positive state may be emitted.  The exact eligible tiers are
  defined by D4 and D14; they are not uniformly named `pass`.

Decision state:
: One of the five bounded user-visible states defined in
  {{decision-states}}.

Positive state:
: The decision state "verified issuer" ({{decision-states}}), with
  or without annotations.  It is the only state that asserts full
  positive eligibility (rule D4), and the only state the invariants
  and the conformance clause of {{profiles}} refer to as positive.
  "Verified issuer destination risky" asserts a verified issuer
  chain but is a warning state, not a positive state.  The positive
  attention level is narrower still: only an unannotated "verified
  issuer" carries it.

Issuer-verification terminal:
: A decision state asserting a verified issuer chain: "verified
  issuer" or "verified issuer destination risky" (rules D4 and D5).

Annotation:
: A machine-readable qualifier attached to an emitted decision state
  (for example, limited visibility, stale bound, artifact warning,
  testing posture, or cross-root contradiction).  Any annotation
  raises the required attention of "verified issuer" to warning
  ({{decision-states}}).

Attention level:
: The minimum user attention a decision state demands, on the ordered
  scale positive < neutral < warning < block.

Verification profile:
: A named, closed parameterization of the decision semantics
  ({{profiles}}) that fixes how insufficiency, staleness, and
  optional families are treated.

Controlled resolution:
: Resolution of a payload's redirect chain inside an isolated
  environment operated by the verifier, rather than in the user's
  browsing context.

Resolver:
: An intermediary host (for example, a short-link service) through
  which a payload passes before reaching its final destination.
  Such policies bind the first-hop resolver as well as that
  final destination ({{gov-objects}}).

Trusted mode:
: The evaluation mode entered when the payload carries a managed
  trust claim, and therefore the only mode in which a positive state
  is reachable.  Redirect-flow evaluation ({{family-rr}}) and rule D7
  ({{decision-table}}) apply in trusted mode only: a payload with no
  claim cannot reach a positive state, so resolving its chain would
  spend a network action and its privacy cost ({{privacy}}) on a
  decision it cannot change.

Similar names recur in three namespaces: severity tiers ("warn",
"block") describe residual evidence ({{lattice}}); attention levels
("warning", "block") describe demanded user attention; decision
states ("blocked") are the emitted outcome.  The namespaces are
related but never interchangeable.

# Trust-Residual Model {#model}

## Verification Function

A complete verifier implements a function:

~~~
V(q, t, C_t, P) -> (S, A, L, R, E)
~~~

where q is the scanned artifact (decoded payload plus capture
metadata), t is the evaluation time, C_t is the verifier's cached
signed trust state at time t, and P is the active verification
profile.  The outputs are a decision state S ({{decision-states}}),
a residual vector R, and an evidence set E that records the artifacts,
hashes, sequence numbers, and freshness windows consulted.  A is the
ordered annotation list and L is the derived attention level.

The decision-semantics function specified by this document is the
narrower function:

~~~
Delta(R, P) -> (S, A, L)
~~~

where P is the decision context defined in {{profiles}}, A is the
ordered annotation list, and L is the derived attention level.  Delta
does not acquire evidence or decide whether an observation justifies a
residual tier.  It consumes the closed input below.

The residual vector has one entry per family:

~~~
R = [R_I, R_D, R_R, R_S, R_F, R_A]
~~~

for issuer chain (R_I), destination policy (R_D), redirect flow
(R_R), runtime safety (R_S), freshness (R_F), and artifact integrity
(R_A).

## Residual Record

Each residual is a record `(tier, causes, evidence_refs,
freshness_ref)`:

tier:
: One token permitted for the family by {{lattice}}.  Delta consumes
  this field.

causes:
: An ordered, duplicate-free list drawn from the family's enumeration
  in {{families}}.  A passing residual has an empty cause list.  Causes
  explain appraisal but do not alter Delta independently of `tier`.

evidence_refs:
: An ordered, duplicate-free list of opaque references into E that
  identify the signed artifacts, observations, or measurements used by
  the appraiser.  Delta preserves but does not inspect them.

freshness_ref:
: An opaque reference into E for the validity window, sequence, and
  evaluation-time facts used by appraisal, or null when the family is
  not applicable or no time-bound source applies.  Delta does not
  re-evaluate time.

Mandatory-family membership is carried once in P, not duplicated in
each residual.  Confidence is outside the conformance
record: an appraiser can retain a calibrated score in E, but Delta MUST
ignore it.

## Severity Lattice {#lattice}

The generic evidence tiers form the ordered set:

~~~
pass < unknown < stale < warn < fail < block
~~~

The generic `unknown` class is represented in the closed family
vocabularies by three explicit tier tokens that decision rules can
distinguish:

not-applicable:
: The family does not apply to this artifact under the active
  profile (for example, redirect-flow evaluation for a payload with
  no redirect and a profile that does not require controlled
  resolution).

not-checked:
: The verifier did not evaluate the family (for example, artifact
  integrity on a platform without capture forensics).

unavailable:
: The verifier attempted evaluation and could not obtain the
  required state (for example, a runtime-safety provider that did
  not answer within its budget).

The decision input uses the following closed family-specific tier
sets.  `no-issuer`, `unaccepted-issuer`, `invalid-managed-claim`,
`revoked-issuer`, and `cross-root-contradiction` retain issuer meaning
that a generic severity would erase.

| Family | Permitted tier tokens |
|--------|-----------------------|
| R_I | pass, no-issuer, unaccepted-issuer, invalid-managed-claim, revoked-issuer, cross-root-contradiction |
| R_D | pass, fail, not-applicable, unavailable |
| R_R | pass, warn, fail, not-applicable, unavailable |
| R_S | pass, warn, block, stale, unavailable, not-checked |
| R_F | pass, warn, block, not-applicable |
| R_A | pass, warn, fail, block |
{: #tab-residual-tiers title="Closed residual-tier vocabulary"}

A decision engine MUST reject a missing family, an extra family, or a
tier outside the permitted set before applying Delta.  This validation
turns unknown extensions into a loud version mismatch rather than the
D15 caution default.  D15 provides totality over valid combinations of
the vocabulary above; it is not an extension mechanism.

The lattice orders evidence classes, not decision precedence.  An
insufficiency tier in a mandatory family can outweigh a warn tier in
an optional family: rule D14 in {{decision-table}} makes a mandatory
family that lacks positive-eligible evidence fatal to positive
eligibility, regardless of lattice position.  Runtime safety has no
`not-applicable` tier; see {{family-rs}}.

# Residual Families {#families}

Each family defines a pass condition and an enumeration of residual
causes.  Cause identifiers are lowercase kebab-case tokens carried in
the evidence set.  These enumerations are closed for
`qr-trust-delta-v1`; a future document can extend them only with a new
semantics version.

## Issuer Chain (R_I) {#family-ri}

Pass condition: the payload carries a managed trust claim whose
signature verifies under a key bound to an issuer record, the issuer
record chains through a valid delegation path to an accepted root,
and every element of the path is within its validity window and free
of revocation or suspension.

Residual causes: no-trust-claim, invalid-signature,
invalid-trust-claim, unaccepted-root, unknown-issuer,
malformed-chain, delegation-depth-exceeded, issuer-revoked,
issuer-suspended, key-revoked, key-suspended, record-expired,
record-not-yet-valid, key-window-mismatch, and
trust-state-unavailable.  The cause
invalid-trust-claim marks a claim that is present but fails
validation, used when a profile carve-out routes such a payload to
"unverified" instead of "blocked" ({{decision-table}}).

A verifiable signature from an issuer outside every accepted root is
not an error condition; it is the distinct "signed unaccepted
issuer" outcome ({{decision-states}}).

## Destination Policy (R_D) {#family-rd}

Pass condition: under the appraiser's selected normalization and
policy-matching profile, the final destination and, when a resolver is
used, the first-hop resolver both fall within the issuer's signed
destination policy ({{gov-objects}}), and the policy itself is valid
and in window.  {{normalization}} explains why this condition needs a
future binding before different appraisers can claim interoperability.

Residual causes: destination-not-authorized,
resolver-not-authorized, policy-expired, policy-unavailable,
normalization-failure, policy-invalid.

A destination outside the signed policy of an otherwise valid issuer
is treated as adverse evidence, not as missing evidence: it yields
severity "fail" and rule D6 ({{decision-table}}) maps it to
"blocked", never to
"unverified".  A signed claim pointing outside its own policy is a
stronger signal of compromise or misissuance than an unsigned code.

An R_D pass is URL authorization, not resource integrity.  It says
that the normalized scheme, host, port, path, and query satisfy the
signed policy at evaluation time.  It does not attest DNS resolution,
hosting continuity, resource bytes, page content, or navigation after
the scanner hands the URL to another user agent.  A resource change
behind the same authorized URL leaves R_D at "pass" unless some other
policy or evidence family detects it.

## Redirect Flow (R_R) {#family-rr}

Redirect flow is evaluated in trusted mode when the payload carries a
managed trust claim, because only then is a positive state reachable
and worth protecting.  Pass condition: under controlled resolution,
the observed chain stays within the policy's allowed redirect hosts,
does not exceed the policy's maximum depth, and terminates at a
destination consistent with R_D.

Residual causes: depth-exceeded, unauthorized-intermediary,
nested-shortener, resolver-mismatch, cloaking-indicator,
resolution-unavailable.

## Runtime Safety (R_S) {#family-rs}

Pass condition: a fresh, signed runtime-safety verdict for the final
destination (and resolver, when used) reports no adverse state.

Residual causes: verdict-warn, verdict-block, verdict-expired,
verdict-stale, provider-unavailable, provider-disagreement.

Runtime safety MAY reduce trust but MUST NOT create issuer trust
(invariant I1 in {{invariants}}).  This family has no
"not-applicable" tier: every navigation has a present-time safety
question.  The only positive-eligible non-pass tier is
"unavailable", and only when the active profile is neither
strict-online ({{profiles}}) nor marks runtime safety mandatory; a positive state
emitted in that situation MUST carry a limited-visibility
annotation.  An expired verdict is recorded here (as
verdict-expired) rather than in R_F, so that freshness of the safety
signal and freshness of governance objects remain independently
visible.

## Freshness (R_F) {#family-rf}

Pass condition: every governance object consulted (see
{{gov-objects}} for the object types) is within its validity
window, sequence numbers are monotonic with no observed rollback,
no gap is observed in any previous_sequence-chained stream, and the
verifier's clock is within the deployment's permitted skew of the
objects' timestamps.

Residual causes: object-expired, object-not-yet-valid,
sequence-rollback, sequence-gap, clock-skew-exceeded,
cache-unverifiable.

State past its window but within an appraisal-profile grace bound is
tier `warn`, distinct from `block`.  Rule D9 in {{decision-table}}
governs the outcome: profiles of the strict class block, while the
bounded and testing classes continue with an explicit warning
annotation (profile classes are defined in {{profiles}}).

## Artifact Integrity (R_A) {#family-ra}

Pass condition: capture-side analysis of the physical or digital
artifact reveals no tampering indicators.

Residual causes: overlay-suspected, conflicting-symbols,
framed-symbol-anomaly, print-provenance-anomaly,
container-mismatch, analysis-unavailable.

Artifact-integrity analysis is probabilistic and environment
dependent, so this family is supporting evidence by default:
optional, advisory, and unable to create trust.  Delta consumes an
R_A tier of `block` without inferring how the appraiser reached it.
A future appraisal binding must define the evidence and signed policy
needed to assign `block`, including any treatment of conflicting
symbols or overlays in a signed-only workflow.  Other detections
downgrade or annotate (rules D11 and D12) and become blocking only
where P marks the family mandatory (m_A).

# Security Invariants {#invariants}

The decision semantics MUST maintain the following invariants.  They
are stated independently of the decision table so that any
implementation, extension, or profile can be checked against them
directly.

I1 (non-upgrade by runtime safety):
: A benign runtime-safety verdict MUST NOT raise the decision state
  of a payload whose issuer chain does not pass.  Reputation
  evidence never creates issuer trust.

I2 (non-upgrade by transport):
: HTTPS transport, certificate validity, or destination TLS posture
  MUST NOT raise the decision state.  Transport security is assumed
  necessary and is never sufficient.

I3 (destination-binding precedence):
: A destination or resolver outside the signed destination policy
  MUST prevent any positive state, regardless of issuer-chain
  validity.

I4 (freshness precedence):
: A stale appraisal MUST NOT silently produce an unannotated positive-
  attention result.  The strict class blocks an R_F tier of `warn`;
  the bounded and testing classes continue with
  `stale-offline-warning`.  State past every appraisal grace bound is
  R_F `block`, not `warn`.

I5 (root isolation):
: Trust decisions under one accepted root MUST NOT be influenced by
  artifacts signed under a different root, except to surface a
  cross-root contradiction through rule D13.  An appraiser may assign
  `cross-root-contradiction` only when the artifacts carry an explicit
  common subject identifier under a binding that defines cross-root
  equality.  Display-name, host-name, or other heuristic similarity is
  insufficient.  Without that binding, the appraiser keeps the root
  decisions separate and does not invoke D13.

I6 (evidence preservation):
: Every emitted state MUST be accompanied by the residual vector and
  evidence set that produced it, sufficient for later review to
  replay Delta from R and P.  This does not require retaining the raw
  capture, full URL, network response, or physical context needed to
  repeat appraisal.  Evidence retention is minimized, protected, and
  bounded as specified in {{privacy}}.

I7 (no silent fallback to trust):
: Unavailability of any required input (provider, cache, policy)
  MUST NOT default to a positive state.  Fail-open is expressible
  only as an explicit, annotated profile choice, never as an
  implementation default.

# Decision States {#decision-states}

A verifier maps every evaluated artifact to exactly one of five
bounded decision states.  Open-ended scores and ad hoc warning strings
would prevent deterministic review across implementations.

unverified (attention: neutral):
: No managed trust claim is present, or the profile's carve-outs
  route an invalid claim here with warnings ({{profiles}}).  The
  code is an ordinary link; nothing positive is asserted.  Because
  the absence of a claim is unauthenticatable, this state is also
  where a code stripped of its claim lands; {{downgrade}} treats that
  attack and its deployment-side countermeasures.

signed unaccepted issuer (attention: warning):
: The payload carries a cryptographically valid claim, but the
  delegation path terminates outside every accepted root.  The
  verifier asserts the signature's validity and nothing more.

verified issuer (attention: positive when unannotated):
: The full positive-eligibility predicate of rule D4
  ({{decision-table}}) holds.  If any
  annotation accompanies this state (limited visibility, stale
  bound, artifact warning, testing posture, cross-root
  contradiction), the required attention level is warning: an
  annotated "verified issuer" is not the positive attention level.

verified issuer destination risky (attention: warning):
: The issuer path is positive-eligible, but the runtime-safety
  verdict for the destination is warn-grade (rule D5).

blocked (attention: block):
: A mandatory block condition matched (rules D3, D6, D7, D8, D10,
  and profile-dependent D9/D11).  The verifier MUST NOT offer
  one-tap continuation from this state.

Unreadable capture is not a sixth decision state.  When no reliable
payload can be extracted from the capture, rule D0 reports the
unreadable capture outcome with re-capture guidance; this is a
capture result, not a trust decision.  Residuals recorded for such
captures (as in the conformance corpus) are diagnostic; rule D0
decides without consulting them.

For conformance JSON results and APIs, the authoritative field is
model_decision.primary_state.  Its value is the decision-state name
in lowercase kebab-case: unverified, signed-unaccepted-issuer,
verified-issuer, verified-issuer-destination-risky, or blocked.  The
unreadable capture outcome is not carried in this trust-decision
field.

An implementation MAY also expose a product-oriented decision_state
field with UX refinements or compatibility labels.  That field is
not a conformance surface.  Each response MUST still carry the exact
underlying model_decision, and the product treatment MUST NOT demand
less attention than model_decision.attention_level.

Deployed scanners MAY present UX-layer refinements of these states
(for example, a "destination changed" treatment distinguishing why
a previously positive code is no longer positive), provided the
refinement maps to exactly one underlying decision state and never
demands less attention (conformance clause, {{profiles}}).

# Decision Procedure {#decision-table}

## Decision Rules

The overall evaluation first applies the capture rule D0.  If capture
and decode succeed, the decision function Delta maps a residual
vector and decision context P to one of the five decision states via the
remaining rules.  D0 stays in the table to make the total evaluation
order explicit, but its result inhabits the separate capture-outcome
type.  Conditions abbreviate the pass conditions of {{families}};
m_x denotes "family x is mandatory".

| Rule | Condition (summary) | Outcome |
|------|---------------------|---------|
| D0   | capture yields no reliable claim | unreadable capture outcome |
| D1   | R_I = no-issuer | unverified |
| D2   | R_I = unaccepted-issuer | signed unaccepted issuer |
| D3   | R_I = invalid-managed-claim or revoked-issuer | blocked, except the reference-testing carve-out below |
| D4   | full positive eligibility (see below) | verified issuer |
| D5   | positive-eligible except R_S = warn | verified issuer destination risky |
| D6   | R_D = fail (destination or resolver outside policy) | blocked |
| D7   | R_R = fail in trusted mode | blocked |
| D8   | R_S = block | blocked |
| D9   | R_F = block, or R_F = warn | block; for warn under a non-strict profile, instead continue with stale-offline-warning |
| D10  | R_A = block | blocked |
| D11  | R_A = fail | m_A: blocked; else unverified + artifact warning |
| D12  | Positive-eligible R_A = warn, R_R = warn, or non-mandatory R_S = unavailable | continue with the corresponding annotation |
| D13  | R_I = cross-root-contradiction | strict: blocked; otherwise unverified + incomplete-verification-warning |
| D14  | R_S is stale or not checked as detailed below, or a mandatory family lacks positive-eligible evidence | strict: blocked; otherwise unverified + incomplete-verification-warning |
| D15  | any valid vector not matched above | unverified + incomplete-verification-warning |
{: #tab-rules title="Decision rules"}

Rule D4's positive-eligibility predicate is: R_I is `pass`; R_D is
`pass` or `not-applicable`; R_R is `pass`, `warn`, or
`not-applicable`; R_S is `pass` or `unavailable` where the profile and
m_S allow it; R_F is `pass`, `warn`, or `not-applicable` where the
profile allows it; R_A is `pass` or `warn`; no mandatory family lacks
positive-eligible evidence; and no earlier rule returned.  Warn-grade
evidence that survives to D4 surfaces as annotations, and any
annotation removes the positive attention level
({{decision-states}}).

For D9, "continue" means that the annotation is accumulated before
later rules run.  If no later rule downgrades the result, D4 emits
`verified-issuer` with `stale-offline-warning`, whose attention level
is warning rather than positive.  For D13, the exact strict result is
`blocked` with no annotation; the exact bounded or testing result is
`unverified` with `incomplete-verification-warning`.  Both carry a
cross-root-contradiction diagnostic reason.  A stronger earlier block
condition wins before D13.

D3 consumes issuer tiers, not raw signature or lifecycle evidence.
`invalid-managed-claim` is the invalid-claim tier, while
`revoked-issuer` is the block-grade issuer-or-key lifecycle tier; the
cause list preserves whether appraisal observed an invalid signature,
malformed chain, issuer suspension or revocation, or key suspension or
revocation.  Under `reference-testing`, `invalid-managed-claim` instead
returns `unverified` with annotations `invalid-trust-claim-warning`
then `policy-profile-warning`.  `revoked-issuer` remains blocked under
every profile.

D14's runtime-specific arms are exact: R_S `stale` blocks under
`strict-online` and otherwise returns `unverified` with
`incomplete-verification-warning`; R_S `not-checked` has the same
outcomes; and R_S `unavailable` blocks under `strict-online` but
continues with `limited-runtime-safety-visibility` under a non-strict
profile unless P marks R_S mandatory.  The general arm then applies
to every family P marks mandatory.  R_S `warn` is decision-grade risky
evidence and belongs to D5, not to the missing-evidence arm of D14.

## Evaluation Order

The overall evaluation uses the following order.  D0 is the sole
pre-Delta class.  Once capture succeeds, Delta is total over every
valid R and P.  A terminal outcome returns immediately; an annotation
step appends to A and continues:

1. Capture: D0.
2. Adverse blocks: D3; D6; D7; D8; the R_F `block` arm of D9;
   the strict-profile R_F `warn` arm of D9; D10; and the mandatory
   arm of D11.
3. Early adverse downgrades: the non-mandatory arm of D11, then D13.
4. Claim status: D1, then D2.  These terminals intentionally precede
   optional-evidence annotation: an unsigned or unaccepted path does
   not gain warning qualifiers that cannot change its trust claim.
5. Runtime insufficiency: D14 handles R_S `stale`; strict profiles
   also block R_S `unavailable` and `not-checked`; non-strict profiles
   return an annotated caution for `not-checked`.
6. Annotation accumulation, in order: the non-strict R_F `warn` arm
   of D9; R_S `unavailable`; the R_A `warn` arm of D12; R_R `warn`;
   and the `reference-testing` profile marker.
7. Risky downgrade: D5.
8. General mandatory-family insufficiency: D14.
9. Totality: D15 catches a tier combination outside the positive-
   eligibility sets.
10. Positive terminal: D4.

Adverse evidence (fail or block in any family) preempts the
claim-status outcomes: a payload with no
managed trust claim but a blocking safety verdict is "blocked",
not "unverified".  Insufficiency (any "unknown" refinement or
"stale") gates only the positive path: under the bounded and
testing classes it never converts a claim-status outcome into a
block by itself, and under the strict class mandatory-family
insufficiency blocks ({{profiles}}).  The positive terminal fires only
for vectors whose full eligibility predicate holds; because that
predicate is self-guarding, D4 is reached only by vectors no earlier
class matched.  The totality class is evaluated immediately before D4,
so that it catches exactly the valid vectors that cannot reach the
positive terminal and every vector still reaches a state.

D4 repeats D12's warn-annotation condition so that the positive
predicate can be read independently.  Listing strict-profile D9 among
the mandatory blocks does not change its outcome.  The
reference-testing profile ({{profiles}}) routes invalid managed trust
claims to "unverified" with an invalid-trust-claim cause and profile
warnings, allowing negative fixtures to traverse the pipeline without
invoking block handling; a corpus case pair pins this behavior
({{impl-status}}).  Runtime safety has no "not-applicable" tier for the
reason given in {{family-rs}}.

## Worked Examples

Example 1.  A table-tent code carries a valid claim from an issuer
chained to an accepted root; the destination and resolver are within
policy; the safety verdict, freshness, and artifact analysis all
pass.  No rule in classes 1-9 returns; D4 emits "verified issuer"
with no annotations: the positive attention level.

Example 2.  The same code, but the safety provider reports a
warn-grade verdict for the destination.  No terminal in classes 1-6
fires; class 7 applies D5 and emits "verified issuer destination
risky".  Invariant I1 is
preserved: the warn reduced trust and could never have created it.

Example 3.  A code carries a valid claim, but controlled resolution
terminates at a host outside the signed destination policy.  R_D is
"fail"; class 2 matches at D6 and emits "blocked" -- despite the
fully valid issuer chain, per invariant I3.

Example 4.  An appraiser operating under a binding that classifies
conflicting decodable symbols as R_A `block` supplies that tier to
Delta.  Class 2 matches at D10 and emits "blocked" regardless of
profile or signature state.  This document specifies the result of
the tier, not the capture-to-tier classification.

# Verification Profiles {#profiles}

Profile identifiers form a closed enumeration owned by this
document; new profiles, and the residual-cause extensions they may
carry ({{families}}), are defined only by future documents that
update this enumeration.  A verifier MUST reject a profile
identifier outside this enumeration before any
evaluation begins; an unrecognized profile converts a potential
fail-open misconfiguration into a loud failure.

The decision context has exactly three members:

~~~
P = (semantics_version, profile_id, mandatory_families)
~~~

`semantics_version` is `qr-trust-delta-v1`.  `profile_id` is one of
the five identifiers below.  `mandatory_families` is an ordered,
duplicate-free subset of the six family names in R, serialized in R
family order.  `strict-online` additionally requires runtime-safety
evidence even when `runtime_safety` is absent from
`mandatory_families`; this is a property of that profile, not an
implicit mutation of P.  An engine MUST reject an unknown member,
unknown token, duplicate, or out-of-order family name before invoking
Delta.

Clock-skew bounds, grace periods, object lifetimes, URI
normalization, subject identity, overlay classification, and other
evidence-appraisal parameters do not alter Delta directly.  The
appraiser records them in E and uses them when assigning a closed
tier to R.  A future appraisal binding must version those parameters;
placing them in P would incorrectly make Delta re-appraise evidence.

strict-online:
: Full online posture.  The only profile that converts
  insufficiency of mandatory-family state into a mandatory block,
  and the only profile that requires runtime safety without needing
  an m_x marking.

bounded-online:
: Online posture with bounded degradation: warn-grade freshness and
  provider unavailability yield explicit annotations rather than
  silent positive attention or automatic blocks.

bounded-offline:
: Operates from cached signed state within freshness windows; all
  online-only families degrade per the bounded rules.

production-trusted:
: Bounded posture for managed deployments that pre-provision trust
  state.

reference-testing:
: Testing posture.  Stamps a testing-posture annotation on every
  issuer-verification terminal, so this profile can never render an
  unannotated positive; carves invalid managed trust claims out of
  D3 as described in {{decision-table}}.

The strict-online profile forms the strict behavior class;
reference-testing forms the testing class; and bounded-online,
bounded-offline, and production-trusted form the bounded class.  Mandatory
markings m_x are orthogonal to the profile: deployment policy MAY mark any
family mandatory under any profile, which gates rules D11 and D14.

| Profile | Class | Warn-grade freshness | Runtime safety |
|---------|-------|--------------------------------|----------------|
| strict-online | strict | block (D9) | mandatory (without m_S) |
| bounded-online | bounded | continue with warning annotation | per m_S |
| bounded-offline | bounded | continue with warning annotation | per m_S |
| production-trusted | bounded | continue with warning annotation | per m_S |
| reference-testing | testing | continue with warning annotation | per m_S |
{: #tab-profiles title="Profile behavior matrix"}

## Conformance

This version defines decision-semantics conformance, not complete
verifier or wire-protocol conformance.  Given R and P as closed above,
a decision engine
claiming conformance MUST implement Delta exactly and MUST satisfy the
invariants of {{invariants}}.

A deployed pipeline MAY demand more user attention than Delta for a
given input (for example, blocking where Delta warns, under a declared
stricter posture) but MUST NOT demand less.  Delta agreement is
REQUIRED for any positive state, and a deployment MUST NOT upgrade
Delta's outcome.  Every emitted state MUST carry its residual vector
and evidence set (invariant I6), and profile identifiers outside the
closed enumeration MUST be rejected before evaluation.

The acquisition of evidence and its appraisal into residual
severities are inputs to this conformance surface; they are not fully
specified by this version.  Likewise, conformance to Delta does not
establish interoperability for the illustrative governance objects or
payload claims of {{gov-objects}}.  An implementation claiming broader
verifier or wire interoperability needs a future binding and appraisal
specification in addition to this decision-semantic core.

## Versioned Conformance Representation {#conformance-representation}

The following JSON shape is the versioned test-vector representation
for `qr-trust-delta-v1`.  It is not an on-the-wire verifier protocol,
governance object, or QR payload encoding.  JSON object member order
is insignificant {{RFC8259}}; the example displays residuals
in R family order only for readability.  A decision engine MUST reject
an unknown or missing member rather than ignore it.

~~~ json
{
  "semantics_version": "qr-trust-delta-v1",
  "profile": "bounded-offline",
  "mandatory_families": [],
  "evidence": {
    "e:issuer": "fixture:C10b:issuer-record",
    "e:issuer-window": "fixture:C10b:issuer-window",
    "e:policy": "fixture:C10b:destination-policy",
    "e:policy-window": "fixture:C10b:policy-window",
    "e:redirect-observation": "fixture:C10b:redirect-observation",
    "e:observation-time": "fixture:C10b:observation-time",
    "e:safety-verdict": "fixture:C10b:safety-verdict",
    "e:safety-window": "fixture:C10b:safety-window",
    "e:capture": "fixture:C10b:capture"
  },
  "residuals": {
    "issuer_chain": {
      "tier": "pass",
      "causes": [],
      "evidence_refs": ["e:issuer"],
      "freshness_ref": "e:issuer-window"
    },
    "destination_policy": {
      "tier": "pass",
      "causes": [],
      "evidence_refs": ["e:policy"],
      "freshness_ref": "e:policy-window"
    },
    "redirect_flow": {
      "tier": "pass",
      "causes": [],
      "evidence_refs": ["e:redirect-observation"],
      "freshness_ref": "e:observation-time"
    },
    "runtime_safety": {
      "tier": "pass",
      "causes": [],
      "evidence_refs": ["e:safety-verdict"],
      "freshness_ref": "e:safety-window"
    },
    "freshness": {
      "tier": "warn",
      "causes": ["object-expired"],
      "evidence_refs": ["e:issuer"],
      "freshness_ref": "e:issuer-window"
    },
    "artifact_integrity": {
      "tier": "pass",
      "causes": [],
      "evidence_refs": ["e:capture"],
      "freshness_ref": null
    }
  },
  "result": {
    "primary_state": "verified-issuer",
    "annotations": ["stale-offline-warning"],
    "attention_level": "warning"
  }
}
~~~

The top-level and residual-record member sets shown above are exact for
this test-vector version; unknown or missing members are rejected, but
member order is not examined.
Every `evidence_refs` value and non-null `freshness_ref` value MUST name
a member of `evidence`.  Delta does not inspect those values, but their
presence preserves the evidence association at the conformance
boundary.

The annotation vocabulary is closed.  A contains only
`artifact-warning`, `stale-offline-warning`,
`limited-runtime-safety-visibility`, `redirect-variation-warning`,
`invalid-trust-claim-warning`, `policy-profile-warning`, and
`incomplete-verification-warning`, in the order imposed by the
evaluation rules.  A conforming engine rejects an unknown or duplicate
annotation.  L is derived exactly: `blocked` maps to `block`;
`signed-unaccepted-issuer`, `verified-issuer-destination-risky`, or any
annotated result maps to `warning`; unannotated `unverified` maps to
`neutral`; and unannotated `verified-issuer` maps to `positive`.

Diagnostic reason codes MAY accompany the result, but they are not an
output of Delta and MUST NOT change S, A, or L.  D0 is encoded as a
separate capture outcome and MUST NOT be serialized as
`result.primary_state`.  The example above is the C10b decision class
from the public corpus; the corpus remains the machine-checkable source
of examples and expected outcomes.

# Requirements for a Future Binding {#gov-objects}

Delta conformance does not depend on a governance-object wire format.
A future binding that claims compatibility with this architecture needs
representations for a root trust program manifest, delegated operator
manifest, issuer record, destination policy, status event or runtime-
safety verdict, and verifier cache entry.  The capitalized requirements
in this section apply to that later binding, not to conformance with the
decision semantics in this document.

The binding must close member types, canonical payloads, signature
coverage, identifier and time grammars, algorithms, key discovery,
error handling, media types, retrieval, and test vectors.  Every signed
governance object needs an object type, schema version, issuer, subject,
issuance and validity times, sequence number, and previous-sequence
link.  A JSON binding must decide whether to require I-JSON {{RFC7493}}
and the JSON Canonicalization Scheme {{RFC8785}}; a CBOR binding must
define its deterministic encoding.  Either binding must reject duplicate
or invalid members, pin sequence-number ranges, and publish canonical
test vectors.

## Canonicalization and Signature Coverage

The semantic requirement is identity of the canonical application
payload within a selected binding, not identity of signatures across
formats.  A future binding MUST select and completely profile one
primary envelope.  A JWS binding needs to define the JWS serialization,
protected `alg` and `kid` processing, key discovery and representation,
allowed algorithms, critical-header behavior, detached-payload rules,
and media type using {{RFC7515}}, {{RFC7517}}, and {{RFC8725}}.  A COSE
binding needs the corresponding COSE structure, protected headers,
algorithm and key identifiers, external additional authenticated data,
detached-payload rules, and media type using {{RFC9052}} and
{{RFC9053}}.

JWS and COSE MUST NOT be treated as signing the same byte string.  JWS
signs its JWS Signing Input; COSE signs its `Sig_structure`.  If two
bindings represent the same semantic object, they can require the same
canonical application payload octets, but their envelope-specific
signature inputs and signature values differ.  Within one selected
binding, embedded and detached presentations must preserve the exact
application payload octets and every security-affecting parameter must
be integrity protected.

A future binding MUST reject an object whose application payload,
envelope, sequence, or validity window cannot be checked under that
binding's deterministic rules.  This -00 does not define a generic raw
signature field beside JOSE or COSE.

## Object Types

Root trust program manifest:
: Defines the trust anchor: root public keys, the accepted
  signature-algorithm set for the root's subtree, the delegation
  policy (allowed operator types, maximum delegation depth),
  recognized assurance tiers, and status distribution points.  A
  separate future SCITT application binding can make selected root or
  governance statements transparent; a generic log field is not part
  of this template.  Verifiers MUST reject a
  signature algorithm outside the root's declared set; algorithm
  rotation and post-quantum migration are manifest updates under the
  existing sequence and validity machinery, with Ed25519 {{RFC8032}}
  as the illustrative baseline.  A root manifest defines the rules
  under which subordinate authorities can exist, not merely a key
  list.

Delegated operator manifest:
: Binds an operator to the root's delegation policy and scopes what
  the operator may issue.

Issuer record:
: Binds a specific issuer to keys, assurance attributes, and allowed
  policy scope.

Destination policy object:
: Defines authorized destinations and resolver behavior.  The
  policy MUST bind both the first-hop resolver and the final
  destination; otherwise a trusted-looking short URL can conceal an
  untrusted final destination.  An illustrative template:

~~~ json
{
  "object_type": "destination_policy",
  "policy_id": "policy:restaurant-12345:v3",
  "root_id": "qrtrust.example.root",
  "operator_id": "merchant-platform.example",
  "issuer_id": "restaurant-12345",
  "allowed_final_destinations": [
    { "scheme": "https",
      "host": "order.restaurant.example",
      "path_prefix": "/qr/" }
  ],
  "allowed_resolvers": [
    { "scheme": "https",
      "host": "qr.merchant-platform.example",
      "path_prefix": "/r/restaurant-12345/" }
  ],
  "allowed_redirect_hosts": [
    "qr.merchant-platform.example",
    "order.restaurant.example"
  ],
  "max_redirect_depth": 3,
  "prohibit_nested_shorteners": true,
  "require_https": true,
  "runtime_safety_required": true,
  "runtime_safety_ttl_seconds": 300
}
~~~

Status event and runtime-safety verdict:
: Updates issuer, key, policy, or destination state, or provides a
  time-bounded risk verdict for a resolver or final destination.
  A status event MUST be signed by a key on the subject's delegation
  path at or above the subject's parent, so that a subject whose
  only key is compromised can still be revoked from above.  A status
  event MUST carry an expiry no later than its issuance time plus
  the profile's maximum status-event lifetime, and its absence MUST
  NOT silently preserve positive trust when policy requires fresh
  status (invariants I4 and I7).  In a stream chained by
  previous_sequence, an observed gap is not a pass condition: it
  yields the sequence-gap cause in R_F at tier `warn` only while a
  declared appraisal grace bound remains, and `block` otherwise,
  since state continuity can no longer be shown.

Verifier cache entry:
: Records the local state used during scan-time validation: the
  exact source artifacts, hashes, sequence numbers, freshness
  windows, and verification profile used to compute the decision
  state.
  Without this record, later review cannot distinguish a correct
  warning from a stale positive result.

## Payload Trust Claim {#payload-claim}

The managed trust claim is the payload-side counterpart of the
governance objects.  A future binding needs at least these semantics:

- The claim identifies the issuing chain (root, operator, and issuer
  identifiers) and the signing key (key_id).

- The claim binds the exact destination carried in the payload,
  under the future binding's closed normalization profile, so that
  claim and payload cannot diverge.

- The claim is signed under a key bound by the issuer's record, with
  the selected envelope and application-payload rules of
  {{gov-objects}}.

- The claim can be embedded in the payload or detached (retrieved
  via a reference carried in the payload).  Within the selected
  binding, a verifier MUST NOT accept a detached claim unless it
  preserves the exact signed application payload octets and protected
  parameters required by that envelope.  Detached-claim
  retrieval is a pre-verification network fetch with the privacy
  properties of controlled resolution ({{privacy}}); embedded
  claims are RECOMMENDED where payload capacity allows.

Payload size in QR symbols is constrained, so compact encodings are
expected.  The later binding must measure this constraint before
choosing its carrier, application encoding, and envelope; this -00
does not select them.

# Verification Algorithm {#algorithm}

An implementation can evaluate a scan using the following eleven-step
pipeline.  The pipeline is informative: steps 1 through 9 illustrate
evidence acquisition and appraisal, step 10 invokes the normative
decision procedure, and step 11 emits its result.  Decision-semantics
conformance is defined by {{model}}, {{invariants}},
{{decision-states}}, {{decision-table}}, {{profiles}}, and the
conformance clause above, not by reproducing this pipeline:

1. Decode the captured artifact safely, without dereferencing
   anything; on failure, emit the D0 unreadable capture outcome.

2. Parse the payload and extract the destination and any managed
   trust claim (embedded or by reference).

3. Under the selected appraisal profile recorded in E, normalize the
   HTTP(S) destination's scheme, host, port, path, query, and
   internationalized-domain form.  This document does not pin an
   interoperable normalization profile; see {{normalization}}.

4. Evaluate R_I: claim signature, issuer record, delegation path,
   root acceptance, status.

5. Evaluate R_D: normalized destination and resolver against the
   signed destination policy.

6. Evaluate R_R: in trusted mode only, controlled resolution of the
   redirect chain in an isolated environment ({{operational}}).
   Outside trusted mode no resolution is performed and R_R has tier
   `not-applicable` with an empty cause list.

7. Evaluate R_S: obtain or consult the runtime-safety verdict for
   the final destination and resolver.

8. Evaluate R_F: validity windows, sequences, and clock skew for
   every consulted object (verdict freshness was handled in step 7).

9. Evaluate R_A: capture-side artifact analysis.  If analysis is
   unavailable, the appraisal binding assigns one permitted R_A tier
   and carries cause `analysis-unavailable`; Delta does not invent an
   additional unknown tier.

10. Apply the decision procedure Delta of {{decision-table}} under
    the active profile.

11. Emit (S, A, L, R, E): the state, ordered annotations, derived
    attention level, residual vector, and evidence set.

An illustrative emitted result for a destination-policy block:

~~~ json
{
  "state": "blocked",
  "profile": "strict-online",
  "issuer": {
    "root_id": "qrtrust.example.root",
    "operator_id": "merchant-platform.example",
    "issuer_id": "restaurant-12345",
    "assurance_tier": "verified_business"
  },
  "residuals": {
    "issuer_chain": "pass",
    "destination_policy": "fail",
    "redirect_flow": "pass",
    "runtime_safety": "pass",
    "freshness": "pass",
    "artifact_integrity": "pass"
  },
  "reasons": ["destination-not-authorized"],
  "user_message": "Destination not authorized. Do not continue."
}
~~~

## Destination Normalization and Matching {#normalization}

Step 3 cannot be an interoperable evidence-appraisal step until a
future binding pins one closed normalization and policy-matching
profile.  That binding needs to specify, at minimum: accepted schemes;
default-port handling; userinfo rejection; dot-segment processing;
percent-encoding and UTF-8 failure behavior; IDN version and mapping;
empty and trailing paths; fragment treatment; query separators, blank
values, duplicate keys, key/value decoding, and ordering; path-segment
boundary rules; and the residual tier produced by every parse or
normalization failure.

The present implementation illustrates converting scheme and host to lowercase,
removing default ports, resolving dot-segments, normalizing
percent-encoding under {{RFC3986}}, rejecting userinfo, exact host
comparison, and segment-aligned path-prefix comparison.  Those choices
do not become protocol requirements merely because one implementation
uses them.  Until a future binding closes the list above and publishes
matching test vectors, an implementation MUST NOT claim URI-policy or
wire interoperability from conformance to Delta alone.  Its appraiser
records the selected normalization profile and parameters in E before
assigning R_D.

These rules compare URI components; they do not resolve the host or
fetch the resource.  Controlled redirect resolution belongs to R_R,
runtime observations belong to R_S, and neither changes the meaning
of an R_D pass into a DNS, hosting, content, or navigation-integrity
claim.

# Operational Considerations {#operational}

Resolver sandboxing:
: Controlled resolution (step 6) MUST run in an isolated
  environment.  Its HTTP client sends no user cookies, authorization
  credentials, referrer, client certificates, or user identifiers;
  follows only the deployment's bounded HTTP(S) policy; and enforces
  strict time, byte, redirect-depth, concurrency, and rate budgets.
  Controlled resolution necessarily exposes the requested URL to its
  destination and is a network action with privacy consequences
  ({{privacy}}).

Trusted caches:
: Verifier caches hold only signed artifacts, verified before use,
  in protected state stores.  Cache entries record full provenance
  ({{gov-objects}}).  A cache the verifier cannot re-verify yields
  cache-unverifiable in R_F, never silent reuse.

Offline operation:
: bounded-offline supports scan-time decisions from pre-fetched
  signed state within freshness windows.  Expiry maps to R_F `warn`
  only inside a declared appraisal grace bound and to `block`
  otherwise; offline operation never extends a validity window.

Degraded providers:
: When a runtime-safety provider is unreachable or times out, R_S
  is "unavailable" and the profile rules of {{family-rs}} apply.
  When multiple providers disagree, the verifier records
  provider-disagreement and MUST NOT resolve the disagreement in
  favor of trust (invariant I7).

Decision lifetime and navigation binding:
: The outputs (S, A, L, R, E) are valid as of the evaluation time t
  only.
  It is RECOMMENDED that navigation bind to the outcome of
  controlled resolution -- navigating to the observed final URL
  rather than re-dereferencing the original payload -- or that the
  verifier re-evaluate on tap when more than a profile-defined
  bound has elapsed since t.  Re-dereferencing lets a resolver
  serve a different chain than the one evaluated; this residual
  divergence (a cloaking channel, {{privacy}}) cannot be fully
  closed and is named here rather than hidden.

# Privacy Considerations {#privacy}

The verifier sees every code a user scans; a careless design turns a
safety mechanism into a tracking mechanism.  Deployments SHOULD prefer,
in order: local verification against pre-fetched signed state; batch
status distribution that is independent of an individual scan; and
only then bounded, minimized per-scan queries.  Per-scan network
acquisition MUST be an explicit profile behavior disclosed to the user
or deployment operator, never a hidden default.  Scan-history click
analytics are not required by this document, and safety processing
SHOULD be separated from tracking or analytics.

The surveillance, correlation, and identification concerns of
{{RFC6973}} apply to every network interaction this document
introduces: status retrieval, runtime-safety queries, controlled
resolution, and detached-claim retrieval.  Deployments SHOULD
evaluate their design against that framework.

Each network action has a different minimum disclosure:

- Status retrieval SHOULD request a signed batch, epoch, or source
  update without sending the scanned destination, code identifier, or
  scan time.  The result is cached and verified locally.

- A runtime-safety query sends only the granularity the provider's
  declared contract requires.  Fragment components are never sent;
  path or query components are omitted unless the service actually
  evaluates them.  Before a query, bearer tokens and other user
  secrets are removed or the query is skipped.  The deployed profile
  MUST disclose whether it sends an origin, host, path, or query.

- Controlled resolution needs the target URL to observe its redirect
  behavior and therefore exposes that URL to the destination and
  intermediaries.  The isolated client sends none of the ambient user
  state prohibited in {{operational}}, and MUST NOT forward credentials
  learned from another hop.  Full hop URLs exist only transiently for
  appraisal and do not cross the logging boundary.  Because a path or
  query can itself contain a capability token, deployments MUST
  disclose this pre-navigation disclosure and define when controlled
  resolution is skipped for sensitive links.  A skipped required
  observation yields R_R `unavailable` with
  `resolution-unavailable`; it does not silently pass.

- Detached-claim retrieval sends the exact claim-reference URL to
  issuer-controlled infrastructure before verification.  It uses no
  user cookies, credentials, referrer, or ambient identifiers.  A
  unique or per-code reference remains a tracking identifier even when
  relayed, so embedded claims are RECOMMENDED where capacity permits
  and the behavior MUST be disclosed.

A shared proxy can hide the user's network address from a destination,
but it transfers visibility and availability trust to the proxy.  The
proxy can correlate users, destinations, claim references, and timing;
it does not anonymize a unique URL or destination identifier.  A
deployment that uses a proxy MUST disclose that trust transfer and
apply the same minimization and retention rules at the proxy.

Capture analysis is transient by default.  Raw images, video frames,
EXIF, physical surroundings, document contents, full URLs, query
strings, response bodies, and bearer credentials MUST NOT be retained
merely to satisfy invariant I6.  After appraisal, the default retained
record is P, the six residual records, `(S,A,L)`, evaluation time, the
appraisal implementation and rule versions, signed-object identifiers,
content digests and sequence/validity facts, and opaque references
needed to locate an authorized protected source.  That record is
sufficient to replay Delta without retaining the user's physical
context or re-running network acquisition.

When a deployment has a documented need to retain a sensitive source
artifact for re-appraisal, it MUST strip unrelated metadata, enforce
per-record size and retention limits, encrypt the artifact at rest,
restrict access, define deletion behavior including derived exports
and backups, and disclose the exception.  Local storage alone is not a
security control.

Logs and exports carry derived tiers, causes, and trace-scoped random
opaque identifiers, not raw captures or URLs.  A plain digest of a
guessable URL is not adequate redaction because it permits offline
confirmation.  If an explicitly justified use requires cross-trace
correlation, the identifier MUST use a keyed construction with access
control and key rotation; otherwise correlation scope ends with the
trace.

A single resolution vantage cannot reliably observe destinations
that discriminate by geography or user agent; multi-vantage
resolution reduces but does not eliminate this limit and increases the
number of parties that observe the request ({{security}}).

# Security Considerations {#security}

This entire document specifies security behavior; this section
addresses the threat model and residual risks.  The verifier
operates under these assumptions: accepted roots are chosen by local
policy; the verifier validates signed artifacts correctly; the
verifier's clock is within the appraisal profile's permitted skew; the
selected envelope and normalization rules are applied consistently;
and local state stores are protected.

The attacker can: print, replace, or overlay physical artifacts
(answered by R_A and D10); sign payloads under self-chosen keys
(D2, I1, I2); enroll under an accepted root, subject to that root's
vetting (I3, D5, D8, revocation via D3); change a payload URL or
redirect chain after issuance (R_D, R_R, D6, D7); change DNS,
hosting, or content behind an unchanged authorized URL (outside R_D,
with only bounded R_S coverage); serve the resolution vantage different
content than victims see (cloaking; {{privacy}} and the
residual-risk list below); and interfere with the network path to
status and safety providers -- delaying, blocking, or replaying
signed state but not forging signatures (R_F, I4, I7, D9).  A
network attacker who can only replay or suppress already signed state
gains at most the declared appraisal grace window: expiry maps R_F to
`warn` inside that bound and `block` after it, and rule D9 never lets
suppression preserve an unannotated positive.  An accepted malicious
signer is stronger and can issue fresh state; the split-view trace
below treats that case separately.  Each
vignette below pairs one of these capabilities with the answering
semantics.

Malicious issuer enrollment:
: An attacker enrolls under a root and issues signed codes for
  malicious destinations.  Enrollment vetting is a governance
  problem outside this document, but the semantics bound the damage:
  destination policies bind what the issuer may point to (I3),
  runtime safety can downgrade live abuse (D5, D8), and status
  events revoke (D3).

Unknown signed issuer:
: An attacker signs payloads under a self-chosen key hoping the
  signature icon itself creates trust.  The semantics assign this
  the "signed unaccepted issuer" state (D2), whose attention level
  is warning precisely because a bare signature indicator invites
  misplaced trust, and invariants I1 and I2 prevent any upgrade.

Destination drift:
: A once-legitimate payload is changed to carry a URL outside its
  issuer's current signed policy, or the issuer narrows that policy.
  R_D and R_F detect that URL-or-policy mismatch at scan time.  If
  DNS, hosting control, or content changes behind the same authorized
  URL, R_D still passes: current runtime-safety evidence may downgrade
  the result, but this document provides no continuity or content-
  integrity guarantee for that same-URL case.

Resolver and redirect abuse:
: Shorteners, open redirects, and nested resolution hide the final
  destination.  Policies bind the first-hop resolver and the final
  destination, and D7 blocks depth and intermediary abuse observed
  under controlled resolution.

Compromised legitimate destination:
: A destination inside policy is compromised after issuance.
  Runtime-safety verdicts are the mechanism designed for this
  window (D5, D8); their imperfection is a stated limitation, and
  I1 keeps them one-directional.

Stale trust state:
: An attacker exploits cached positive state after revocation.
  Against replay or suppression of fixed signed objects, freshness
  rules (R_F, D9, I4) bound the exposure window to the validity and
  appraisal-grace rules.  They do not bound a malicious authorized
  signer that keeps issuing fresh objects.

Artifact tampering:
: Physical overlays, added symbols, or manipulated print artifacts
  substitute the attacker's payload.  R_A supplies capture-side
  evidence; D10 blocks only when an appraisal binding has assigned
  R_A `block`, while lower tiers annotate or downgrade.  This
  document does not label a visual pattern unambiguous without that
  binding.

Trust-infrastructure compromise:
: A compromised root, operator, or issuer key is the
  highest-impact threat.  The semantics support rotation and
  revocation through status events and sequence rules, and root
  isolation (I5) confines cross-root blast radius; incident
  response and root-scoped distrust remain governance obligations.
  Rotation alone does not terminate a compromised superseded key:
  the payload's `issued_at` is asserted by the same key that signs
  the payload, so the holder can sign after rotation while claiming
  an earlier time inside the retired key's window.  Without an
  independent issuance-time witness (for example, a timestamp
  authority, transparency record, or countersigned issuance record),
  the verifier cannot distinguish that artifact from one genuinely
  issued before rotation.  Suspected compromise therefore requires
  revocation; rotation is routine lifecycle hygiene, not an incident-
  response substitute.

Malicious accepted root:
: Accepting a root is a full trust delegation for that root's
  subtree.  A malicious or coerced accepted root can mint issuers,
  policies, and status events at will, and the semantics cannot
  detect this from inside the subtree: the model is defeated for
  everything under that root.  Acceptance is therefore a local
  policy decision rather than a global list.  I5 confines every root to
  its own subtree, and a later binding can use SCITT receipts as
  equivocation evidence ({{gov-objects}}).  Expiry
  does not contain this attacker: the root can refresh both sides of a
  split view before each window closes.  Recovery requires the local
  trust policy to distrust or remove that root and distribute the
  change to affected verifiers.  Transparency can expose evidence for
  that decision but does not make it automatically.

## Hostile Split-View Trace

This trace distinguishes fixed-object replay from continuous fresh
equivocation by an accepted root:

1. At t0, verifiers A and B accept root K under local policy.
2. At t1, K signs issuer state X for A and contradictory state Y for B.
   Both objects identify the same subject and are valid until t1+H.
3. Before t1+H, K signs fresh successors X2 and Y2 with later sequence
   values inside each view.  K repeats this before every expiry.
4. A and B each observe a fresh, internally monotonic history, so Delta
   can continue to accept each local R_I input.  Even if one verifier
   later obtains both same-root views, D13 MUST NOT be used: its
   `cross-root-contradiction` tier concerns different accepted roots.
   This version supplies no automatic same-root arbitration; the
   evidence instead informs local root-distrust policy.
5. If statements are registered through a future SCITT binding and a
   monitor compares the histories, the receipts can prove that
   contradictory statements were registered.  That evidence does not
   revoke K or change Delta by itself.
6. At t2, local policy removes K and distributes that trust-anchor
   change.  Only then do affected verifiers stop accepting newly signed
   descendants of K.  A verifier that never receives the local policy
   change can remain deceived.

If K stops signing after step 2, expiry plus R_F does bound the fixed
objects.  The unconditional time-bound claim fails specifically at
step 3, where an authorized malicious signer creates fresh evidence.

Resource exhaustion:
: Oversized objects, deep chains, and floods of governance state
  can exhaust a verifier.  Verifiers SHOULD enforce size, count,
  and cache quotas; exceeding a quota yields "unavailable" (or
  cache-unverifiable in R_F) and follows the insufficiency rules --
  degraded verification is never fail-open (I7).

Residual risks include cloaking against the resolution vantage
({{privacy}}), probabilistic artifact analysis, imperfect
runtime-safety providers, and every institutional assumption listed
in {{scope-and-non-goals}}.  The invariants are stated for
machine-checkable review, but this document does not claim a
mechanized proof of them.

## Downgrade to Unverified {#downgrade}

The attack this document's own motivating examples begin with -- an
unsigned sticker covering a signed table tent -- lands in the
neutral "unverified" state, not in a warning or block.  This is a
structural limit shared by every opt-in trust marking from EV
certificates to BIMI: the absence of a claim is unauthenticatable,
and no verifier can prove that a claim should have been present.
The semantics guarantee the downgrade terminates in a bounded
neutral state rather than a spoofable positive one (I1, I2), and
capture-side evidence can catch the physical form of the attack
  (R_A: overlay detection and conflicting symbols; D10 when appraisal
  assigns `block`).  Deployments supply the remaining countermeasures:

- In open consumer scanning, the defense is the salience of the
  neutral state itself.  User-interface treatments SHOULD make
  "unverified" visibly distinct from every positive and
  issuer-verification state, and the cited scanner-interface studies
  ({{KOWALEWSKI}}, {{SEQR}}) document how weak unaided recognition
  is -- salience is a measured requirement, not a nicety.

- Deployments that control their surfaces (enterprise gateways,
  document workflows, venue-managed placements) SHOULD declare a
  signed-only posture using the stricter-posture allowance of the
  conformance clause ({{profiles}}): treat "unverified" as blocked
  where every legitimate code is known to carry a claim.  There the
  downgrade attack converts to a hard failure.  A future appraisal
  binding can additionally define a signed-workflow policy that
  assigns R_A `block` for specified tampering evidence; only then does
  D10 turn that classified evidence into a block.

# IANA Considerations

This document has no IANA actions.

If this work is adopted and progressed, registries could be
considered for residual cause identifiers ({{families}}), decision
states ({{decision-states}}), verification profile identifiers
({{profiles}}), and governance object types ({{gov-objects}}).
Extensions to the profile enumeration, residual causes, decision
states, or object types are expected to arrive via future
documents, potentially creating those registries.  No registry is
requested at this time.

# Implementation Status {#impl-status}

This section records the status of a known implementation at the
time of posting, on the model of {{RFC7942}}; it is to be removed
before any publication as an RFC.

The claim-to-artifact map separates evidence produced by different
snapshots.  Public paths are pinned to immutable Git commits; the private
row records implementation activity but supplies no independent
reproducibility claim.

~~~
Claim                 Reference           Availability
Decision evaluation   trust-residuals-v1  public
Projection and policy 78b86               public
Candidate and E1/E2   c994911             private
~~~

**Historical decision-core evaluation.**  Public tag
`trust-residuals-v1`, commit
[35c5bf9](https://github.com/unixtime/qr-trust-poc/tree/35c5bf9ed07e753f95ed23bf9bf8c7603af9980a),
contains the
[decision core](https://github.com/unixtime/qr-trust-poc/blob/35c5bf9ed07e753f95ed23bf9bf8c7603af9980a/backend/app/services/trust_residuals_decision.py),
[evaluation](https://github.com/unixtime/qr-trust-poc/blob/35c5bf9ed07e753f95ed23bf9bf8c7603af9980a/scripts/trust_residuals_evaluation.py),
[corpus](https://github.com/unixtime/qr-trust-poc/blob/35c5bf9ed07e753f95ed23bf9bf8c7603af9980a/docs/public/evaluation/trust_residuals_corpus.v1.json),
and
[results](https://github.com/unixtime/qr-trust-poc/blob/35c5bf9ed07e753f95ed23bf9bf8c7603af9980a/docs/public/evaluation/trust_residuals_results.v1.json).
The 37-case corpus reports no semantic or residual mismatch, unsafe
positive, or attention undercut.  A modeled sweep compares 6,912 residual
vectors under five profiles and all 64 mandatory-family subsets, producing
2,212,160 comparisons with no disagreement against a separately encoded
decision table.  These results do not measure field effectiveness or
independent producer/consumer interoperability, and they predate the
current D0 result shape.

**Public trust projection and URL-policy implementation.**  Public commit
[78b86](https://github.com/unixtime/qr-trust-poc/tree/78b86fe90ac812573eaed56ec9e44e70836bfbf9):
[trust projection](https://github.com/unixtime/qr-trust-poc/blob/78b86fe90ac812573eaed56ec9e44e70836bfbf9/backend/app/services/trust_projection.py),
[scanner trust store](https://github.com/unixtime/qr-trust-poc/blob/78b86fe90ac812573eaed56ec9e44e70836bfbf9/backend/app/services/scanner_trust_store.py),
[payload policy](https://github.com/unixtime/qr-trust-poc/blob/78b86fe90ac812573eaed56ec9e44e70836bfbf9/backend/app/services/payload_revalidation_poc.py),
and
[redirect policy](https://github.com/unixtime/qr-trust-poc/blob/78b86fe90ac812573eaed56ec9e44e70836bfbf9/backend/app/services/redirect_policy_poc.py).
These files support inspection of the projection and pure URL-policy logic.
The commit predates the E1/E2 lifecycle record and cannot reproduce those
experiments.

**Current candidate semantics, response contract, and E1/E2 record.**  The
private/pre-publication Git object is
`c994-911e-4985-0a44-31f1-b776-695d-9201-9b9c-fa04`, with display hyphens
removed when resolving it.  Its current decision core, corpus, results,
projection, trust store, `key_lifecycle_evidence.v1.json`, and lifecycle
experiment program are not publicly retrievable at posting and therefore
provide no independent reproduction claim.  Measured comparisons against
decode-only, HTTPS-only, signature-only, and reputation-only baselines appear
in {{RESIDUALS}}.

The private candidate separates unreadable capture as D0, carries the
authoritative result in `model_decision`, and keeps product labels such as
`signed_unknown_issuer` in a compatibility field.  It rejects attention
undercuts, unmapped product states, and corpus cases containing both D0 and
trust-decision result shapes.  The Python response and network schema expose
a closed 29-value subset of the cause identifiers in this document.  The
TypeScript network scanner does not emit `model_decision` and remains outside
this conformance claim.

The proof-of-concept does not implement a live redirect observer.  A
fixture evaluator models R_R from synthetic `final`, `hops`, and
`nested` values; these are not HTTP observations.  For an enrolled
resolver, the runtime reports R_R as `unavailable` with cause
`resolution-unavailable`, returns product state `unknown`, and disallows
opening.  The R_R evidence covers decision mapping and modeled policy,
not controlled resolution, DNS behavior, or redirect acquisition.

The Python destination matcher performs only URL-policy logic:
its inputs are the payload URL, verified-domain state, evaluation time,
and policy fixture.  It performs no DNS resolution or resource fetch
and receives no hosting, response-content, or post-navigation evidence.
The reference implementation therefore makes no such claim from an R_D
pass.

Two local experiments exercise the Postgres-backed trust projection.  In
E1, an artifact verified while its key was active and retired, became
blocked at the `key_status` stage after revocation, and remained blocked
after an operator-observed API restart with Postgres left running.  The
run captured no container identity or restart receipt, so it is not a
machine-verifiable restart attestation or longitudinal field evidence.

In E2, the experiment program rotated a key and then used its retained
private half to sign a new artifact while self-asserting an `issued_at`
seven days earlier, inside the key window.  The retired-key artifact
verified; the same artifact became blocked after the key was revoked.
This confirms
the limitation described in {{security}}: the current profile has no
independent issuance-time witness, so rotation does not defend against
a compromised superseded key that backdates a new artifact.  The
selected-field record and source digests are stored in
`docs/public/evaluation/key_lifecycle_evidence.v1.json` at private commit
`c994911`.  E1 and E2 remain operator-run observations until that record is
publicly retrievable; neither public reference in the table contains it.
Full trust-store dumps and private key material are excluded.

--- back

# Acknowledgments {#acknowledgments}
{:numbered="false"}

This document distills the decision semantics developed in the
author's companion research papers {{QRTRUST}} {{RESIDUALS}}.
ChatGPT, Claude Code, and Codex assisted with code-path inspection,
draft preparation, and adversarial review.  The author selected the
claims, verified the cited sources and implementation evidence, and is
responsible for the content.
