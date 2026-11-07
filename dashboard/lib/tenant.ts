import { createClient } from "@/lib/supabase-server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { Tenant } from "./types"

/** Get the current user's active tenant. Redirects to login if not authenticated. */
export async function requireTenant(): Promise<{ tenant: Tenant; userId: string }> {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  // Fetch all tenant memberships for this user.
  const { data: memberships } = await supabase.rpc("tenant_admins_list_for_user")

  if (!memberships?.length) {
    // First sign-in — no apps yet. Send the user through /onboarding so they
    // name the app themselves. NEVER auto-provision with their Google display
    // name (that ends up as "Rajan Maurya" or "John Doe" as the app brand).
    redirect("/onboarding")
  }

  const { tenantId } = pickActiveTenant(memberships.map((m: any) => m.tenant_id))
  return loadTenant(supabase, tenantId!, user!.id)
}

export type TenantResolution =
  | { tenantId: string; resolvedFrom: "query" | "cookie" | "default" }
  | { tenantId: null; resolvedFrom: "none" | "not_a_member" }

/**
 * Which app this request means, from the caller's memberships. THE one resolution rule — used by
 * requireTenant and by API routes that must not redirect.
 *
 *   explicit `requested` (e.g. `?tenant_id=`) wins, but ONLY if the user is a member; a non-member
 *   id is reported as `not_a_member`, never silently swapped for another app (that swap is how a
 *   caller reconciling one app ends up reading another's state);
 *   else the `paycraft_active_app_id` cookie, if it names a membership;
 *   else the first membership.
 */
export function pickActiveTenant(tenantIds: string[], requested?: string | null): TenantResolution {
  if (requested) {
    return tenantIds.includes(requested)
      ? { tenantId: requested, resolvedFrom: "query" }
      : { tenantId: null, resolvedFrom: "not_a_member" }
  }
  const activeCookieId = cookies().get("paycraft_active_app_id")?.value
  if (activeCookieId && tenantIds.includes(activeCookieId)) {
    return { tenantId: activeCookieId, resolvedFrom: "cookie" }
  }
  return tenantIds.length ? { tenantId: tenantIds[0], resolvedFrom: "default" } : { tenantId: null, resolvedFrom: "none" }
}

/** Resolve the caller's tenant without redirecting. Membership comes from the same RPC requireTenant uses. */
export async function resolveTenantForUser(
  supabase: ReturnType<typeof createClient>,
  requested?: string | null,
): Promise<TenantResolution> {
  const { data: memberships } = await supabase.rpc("tenant_admins_list_for_user")
  return pickActiveTenant((memberships ?? []).map((m: any) => m.tenant_id), requested)
}

async function loadTenant(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  userId: string,
): Promise<{ tenant: Tenant; userId: string }> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single()

  if (!tenant) redirect("/auth/login")
  return { tenant: tenant as Tenant, userId }
}

/** Get all tenants the current user is a member of (for AppSwitcher). */
export async function getUserApps(): Promise<{ id: string; name: string; plan: string }[]> {
  const supabase = createClient()
  const { data: memberships } = await supabase.rpc("tenant_admins_list_for_user")
  if (!memberships?.length) return []

  const tenantIds = memberships.map((m: any) => m.tenant_id)
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, name, plan")
    .in("id", tenantIds)
    .order("created_at")

  return (tenants ?? []) as { id: string; name: string; plan: string }[]
}
