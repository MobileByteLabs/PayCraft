import { NextRequest, NextResponse } from "next/server"
import { detectCustomerCountry } from "@/lib/customer-geo"

export const dynamic = "force-dynamic"

// The visitor's country from the hosting edge's IP-geo header — what the web SDK prices by when the site has
// not called setCountry(). Supabase's edge does not forward cf-ipcountry to Edge Functions, so `config` cannot
// see the buyer's country for a browser; this host can. Same header order as `_shared/geo.ts`
// (detectCustomerCountry). Public and cookieless: any site embedding PayCraftWeb may call it.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "private, no-store",
  vary: "*",
}

export function GET(req: NextRequest) {
  return NextResponse.json({ country: detectCustomerCountry(req) }, { headers: CORS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
