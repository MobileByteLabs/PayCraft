import { Mail, Plus, ShieldCheck, Users2 } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { InviteForm } from "@/components/team/invite-form"

interface Member {
  user_id: string
  role: "owner" | "admin" | "viewer"
  created_at: string
  email: string | null
}

export default async function TeamPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: admins } = await supabase
    .from("tenant_admins")
    .select("user_id,role,created_at")
    .eq("tenant_id", tenant.id)

  // Hydrate email for each admin from auth.users via admin RPC.
  // Since this RPC isn't tenant-scoped, fall back to showing user_id snippet.
  const members: Member[] = (admins ?? []).map((row: any) => ({
    user_id: row.user_id,
    role: row.role,
    created_at: row.created_at,
    email: null,
  }))

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle="Invite teammates to manage your PayCraft tenant. Owners can rotate API keys and upgrade tiers. Admins manage products and providers. Viewers see analytics + audit only."
      />

      <Card className="mb-6 animate-slide-up">
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              Invite a teammate
            </h3>
            <p className="text-xs text-ink-500 mt-0.5">
              They'll receive a magic-link sign-in via email.
            </p>
          </div>
          <Badge tone="brand">{members.length} members</Badge>
        </div>
        <CardBody>
          <InviteForm tenantId={tenant.id} />
        </CardBody>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-ink-100 flex items-center gap-2">
          <Users2 className="w-4 h-4 text-ink-500" strokeWidth={2} />
          <h3 className="text-sm font-semibold text-ink-900">Members</h3>
        </div>
        {members.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Users2 className="w-5 h-5" />}
              title="No teammates yet"
              description="You're the only admin on this tenant. Invite a teammate above to share access."
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-ink-100">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center gap-4 px-5 py-4 hover:bg-ink-50/40 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                  {(m.email ?? m.user_id).substring(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">
                    {m.email ?? (
                      <span className="font-mono text-xs text-ink-500">
                        {m.user_id.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    Added{" "}
                    {new Date(m.created_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
                <Badge
                  tone={
                    m.role === "owner"
                      ? "brand"
                      : m.role === "admin"
                      ? "info"
                      : "neutral"
                  }
                >
                  {m.role}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-4 mt-8 text-xs">
        <RoleCard
          name="Owner"
          tone="brand"
          permissions={[
            "Rotate API keys",
            "Upgrade tier + billing",
            "Add/remove team members",
            "Everything Admin can do",
          ]}
        />
        <RoleCard
          name="Admin"
          tone="info"
          permissions={[
            "Manage products + pricing",
            "Connect providers",
            "Edit paywall design",
            "View analytics + audit",
          ]}
        />
        <RoleCard
          name="Viewer"
          tone="neutral"
          permissions={[
            "View analytics + dashboards",
            "View audit log",
            "Read-only on subscribers",
            "Cannot modify config",
          ]}
        />
      </div>
    </div>
  )
}

function RoleCard({
  name,
  tone,
  permissions,
}: {
  name: string
  tone: "brand" | "info" | "neutral"
  permissions: string[]
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-3.5 h-3.5 text-ink-400" strokeWidth={2} />
          <Badge tone={tone}>{name}</Badge>
        </div>
        <ul className="space-y-1.5 text-ink-600">
          {permissions.map((p) => (
            <li key={p} className="flex items-start gap-1.5">
              <span className="text-ink-300 mt-0.5">·</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
