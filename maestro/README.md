# Maestro E2E flows — PayCraft v2 branded flow

End-to-end UI flows for the v2 branded paywall + restore sheet (sub-plan 03 T6 of
`paycraft-paywall-v2-production-ui`, AC-16).

## Flows

| File | Verifies |
|------|----------|
| `paycraft_branded_flow.yaml` | BrandedStackTemplate paywall renders (hero copy, plan stack, Continue CTA, footer links) and the plan-select → Continue path runs without crashing. |
| `paycraft_restore_flow.yaml` | The Koin-injected `PayCraftRestore` sheet opens from the footer and renders its email gate (the path `PayCraftRestoreContentTest.kt` defers to e2e). |

## Target app

Both flows target the **in-repo `sample-app`** (`com.mobilebytelabs.paycraft.sample`),
which renders the branded paywall via `PayCraftBackend.Mock`. The plan originally named
`reels-downloader` (an external consumer workspace); that project is not buildable from this
repo, so the in-repo showcase — which is the canonical branded-flow demo and runs on the
connected device — is the correct, self-contained e2e target.

## Run

```bash
# 1. Install the sample app on a connected device/emulator
./gradlew :sample-app:installDebug

# 2. Run the flows (requires Maestro CLI: https://maestro.mobile.dev)
maestro test maestro/paycraft_branded_flow.yaml
maestro test maestro/paycraft_restore_flow.yaml
```

> Authored as production-grade flows; an actual device run + green Maestro exit is the
> remaining e2e acceptance step (tracked alongside the post-merge infra rows of sub-plan 01).
