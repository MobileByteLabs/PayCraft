# Migrating to `PayCraftPremiumBanner` — cmp-paycraft 2.1.0+

The hand-coded Settings-tab premium banner that ships in many PayCraft
consumer apps today (with `strings.xml` entries `settings_premium_banner_title`,
`_subtitle`, `_cta` and a handful of `_perk_*` strings) can be replaced with
a single SDK composable — `PayCraftPremiumBanner` — that pulls every piece
of copy from the dashboard-configured `tenant_paywall` row.

The migration is **opt-in** (D8 of the paycraft-paywall-v2-production-ui
epic). Consumer apps keep their existing `strings.xml` entries during a
90-day grace so they can roll back without churn.

## Pre-flight visual diff (recommended)

Before deleting any consumer-side code, render both banners side-by-side
in an Android Compose preview. Expect ≤ 2 % pixel diff (the
`PayCraftPremiumBannerTest` unit test verifies this against a baseline
screenshot of the reels-downloader banner committed in cmp-paycraft 2.1.0).

```kotlin
@Preview(showBackground = true)
@Composable
fun PreviewOldVsNew() {
    Column {
        OldHandCodedBanner(...)              // the existing card
        PayCraftPremiumBanner(
            onGetPremiumTap = {},
            onRestoreTap = {},
        )
    }
}
```

If the diff is meaningfully larger than ~2 % the most likely culprits are
(a) host-app `MaterialTheme` overrides bleeding into the SDK render, or
(b) dashboard config not yet populated for this tenant (the SDK falls back
to copy that matches reels-downloader's `strings.xml` exactly, but other
consumer apps may have authored different defaults).

## The swap

Replace the existing Card-based banner block in your `SettingsScreen.kt`:

```kotlin
// OLD — delete
Card(
    modifier = Modifier.fillMaxWidth().padding(16.dp),
    shape = RoundedCornerShape(20.dp),
    colors = CardDefaults.cardColors(containerColor = brandPurple),
) {
    Column(modifier = Modifier.padding(20.dp)) {
        Row(...) { /* ~40 lines of hand-coded banner JSX */ }
        Spacer(...)
        Button(onClick = { showPaywall.value = true }, ...) { ... }
        TextButton(onClick = { showRestore.value = true }, ...) { ... }
    }
}

// NEW — replace with
PayCraftPremiumBanner(
    onGetPremiumTap = { showPaywall.value = true },
    onRestoreTap   = { showRestore.value = true },
)
```

That's the whole migration on the consumer side. Everything else flows from
the dashboard.

## strings.xml during the grace window

Don't delete the `settings_premium_banner_*` entries yet — they remain as
fallback while we observe the migrated banner in production. Delete only
after 90 days of green telemetry. The SDK does **not** read these
`strings.xml` keys — they're a consumer-side concern — but consumer apps
that want to gradually transition can pass them as explicit overrides so
the SDK uses the host-resource copy until the dashboard is populated:

```kotlin
PayCraftPremiumBanner(
    onGetPremiumTap = { ... },
    onRestoreTap = { ... },
    titleOverride    = stringResource(R.string.settings_premium_banner_title),
    subtitleOverride = stringResource(R.string.settings_premium_banner_subtitle),
    ctaOverride      = stringResource(R.string.settings_premium_banner_cta),
)
```

When the dashboard config catches up, drop the override args one by one —
remove `titleOverride` first, verify the SDK now reads `paywall.hero_title`
from `/config`, then remove `subtitleOverride`, then `ctaOverride`. At the
end the call is the minimal 2-arg form shown earlier.

## What the dashboard needs to look right

For the SDK render to match the previous hand-coded look, populate these
fields in the dashboard's **Paywall designer → Content tab**:

| Dashboard field | Default | Override for reels-downloader-style |
|---|---|---|
| Hero title | "Upgrade to Premium" | — (default matches) |
| Hero subtitle | "Enjoy ad-free experience, HD downloads, and exclusive features" | — (default matches) |
| CTA · Get Premium | "Get Premium" | — (default matches) |
| Restore label | "Restore Your Premium" | — (default matches) |

The dashboard defaults *are* reels-downloader's strings.xml defaults
(verified by `PayCraftPremiumBannerTest`), so for that consumer the
migration is a zero-config swap. Other consumer apps that authored their
own banner copy should overwrite these fields in the dashboard *before*
flipping the swap on the consumer side, otherwise their banner will
suddenly show the framework defaults.

## Rollback

If the migrated banner causes a visual regression in production, revert
the consumer-side commit — the `strings.xml` keys are still there, the
old hand-coded Card block is in git history, and no dashboard config
needs to be touched.

## Tier-aware Powered-by-PayCraft footer

The dashboard's existing **Branding** tab (`attribution` / `none` /
`custom`) is unchanged by this epic. The Settings-tab banner doesn't
render the branding footer — that lives on the paywall modal and the
existing `BrandingFooter` composable handles it. So no extra work to
preserve the tiered behaviour.

## Related

- `cmp-paycraft/src/commonMain/.../ui/PayCraftPremiumBanner.kt` — the
  composable
- `cmp-paycraft/src/commonTest/.../ui/PayCraftPremiumBannerTest.kt` — the
  test that asserts the ≤ 2 % pixel diff vs reels-downloader baseline
- `plan-layer/project-plans/mbs/PayCraft/active/paycraft-paywall-v2-
  production-ui/03-new-branded-flow-components.md` — sub-plan 03 spec
- `cmp-paycraft/CHANGELOG.md` 2.1.0 entry — for release-note copy you
  can paste into your consumer app's changelog
