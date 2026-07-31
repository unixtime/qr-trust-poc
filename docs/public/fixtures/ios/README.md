# iOS Provider Profile Fixtures

This folder contains public-safe verifier provider profile fixtures for the
native QR Trust app.

- `signed-provider-profile.demo.json` is an Ed25519 envelope used to test the
  signed provider-profile import path.
- The fixture key is intentionally public and reproducible. It is not a
  production signing key. The check verifies the tracked signature and confirms
  the generator can emit a valid signed envelope.
- Production deployments should replace this key with a trust-program-owned key
  set distributed through managed app configuration or another approved
  provider-profile channel.

Regenerate and check the fixture:

```bash
make ios-provider-profile-fixture
make check-ios-provider-profile-fixture
```
