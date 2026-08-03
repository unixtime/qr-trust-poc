# Figure 3 ASCII Reference

Source figure:
- `Figure 3` in the [published QR trust paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- visual asset: [TRUST_MODEL_GRAPH.svg](./TRUST_MODEL_GRAPH.svg)

This ASCII version captures the conceptual relationships the figure is supposed to express.

Important semantic rules:
- `Trust onboarding` is not downstream of all trust layers.
- onboarding constrains `issuer legitimacy` and `destination binding`, and can permit runtime monitoring through consent and policy
- `runtime safety` remains a separate operational signal, not an onboarding result
- `QR can be created anywhere` stays separate from trust enrollment; generator is not trust root
- scanner-visible outcomes should use the same wording as the paper:
  - `signed, unaccepted issuer`
  - `verified issuer, destination risky`

```text
Trust-Model Relationship Graph
------------------------------

+-------------------------------+        +----------------------------------+
| Research base                 | -----> | Core architecture                |
| Observed problem              |        | Trust model                      |
| - QR phishing                 |        | - trust is a managed signal      |
| - weak scanner UX             |        | - not a property of decoding     |
| - narrow-domain standards     |        | - generation and enrollment      |
| - no consumer trust layer     |        |   are separate                   |
+-------------------------------+        +----------------------------------+
                                                     |             |             \
                                                     |             |              \
                                                     v             v               v
                                           +----------------+ +----------------+ +----------------+
                                           | Layer 1        | | Layer 2        | | Layer 3        |
                                           | Issuer         | | Destination    | | Runtime        |
                                           | legitimacy     | | binding        | | safety         |
                                           +----------------+ +----------------+ +----------------+
                                                     ^             ^               ^
                                                     |             |               |
                                                     |             |               |
                                   +-----------------------------------------------+
                                   | Trust onboarding                              |
                                   | - issuer proofing                             |
                                   | - approved destinations                       |
                                   | - monitoring consent                          |
                                   | - revocation / status rules                   |
                                   +-----------------------------------------------+
                                                     |
                                                     | constrains who can receive
                                                     | trust treatment
                                                     |
+-------------------------------+                    v                    +----------------------------------+
| Generation side               | -------------------------------------> | Decision engine                  |
| QR can be created anywhere    |                                         | Scanner combines signals         |
| - merchant dashboard          |                                         | issuer legitimacy + destination  |
| - CMS plugin                  |                                         | binding + runtime safety         |
| - script / app / platform     |                                         | -> user-facing state             |
| Generator is not trust root   |                                         +----------------------------------+
+-------------------------------+                                                      |
                                                                                       v
                                                                    +----------------------------------+
                                                                    | Scanner outcomes                 |
                                                                    | User-visible trust states        |
                                                                    | - unverified                     |
                                                                    | - signed, unaccepted issuer      |
                                                                    | - verified issuer                |
                                                                    | - verified issuer, destination   |
                                                                    |   risky                          |
                                                                    | - blocked                        |
                                                                    +----------------------------------+
                                                                                       |
                                                                                       v
                                                                    +----------------------------------+
                                                                    | Critical gap                     |
                                                                    | Without adoption                 |
                                                                    | Native scanners remain decoders. |
                                                                    | Users still get URLs, not trust. |
                                                                    +----------------------------------+
```
