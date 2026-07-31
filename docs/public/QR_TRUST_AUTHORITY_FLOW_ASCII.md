# Figure 2 ASCII Reference

Source figure:
- `Figure 2` in the [published QR trust paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- visual asset: [QR_TRUST_AUTHORITY_FLOW.svg](./QR_TRUST_AUTHORITY_FLOW.svg)

This ASCII version captures the intended governance semantics. It is the reference to use when refining the Figma version.

```text
Governance and Validation Flow for QR Trust
-------------------------------------------

Governance / delegation
-----------------------

                              +---------------------------+
                              | Root trust program        |
                              | - root keys               |
                              | - accreditation rules     |
                              | - delegation policy       |
                              | - distribution endpoints  |
                              +---------------------------+
                                   |            |            |
                                   | delegates  | delegates  | delegates
                                   v            v            v
                      +----------------+ +----------------+ +-----------------------------+
                      | Payment        | | Government /   | | Merchant / enterprise      |
                      | operator       | | public service | | operator                   |
                      | delegated tree | | delegated tree | | delegated tree             |
                      +----------------+ +----------------+ +-----------------------------+
                               \             |             /
                                \ enroll / govern issuer /
                                 v                      v
                         +--------------------------------------+
                         | Enrolled issuer node                 |
                         | - issuer identifier                  |
                         | - assurance tier                     |
                         | - key refs                           |
                         | - approved domains / resolvers / app |
                         +--------------------------------------+
                                            |
                                            | issues
                                            v
                         +--------------------------------------+
                         | Signed QR artifact                   |
                         | - issuer reference                   |
                         | - destination / resolver claims      |
                         +--------------------------------------+

Shared state publication
------------------------

+---------------------------+          publishes         +--------------------------------------+
| Root trust program        | -------------------------> | Signed artifacts / shared state      |
+---------------------------+                            | - delegation manifests               |
                                                         | - issuer manifests                   |
+---------------------------+          publishes         | - destination policy updates         |
| Delegated operators       | -------------------------> | - revocation / suspension events     |
+---------------------------+                            | - freshness metadata                 |
                                                         +--------------------------------------+

State synchronization and validation
------------------------------------

+--------------------------------------+      sync / cache      +--------------------------------------+
| Signed artifacts / shared state      | ---------------------> | Scanner / verifier cache             |
+--------------------------------------+                        | - root / operator state              |
                                                                | - issuer state                       |
                                                                | - destination policy state           |
                                                                | - revocation / freshness state       |
                                                                +--------------------------------------+
                                                                                  |
                                                                                  | provides current state
                                                                                  v
                                            +--------------------------------------+
                                            | Verifier decision path               |
                                            | 1. validate root -> authority ->     |
                                            |    issuer chain                      |
 +--------------------------------------+   | 2. validate issuer status / tier     |
 | Signed QR artifact                   |-->| 3. validate current destination /    |
 +--------------------------------------+   |    resolver policy                   |
                                            | 4. check runtime safety freshness    |
                                            |    or query                          |
                                            | 5. apply local policy and emit trust |
                                            |    state                             |
                                            +--------------------------------------+
```

Critical semantic rule:
- `Signed artifacts / shared state -> Scanner / verifier cache -> Verifier decision path`
- `Signed QR artifact -> Verifier decision path`

The QR artifact is a scan-time input. It is not the same thing as cached trust state.
