export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Per-provider, PER-MODE readiness for the bound tenant.
 *
 * GET /api/providers/readiness
 *
 * Returns:
 *   200 {
 *     tenant_id,
 *     providers: [{ provider, auth_kind, is_active, live_ready, test_ready,
 *                   live_detail, test_detail, test_mechanism, human_action }],
 *     summary: { live_ready, test_ready, blocked_on_human }
 *   }
 *
 * WHY THIS EXISTS SEPARATELY FROM /api/providers
 * `tenant_providers_resolved_list` answers one question — "does this provider bill at all?" — with
 * a single boolean. That cannot express the state anyone actually needs, because a provider can be
 * perfectly connected for LIVE and have no way to transact a TEST purchase at all. Measured on
 * cappy: stripe `connected=true` with `test_payment_links: {}`, so a debug build resolved an empty
 * map and its checkout button did nothing.
 *
 * TWO CONSUMERS, ONE SHAPE. The dashboard renders these rows as per-mode badges; `/idea-paycraft`
 * reads the SAME endpoint to decide what it can fix and what needs a human. A second, subtly
 * different readiness calculation on the CLI side is exactly the drift this avoids.
 *
 * `human_action` is non-null ONLY when something is genuinely outstanding, and it names a concrete
 * step. For store providers that step is a console action with no API — Play license testing, an
 * App Store sandbox tester — which is why the caller must be able to distinguish "I can fix this"
 * from "a person must do this", rather than retrying forever.
 */
export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data, error } = await supabase.rpc("tenant_providers_mode_readiness", {
    p_tenant_id: tenant.id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type Row = {
    provider: string
    auth_kind: "key_pair" | "store"
    is_active: boolean
    live_ready: boolean
    test_ready: boolean
    live_detail: string
    test_detail: string
    test_mechanism: string
    human_action: string | null
  }
  const providers = (data ?? []) as Row[]

  return NextResponse.json({
    tenant_id: tenant.id,
    providers,
    // Rolled up here rather than in each caller: "is this tenant testable at all?" is the question
    // both the dashboard banner and /idea-paycraft's gate ask, and two implementations of it would
    // eventually disagree about whether an inactive provider counts.
    summary: {
      live_ready: providers.some((p) => p.is_active && p.live_ready),
      test_ready: providers.some((p) => p.is_active && p.test_ready),
      blocked_on_human: providers.filter((p) => p.human_action).map((p) => p.provider),
    },
  })
}
