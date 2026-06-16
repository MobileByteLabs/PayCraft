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

  // Honor the active-app cookie if it points to a tenant the user is a member of.
  const cookieStore = cookies()
  const activeCookieId = cookieStore.get("paycraft_active_app_id")?.value
  const tenantIds: string[] = memberships.map((m: any) => m.tenant_id)

  const activeTenantId =
    activeCookieId && tenantIds.includes(activeCookieId)
      ? activeCookieId
      : tenantIds[0]

  return loadTenant(supabase, activeTenantId, user!.id)
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
