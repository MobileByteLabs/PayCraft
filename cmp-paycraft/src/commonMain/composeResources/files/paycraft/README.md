# PayCraft SDK — bundled Lottie animations

Rendered by `com.mobilebytelabs.paycraft.ui.components.PayCraftStateAnimation` on the SDK's
terminal states. These ship INSIDE the SDK artifact, so a consumer gets them with no asset work.

| File | Used by | Motion |
|---|---|---|
| `config_error.json` | every non-offline `ConfigResult.Failed` reason | card tilts gently under an expanding pulse ring; three dots cycle underneath |
| `offline.json` | `ConfigResult.Failed.Reason.OFFLINE` | signal arcs fade out in sequence, slash draws on |

## Provenance

Both files are **hand-authored for this repository** (Lottie schema 5.7.4, 240×240, 60 fps,
2.5 s loop). They are not sourced from LottieFiles, so there is no third-party attribution or
license to track — they carry this repository's own licence.

## Constraints they were authored under

- **Monochrome by design.** Every stroke/fill is a single neutral grey (`0.42, 0.45, 0.50`), so the
  animation sits correctly on a tenant's own paywall theme — light or dark — without tinting. Do not
  add brand colour here; the surrounding `PayCraftTheme` owns colour.
- **JSON only, no `.lottie` zip.** The SDK pulls `compottie-resources`, not `compottie-dot-lottie`.
- **No external images/fonts.** `assets` is empty on purpose — a terminal state must render with no
  network, which is exactly the offline case.
- Keep them small (< 10 KB). They are paid for by every consumer of the SDK.
