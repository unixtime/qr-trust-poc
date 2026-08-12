# Citing this work

If you use, evaluate, compare, or extend this PoC in academic or technical
work, please cite the published papers that define its foundation. There are
two, and they cover different layers:

- **Paper 1** argues *why* navigation QR security is a trust-model problem
  rather than a cryptography problem. Cite it for the framing.
- **Paper 2** defines *how* a scan resolves to one bounded decision state by
  evaluating trust residuals. Cite it for the decision semantics, the D0–D15
  decision table, or the conformance evaluation this repository ships.

Citing both is appropriate for work that builds on the implementation as a
whole.

## Paper 1 — trust model

Hassan El-Masri, “QR Navigation Security Is Not Primarily a Cryptography
Problem: A Trust-Model Framework for Managed Issuer Verification, Destination
Binding, and Runtime Safety” (April 12, 2026), SSRN Abstract 6577478.

- [SSRN abstract page](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478)
- [DOI: 10.2139/ssrn.6577478](https://doi.org/10.2139/ssrn.6577478)

The SSRN record lists the paper as 22 pages and publicly posted in May 2026.

## Paper 2 — decision semantics

Hassan El-Masri, “Trust Residuals for Navigation QR Codes: Decision Semantics
for Issuer, Destination, and Runtime Safety State” (August 3, 2026), SSRN
Abstract 7225699. Accepted and posted August 2026.

- [SSRN abstract page](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7225699)
- [DOI: 10.2139/ssrn.7225699](https://doi.org/10.2139/ssrn.7225699)

[Trust-residual decision semantics](TRUST_RESIDUALS_DECISION_SEMANTICS.md) is
the implementation-oriented view of this paper, and
[Evaluation results](evaluation/trust_residuals_results.v1.md) reports the
conformance run against the public corpus.

This repository contains implementation and evaluation work that continues past
both papers, so a paper and this software should not be treated as identical
artifacts.

## Suggested citations

El-Masri, Hassan, *QR Navigation Security Is Not Primarily a Cryptography
Problem: A Trust-Model Framework for Managed Issuer Verification, Destination
Binding, and Runtime Safety* (April 12, 2026). Available at SSRN:
<https://ssrn.com/abstract=6577478> or
<https://doi.org/10.2139/ssrn.6577478>.

El-Masri, Hassan, *Trust Residuals for Navigation QR Codes: Decision Semantics
for Issuer, Destination, and Runtime Safety State* (August 3, 2026). Available
at SSRN: <https://ssrn.com/abstract=7225699> or
<https://doi.org/10.2139/ssrn.7225699>.

## BibTeX

```bibtex
@misc{elmasri2026qrtrust,
  author       = {El-Masri, Hassan},
  title        = {QR Navigation Security Is Not Primarily a Cryptography Problem: A Trust-Model Framework for Managed Issuer Verification, Destination Binding, and Runtime Safety},
  date         = {2026-04-12},
  doi          = {10.2139/ssrn.6577478},
  howpublished = {SSRN},
  url          = {https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478}
}

@misc{elmasri2026residuals,
  author       = {El-Masri, Hassan},
  title        = {Trust Residuals for Navigation QR Codes: Decision Semantics for Issuer, Destination, and Runtime Safety State},
  date         = {2026-08-03},
  doi          = {10.2139/ssrn.7225699},
  howpublished = {SSRN},
  url          = {https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7225699}
}
```

## Software citation

[`CITATION.cff`](../../CITATION.cff) contains machine-readable software and
preferred-paper citation metadata for GitHub and citation tools, including the
public source repository URL.
