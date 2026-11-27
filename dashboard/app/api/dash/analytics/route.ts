import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { getMode } from "@/lib/mode"
import { rangeDays } from "@/lib/funnel"
import { joinedAnalytics, segmentRows } from "@/lib/analytics-joined"
import { ga4Overview, paycraftGa4Account } from "@/lib/ga4"
import { readFilters, type AnalyticsSearch } from "@/lib/analytics-search"

/**
 * The server half of the Analytics page — the parts that need PayCraft's GA4 service account
 * (PAYCRAFT_GA4_SA_JSON). The page reads everything else from Supabase in the browser.
 *
 *   ?part=joined  the joined report (provider-truth funnel + Payment health + GA4 segments) for the URL's filters
 *   ?part=ga4     the GA4 connection, PayCraft's Viewer email and the property overview
 *
 * `range` is capped by the plan's analytics retention HERE, not trusted from the browser.
 */
export async function GET(req: NextRequest) {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const search = Object.fromEntries(req.nextUrl.searchParams) as AnalyticsSearch & { part?: string }

  const tierRes = await supabase
    .from("tier_definitions")
    .select("analytics_retention_days")
    .eq("tier_name", tenant.plan ?? "free")
    .maybeSingle()
  const range = rangeDays(search.range, tierRes.data?.analytics_retention_days ?? 7)
  const ga4Account = paycraftGa4Account()

  if (search.part === "ga4") {
    const { data: connection, error } = await supabase
      .from("tenant_ga4_connections")
      .select("property_id,verified_at,last_error,stream_ids")
      .eq("tenant_id", tenant.id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const overview = ga4Account && connection?.verified_at
      ? await ga4Overview(connection.property_id, range.days, { token: ga4Account.token, saEmail: ga4Account.email }, connection.stream_ids ?? [])
      : null
    return NextResponse.json({ saEmail: ga4Account?.email ?? null, connection: connection ?? null, overview, days: range.days })
  }

  // A read failure is reported as such, never as an empty (healthy-looking) report.
  try {
    const joined = await joinedAnalytics(supabase, tenant.id, await getMode(), { days: range.days, ...readFilters(search) }, { account: ga4Account })
    return NextResponse.json({
      joined,
      segments: {
        platform: segmentRows(joined.ga4?.byPlatform ?? null, joined.paycraft.by_platform ?? []),
        country: segmentRows(joined.ga4?.byCountry ?? null, joined.paycraft.by_country),
        appVersion: segmentRows(joined.ga4?.byAppVersion ?? null, joined.paycraft.by_app_version ?? []),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
