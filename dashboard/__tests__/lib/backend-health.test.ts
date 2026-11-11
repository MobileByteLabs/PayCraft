import { backendChecks, checkBackend } from "@/lib/backend-health"

const res = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status })) as ReturnType<typeof fetch>

describe("backend health folded into /health", () => {
  it("maps each backend check, prefixed", () => {
    const c = backendChecks(503, { checks: { db: { ok: true }, stripe_live: { ok: false, detail: "2 event(s) Stripe cannot deliver" } } }, 5)
    expect(c.map((x) => [x.name, x.ok])).toEqual([["backend:db", true], ["backend:stripe_live", false]])
    expect(c[1].detail).toBe("2 event(s) Stripe cannot deliver")
  })

  it("an answer without checks is a failure, never a silent pass", () => {
    expect(backendChecks(502, null, 1)).toEqual([expect.objectContaining({ name: "backend", ok: false })])
  })

  it("an unreachable backend is a failure", async () => {
    const c = await checkBackend("https://x.supabase.co", (() => Promise.reject(new Error("timeout"))) as typeof fetch)
    expect(c).toEqual([expect.objectContaining({ name: "backend", ok: false, detail: "unreachable: timeout" })])
  })

  it("calls the health function on the project URL", async () => {
    const seen: string[] = []
    await checkBackend("https://x.supabase.co", ((u: string) => (seen.push(u), res(200, { checks: { db: { ok: true } } }))) as typeof fetch)
    expect(seen).toEqual(["https://x.supabase.co/functions/v1/health"])
  })
})
