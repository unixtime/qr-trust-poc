# Support

This repository does not provide production support or service-level guarantees.

## Use Public Issues For

- reproducible verifier PoC bugs
- documentation gaps
- broken setup instructions
- test-vector corrections
- browser lab or iPhone lab usability issues
- Docker Compose setup problems

## Do Not Use Public Issues For

- exploitable vulnerability details
- real credentials or private logs
- legal advice
- patent prosecution strategy
- requests to validate production deployments

For security-sensitive reports, follow [SECURITY.md](./SECURITY.md).

## Before Opening An Issue

Run the relevant checks where possible:

```bash
make release-audit
make smoke-compose
make build-frontend
```

If the issue involves the native iPhone lab, include:

- device model and iOS version
- whether the app was run on simulator or physical iPhone
- backend base URL shape, without secrets
- expected verifier stage
- observed verifier stage or error
