import { createClient } from "@/lib/supabase-server"
import { redirect } from "next/navigation"
import type { Tenant } from "./types"

/** Get the current user's tenant. Redirects to login if not authenticated. */
export async function requireTenant(): Promise<{ tenant: Tenant; userId: string }> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect("/auth/login")
  }

  const { data: admin } = await supabase
    .from("tenant_admins")
    .select("tenant_id")
    .eq("user_id", session.user.id)
    .single()

  if (!admin) {
    redirect("/auth/login")
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", admin.tenant_id)
    .single()

  if (!tenant) {
    redirect("/auth/login")
  }

  return { tenant: tenant as Tenant, userId: session.user.id }
}
