# Figure 1 ASCII Reference

Source figure:
- `Figure 1` in the [published QR trust paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- visual asset: [QR_TRUST_PROBLEM_DIAGRAM.svg](./QR_TRUST_PROBLEM_DIAGRAM.svg)

This ASCII version is the semantic reference for the figure. It prioritizes flow and box relationships over exact layout.

```text
QR Code Security Is a Trust Problem
----------------------------------

+-----------------------------------+     +-----------------------------------+     +-----------------------------------+
| What scanners do today            | --> | What the industry keeps focusing  | --> | What users actually need          |
| Convenience pipeline              |     | on                                |     | Trust questions                   |
| 1. Detect QR                      |     | Integrity layer                   |     | 1. Who issued this code?          |
| 2. Decode payload                 |     | - signed payloads                 |     | 2. Is the issuer trusted?         |
| 3. Surface URL or app intent      |     | - certificate checks              |     | 3. Is destination still approved? |
| 4. Let the user absorb the risk   |     | - HTTPS transport                 |     | 4. Is opening it safe right now?  |
|                                   |     | - cleaner warning UI              |     |                                   |
+-----------------------------------+     +-----------------------------------+     +-----------------------------------+
              |                                         |                                         |
              v                                         v                                         v
   +-------------------------------+          +-------------------------------+          +-------------------------------+
   | Failure                       |          | Limit                         |          | Consequence                   |
   | Successful decoding is        |          | A QR can be syntactically    |          | Trust is a managed platform   |
   | mistaken for trust.           |          | valid, cryptographically      |          | signal, not a property of     |
   | The scanner answers           |          | valid, and still unsafe.      |          | successful decoding.          |
   | "what is this?" but not       |          |                               |          |                               |
   | "should I trust it?"          |          |                               |          |                               |
   +-------------------------------+          +-------------------------------+          +-------------------------------+

Required trust stack
--------------------

+---------------------------+     +---------------------------+     +---------------------------+     +------------------------------+
| 1. Issuer legitimacy      | --> | 2. Destination binding   | --> | 3. Runtime safety         | --> | 4. Scanner decision UX      |
| Who is authorized to      |     | Is the QR still bound to |     | Is the destination safe   |     | User-visible outcomes       |
| issue this QR under a     |     | the issuer-approved      |     | now?                      |     | should separate:            |
| trusted program?          |     | destination?             |     | Compromise can happen     |     | - unverified                |
|                           |     |                          |     | after issuance.           |     | - signed unknown issuer     |
| Examples: verified        |     | Checks: exact URL,       |     | Inputs: redirects,        |     | - verified issuer           |
| individual, business,     |     | normalization, subdomain |     | reputation, malware,      |     | - risky destination         |
| institution, payment op   |     | policy, post-issuance    |     | phishing, injected        |     | - blocked                   |
|                           |     | changes                  |     | content                   |     |                              |
+---------------------------+     +---------------------------+     +---------------------------+     +------------------------------+
```
