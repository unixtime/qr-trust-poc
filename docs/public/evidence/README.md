# Evidence Manifest

This folder separates reproducible browser evidence from physical-device
evidence that still requires a real iPhone.

## Browser Evidence

Captured files:

- [browser/accepted.png](./browser/accepted.png)
- [browser/payload-mismatch.png](./browser/payload-mismatch.png)
- [browser/runtime-risky.png](./browser/runtime-risky.png)
- [browser/stale-cache.png](./browser/stale-cache.png)

Regenerate from the repository root with the React dev server running:

```bash
make capture-browser-evidence
```

Validate the tracked browser evidence artifacts:

```bash
make check-browser-evidence
```

These screenshots prove the React verifier lab can drive accepted,
`payload_revalidation`, `runtime_safety`, and `governance_cache` outcomes
against the live verifier and scanner APIs. They do not prove native camera
behavior.

The scope-honesty pass retired the pre-pass capture that demonstrated
per-presentation blocking: the verifier keeps no per-presentation state, so
there is no such outcome to photograph. `make capture-browser-evidence` and
`make check-browser-evidence` cover the four captures listed above.

## Native iPhone Evidence

Current repo-level gate:

```bash
make smoke-ios
make ios-provider-config
make check-ios-provider-config
make iphone-evidence-preflight
```

This checks that the native iPhone scanner still exposes the expected
end-user decision contract, that the simulator app builds, that the ignored
local provider profile is valid, and that the current Mac/iPhone setup is ready
for physical capture.

Most tracked scanner-fleet and provider-profile artifacts under
[iphone/](./iphone/) are deterministic ios-reference reviewer exports written
by the native app's evidence exporter. They document how the app surfaces each
scanner and provider-profile decision, but they do not constitute
physical-device capture evidence. The `green_verified_issuer` set is the
exception: the native app exported it after a live scan on 2026-09-02, and its
trace carries the verifier envelope id and check time. Raw screen recordings
are not tracked. Use
[iphone/README.md](./iphone/README.md)
and [IPHONE_TEST_PLAN.md](../IPHONE_TEST_PLAN.md)
for the manual capture plan.
