/**
 * Razorpay webhook registration — the Razorpay twin of the Stripe connect callback's
 * `webhookEndpoints.create`.
 *
 * Until 2026-11-13 PayCraft never registered a Razorpay webhook: the merchant typed a URL into
 * Razorpay's dashboard. The shared org test account ended up pointing at a dashboard route that does
 * not exist (404), and the live one at the tenant-less function URL, which the function then refused —
 * so no Razorpay delivery had ever reached PayCraft. Registration is now PayCraft's job, idempotent,
 * at ONE account-level URL (several apps can share one Razorpay account; the function reads the app
 * from the event notes).
 */
import {
  RAZORPAY_WEBHOOK_EVENTS,
  type RazorpayWebhookRow,
  ensureRazorpayWebhook,
  razorpayWebhookUrl,
  webhookCoverage,
} from "@/lib/razorpay-webhook"

const SB = "https://abc.supabase.co"
const T = "ef8688ea-cd8c-489c-ae52-0b0384fe45db"
const URL_ACCOUNT = `${SB}/functions/v1/razorpay-webhook`

function client(existing: RazorpayWebhookRow[]) {
  return {
    webhooks: {
      all: jest.fn(async () => ({ items: existing })),
      create: jest.fn(async (p: Record<string, unknown>): Promise<RazorpayWebhookRow> => ({ id: "wh_new", url: String(p.url), active: true })),
    },
  }
}

const allEvents = Object.fromEntries(RAZORPAY_WEBHOOK_EVENTS.map((e) => [e, true]))

test("the account-level URL carries no tenant segment", () => {
  expect(razorpayWebhookUrl(SB)).toBe(URL_ACCOUNT)
  expect(razorpayWebhookUrl(`${SB}/`)).toBe(URL_ACCOUNT)
})

test("the events cover every subscription state and one-time payments", () => {
  for (const e of ["subscription.authenticated", "subscription.activated", "subscription.charged",
    "subscription.halted", "subscription.cancelled", "subscription.completed", "payment.captured",
    "payment.failed", "refund.processed"]) {
    expect(RAZORPAY_WEBHOOK_EVENTS).toContain(e)
  }
})

test("creates the webhook when none points at PayCraft", async () => {
  const c = client([{ id: "wh_dead", url: "https://paycraft.example.com/api/webhooks/razorpay", active: true, events: allEvents }])
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "whsec_x", alertEmail: "ops@example.com" })
  expect(r).toMatchObject({ status: "created", id: "wh_new", url: URL_ACCOUNT })
  expect(c.webhooks.create).toHaveBeenCalledWith(expect.objectContaining({
    url: URL_ACCOUNT, secret: "whsec_x", alert_email: "ops@example.com",
  }))
  const sent = (c.webhooks.create.mock.calls[0] as unknown as [Record<string, unknown>])[0]
  expect(Object.keys(sent.events as object).sort()).toEqual([...RAZORPAY_WEBHOOK_EVENTS].sort())
})

test("is idempotent: an active webhook at the account URL is left alone", async () => {
  const c = client([{ id: "wh_ok", url: URL_ACCOUNT, active: true, events: allEvents }])
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "whsec_x" })
  expect(r).toMatchObject({ status: "ok", id: "wh_ok", missingEvents: [] })
  expect(c.webhooks.create).not.toHaveBeenCalled()
})

test("a per-app URL (/razorpay-webhook/{tenant}) also counts as registered", async () => {
  const c = client([{ id: "wh_app", url: `${URL_ACCOUNT}/${T}`, active: true, events: allEvents }])
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "whsec_x", tenantId: T })
  expect(r).toMatchObject({ status: "ok", id: "wh_app" })
  expect(c.webhooks.create).not.toHaveBeenCalled()
})

test("reports missing events on an existing webhook instead of creating a duplicate", async () => {
  const c = client([{ id: "wh_old", url: URL_ACCOUNT, active: true, events: { "payment.captured": true } }])
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "whsec_x" })
  expect(r.status).toBe("ok")
  expect(r.missingEvents).toContain("subscription.charged")
  expect(c.webhooks.create).not.toHaveBeenCalled()
})

test("an inactive webhook at our URL is reported, not duplicated", async () => {
  const c = client([{ id: "wh_off", url: URL_ACCOUNT, active: false, events: allEvents }])
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "whsec_x" })
  expect(r).toMatchObject({ status: "inactive", id: "wh_off" })
  expect(c.webhooks.create).not.toHaveBeenCalled()
})

test("without a webhook secret nothing is created (Razorpay signs with it; PayCraft must know it)", async () => {
  const c = client([])
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "" })
  expect(r.status).toBe("secret_missing")
  expect(c.webhooks.create).not.toHaveBeenCalled()
})

test("a Razorpay API failure is reported, never thrown", async () => {
  const c = client([])
  c.webhooks.all.mockRejectedValueOnce(new Error("Authentication failed"))
  const r = await ensureRazorpayWebhook(c, { supabaseUrl: SB, secret: "whsec_x" })
  expect(r).toMatchObject({ status: "error", message: "Authentication failed" })
})

test("webhookCoverage reads Razorpay's two event shapes (map and array)", () => {
  expect(webhookCoverage({ "payment.captured": true, "subscription.charged": false }))
    .toEqual(expect.arrayContaining(["subscription.charged"]))
  expect(webhookCoverage([...RAZORPAY_WEBHOOK_EVENTS])).toEqual([])
})
