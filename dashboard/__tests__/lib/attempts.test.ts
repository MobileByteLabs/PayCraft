import { createHash } from "crypto"
import { buyerRef, eventLabel, failingEvent, fetchAttemptTimeline, type AttemptRow } from "@/lib/attempts"
import { fakeSupabase } from "../support/fake-supabase"

// A buyer's attempts on the subscriber page: newest first, each with its own timeline oldest first, and NOTHING
// from another tenant or another buyer — the rows are seeded side by side so a missing filter shows up as a leak.
const A = "tenant-A"
const B = "tenant-B"
const U1 = "user-hash-1"
const U2 = "user-hash-2"

const attempt = (o: Partial<AttemptRow> & { id: string; tenant_id: string; user_ref: string; started_at: string }) => ({
  attempt_id: null, provider: "stripe", mode: "live", plan: "pro-monthly", state: "started", correlation: "exact",
  match_rule: null, stage: null, error_class: null, error_code: null, error_message: null,
  paid_at: null, granted_at: null, closed_at: null, ...o,
})
const ev = (attempt_id: string, tenant_id: string, event: string, stage: string, occurred_at: string, f: Partial<Record<"error_class" | "error_code" | "error_message", string>> = {}) =>
  ({ attempt_id, tenant_id, event, stage, occurred_at, error_class: null, error_code: null, error_message: null, ...f })

function seed() {
  return fakeSupabase({
    payment_attempts: [
      attempt({ id: "r1", tenant_id: A, user_ref: U1, attempt_id: "att-old", state: "granted", started_at: "2026-11-20T10:00:00Z" }),
      attempt({ id: "r2", tenant_id: A, user_ref: U1, attempt_id: "att-new", state: "failed", stage: "provider", error_class: "card_declined", error_code: "card_declined", error_message: "Your card was declined.", started_at: "2026-11-23T10:00:00Z" }),
      attempt({ id: "r3", tenant_id: A, user_ref: U1, attempt_id: null, state: "abandoned", correlation: null, started_at: "2026-11-21T09:00:00Z" }),
      // Leak probes: same buyer hash under tenant-B, and another buyer under tenant-A.
      attempt({ id: "rB", tenant_id: B, user_ref: U1, attempt_id: "att-b", state: "failed", started_at: "2026-11-24T10:00:00Z" }),
      attempt({ id: "rU2", tenant_id: A, user_ref: U2, attempt_id: "att-u2", state: "granted", started_at: "2026-11-24T11:00:00Z" }),
    ],
    attempt_events: [
      ev("att-new", A, "paycraft_checkout_start", "sdk", "2026-11-23T10:01:00Z"),
      ev("att-new", A, "started", "sdk", "2026-11-23T10:00:00Z"),
      ev("att-new", A, "failed", "provider", "2026-11-23T10:04:00Z", { error_class: "card_declined", error_code: "card_declined", error_message: "Your card was declined." }),
      ev("att-old", A, "started", "sdk", "2026-11-20T10:00:00Z"),
      ev("att-old", A, "granted", "entitlement", "2026-11-20T10:02:00Z"),
      // tenant-B row that names a tenant-A attempt id — must never be stitched onto A's timeline.
      ev("att-new", B, "paycraft_purchase_fail", "sdk", "2026-11-23T10:02:00Z"),
      ev("att-b", B, "failed", "provider", "2026-11-24T10:01:00Z"),
      ev("att-u2", A, "granted", "entitlement", "2026-11-24T11:02:00Z"),
    ],
  })
}

describe("fetchAttemptTimeline", () => {
  it("returns the buyer's attempts newest first, each with its events oldest first", async () => {
    const { client } = seed()
    const rows = await fetchAttemptTimeline(client, A, U1)
    expect(rows.map((r) => r.id)).toEqual(["r2", "r3", "r1"])
    expect(rows[0].events.map((e) => e.event)).toEqual(["started", "paycraft_checkout_start", "failed"])
    expect(rows[2].events.map((e) => e.event)).toEqual(["started", "granted"])
  })

  it("never returns another tenant's attempt or event (tenant-B probe)", async () => {
    const { client, calls } = seed()
    const rows = await fetchAttemptTimeline(client, A, U1)
    expect(rows.find((r) => r.id === "rB")).toBeUndefined()
    const allEvents = rows.flatMap((r) => r.events.map((e) => e.event))
    expect(allEvents).not.toContain("paycraft_purchase_fail")
    for (const c of calls) expect(c.filters).toContain(`eq:tenant_id=${A}`)
  })

  it("never returns another buyer's attempt (user-hash-2 probe)", async () => {
    const { client } = seed()
    const rows = await fetchAttemptTimeline(client, A, U1)
    expect(rows.find((r) => r.id === "rU2")).toBeUndefined()
  })

  it("an attempt recorded before attempt ids has an empty timeline, not someone else's", async () => {
    const { client } = seed()
    const rows = await fetchAttemptTimeline(client, A, U1)
    expect(rows.find((r) => r.id === "r3")!.events).toEqual([])
  })

  it("an empty buyer ref returns [] without querying", async () => {
    const { client, calls } = seed()
    expect(await fetchAttemptTimeline(client, A, "")).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("a buyer with no attempts returns []", async () => {
    const { client } = seed()
    expect(await fetchAttemptTimeline(client, A, "nobody")).toEqual([])
  })
})

describe("buyerRef", () => {
  it("is the same hash the events function and the payment_attempts view store: sha256(tenant:lower(email))", async () => {
    const expected = createHash("sha256").update(`${A}:carol@example.com`).digest("hex")
    expect(await buyerRef(A, "Carol@Example.com")).toBe(expected)
  })
})

describe("failingEvent + eventLabel", () => {
  it("names the step that failed, with its stage", async () => {
    const { client } = seed()
    const [failed, , granted] = await fetchAttemptTimeline(client, A, U1)
    expect(failingEvent(failed)).toMatchObject({ event: "failed", stage: "provider", error_code: "card_declined" })
    expect(failingEvent(granted)).toBeNull()
  })

  it("turns event names into readable steps", () => {
    expect(eventLabel("paycraft_plan_select")).toBe("Plan selected")
    expect(eventLabel("checkout_opened")).toBe("Checkout opened")
    expect(eventLabel("paid_not_granted")).toBe("Paid, not granted")
    expect(eventLabel("stitched:session_email")).toBe("Matched by rule session_email")
    expect(eventLabel("paycraft_some_new_thing")).toBe("Some new thing")
  })
})
