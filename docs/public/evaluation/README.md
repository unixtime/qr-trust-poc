# Trust Residuals Evaluation Artifact

This folder contains the public, deterministic corpus evidence for the navigation-QR trust residuals paper.

## Files

- `trust_residuals_corpus.v1.json` is the public corpus manifest. Each case includes a synthetic QR artifact identifier, decoded payload, verifier profile, policy/governance reference, evidence facts, expected residual vector, and expected scanner output.
- `trust_residuals_results.v1.json` is the machine-readable evaluation report generated from the corpus.
- `trust_residuals_results.v1.md` is the human-readable report with semantic-match, baseline unsafe-positive/attention-undercut/state-mismatch, and residual-ablation tables.
- `fixtures/` contains deterministic PNG, PDF, and email fixtures used by artifact-integrity corpus cases. Image, PDF, and email fixtures are extracted and analyzed by the local QR artifact analyzer during evaluation.

## Rebuild

Run:

```sh
./backend/.venv/bin/python scripts/generate_trust_residuals_artifact_fixtures.py
./backend/.venv/bin/python scripts/trust_residuals_evaluation.py --check
```

The generator and runner are intentionally offline and deterministic. They do not use Postgres, Redis, NATS, private keys, remote reputation feeds, or live scanner services.

## Scope

This artifact supports a narrow conformance claim: the residual decision table exactly classifies the controlled corpus, and weaker decode-only, HTTPS-only, signature-only, and reputation-only baselines either assert positive trust where the expected outcome does not (unsafe positives) or demand strictly less user attention than required (attention undercuts) on cases where a residual requires downgrade, warning, or block. The corpus is an author-constructed fixture suite, so these are conformance measurements against specified expected outcomes, not field-effectiveness results.

It does not prove user comprehension, real-world scanner adoption, runtime-feed accuracy, artifact-forensics precision, or production governance legitimacy. Those require separate deployment and user-study evidence.
