import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { GraceBannerView } from "@/components/billing/grace-banner-view"

/**
 * GraceBanner — server component mounted in the dashboard layout.
 *
 * Reads the active tenant's `grace_started_at` + `over_limit_warned_at` columns
 * (migration 036_tier_enforcement.sql) together with the live subscriber-cap
 * usage view, and renders one of three states above the dashboard nav:
 *
 *   1. `grace_started_at IS NOT NULL`  → red sticky banner with a 7-day
 *      countdown ("X days until features lock"), live "N / cap subscribers"
 *      meter, and a primary Upgrade CTA.
 *   2. `over_limit_warned_at IS NOT NULL` (80% warn, not yet in grace)
 *      → amber sticky banner with the same meter + secondary CTA.
 *   3. Neither → renders nothing (AC-44: banner is *only* visible when
 *      tenant has crossed the 80% threshold or entered grace).
 *
 * Style matches `dashboard/app/(dashboard)/billing/page.tsx` (warning/danger
 * tokens, ButtonLink primitive, lucide icons).
 */
export async function GraceBanner() {
  const { tenant } = await requireTenant()

  // Cheap exit — Pro / Enterprise tenants have NULL grace fields after upgrade
  // because `upgrade_tenant_plan()` resets them. Skipping for non-free tiers
  // also keeps a noisy banner off Enterprise dashboards.
  if (tenant.plan !== "free") return null

  const supabase = createClient()

  // The grace columns live on `tenants` but are not surfaced by the existing
  // `Tenant` type (see dashboard/lib/types.ts). Fetch them explicitly here so
  // we don't widen the shared type for one banner.
  const [graceRes, usageRes, tierRes] = await Promise.all([
    supabase
      .from("tenants")
      .select("grace_started_at, over_limit_warned_at")
      .eq("id", tenant.id)
      .maybeSingle(),
    supabase
      .from("tenant_subscriber_count_view")
      .select("active_count")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("tier_definitions")
      .select("max_active_subscribers")
      .eq("tier_name", tenant.plan)
      .maybeSingle(),
  ])

  const graceStartedAt = (graceRes.data as { grace_started_at: string | null } | null)
    ?.grace_started_at ?? null
  const warnedAt = (graceRes.data as { over_limit_warned_at: string | null } | null)
    ?.over_limit_warned_at ?? null

  return (
    <GraceBannerView
      graceStartedAt={graceStartedAt}
      warnedAt={warnedAt}
      active={usageRes.data?.active_count ?? 0}
      limit={tierRes.data?.max_active_subscribers ?? null}
    />
  )
}
