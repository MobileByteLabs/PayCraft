import { readFileSync } from "node:fs"
import { join } from "node:path"

import { detectSyncStuck, DRIFT_DETECTORS, DRIFT_KINDS, STUCK_AFTER_MS } from "@/lib/drift-detectors"

/**
 * Class 9 — a provider left at `syncing` by a run the platform killed.
 *
 * reels-downloader, 2026-11-06: turning on a 14-day trial made each App Store sync create ~174
 * introductory offers serially, Cloudflare ended the request at 100s, and three products sat at
 * `syncing` indefinitely. The drain reported "0 findings" because no detector read the marker.
 */

const TENANT = "11111111-1111-1111-1111-111111111111"
const NOW = Date.parse("2026-11-06T12:00:00Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function supa(rows: unknown[] | null, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error }),
      }),
    }),
  } as never
}

describe("detectSyncStuck", () => {
  it("flags a provider whose syncing marker is older than the threshold, scoped to that provider", async () => {
    const out = await detectSyncStuck(
      supa([
        {
          id: "p1",
          sku: "pro-annual",
          updated_at: ago(60_000),
          sync_state: {
            app_store: { status: "syncing", started_at: ago(STUCK_AFTER_MS + 60_000) },
            google_play: { status: "synced" },
          },
        },
      ]),
      TENANT,
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: "sync-stuck", subject_id: "p1", provider: "app_store" })
    expect(out[0].subject).toBe("product:pro-annual/app_store")
  })

  it("leaves a sync that is still within the threshold alone — it may be running", async () => {
    const out = await detectSyncStuck(
      supa([{ id: "p1", sku: "s", updated_at: ago(0), sync_state: { stripe: { status: "syncing", started_at: ago(60_000) } } }]),
      TENANT,
      NOW,
    )
    expect(out).toHaveLength(0)
  })

  it("falls back to updated_at for markers written before started_at existed", async () => {
    const out = await detectSyncStuck(
      supa([{ id: "p1", sku: "s", updated_at: ago(STUCK_AFTER_MS * 3), sync_state: { razorpay: { status: "syncing" } } }]),
      TENANT,
      NOW,
    )
    expect(out.map((f) => f.provider)).toEqual(["razorpay"])
  })

  it("ignores terminal statuses and rows with no sync_state", async () => {
    const out = await detectSyncStuck(
      supa([
        { id: "p1", sku: "a", updated_at: ago(STUCK_AFTER_MS * 3), sync_state: { stripe: { status: "failed" } } },
        { id: "p2", sku: "b", updated_at: ago(STUCK_AFTER_MS * 3), sync_state: null },
      ]),
      TENANT,
      NOW,
    )
    expect(out).toHaveLength(0)
  })

  it("is registered, so the drift report and the drain both see it", () => {
    expect(DRIFT_DETECTORS).toContain(detectSyncStuck)
    expect(DRIFT_KINDS).toContain("sync-stuck")
  })
})

describe("the paths that create and clear a stuck sync", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

  it("the drain re-syncs a stuck product scoped to its provider, instead of parking it in needs_human", () => {
    const drain = src("lib/sync-drain.ts")
    expect(drain).toMatch(/x\.kind === "sync-stuck"/)
    expect(drain).toMatch(/onlyProvider: f\.provider!/)
    expect(drain).toMatch(/!\(f\.kind === "sync-stuck" && f\.subject_id && f\.provider\)/)
  })

  it("the in-flight marker records when it was written", () => {
    expect(src("lib/stripe-route-helper.ts")).toMatch(/status: "syncing", reason: "sync in progress", started_at: startedAt/)
  })

  it("App Store introductory offers are created with bounded concurrency, not one serial POST per territory", () => {
    const sync = src("lib/appstore-product-sync.ts")
    const body = sync.slice(sync.indexOf("async function ensureIntroductoryOffer("), sync.indexOf("async function ensureNoIntroductoryOffer("))
    expect(body).toMatch(/OFFER_CONCURRENCY = 10/)
    expect(body).toMatch(/Promise\.all\(missing\.slice\(i, i \+ OFFER_CONCURRENCY\)\.map\(createOffer\)\)/)
    expect(body).not.toMatch(/for \(const territory of missing\)/)
  })
})
