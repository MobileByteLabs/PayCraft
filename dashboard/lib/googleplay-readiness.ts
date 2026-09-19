import { playAccessToken, type PlayServiceAccountJson } from "@/lib/store-jwt"
import { playFetch } from "@/lib/googleplay-product-sync"

/**
 * Report whether each Google Play subscription is actually SELLABLE, by reading Play.
 *
 * The App Store twin of this module exists because a local `app_store_product_id` was treated as
 * proof of a sellable product. Play has the same exposure through a different door: a base plan is
 * created in DRAFT and is NOT purchasable until activated, and activation is refused while the app
 * is unpublished — so a sync can legitimately succeed and leave nothing buyable. `play_product_id`
 * is written either way.
 *
 * Play differs from the App Store in a way that matters for the checks below. Apple models
 * availability and price as SEPARATE resources, which is how a subscription came to be available in
 * 175 territories and priced in 1. Play has no separate availability: `regionalConfigs` IS the
 * distribution, so an unpriced region is simply a region the product is not sold in. That makes
 * narrow pricing not a contradiction but a quiet limit — reported as a WARNING, not a blocker,
 * because it sells fine where it is priced.
 */

export interface PlayReadiness {
  /** tenant_products.id — so a caller can re-sync exactly this product. */
  id: string
  sku: string
  productId: string | null
  /** Base plan state as Play reports it (ACTIVE / DRAFT / INACTIVE), or null when unresolved. */
  state: string | null
  ready: boolean
  /** Hard problems: the product cannot be bought. */
  blockers: string[]
  /** Real but non-blocking: it sells, yet not as configured. */
  warnings: string[]
  regions?: number
}

/**
 * Play answers "no offers" with **204 No Content** and an EMPTY body, not `{}`. `JSON.parse("")`
 * throws, so a naive reader turns a perfectly healthy trial-less plan into a crash. Parse defensively.
 */
async function playJson(token: string, path: string): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await playFetch(token, path)
  const body = await res.text()
  if (!res.ok) return { ok: false, status: res.status, json: null }
  if (!body.trim()) return { ok: true, status: res.status, json: {} }
  try {
    return { ok: true, status: res.status, json: JSON.parse(body) }
  } catch {
    return { ok: false, status: res.status, json: null }
  }
}

export interface PlayProductInput {
  id: string
  sku: string
  playProductId: string | null
  /** Trial days that SHOULD apply on Android (0/null → no trial advertised). */
  androidTrialDays: number | null
  /** How many currencies the product declares, to spot a catalogue narrower on Play than on web. */
  configuredCurrencies?: number
}

export async function googlePlaySubscriptionReadiness(
  creds: { serviceAccountJson: string; packageName: string },
  products: PlayProductInput[],
): Promise<PlayReadiness[]> {
  const token = await playAccessToken(JSON.parse(creds.serviceAccountJson) as PlayServiceAccountJson)
  const pkg = creds.packageName
  const out: PlayReadiness[] = []

  for (const p of products) {
    if (!p.playProductId) {
      out.push({ id: p.id, sku: p.sku, productId: null, state: null, ready: false, blockers: ["not synced to Google Play"], warnings: [] })
      continue
    }

    const sub = await playJson(token, `/applications/${pkg}/subscriptions/${encodeURIComponent(p.playProductId)}`)
    if (!sub.ok) {
      out.push({
        id: p.id, sku: p.sku, productId: p.playProductId, state: null, ready: false, warnings: [],
        blockers: [
          sub.status === 404
            ? "product id recorded locally but no such subscription in Google Play"
            : `Google Play returned ${sub.status} for this subscription`,
        ],
      })
      continue
    }

    const blockers: string[] = []
    const warnings: string[] = []

    const listings: any[] = sub.json.listings ?? []
    if (listings.length === 0) blockers.push("no store listing (title + description)")
    else if (!listings.some((l) => l?.title)) blockers.push("store listing has no title")
    else if (!listings.some((l) => l?.description)) warnings.push("store listing has no description")

    const basePlans: any[] = sub.json.basePlans ?? []
    if (basePlans.length === 0) {
      blockers.push("no base plan — nothing to purchase")
      out.push({ id: p.id, sku: p.sku, productId: p.playProductId, state: null, ready: false, blockers, warnings })
      continue
    }

    // The plan a buyer actually gets: prefer an ACTIVE one, else report the first honestly.
    const plan = basePlans.find((b) => b.state === "ACTIVE") ?? basePlans[0]
    const state: string | null = plan?.state ?? null
    if (state !== "ACTIVE") {
      // The defining Play failure: created but never activated, so the store has it and no one can
      // buy it. Play refuses activation while the app is unpublished, so a sync can report success.
      blockers.push(`base plan ${plan?.basePlanId ?? "?"} is ${state ?? "in an unknown state"} — not purchasable`)
    }

    const regions: number = (plan?.regionalConfigs ?? []).length
    if (regions === 0) blockers.push("base plan is priced in no regions — cannot be sold anywhere")
    else if (p.configuredCurrencies && p.configuredCurrencies > 1 && regions < p.configuredCurrencies) {
      warnings.push(
        `priced in ${regions} region${regions === 1 ? "" : "s"} while the product declares ${p.configuredCurrencies} currencies — sold in fewer places than configured`,
      )
    }

    // Offers are their OWN collection; the subscription GET does not populate basePlans[].offers,
    // so reading them from the subscription would report every trial as missing.
    const offersRes = await playJson(
      token,
      `/applications/${pkg}/subscriptions/${encodeURIComponent(p.playProductId)}/basePlans/${encodeURIComponent(plan.basePlanId)}/offers`,
    )
    const offers: any[] = offersRes.ok ? offersRes.json.subscriptionOffers ?? [] : []
    const activeTrial = offers.find(
      (o) => o?.state === "ACTIVE" && (o?.phases ?? []).some((ph: any) => ph?.duration),
    )
    const wantsTrial = typeof p.androidTrialDays === "number" && p.androidTrialDays > 0

    if (wantsTrial && !activeTrial) {
      // The paywall advertises a trial the Play cart would not grant — a Subscriptions-policy
      // mismatch, and a rejection risk, not a cosmetic difference.
      blockers.push(`a ${p.androidTrialDays}-day trial is configured for Android but no active free-trial offer exists on Play`)
    } else if (!wantsTrial && activeTrial) {
      blockers.push(`an active free-trial offer exists on Play (${activeTrial.offerId}) but no trial is configured — the cart grants what the paywall does not advertise`)
    } else if (activeTrial) {
      const offerRegions = (activeTrial.regionalConfigs ?? []).length
      if (offerRegions > 0 && offerRegions < regions) {
        warnings.push(`free-trial offer covers ${offerRegions} of the base plan's ${regions} regions`)
      }
    }

    out.push({
      id: p.id,
      sku: p.sku,
      productId: p.playProductId,
      state,
      ready: blockers.length === 0,
      blockers,
      warnings,
      regions,
    })
  }

  return out
}
