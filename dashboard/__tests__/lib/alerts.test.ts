import { alertKindLabel, fetchAlerts, fetchInsights, inboxOrder, unreadCounts } from "@/lib/alerts"
import { fakeSupabase } from "../support/fake-supabase"

const A = "tenant-A"
const B = "tenant-B"
const alert = (id: string, o: Record<string, unknown>) => ({
  id, tenant_id: A, kind: "paid_not_granted", severity: "critical", title: id, body: "", stage: null, code: null,
  correlation: null, payload: {}, read_at: null, ...o,
})

function seed() {
  return fakeSupabase({
    tenant_alerts: [
      alert("crit-old-unread", { created_at: "2026-11-24T08:00:00Z" }),
      alert("crit-new-read", { created_at: "2026-11-24T10:00:00Z", read_at: "2026-11-24T10:05:00Z" }),
      alert("digest-unread", { kind: "abandon_digest", severity: "digest", created_at: "2026-11-24T09:00:00Z" }),
      alert("insight", { kind: "ai_insight", severity: "digest", created_at: "2026-11-24T11:00:00Z" }),
      alert("other-tenant", { tenant_id: B, created_at: "2026-11-24T12:00:00Z" }),
    ],
    alert_deliveries: [
      { alert_id: "crit-old-unread", channel: "email", status: "sent", attempts: 1, http_status: null, error: null },
      { alert_id: "crit-old-unread", channel: "slack", status: "failed", attempts: 2, http_status: 500, error: "HTTP 500" },
    ],
  })
}

describe("alerts inbox", () => {
  it("lists unread first, newest first within each group; excludes insights and other tenants", async () => {
    const rows = await fetchAlerts(seed().client, A, "all")
    expect(rows.map((r) => r.id)).toEqual(["digest-unread", "crit-old-unread", "crit-new-read"])
  })

  it("attaches each alert's deliveries", async () => {
    const rows = await fetchAlerts(seed().client, A, "all")
    expect(rows.find((r) => r.id === "crit-old-unread")!.deliveries.map((d) => `${d.channel}:${d.status}`)).toEqual(["email:sent", "slack:failed"])
    expect(rows.find((r) => r.id === "digest-unread")!.deliveries).toEqual([])
  })

  it("filters by severity and by unread", async () => {
    expect((await fetchAlerts(seed().client, A, "critical")).map((r) => r.id)).toEqual(["crit-old-unread", "crit-new-read"])
    expect((await fetchAlerts(seed().client, A, "digest")).map((r) => r.id)).toEqual(["digest-unread"])
    expect((await fetchAlerts(seed().client, A, "unread")).map((r) => r.id)).toEqual(["digest-unread", "crit-old-unread"])
  })

  it("insights are their own list", async () => {
    expect((await fetchInsights(seed().client, A)).map((r) => r.id)).toEqual(["insight"])
    expect(await fetchInsights(seed().client, B)).toEqual([])
  })

  it("unread counts are tenant-scoped and split out criticals (insight counts as unread digest)", async () => {
    expect(await unreadCounts(seed().client, A)).toEqual({ total: 3, critical: 1 })
    expect(await unreadCounts(seed().client, B)).toEqual({ total: 1, critical: 1 })
  })

  it("inboxOrder and labels", () => {
    expect(inboxOrder([{ read_at: "x", created_at: "2" }, { read_at: null, created_at: "1" }]).map((r) => r.created_at)).toEqual(["1", "2"])
    expect(alertKindLabel("webhook_sig_fail")).toBe("Webhook signature failures")
    expect(alertKindLabel("brand_new_kind")).toBe("brand new kind")
  })
})

describe("delivery errors on screen", () => {
  it("never show the channel URL a failed send quoted", async () => {
    const { client } = fakeSupabase({
      tenant_alerts: [alert("a1", { created_at: "2026-11-24T08:00:00Z" })],
      alert_deliveries: [{ alert_id: "a1", channel: "slack", status: "failed", attempts: 1, http_status: null, error: "error sending request for url (https://hooks.slack.com/services/T/B/SECRET)" }],
    })
    const [row] = await fetchAlerts(client, A, "all")
    expect(row.deliveries[0].error).not.toContain("SECRET")
    expect(row.deliveries[0].error).toContain("the channel's URL")
  })
})
