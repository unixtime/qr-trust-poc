# Quishing threat evidence

QR code phishing — *quishing* — is the attack this project's trust model exists
to answer. This brief records what is verifiable about its scale and mechanics,
with every figure traced to a named first-party source.

**Figures as of Q1 2026 (January–March), published 30 April 2026.** This is a
dated snapshot. When newer primary telemetry lands, the figures and this stamp
are updated together.

## Why this brief exists

The QR trust problem is usually argued from first principles: a decode is not a
trust decision, so a scanner that only decodes cannot tell a user whether a
destination is safe. That argument stands on its own. What it does not show is
whether anyone is actually exploiting the gap.

They are, at scale, and the trend runs opposite to the phishing category that
contains it.

## What the telemetry shows

Microsoft's Q1 2026 email threat landscape report covers roughly 8.3 billion
email-based phishing threats detected between January and March 2026. Inside
that total, two things move in opposite directions.

| Figure | Value | Period |
|---|---|---|
| Total email phishing threats | ~8.3 billion | Q1 2026 |
| Monthly email phishing volume | 2.9B → 2.6B | January → March 2026 |
| QR phishing threats, January | 7.6 million | January 2026 |
| QR phishing threats, March | 18.7 million | March 2026 |
| QR phishing growth | +146% | across Q1 2026 |
| QR month-over-month change | −35%, +59%, +55% | January, February, March |
| QR codes delivered in the email body | +336% | March 2026 |
| Link-based share of all email threats | 78% | Q1 2026 |
| Malicious payload share | 19% → 13% | January → February/March |

Overall email phishing volume **fell** about 10% across the quarter — 2.6
divided by 2.9 is 0.897 — while QR phishing **rose 146%**, from 7.6 million
detections in January to 18.7 million in March. March was QR phishing's highest
monthly volume in at least a year.

Two clarifications that circulating summaries get wrong. First, the 146% figure
is quarter-over-quarter growth *within* Q1 2026, not a year-over-year
comparison. Second, "highest monthly volume in at least a year" describes QR
phishing; CAPTCHA-gated attacks are a separate series that fell through
January and February before rising 125% in March.

February QR volume is not stated outright. It is derivable from the published
month-over-month deltas: 7.6 million × 1.59 ≈ 12.1 million, and 12.1 million ×
1.55 ≈ 18.7 million, which reconciles with the published March figure. Anywhere
that derived value appears it is labelled as derived.

### Why the divergence is the finding

A rising number in isolation says little — attack volumes rise and fall with
campaign cycles. A subset rising 146% while its parent category falls 10% is a
different claim: attackers are *reallocating* effort toward this vector, and
they are doing so while the defences that catch text links are working well
enough to push the parent number down.

Microsoft states the reason plainly:

> By embedding malicious URLs within image-based QR codes in the body of an
> email or within the contents of an attachment, threat actors attempt to
> exploit the limitations of text-based scanning engines and redirect victims to
> phishing sites on unmanaged mobile devices.

Two properties of the vector are doing the work. A QR code is an image, so a
text-based scanning engine has nothing to parse. And a QR code is scanned with a
phone, which moves the victim off a managed corporate endpoint and onto a device
where enterprise controls typically do not reach. PDF attachments were the
preferred delivery method throughout the quarter, with in-body delivery growing
336% in March.

## How the attack runs: the FBI's ATT&CK chain

In January 2026 the FBI published FLASH alert AC-000001-MW (TLP:CLEAR),
documenting North Korean Kimsuky actors using malicious QR codes in
spearphishing campaigns against U.S. entities: NGOs, think tanks, academia, and
foreign-policy experts with a North Korea nexus, alongside U.S. and foreign
government entities. The activity is dated "as of 2025"; the advisory is dated
8 January 2026.

The FBI's definition:

> Quishing (QR Code Phishing) is a phishing technique in which adversaries embed
> malicious URLs inside QR codes to force victims to pivot from their corporate
> endpoint to a mobile device, bypassing traditional email security controls.

The advisory maps the campaign to six MITRE ATT&CK techniques in sequence.

| Step | Technique | What happens |
|---|---|---|
| 1 | T1660 | A spearphishing message embeds the malicious URL inside a QR code, so the link never appears as text a scanning engine can read. |
| 2 | T1598 / T1589 | The first hop is a redirector that collects user-agent, operating system, IP address, locale, and screen size before deciding what to serve. |
| 3 | T1056.003 | Web Portal Capture: a mobile-optimised credential page impersonating Microsoft 365, Okta, or a VPN portal takes the login. |
| 4 | T1550.004 | The stolen session token is replayed, so the second factor the victim already satisfied is bypassed rather than defeated. |
| 5 | T1098 | Account manipulation keeps access alive after a password rotation. |
| 6 | T1566 | Lateral phishing runs from the victim's own mailbox, so the next wave arrives from a real, trusted internal sender. |

MITRE tracks the actor as G0094 (Kimsuky; also APT43, Black Banshee, Velvet
Chollima, Emerald Sleet, THALLIUM, TA427, Springtail, Earth Kumiho,
PatheticSlug), affiliated with North Korea's Reconnaissance General Bureau. The
technique entry for T1660 records the behaviour directly:

> Kimsuky has also leveraged QR codes (also known as Quishing) to evade URL
> inspection and to direct victims from their corporate host devices to mobile
> devices.

T1660 entered ATT&CK in v14, covering smishing, quishing, and vishing together.

## What this means for QR trust

Steps 1 and 2 of that chain both happen before any credential is typed, and
both are invisible to the user. The QR code renders identically whether it
resolves to a payroll portal or a redirector that fingerprints the device. The
scan itself is the decision point, and at that point a decode-only scanner has
nothing to offer but the decoded string.

That is the same gap the trust model addresses, arriving from the attacker's
side: issuer legitimacy is unestablished, destination binding is absent, and
runtime safety is unevaluated. The chain's first two steps are exactly the
window a scanner-side trust decision closes.

## Sources

### Tier 1 — primary sources

- Microsoft Security Blog, "Email threat landscape: Q1 2026 trends and
  insights", published 30 April 2026.
  <https://www.microsoft.com/en-us/security/blog/2026/04/30/email-threat-landscape-q1-2026-trends-and-insights>
- FBI FLASH AC-000001-MW (TLP:CLEAR), 8 January 2026, "North Korean Kimsuky
  Actors Leverage Malicious QR Codes in Spearphishing Campaigns Targeting U.S.
  Entities". <https://www.ic3.gov/CSA/2026/260108.pdf>
- MITRE ATT&CK, T1660 — Phishing (Mobile).
  <https://attack.mitre.org/techniques/T1660>

### Tier 2 — industry telemetry, cited with named attribution

Mimecast, reported through the Anti-Phishing Working Group, counted 635,672
unique malicious QR codes in Q2 2025 and 716,306 in Q3 2025, a 13% quarterly
rise, and put QR codes in roughly 12% of 2025 phishing attacks. APWG's own
totals were 3,759,576 phishing attacks in 2024 and approximately 3.8 million
across 2025. These are vendor and consortium telemetry rather than primary
platform disclosure, so they support the direction of travel here without
carrying any figure on their own.

### Sources considered and rejected

Year-over-year quishing growth circulates as +25% (Hoxhunt), +331% (Cofense),
and +400% for 2023 to 2025 (Abnormal Security). These are mutually
irreconcilable — they cannot all describe the same quantity — and none is a
primary telemetry disclosure with a stated methodology. Aggregator round-ups
(Keepnet, StationX, Astra) recycle these same numbers from each other without
tracing them to a first-party report.

They are recorded here as rejected rather than omitted, because the alternative
is worse: a gap in the data filled with an unsourced statistic is precisely how
figures like these enter circulation in the first place. Where this brief has no
primary source, it says so.
