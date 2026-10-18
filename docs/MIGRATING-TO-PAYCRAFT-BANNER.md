# Migrating a hand-coded premium banner to `PayCraftBanner`

The hand-coded Settings-tab premium banner that ships in many PayCraft consumer apps today (with
`strings.xml` entries `settings_premium_banner_title`, `_subtitle`, `_cta` and a handful of
`_perk_*` strings) is replaced by one SDK composable that pulls every piece of copy from the
dashboard-configured `tenant_paywall` row.

> **Renamed.** This guide was *Migrating to `PayCraftPremiumBanner`*. That composable and
> `PayCraftBanner` were two public names for one job — observe entitlement, draw a card, offer
> upgrade and restore — differing only in what a paying user sees. They are now one component and
> that difference is a style: the old `PayCraftPremiumBanner` is
> `PayCraftBanner(style = PayCraftBannerStyle.Upsell)`.

## The swap

```kotlin
// OLD — delete
Card(
    modifier = Modifier.fillMaxWidth().padding(16.dp),
    shape = RoundedCornerShape(20.dp),
    colors = CardDefaults.cardColors(containerColor = brandPurple),
) {
    Column(modifier = Modifier.padding(20.dp)) {
        Row(...) { /* ~40 lines of hand-coded banner */ }
        Button(onClick = { showPaywall.value = true }, ...) { ... }
        TextButton(onClick = { showRestore.value = true }, ...) { ... }
    }
}

// NEW
PayCraftBanner(style = PayCraftBannerStyle.Upsell)
```

That is the whole migration on the consumer side. Everything else flows from the dashboard.

Note what also disappears: the `showPaywall` / `showRestore` state and the sheets they drove. The
banner presents the SDK's paywall and the SDK's restore sheet itself, so there are no callbacks and
nothing for the host to render. `PayCraftRestore` is internal for that reason.

## Which style

| | `Adaptive` (default) | `Upsell` |
|---|---|---|
| free user | gradient card, perks, gold CTA | flat brand card, CTA |
| subscriber | plan, renewal date, Manage | renders nothing |
| status unknown | spinner over the last stable card | layout-matched shimmer |

Pick `Upsell` when the banner sits among unrelated content and a paying user should see no billing
UI at all. Pick `Adaptive` for a dedicated billing area — or use
`PayCraftSubscriptionSettings`, which is the full section (status line, Manage row, Restore row) in
five styles.

## strings.xml

Delete the `settings_premium_banner_*` entries once the swap is in. The SDK never read them — they
were a consumer-side concern — and the `titleOverride` / `subtitleOverride` / `ctaOverride` /
`restoreOverride` parameters that let a host feed them in during the original 90-day grace are
**gone**. That grace (D8 of the paycraft-paywall-v2-production-ui epic) has long expired, nothing
outside the SDK's own tests ever used those parameters, and a host pinning copy is how a banner
drifts from the paywall it links to.

Copy now has exactly one source: the dashboard.

## What the dashboard needs

Populate these in **Paywall designer → Content**:

| Dashboard field | Default |
|---|---|
| Hero title | "Upgrade to Premium" |
| Hero subtitle | "Enjoy ad-free experience, HD downloads, and exclusive features" |
| CTA · Get Premium | "Get Premium" |
| Restore label | "Restore Your Premium" |

The defaults match reels-downloader's `strings.xml` exactly (asserted by `UpsellBannerCardTest`), so
for that consumer the swap is zero-config. An app that authored its own banner copy should overwrite
these fields in the dashboard **before** flipping the swap, or its banner will suddenly show the
framework defaults.

## Verifying

```kotlin
@Preview(showBackground = true)
@Composable
fun PreviewOldVsNew() {
    Column {
        OldHandCodedBanner(...)
        PayCraftBanner(style = PayCraftBannerStyle.Upsell)
    }
}
```

A meaningfully different render usually means either host-app `MaterialTheme` overrides bleeding
into the SDK, or dashboard config not yet populated for the tenant.

## Source

- `cmp-paycraft/src/commonMain/.../ui/PayCraftBanner.kt` — the component and its style dispatch
- `cmp-paycraft/src/commonMain/.../ui/PayCraftBannerStyle.kt` — the two presets, and why two
- `cmp-paycraft/src/commonMain/.../ui/UpsellBannerCard.kt` — the `Upsell` body
- `cmp-paycraft/src/commonTest/.../ui/UpsellBannerCardTest.kt` — the render assertions
