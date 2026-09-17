/**
 * Unit tests for `lib/store-liveness.ts`.
 *
 * These probes exist to disambiguate an opaque provider error. Play answers
 * "The app is not published." whether the app is genuinely in draft, the package name is
 * a typo, or the service account lacks permission — so we ask the PUBLIC storefront,
 * which is the same thing a user's device resolves.
 *
 * The load-bearing property is the THIRD state: a network failure must degrade to
 * `unknown`, never to `not-published`. Telling an operator their live app is unpublished
 * because our egress blipped is worse than saying nothing.
 */

import {
  checkPlayAppLive,
  checkAppStoreAppLive,
  playListingUrl,
  appStoreLookupUrl,
  __clearLivenessCache,
} from "@/lib/store-liveness"

function installFetch(impl: (url: string) => any) {
  const mock = jest.fn(async (url: unknown) => impl(String(url)))
  ;(global as unknown as { fetch: unknown }).fetch = mock
  return mock
}

beforeEach(() => {
  __clearLivenessCache()
  jest.clearAllMocks()
})

describe("Play", () => {
  test("200 → live", async () => {
    installFetch(() => ({ ok: true, status: 200 }))
    const v = await checkPlayAppLive("com.mobilebytesensei.cappy")
    expect(v.status).toBe("live")
    expect(v.live).toBe(true)
    expect(v.url).toBe(playListingUrl("com.mobilebytesensei.cappy"))
  })

  test("404 → not-published, with the manual-activation next step", async () => {
    installFetch(() => ({ ok: false, status: 404 }))
    const v = await checkPlayAppLive("com.example.draft")
    expect(v.status).toBe("not-published")
    expect(v.live).toBe(false)
    expect(v.message).toMatch(/not published on Play Store/i)
    expect(v.message).toMatch(/activate the base plan manually in Play Console/i)
  })

  test("a network failure is `unknown`, NOT `not-published`", async () => {
    installFetch(() => {
      throw new Error("ECONNREFUSED")
    })
    const v = await checkPlayAppLive("com.example.app")
    expect(v.status).toBe("unknown")
    expect(v.live).toBe(false)
    // Must not accuse the operator of having an unpublished app.
    expect(v.message).not.toMatch(/not published/i)
    expect(v.message).toMatch(/could not reach/i)
  })

  test("a 5xx or consent wall is `unknown`, not a verdict", async () => {
    installFetch(() => ({ ok: false, status: 503 }))
    expect((await checkPlayAppLive("com.example.app")).status).toBe("unknown")
  })

  test("an empty package name never probes the network", async () => {
    const mock = installFetch(() => ({ ok: true, status: 200 }))
    const v = await checkPlayAppLive("")
    expect(v.status).toBe("unknown")
    expect(mock).not.toHaveBeenCalled()
  })

  test("a resolved verdict is memoized so a bulk drain issues ONE probe", async () => {
    const mock = installFetch(() => ({ ok: true, status: 200 }))
    for (let i = 0; i < 5; i++) await checkPlayAppLive("com.example.same")
    expect(mock).toHaveBeenCalledTimes(1)
  })

  test("an `unknown` verdict is NOT memoized — a transient outage must not stick", async () => {
    const mock = installFetch(() => ({ ok: false, status: 503 }))
    await checkPlayAppLive("com.example.flaky")
    await checkPlayAppLive("com.example.flaky")
    expect(mock).toHaveBeenCalledTimes(2)
  })
})

describe("App Store", () => {
  test("resultCount > 0 → live, and names the app", async () => {
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ resultCount: 1, results: [{ trackName: "Cappy" }] }) }))
    const v = await checkAppStoreAppLive("com.mobilebytesensei.cappy")
    expect(v.status).toBe("live")
    expect(v.message).toMatch(/Cappy/)
    expect(v.url).toBe(appStoreLookupUrl("com.mobilebytesensei.cappy"))
  })

  test("resultCount 0 → not-published, with the manual next step", async () => {
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ resultCount: 0, results: [] }) }))
    const v = await checkAppStoreAppLive("com.example.draft")
    expect(v.status).toBe("not-published")
    expect(v.message).toMatch(/not live on the App Store/i)
    expect(v.message).toMatch(/App Store Connect/i)
  })

  test("a malformed body is `unknown`, not `not-published`", async () => {
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ unexpected: true }) }))
    const v = await checkAppStoreAppLive("com.example.app")
    expect(v.status).toBe("unknown")
    expect(v.message).not.toMatch(/not live/i)
  })

  test("a network failure is `unknown`", async () => {
    installFetch(() => {
      throw new Error("ETIMEDOUT")
    })
    expect((await checkAppStoreAppLive("com.example.app")).status).toBe("unknown")
  })
})
