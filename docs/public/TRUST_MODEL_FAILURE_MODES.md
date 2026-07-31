# Trust Model Failure Modes And Objections

Date: 2026-04-12

Purpose:
- challenge the current trust-model graph with realistic objections
- identify where the model breaks first
- separate solvable engineering problems from ecosystem or governance blockers

## Reading Rule

This document is not a rejection of the trust model.

It is a pressure test of the assumptions in:
- [TRUST_MODEL_GRAPH.md](./TRUST_MODEL_GRAPH.md)
- [TRUST_MODEL.md](./TRUST_MODEL.md)

## Main Objection

The model is internally coherent.

The real risk is not internal coherence. The real risk is that the model asks for coordination, incentives, and governance that the market may never provide.

## Failure Modes By Graph Area

## 1. Enrollment Authority

### Failure mode

No one credible wants to operate the root trust program for ordinary QR destinations.

### Why this matters

The graph assumes an enrollment authority exists and that scanners trust it.

If that node fails:
- trust tiers collapse
- issuer verification collapses
- the scanner falls back to URL display plus generic warnings

### Objection

Why would Apple, Google, or anyone else accept the liability of deciding which small business, freelancer, or individual gets a trusted QR badge?

### Likely result

Adoption stalls at:
- enterprise
- payments
- closed ecosystems

Not broad consumer web QR.

## 2. Issuer Onboarding

### Failure mode

Identity proofing is too expensive or too invasive for ordinary users.

### Why this matters

If onboarding is hard:
- normal people do not enroll
- most public QR codes remain unverified
- the trust signal becomes rare and possibly ignored

### Objection

A music teacher or food truck owner may not want to submit business paperwork, identity documents, or monitoring consent just to post a QR flyer.

### Likely result

The model works only where:
- the issuer already has a platform account
- the issuer already tolerates verification

Such as:
- payment providers
- app stores
- enterprise portals
- established merchant platforms

## 3. Privacy Resistance

### Failure mode

Users reject trusted QR because they do not want public identity disclosure or platform tracking.

### Why this matters

The model assumes trust can be separated from full identity exposure.

That may be true technically, but users may still distrust:
- registration
- logging
- monitoring
- platform mediation

### Objection

"Why do I need to register with a platform to post a flyer?"

### Likely result

The system becomes:
- optional
- niche
- concentrated in regulated or commercial use cases

## 4. Monitoring Consent

### Failure mode

Website owners resist runtime scanning, or the legal line between passive checks and active analysis becomes contentious.

### Why this matters

The model assumes runtime safety can be layered on top of issuer validation.

But runtime safety implies:
- fetching pages
- inspecting behavior
- possibly executing content

### Objection

"You can verify my QR binding, but you do not have permission to continuously inspect my site."

### Likely result

The runtime safety layer becomes:
- shallow
- opt-in only
- inconsistent across issuers

Which weakens the scanner’s claims.

## 5. Compromised Legitimate Destinations

### Failure mode

A trusted issuer and approved destination exist, but the page is compromised after issuance.

### Why this matters

This is one of the strongest reasons the trust model exists.

But it also shows its limit:
- issuer trust does not equal page safety

### Objection

If a site is compromised for only a few hours, how quickly can the system detect it, update policy, and warn scanners?

### Likely result

There will be windows where:
- the issuer remains verified
- the QR remains correctly bound
- the site is still unsafe

This is a hard operational gap, not a conceptual one.

## 6. False Positives

### Failure mode

Runtime safety or destination policy blocks legitimate QR flows.

### Why this matters

If legitimate small businesses get false warnings:
- trust in the scanner drops
- support burden rises
- platform operators become conservative

### Objection

A temporary CDN redirect, a new subdomain rollout, or benign third-party scripts might look risky.

### Likely result

Operators may weaken the policy until it becomes too soft to matter.

## 7. False Negatives

### Failure mode

Malicious or compromised destinations appear clean long enough to pass.

### Why this matters

Attackers only need the system to miss them for a short period.

### Objection

What if the attacker:
- compromises a real business site
- avoids obvious redirects
- hosts phishing directly on the approved URL

### Likely result

The scanner may still show:
- verified issuer
- approved destination

while the user is at risk.

## 8. Raw QR Majority

### Failure mode

Most QR codes in the real world remain outside the trust program.

### Why this matters

The model assumes trust is additive, not mandatory.

That is realistic, but it creates a scale problem:
- the average user still mostly scans unverified QR codes

### Objection

If most QR codes remain unverified, users may habituate to warnings and ignore the trust state entirely.

### Likely result

The trust UX only helps in high-value ecosystems, not public QR generally.

## 9. Native Scanner Bypass

### Failure mode

Users keep using the built-in camera behavior that just opens links.

### Why this matters

Without platform integration:
- the trust model has no control over the default scan path

### Objection

Why would users install a special scanner if their phone camera already scans QR codes?

### Likely result

The whole model depends on:
- Apple / Google / browser integration

Without that, it stays a reference implementation.

## 10. Fragmented Trust Roots

### Failure mode

Different ecosystems run incompatible trust programs.

### Why this matters

The graph assumes scanners can consume a coherent trust result.

In practice, there may be:
- merchant trust programs
- enterprise trust programs
- government trust programs
- platform trust programs

### Objection

If each platform trusts different issuers, the same QR may appear:
- verified on one scanner
- unknown on another

### Likely result

User trust fragments instead of consolidating.

## 11. Incentive Misalignment

### Failure mode

The parties who benefit are not the parties who bear the cost.

### Why this matters

Who pays for:
- onboarding
- monitoring
- support
- revocation handling
- appeals

### Objection

Small issuers may not pay. Platform vendors may not want the liability. Security vendors may want a market, but not root responsibility.

### Likely result

The model stalls unless tied to an existing commercial or regulated workflow.

## 12. Governance Capture

### Failure mode

The trust authority becomes a gatekeeper that large vendors can navigate but small actors cannot.

### Why this matters

A trust program can improve safety and still produce unfair market power.

### Objection

Does this become "pay to be trusted" for QR codes?

### Likely result

The system may face:
- antitrust criticism
- fairness criticism
- public resistance

## 13. Appeals And Recovery

### Failure mode

Revoked or mistakenly blocked issuers cannot recover fast enough.

### Why this matters

Trust systems fail if corrections are too slow.

### Objection

A small business wrongly blocked on a Saturday loses real revenue immediately.

### Likely result

A trust program without rapid remediation becomes politically and commercially fragile.

## 14. Offline Or Low-Connectivity Use

### Failure mode

The scanner cannot reach status or runtime safety services.

### Why this matters

The graph assumes live checks or recent state.

### Objection

What does the scanner do:
- offline
- in a subway
- at a bad event venue
- in another country

### Likely result

The system needs:
- stale-cache policy
- degraded-trust states
- clear UX for uncertainty

## 15. Abuse Through “Trusted” Social Engineering

### Failure mode

A legitimately enrolled issuer intentionally publishes manipulative but technically policy-compliant destinations.

### Why this matters

A trust model can validate authenticity without validating ethics or user welfare.

### Objection

What if the issuer is real, enrolled, and policy-compliant, but still designs harmful dark patterns?

### Likely result

Trust badges may over-signal safety beyond what the system can really guarantee.

## The Hardest Objections

The strongest objections are not about cryptography.

They are:
- who runs the trust program
- who pays for it
- who accepts liability
- how much identity and monitoring users will tolerate
- whether platform vendors will ever integrate it into default scanners

## What Still Looks Viable

Despite the objections, the model still looks strongest in:
- payments
- enterprise
- education
- government and regulated services
- merchant ecosystems with existing onboarding

It looks weakest in:
- open public consumer web QR for unregistered individuals

## Practical Conclusion

The model is technically coherent.

The main threat is ecosystem non-adoption, not internal contradiction.

That means the next strategic question is not:
- "is the model logically complete?"

It is:
- "which deployment slice has enough incentive and enough tolerance for enrollment to adopt this first?"
