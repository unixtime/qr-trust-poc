# Contributing

This repository is scoped to a public QR verifier reference PoC. Contributions
should improve implementation clarity, reproducibility, security posture, test
coverage, or public documentation.

## Public Repo Boundary

Do not add:

- private filing materials
- patent prosecution notes
- personal contact details beyond intentional public metadata
- real API keys, tokens, passwords, private keys, or customer identifiers
- production credentials or screenshots containing credentials

Use `private/`, `archive/`, `local/`, or your own ignored workspace for local
material that should not be public.

## Useful Commands

Run the narrowest relevant checks before opening a pull request:

```bash
make release-audit
make smoke-compose
make build-frontend
make smoke-ios
```

For backend changes:

```bash
cd backend
PYTHONPATH=.. ./.venv/bin/pytest
```

For frontend changes:

```bash
cd frontend
npm run build
```

For physical iPhone evidence, add the artifacts first and run:

```bash
make check-iphone-evidence
```

## Pull Request Expectations

Each pull request should state:

- what verifier behavior or documentation changed
- which commands were run
- whether public-release boundaries changed
- whether screenshots, PDFs, or generated artifacts were added
- whether the change affects browser, backend, compose, or native iPhone flows

## Design Principles

Prefer changes that keep the PoC:

- deterministic
- explainable to students, researchers, and engineers
- narrow enough to audit
- explicit about what is verified versus only documented
- honest about non-production assumptions

Avoid broad claims that the project is a standard, a complete governance model,
or proof of patentability.
