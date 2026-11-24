/**
 * /api/geo — the visitor's country for the web SDK's default region pricing (cmp-paycraft-web detectCountry).
 * Supabase's edge strips cf-ipcountry before `config` runs, so this host's IP-geo header is the only country a
 * browser gets. Public + cookieless (CORS *), never cached, and "XX" (the CDN's unknown country) is not a country.
 */
import { NextRequest } from "next/server"
import { GET, OPTIONS } from "@/app/api/geo/route"

const req = (headers: Record<string, string> = {}) => new NextRequest("https://paycraft.test/api/geo", { headers })

describe("/api/geo", () => {
  it("answers the edge's IP-geo country, public and uncached", async () => {
    const res = GET(req({ "cf-ipcountry": "IN" }))
    expect(await res.json()).toEqual({ country: "IN" })
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })

  it("reads the Vercel header too, and gives null for an unknown country", async () => {
    expect(await GET(req({ "x-vercel-ip-country": "BR" })).json()).toEqual({ country: "BR" })
    expect(await GET(req({ "cf-ipcountry": "XX" })).json()).toEqual({ country: null })
    expect(await GET(req()).json()).toEqual({ country: null })
  })

  it("lets browsers preflight it", () => {
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-methods")).toContain("GET")
  })
})
