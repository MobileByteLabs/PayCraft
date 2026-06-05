import Link from "next/link"
import { Download, Search, Users } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Button, ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"

type Subscription = {
  id: string
  email: string
  plan: string | null
  provider: string | null
  status: string
  mode: string
  current_period_end: string | null
  created_at: string
}

const PER_PAGE = 25

const PROVIDER_TONES: Record<string, { dot: string; bg: string; text: string }> = {
  stripe: { dot: "bg-info-500", bg: "bg-info-50", text: "text-info-700" },
  razorpay: {
    dot: "bg-warning-500",
    bg: "bg-warning-50",
    text: "text-warning-700",
  },
  paypal: { dot: "bg-info-500", bg: "bg-info-50", text: "text-info-700" },
  paddle: { dot: "bg-ink-500", bg: "bg-ink-100", text: "text-ink-700" },
}

function statusTone(
  status: string,
): "success" | "info" | "neutral" | "danger" {
  if (status === "active") return "success"
  if (status === "trialing") return "info"
  if (status === "canceled" || status === "cancelled") return "neutral"
  if (status === "past_due" || status === "incomplete") return "danger"
  return "neutral"
}

export default async function SubscribersPage({
  searchParams,
}: {
  searchParams: {
    q?: string
    status?: string
    plan?: string
    provider?: string
    mode?: string
    page?: string
  }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const page = parseInt(searchParams.page ?? "1") || 1
  const offset = (page - 1) * PER_PAGE
  const mode = searchParams.mode ?? "live"

  let query = supabase
    .from("subscriptions")
    .select("id,email,plan,provider,status,mode,current_period_end,created_at", {
      count: "exact",
    })
    .eq("tenant_id", tenant.id)
    .eq("mode", mode)
    .order("updated_at", { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (searchParams.q) query = query.ilike("email", `%${searchParams.q}%`)
  if (searchParams.status) query = query.eq("status", searchParams.status)
  if (searchParams.plan) query = query.eq("plan", searchParams.plan)
  if (searchParams.provider) query = query.eq("provider", searchParams.provider)

  const { data, count } = await query

  // Stats
  const { data: stats } = await supabase
    .from("tenant_subscriber_count_view")
    .select("active_count,trial_count,canceled_count")
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE))
  const rows = (data as Subscription[]) ?? []

  return (
    <div>
      <PageHeader
        title="Subscribers"
        subtitle="Active subscriptions across all providers. Search by email, filter by status, plan, or provider."
        actions={
          <>
            <ButtonLink
              href={`/api/subscribers/export?mode=${mode}`}
              variant="secondary"
              leading={<Download className="w-4 h-4" strokeWidth={2.5} />}
            >
              Export CSV
            </ButtonLink>
          </>
        }
      />

      {/* Mode toggle pills */}
      <div className="flex items-center gap-1 mb-4">
        {[
          { value: "live", label: "Live" },
          { value: "test", label: "Test" },
        ].map((m) => (
          <Link
            key={m.value}
            href={`/subscribers?mode=${m.value}`}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === m.value
                ? "bg-ink-900 text-white"
                : "bg-white text-ink-700 border border-ink-200 hover:bg-ink-50"
            }`}
          >
            {m.label}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardBody className="!py-3 flex flex-wrap items-center gap-2">
          <form action="/subscribers" className="flex items-center gap-2 flex-1 min-w-[280px]">
            <input type="hidden" name="mode" value={mode} />
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" strokeWidth={2} />
              <input
                name="q"
                defaultValue={searchParams.q ?? ""}
                placeholder="Search by email..."
                className="input pl-9"
              />
            </div>
            <select name="status" defaultValue={searchParams.status ?? ""} className="input w-36">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="trialing">Trialing</option>
              <option value="canceled">Canceled</option>
              <option value="past_due">Past due</option>
            </select>
            <select name="provider" defaultValue={searchParams.provider ?? ""} className="input w-36">
              <option value="">All providers</option>
              <option value="stripe">Stripe</option>
              <option value="razorpay">Razorpay</option>
              <option value="paypal">PayPal</option>
            </select>
            <Button type="submit" size="sm">
              Filter
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatTile
          label="Active"
          value={(stats?.active_count ?? 0).toLocaleString()}
          tone="success"
        />
        <StatTile
          label="Trialing"
          value={(stats?.trial_count ?? 0).toLocaleString()}
          tone="info"
        />
        <StatTile
          label="Canceled (30d)"
          value={(stats?.canceled_count ?? 0).toLocaleString()}
          tone="neutral"
        />
        <StatTile
          label="Total this page"
          value={`${rows.length} / ${count ?? 0}`}
          tone="brand"
        />
      </div>

      <DataTable<Subscription>
        columns={[
          {
            key: "email",
            header: "Email",
            cell: (r) => (
              <Link
                href={`/subscribers/${r.id}`}
                className="text-sm font-medium text-ink-900 hover:text-brand-600"
              >
                {r.email}
              </Link>
            ),
          },
          {
            key: "plan",
            header: "Plan",
            cell: (r) => (
              <span className="code-inline">{r.plan ?? "—"}</span>
            ),
          },
          {
            key: "provider",
            header: "Provider",
            cell: (r) => {
              const t = PROVIDER_TONES[r.provider ?? ""] ?? {
                dot: "bg-ink-400",
                bg: "bg-ink-100",
                text: "text-ink-700",
              }
              return (
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${t.bg} ${t.text}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
                  {r.provider ?? "—"}
                </span>
              )
            },
          },
          {
            key: "status",
            header: "Status",
            cell: (r) => (
              <Badge tone={statusTone(r.status)} dot={r.status === "active"}>
                {r.status}
              </Badge>
            ),
          },
          {
            key: "period_end",
            header: "Period ends",
            align: "right",
            cell: (r) => (
              <span className="text-sm text-ink-700 tabular-nums font-mono">
                {r.current_period_end
                  ? formatDate(r.current_period_end)
                  : "—"}
              </span>
            ),
          },
          {
            key: "created",
            header: "Created",
            align: "right",
            cell: (r) => (
              <span className="text-sm text-ink-500 tabular-nums font-mono">
                {formatDate(r.created_at)}
              </span>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/subscribers/${r.id}`}
        empty={
          <EmptyState
            icon={<Users className="w-5 h-5" strokeWidth={2} />}
            title={
              searchParams.q || searchParams.status || searchParams.provider
                ? "No subscribers match your filter"
                : "No subscribers yet"
            }
            description={
              searchParams.q || searchParams.status || searchParams.provider
                ? "Try clearing some filters or switching to test mode."
                : "Subscriptions land here when users complete checkout. Make sure your providers are connected and webhooks are pointed at PayCraft."
            }
            action={
              <ButtonLink href="/providers" variant="secondary">
                Check provider setup
              </ButtonLink>
            }
          />
        }
        footer={
          rows.length > 0 ? (
            <>
              <span>
                Showing{" "}
                <span className="tabular-nums font-medium text-ink-700">
                  {offset + 1}–{Math.min(offset + PER_PAGE, count ?? 0)}
                </span>{" "}
                of{" "}
                <span className="tabular-nums font-medium text-ink-700">
                  {(count ?? 0).toLocaleString()}
                </span>
              </span>
              <div className="flex items-center gap-1">
                {page > 1 && (
                  <Link
                    href={`/subscribers?${new URLSearchParams({
                      ...stripUndefined(searchParams as any),
                      page: String(page - 1),
                    }).toString()}`}
                    className="px-2 py-1 rounded hover:bg-ink-100 text-ink-700"
                  >
                    Previous
                  </Link>
                )}
                <span className="px-2 text-ink-500 tabular-nums">
                  Page {page} / {totalPages}
                </span>
                {page < totalPages && (
                  <Link
                    href={`/subscribers?${new URLSearchParams({
                      ...stripUndefined(searchParams as any),
                      page: String(page + 1),
                    }).toString()}`}
                    className="px-2 py-1 rounded hover:bg-ink-100 text-ink-700"
                  >
                    Next
                  </Link>
                )}
              </div>
            </>
          ) : undefined
        }
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "success" | "info" | "neutral" | "brand"
}) {
  const toneClasses = {
    success: "text-success-600",
    info: "text-info-600",
    neutral: "text-ink-500",
    brand: "text-brand-600",
  }[tone]
  return (
    <Card className="!shadow-xs">
      <div className="p-3.5">
        <div className="text-2xs font-medium text-ink-500 uppercase tracking-wider mb-1">
          {label}
        </div>
        <div
          className={`text-xl font-semibold tabular-nums tracking-tight ${toneClasses}`}
        >
          {value}
        </div>
      </div>
    </Card>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function stripUndefined<T extends Record<string, any>>(o: T): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k in o) if (o[k] != null && o[k] !== "") out[k] = String(o[k])
  return out
}
