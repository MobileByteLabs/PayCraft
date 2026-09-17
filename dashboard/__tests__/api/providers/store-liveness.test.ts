/**
 * Route tests for `GET /api/providers/store-liveness`.
 *
 * The route's job is to keep four states distinct, because collapsing any pair of them
 * produces a misleading dashboard:
 *
 *   not connected      → say nothing (the connect prompt lives in settings)
 *   connected, no id   → a CONFIG gap, not a publishing gap
 *   connected, live    → green, publishing is not the blocker
 *   connected, 404     → the actionable "publish your app / activate manually" state
 *
 * Only `connected + confirmed-404` may set `blocks_activation`. An `unknown` verdict must
 * never set it — a probe we could not complete is not evidence of an unpublished app.
 */

const storeStatus: Record<string, { connected: boolean; config: Record<string, any> }> = {}

jest.mock("@/lib/supabase-server", () => ({
  createClient: jest.fn(() => ({
    rpc: (_fn: string, args: any) => ({
      single: async () => ({ data: storeStatus[args.p_provider] ?? { connected: false, config: {} } }),
    }),
  })),
}))

jest.mock("@/lib/tenant", () => ({
  requireTenant: jest.fn(async () => ({
    tenant: { id: "tenant-abc", livemode: true, name: "TestApp" },
    userId: "user-xyz",
  })),
}))

import { __clearLivenessCache } from "@/lib/store-liveness"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require("../../../app/api/providers/store-liveness/route")

function installFetch(byUrl: (url: string) => any) {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: unknown) =>
    byUrl(String(url)),
  )
}

beforeEach(() => {
  for (const k of Object.keys(storeStatus)) delete storeStatus[k]
  __clearLivenessCache()
  jest.clearAllMocks()
})

test("a store that is not connected yields no verdict and never blocks", async () => {
  installFetch(() => ({ ok: true, status: 200 }))
  const json = await (await GET()).json()

  expect(json.google_play.connected).toBe(false)
  expect(json.google_play.liveness).toBeNull()
  expect(json.app_store.connected).toBe(false)
  expect(json.blocks_activation).toBe(false)
})

test("connected but no package_name is a CONFIG gap, not a publishing gap", async () => {
  storeStatus.google_play = { connected: true, config: {} }
  installFetch(() => ({ ok: true, status: 200 }))

  const json = await (await GET()).json()
  expect(json.google_play.connected).toBe(true)
  expect(json.google_play.liveness).toBeNull()
  expect(json.google_play.reason).toMatch(/no package_name/i)
  // A missing id must not be reported as "your app is unpublished".
  expect(json.blocks_activation).toBe(false)
})

test("a live Play app + live App Store app → green, nothing blocked", async () => {
  storeStatus.google_play = { connected: true, config: { package_name: "com.example.live" } }
  storeStatus.app_store = { connected: true, config: { bundle_id: "com.example.live" } }
  installFetch((u) =>
    u.includes("play.google.com")
      ? { ok: true, status: 200 }
      : { ok: true, status: 200, json: async () => ({ resultCount: 1, results: [{ trackName: "Live" }] }) },
  )

  const json = await (await GET()).json()
  expect(json.google_play.liveness.status).toBe("live")
  expect(json.app_store.liveness.status).toBe("live")
  expect(json.blocks_activation).toBe(false)
})

test("an unpublished Play app blocks activation and carries the manual next step", async () => {
  storeStatus.google_play = { connected: true, config: { package_name: "com.example.draft" } }
  installFetch(() => ({ ok: false, status: 404 }))

  const json = await (await GET()).json()
  expect(json.google_play.liveness.status).toBe("not-published")
  expect(json.google_play.liveness.message).toMatch(/activate the base plan manually/i)
  expect(json.blocks_activation).toBe(true)
})

test("an unpublished App Store app blocks activation too (the store is checked, not just Play)", async () => {
  storeStatus.app_store = { connected: true, config: { bundle_id: "com.example.draft" } }
  installFetch(() => ({ ok: true, status: 200, json: async () => ({ resultCount: 0, results: [] }) }))

  const json = await (await GET()).json()
  expect(json.app_store.liveness.status).toBe("not-published")
  expect(json.app_store.liveness.message).toMatch(/App Store Connect/i)
  expect(json.blocks_activation).toBe(true)
})

test("an UNREACHABLE probe does not block — an outage is not evidence of an unpublished app", async () => {
  storeStatus.google_play = { connected: true, config: { package_name: "com.example.app" } }
  installFetch(() => {
    throw new Error("ECONNRESET")
  })

  const json = await (await GET()).json()
  expect(json.google_play.liveness.status).toBe("unknown")
  expect(json.blocks_activation).toBe(false)
})
