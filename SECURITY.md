# Security Policy

This repository is a public reference PoC for QR verifier behavior. Treat it as
research and implementation scaffolding, not as a production security product.

## Supported Scope

Security reports are in scope when they affect tracked public code or documented
reference behavior, including:

- verifier decision logic
- replay-guard behavior
- payload revalidation
- signed-schema handling
- API key administration
- browser or iPhone verifier lab behavior
- Docker Compose defaults and exposed local services

Reports about private filing materials, patent strategy, or local-only ignored
directories are out of scope for this public repository.

## Reporting A Vulnerability

Do not open a public issue with exploitable details.

Preferred route after publication:

1. Use GitHub private vulnerability reporting if enabled for the repository.
2. If private vulnerability reporting is not available, contact the maintainer
   through a private channel already associated with the project or paper.
3. Include a minimal reproduction, affected commit, expected behavior, observed
   behavior, and whether the issue affects the browser lab, native iPhone lab,
   backend API, or documentation.

## Local Secrets

Never include real credentials in reports, screenshots, logs, or pull requests.
Use placeholder values such as:

- `local-lab-admin`
- `replace-with-long-random-key`
- `replace-with-long-random-admin-token`

## Production Use

The PoC is not production-ready by default. Before any production adaptation,
review at minimum:

- TLS termination and certificate trust
- API key generation, rotation, and storage
- Redis and database persistence
- rate limits and abuse controls
- logs and request metadata
- issuer enrollment and governance rules
- privacy handling for scanned destination data
