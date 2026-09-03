# Published snapshot status

Updated: 2026-09-03

The QR Trust PoC is public at
<https://github.com/unixtime/qr-trust-poc>. The reviewed implementation and
submitted Internet-Draft source snapshot is tagged
[`trust-residuals-ietf-00`](https://github.com/unixtime/qr-trust-poc/tree/trust-residuals-ietf-00)
at public commit `d990f0281b841798807ab8a314a85a139aab4790`.

The tag was exported from private source commit
`0c5234dc288e305d7c8259def372989236e1ccc4`. Review-mirror pipeline `4109` and
[GitHub Actions run 33767415830](https://github.com/unixtime/qr-trust-poc/actions/runs/33767415830)
passed before the tag was treated as the public reference snapshot. The tag is
lightweight and unsigned; project policy preserves its target, while the full
commit identifier above provides the reproducible identity.

The IETF Datatracker has posted
[`draft-elmasri-qr-trust-residuals-00`](https://datatracker.ietf.org/doc/draft-elmasri-qr-trust-residuals/)
as an individual submission. The matching Markdown and RFCXML v3 sources are
included in the tagged repository. Publication does not imply working-group
adoption, IETF consensus, or standards-track status.

## Gate for a future public snapshot

Before exporting or publishing any replacement snapshot:

```bash
make docs-build
make release-readiness-report
make release-audit
make release-audit-strict
```

The publication export must also report `RESULT: clean.` and materialize from
the committed index. It is reviewed on the private mirror before an identical
fast-forward reaches GitHub. Existing public tags are never moved or reused.

## Completed controls

- The export is allowlist-based and excludes private history, paper-development
  sources, local work products, and release tooling.
- Personal-string and credential scans fail closed when a scanner or extraction
  tool cannot run.
- Markdown-link, script-reference, and Make-target closure are checked against
  the materialized public tree.
- The deterministic private-key fixture is isolated, documented as test-only,
  and scanned as the sole permitted PEM exception.
- Browser and iPhone evidence artifacts are manifest-checked.
- The public clone audit has an explicit role and passes without maintainer-only
  pattern files or development dependencies.
- The backend decision core and controlled trust-residual corpus have dedicated
  totality, differential, and evaluation tests.
- The documentation site builds from a filtered source set with strict anchor
  validation.
- `CITATION.cff` names the current published paper as the preferred citation.

## Completed publication record

1. The public repository was created without generated starter files.
2. The allowlist-based exporter produced a fresh-history public tree without
   the private repository history or excluded maintainer material.
3. The exported tree passed the private review-mirror pipeline.
4. The identical public commit was pushed to GitHub and passed GitHub Actions.
5. `CITATION.cff` carries the public repository URL and ORCID metadata.
6. The submitted `-00` source and implementation snapshot were tagged only
   after the Datatracker posting and source-digest verification completed.

## Claim boundary

Passing these gates supports a public-source and reproducibility claim for the
identified snapshot. It does not establish production readiness, standards
status, deployment-scale capacity, field detection accuracy, or user
comprehension.
