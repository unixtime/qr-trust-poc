# Figure 4 ASCII Reference

Source figure:
- `Figure 4` in the [published QR trust paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- visual asset: [DEPLOYMENT_ROLLOUT_GRAPH.svg](./DEPLOYMENT_ROLLOUT_GRAPH.svg)

This ASCII version is the relationship reference for stakeholder alignment and first-deployment ordering.

```text
Deployment Rollout and Stakeholder Alignment
-------------------------------------------

                         +----------------------------------+
                         | Starting problem                 |
                         | Generic QR trust gap             |
                         | - who owns issuer trust?         |
                         | - who owns runtime safety?       |
                         | - who controls scanner UX?       |
                         +----------------------------------+
                                        |
                                        v
         +------------------------------+------------------------------+------------------------------+------------------------------+
         |                                                             |                              |                              |
         v                                                             v                              v                              v
+---------------------------+                               +---------------------------+  +---------------------------+  +---------------------------+
| Primary operators         |                               | Primary operators         |  | Primary operators         |  | Primary operators         |
| Payments                  |                               | Merchant ecosystems       |  | Enterprise and            |  | Government and public     |
| High fraud cost.          |                               | Stable destinations.      |  | institutional operators   |  | services                  |
| Strong incentive.         |                               | Managed dashboards.       |  | Internal workflows.       |  | High trust requirement.   |
+---------------------------+                               +---------------------------+  +---------------------------+  +---------------------------+
         |                                                             |                              |                              |
         +------------------------------+------------------------------+--------------+---------------+                              |
                                        |                                             |                                              |
                                        v                                             v                                              v
                         +----------------------------------+          +----------------------------------+          +--------------------------------+
                         | Strong incentive alignment       |          | Secondary rollout slice          |          | Open public consumer QR        |
                         | Best first deployment slices     |          | Enterprise and institutional QR  |          | Weak first market              |
                         | 1. Payments                      |          | - known destinations             |          | - low operator control         |
                         | 2. Merchant ecosystems           |          | - operator policy exists         |          | - high privacy resistance      |
                         | 3. Enterprise / institutional QR |          | - scanner UX still platform-     |          | - no clear paying operator     |
                         | 4. Government/public services    |          |   dependent                      |          | - adoption depends on          |
                         +----------------------------------+          | stronger than open consumer QR   |          |   platforms                    |
                                                                       +----------------------------------+          +--------------------------------+

Support and control actors
--------------------------

+----------------------------------+                   +----------------------------------+
| Secondary operator               |                   | Control point                    |
| Cybersecurity vendors            |                   | OS and browser vendors           |
| - runtime safety signals         |                   | - default scanner UX             |
| - redirect analysis              |                   | - mass-market trust display      |
| - reputation / malware signals   |                   +----------------------------------+
+----------------------------------+                                   |               |
                     |                                                 |               |
                     +-------------------- supports -------------------+               |
                                                                                       |
                                                                                       +---- affects institutional QR
                                                                                       |
                                                                                       +---- affects open consumer QR

Strategic implication
---------------------

+------------------------------------------------------------------------------------------------------------+
| The first viable deployment is not "all QR codes on earth."                                                |
| It is the subset of ecosystems that already own enrollment, fraud cost, destination control, or meaningful |
| influence over scanner behavior.                                                                           |
+------------------------------------------------------------------------------------------------------------+
```
