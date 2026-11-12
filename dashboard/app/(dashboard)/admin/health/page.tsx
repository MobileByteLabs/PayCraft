import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { checkBackend } from "@/lib/backend-health"

export const dynamic = "force-dynamic"

// Platform health for the PayCraft operator: live checks (supabase/functions/health) and the incident
// history behind the alert emails (migration 185). Platform-owner only — RLS on health_incidents
// enforces the same rule the page does.

type Incident = {
  id: string
  check_name: string
  opened_at: string
  resolved_at: string | null
  first_detail: string | null
  last_detail: string | null
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"

function duration(from: string, to: string | null): string {
  const mins = Math.max(1, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000))
  return mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`
}

export default async function AdminHealthPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: isOwner } = await supabase.rpc("is_platform_owner")
  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto pt-20 text-center">
        <h1 className="text-2xl font-bold text-ink-900">Platform health is admin-only</h1>
      </div>
    )
  }

  const [checks, { data: incidents }] = await Promise.all([
    checkBackend(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    supabase.from("health_incidents").select("*").order("opened_at", { ascending: false }).limit(50),
  ])
  const rows = (incidents ?? []) as Incident[]
  const open = rows.filter((r) => !r.resolved_at)
  const allOk = checks.every((c) => c.ok)

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Platform health</h1>
        <p className="mt-1 text-sm text-ink-500">
          Polled every 15 minutes and on every visit to <code>/health</code>. A failing check opens an incident and
          emails the platform owner once; recovery emails again.
        </p>
      </div>

      <section className={`rounded-xl border p-5 ${allOk ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
        <p className={`font-semibold ${allOk ? "text-green-800" : "text-red-800"}`}>
          {allOk ? "All systems healthy" : `${checks.filter((c) => !c.ok).length} check(s) failing`}
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {checks.map((c) => (
            <li key={c.name} className="flex gap-3">
              <span className={c.ok ? "text-green-700" : "text-red-700"}>{c.ok ? "●" : "▲"}</span>
              <span className="font-mono text-ink-900">{c.name.replace("backend:", "")}</span>
              <span className="text-ink-500">{c.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink-900">
          Incidents {open.length > 0 && <span className="text-red-700">· {open.length} open</span>}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No incidents recorded.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-ink-500">
              <tr>
                <th className="py-2">Check</th>
                <th>Opened</th>
                <th>Duration</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-ink-100 align-top">
                  <td className="py-2 font-mono">{r.check_name}</td>
                  <td>{fmt(r.opened_at)}</td>
                  <td className={r.resolved_at ? "text-ink-700" : "text-red-700 font-semibold"}>
                    {r.resolved_at ? duration(r.opened_at, r.resolved_at) : `open · ${duration(r.opened_at, null)}`}
                  </td>
                  <td className="text-ink-500">{r.last_detail ?? r.first_detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
