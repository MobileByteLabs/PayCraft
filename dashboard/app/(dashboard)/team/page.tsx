export const runtime = "edge"

import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { TeamClient } from "./team-client"

/**
 * Team — REAL membership, from tenant_admins.
 *
 * WHAT THIS REPLACES. The page rendered entirely from two module-level fixtures, `MOCK_MEMBERS`
 * and `MOCK_PENDING`, so every account saw the same invented colleagues (including one at
 * "alex.dev@hotmail.com" who had supposedly joined in July 2024). On an access-control screen that
 * is the worst possible thing to fabricate: an operator auditing who can reach their billing data
 * saw people who do not exist, and would NOT have seen a real teammate who does.
 *
 * Membership now comes from `tenant_admins`, which is the same table the app's own authorization
 * checks read, so this page and the permission system cannot disagree.
 *
 * PENDING INVITATIONS have no backing table in the schema at all. Rather than keep a fixture
 * standing in for a feature that was never built, the list is passed through empty and the client
 * renders an honest empty state. A fake pending invite implies an invitation was sent, which is a
 * worse failure than an empty section.
 */
export default async function TeamPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: admins } = await supabase
    .from("tenant_admins")
    .select("id, user_id, role, created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true })

  // `tenant_admins` stores auth user ids, not emails, and auth.users is not readable from here.
  // The owner is identifiable because tenants.owner_email is a real column; everyone else renders
  // by role and join date, with the user id shown so a row is still traceable. Showing an id is
  // honest about what we know, where a fabricated name would not be.
  const ownerEmail = (tenant as { owner_email?: string }).owner_email ?? "Account owner"

  const members = (admins ?? []).map((a, i) => {
    const isOwner = a.role === "owner"
    const label = isOwner ? ownerEmail : `Team member ${i + 1}`
    return {
      id: a.id as string,
      name: label,
      email: isOwner ? ownerEmail : (a.user_id as string),
      role: a.role as "owner" | "admin" | "viewer",
      status: "active" as const,
      joined: new Date(a.created_at as string).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
      initials: label.slice(0, 2).toUpperCase(),
      avatarBg: "from-ink-400 to-ink-600",
    }
  })

  return <TeamClient initialMembers={members} initialPending={[]} />
}
