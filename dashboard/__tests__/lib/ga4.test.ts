import { describe, expect, it, jest } from "@jest/globals"
import { GA4_SCOPE, ga4Overview, paycraftGa4Account, runReport } from "@/lib/ga4"

const SA_EMAIL = "paycraft-ga4@paycraft-prod.iam.gserviceaccount.com"
const deps = (fetchImpl: typeof fetch) => ({ token: async () => "tok", saEmail: SA_EMAIL, fetch: fetchImpl })
const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response

describe("runReport", () => {
  it("asks the GA4 Data API for the tenant's property with PayCraft's token", async () => {
    const f = jest.fn(async (_u: string | URL | Request, _i?: RequestInit) => json(200, { rows: [] }))
    const req = { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] }
    const r = await runReport("123456789", req, deps(f as unknown as typeof fetch))
    expect(r).toEqual({ ok: true, rows: [], withheld: false })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport")
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer tok")
    expect(JSON.parse(String(init!.body))).toEqual(req)
  })

  it("turns a 403 into what to do: add PayCraft's email as Viewer", async () => {
    const r = await runReport("123456789", { metrics: [] }, deps((async () => json(403, { error: { status: "PERMISSION_DENIED" } })) as unknown as typeof fetch))
    expect(r).toEqual({ ok: false, error: "no_access", fix: `Add ${SA_EMAIL} as a Viewer on GA4 property 123456789.` })
  })

  it("marks rows Google withholds (thresholding / other-row) so they are never shown as 0", async () => {
    const r = await runReport("123456789", { metrics: [] }, deps((async () => json(200, { rows: [], metadata: { subjectToThresholding: true } })) as unknown as typeof fetch))
    expect(r).toMatchObject({ ok: true, withheld: true })
    const other = await runReport("123456789", { metrics: [] }, deps((async () => json(200, { metadata: { dataLossFromOtherRow: true } })) as unknown as typeof fetch))
    expect(other).toMatchObject({ ok: true, withheld: true, rows: [] })
  })

  it("reports any other failure by status, and an unreachable API as such", async () => {
    expect(await runReport("1234567", { metrics: [] }, deps((async () => json(429, {})) as unknown as typeof fetch))).toEqual({ ok: false, error: "ga4_429" })
    expect(await runReport("1234567", { metrics: [] }, deps((async () => { throw new Error("offline") }) as unknown as typeof fetch))).toEqual({ ok: false, error: "ga4_unreachable" })
  })
})

describe("paycraftGa4Account", () => {
  it("reads PayCraft's service account from the environment, and mints with the read-only Analytics scope", async () => {
    expect(GA4_SCOPE).toBe("https://www.googleapis.com/auth/analytics.readonly")
    expect(paycraftGa4Account(undefined)).toBeNull()
    expect(paycraftGa4Account("not json")).toBeNull()
    const b64 = Buffer.from(JSON.stringify({ client_email: SA_EMAIL, private_key: "k" })).toString("base64")
    expect(paycraftGa4Account(b64)?.email).toBe(SA_EMAIL) // the org Firebase account is stored base64-encoded
    const mint = jest.fn(async (_sa: unknown, _scope: string) => "minted")
    const acct = paycraftGa4Account(JSON.stringify({ client_email: SA_EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" }), mint)!
    expect(acct.email).toBe(SA_EMAIL)
    expect(await acct.token()).toBe("minted")
    expect(await acct.token()).toBe("minted")
    expect(mint).toHaveBeenCalledTimes(1) // cached until it nears expiry
    expect(mint.mock.calls[0][1]).toBe(GA4_SCOPE)
  })
})

describe("ga4Overview", () => {
  it("totals, users per day and PayCraft's events by country — withheld flagged", async () => {
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      const req = JSON.parse(String(init!.body))
      const dims = (req.dimensions ?? []).map((d: { name: string }) => d.name).join(",")
      if (dims === "") return json(200, { rows: [{ metricValues: [{ value: "4812" }, { value: "9930" }] }] })
      if (dims === "date") return json(200, { rows: [{ dimensionValues: [{ value: "20261109" }], metricValues: [{ value: "700" }] }, { dimensionValues: [{ value: "20261108" }], metricValues: [{ value: "650" }] }] })
      return json(200, {
        rows: [
          { dimensionValues: [{ value: "paycraft_paywall_view" }, { value: "India" }], metricValues: [{ value: "1000" }] },
          { dimensionValues: [{ value: "paycraft_paywall_view" }, { value: "United States" }], metricValues: [{ value: "240" }] },
        ],
        metadata: { subjectToThresholding: true },
      })
    }) as unknown as typeof fetch
    const o = await ga4Overview("123456789", 7, deps(f))
    if (!o.ok) throw new Error(o.error)
    expect(o.totals).toEqual({ activeUsers: 4812, sessions: 9930, paywallViews: 1240 })
    expect(o.daily).toEqual([{ date: "2026-11-08", users: 650 }, { date: "2026-11-09", users: 700 }])
    expect(o.events[0]).toEqual({ event: "paycraft_paywall_view", country: "India", count: 1000 })
    expect(o.eventsWithheld).toBe(true)
    expect(o.totalsWithheld).toBe(false)
  })

  it("passes a failure through with its fix", async () => {
    const o = await ga4Overview("123456789", 7, deps((async () => json(403, {})) as unknown as typeof fetch))
    expect(o).toEqual({ ok: false, error: "no_access", fix: `Add ${SA_EMAIL} as a Viewer on GA4 property 123456789.` })
  })
})
