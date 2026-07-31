# Release-candidate status

Updated: 2026-07-30

The QR Trust PoC is in private pre-publication review. A fresh-history export
has been exercised against a private remote, but no public GitHub repository has
been created and no public release is claimed.

!!! warning
    Any documentation or code change after a candidate export changes the Git
    tree. The reviewed private candidate and the first public GitHub commit must
    have the same commit and tree hashes, or the private review is not proof of
    the public content.

## Current gate

Before replacing the private candidate or publishing:

```bash
make docs-build
make release-readiness-report
make release-audit
make release-audit-strict
```

The publication export must also report `RESULT: clean.` and initialize a
single-commit fresh history from the committed index.

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

## Remaining publication actions

1. Review the replacement private candidate as if it were already public.
2. Confirm its default branch contains one fresh-history commit and the expected
   tracked file set.
3. Create an empty GitHub repository without a generated README, license, or
   `.gitignore`.
4. Push the exact reviewed commit and verify the GitHub commit and tree hashes.
5. Add the real public repository URL and actual release date to software
   metadata in a separately reviewed follow-up if they were not known before the
   first push.

## Claim boundary

Passing these gates supports a public-source and reproducibility claim. It does
not establish production readiness, standards status, deployment-scale
capacity, field detection accuracy, or user comprehension.
