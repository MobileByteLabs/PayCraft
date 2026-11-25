/**
 * Owner alerts end to end (paycraft-attempt-observability phase 3, AC-7): REAL Postgres at migration 211,
 * the REAL alert engine and sender (supabase/functions/attempt-alerts/engine.ts → _shared/alert-channels.ts →
 * _shared/email.ts), REAL HTTP to local receivers. Nothing outbound leaves 127.0.0.1: Slack, the tenant's
 * webhook endpoint and Resend are in-process `Deno.serve` captors (RESEND_API_URL points email.ts at one).
 *
 * The engine runs in-process against the database through `serviceRpcClient()` — the same RPCs the deployed
 * function calls, as the service role, without this suite ever holding the service-role key (harness.ts). The
 * deployed function's own door is checked over HTTP (it refuses a caller that is not the service role).
 *
 *   S1 paid_not_granted → stored once, delivered to email + Slack + signed webhook + inbox within 5 s; the
 *      X-PayCraft-Signature verifies against the tenant's STORED secret; a second run is deduped.
 *   S2 7 abandons in the previous hour → one abandon_digest; a second digest run in that hour adds nothing.
 *   S3 Slack answering 500 never blocks the other channels; the failed delivery is retried when due.
 *   S4 failure_rate_spike fires only at >= 5 failures AND >= 3x the trailing 7-day hourly rate.
 *   S5 webhook signature refusals → webhook_sig_fail per provider.
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/attempt-alerts.e2e.test.ts
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dropTenant,
  FUNCTIONS_URL,
  psql,
  psqlRows,
  requireLocalStack,
  type SeededTenant,
  seedTenant,
  serviceRpcClient,
  sqlLit,
  withClock,
} from "./harness.ts";

// ── Local receivers ──────────────────────────────────────────────────────────────────────────────────────

interface Captured {
  path: string;
  headers: Headers;
  body: string;
}

class Receiver {
  requests: Captured[] = [];
  status = 200;
  private server: Deno.HttpServer<Deno.NetAddr>;
  constructor() {
    this.server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (req) => {
      this.requests.push({ path: new URL(req.url).pathname, headers: req.headers, body: await req.text() });
      return new Response(this.status < 400 ? JSON.stringify({ id: `rcv_${this.requests.length}` }) : "receiver failure", {
        status: this.status,
        headers: { "content-type": "application/json" },
      });
    });
  }
  url(path: string): string {
    return `http://127.0.0.1:${this.server.addr.port}${path}`;
  }
  async close() {
    await this.server.shutdown();
  }
}

const slack = new Receiver();
const hook = new Receiver();
const resend = new Receiver();

// email.ts reads its endpoint + key when first imported: point it at the local Resend captor BEFORE the
// engine loads. The key is a local placeholder (no real Resend account is ever reached).
Deno.env.set("RESEND_API_URL", resend.url("/emails"));
Deno.env.set("RESEND_API_KEY", "re_local_e2e_placeholder");
Deno.env.set("CONFIG_SKIP_SERVE", "1");
const engine = await import("../../supabase/functions/attempt-alerts/engine.ts");
const channels = await import("../../supabase/functions/_shared/alert-channels.ts");

const db = serviceRpcClient();
const WEBHOOK_SECRET = "pcwh_e2e_secret_0123456789abcdef";

Deno.test({ name: "e2e: local stack is up", fn: requireLocalStack, sanitizeResources: false, sanitizeOps: false });

/**
 * A tenant whose channels point at the local receivers. Written directly, encrypted with the database's own
 * passphrase (attempt-correlation's way): tenant_alert_channels_save refuses the dev-default passphrase a
 * local stack ships with — the SQL test (211_attempt_alerts_test.sql) proves the save RPC itself.
 */
async function seedAlertTenant(name: string, opts: { slack?: boolean; webhook?: boolean } = {}): Promise<SeededTenant> {
  const t = await seedTenant({ name });
  const enc = (v: string) => `extensions.pgp_sym_encrypt(${sqlLit(v)}, (SELECT passphrase FROM paycraft_secrets_config WHERE id))`;
  await psql(`
    INSERT INTO tenant_alert_channels (tenant_id, email_enabled, inbox_enabled, slack_url_enc, webhook_url_enc, webhook_secret_enc)
    VALUES (${sqlLit(t.id)}::uuid, true, true,
            ${opts.slack === false ? "NULL" : enc(slack.url(`/slack/${t.id}`))},
            ${opts.webhook === false ? "NULL" : enc(hook.url(`/hook/${t.id}`))},
            ${opts.webhook === false ? "NULL" : enc(WEBHOOK_SECRET)})`);
  return t;
}

async function alertsOf(tenantId: string, kind: string): Promise<string[][]> {
  return await psqlRows(`SELECT id, dedupe_key, severity, title FROM tenant_alerts
                          WHERE tenant_id = ${sqlLit(tenantId)}::uuid AND kind = ${sqlLit(kind)} ORDER BY created_at`);
}

async function deliveriesOf(alertId: string): Promise<Record<string, { status: string; attempts: number; http: string; next: string }>> {
  const rows = await psqlRows(`SELECT channel, status, attempts, coalesce(http_status::text, ''), coalesce(next_retry_at::text, '')
                                 FROM alert_deliveries WHERE alert_id = ${sqlLit(alertId)}::uuid`);
  return Object.fromEntries(rows.map(([c, s, a, h, n]) => [c, { status: s, attempts: Number(a), http: h, next: n }]));
}

const forTenant = (r: Receiver, prefix: string, tenantId: string) => r.requests.filter((q) => q.path === `${prefix}/${tenantId}`);
const opts = { sanitizeResources: false, sanitizeOps: false };

Deno.test({
  ...opts,
  name: "S1 paid_not_granted: stored once, sent to email + Slack + signed webhook + inbox within 5 s; repeat deduped",
  fn: () =>
    withClock("2026-11-25T10:20:00Z", async (clock) => {
      const t = await seedAlertTenant("alerts_png");
      try {
        await psql(`
          INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, plan, outcome, provider_session_id,
                                         attempt_id, state, correlation, paid_at, occurred_at)
          VALUES (${sqlLit(t.id)}::uuid, 'stripe', 'live', 'u-png', 'pro-monthly', 'abandoned', ${sqlLit(`cs_png_${t.id}`)},
                  ${sqlLit(`att-png-${t.id}`)}, 'provider_result', 'exact', ${sqlLit(clock.plus(-15 * 60_000).toISOString())},
                  ${sqlLit(clock.plus(-20 * 60_000).toISOString())})`);
        await psql(`SELECT attempt_stitch_run(${sqlLit(clock.iso())}::timestamptz, 10, 120)`);

        const started = performance.now();
        const run = await engine.runCritical(db, clock.now());
        const elapsedMs = performance.now() - started;
        assertEquals(run.errors, []);
        assert(elapsedMs < 5000, `critical dispatch took ${elapsedMs} ms`);

        const alerts = await alertsOf(t.id, "paid_not_granted");
        assertEquals(alerts.length, 1);
        const [alertId, key, severity, title] = alerts[0];
        assertEquals([key, severity], [`att-png-${t.id}`, "critical"]);
        assertStringIncludes(title, "Paid but not granted");

        const d = await deliveriesOf(alertId);
        assertEquals(Object.keys(d).sort(), ["email", "inbox", "slack", "webhook"]);
        for (const c of ["email", "inbox", "slack", "webhook"]) assertEquals(d[c].status, "sent", c);

        // Email reached the (local) Resend API addressed to the owner.
        const mail = resend.requests.map((r) => JSON.parse(r.body)).filter((b) => b.subject.includes(`att-png-${t.id}`) || b.html.includes(`att-png-${t.id}`));
        assertEquals(mail.length, 1);
        assertEquals(mail[0].to, "e2e@example.test");
        assertEquals(resend.requests.at(-1)!.headers.get("authorization"), "Bearer re_local_e2e_placeholder");

        // Slack got the title; the webhook got a body signed with the tenant's STORED secret.
        assertStringIncludes(JSON.parse(forTenant(slack, "/slack", t.id)[0].body).text, "Paid but not granted");
        const req = forTenant(hook, "/hook", t.id)[0];
        const stored = (await db.rpc("tenant_alert_channels_decrypt", { p_tenant_id: t.id })).data[0].webhook_secret;
        assertEquals(stored, WEBHOOK_SECRET);
        const sig = req.headers.get("X-PayCraft-Signature")!;
        assertEquals(sig.split(",")[0], `t=${req.headers.get("X-PayCraft-Timestamp")}`);
        assert(
          await channels.verifyWebhookSignature(stored, sig, req.body, { nowSec: Math.floor(clock.now().getTime() / 1000) }),
          "X-PayCraft-Signature must verify against the stored tenant secret",
        );
        assertEquals(JSON.parse(req.body).payload.attempt_id, `att-png-${t.id}`);

        // A second critical run (the next 5-minute tick) dedupes: no new alert, nothing re-sent.
        const again = await engine.runCritical(db, clock.plus(5 * 60_000));
        assertEquals((await alertsOf(t.id, "paid_not_granted")).length, 1);
        assert(again.deduped >= 1, JSON.stringify(again));
        assertEquals(forTenant(hook, "/hook", t.id).length, 1);
      } finally {
        await dropTenant(t.id);
      }
    }),
});

Deno.test({
  ...opts,
  name: "S2 abandon_digest: 7 abandons in the previous hour → one digest per tenant per hour",
  fn: () =>
    withClock("2026-11-25T11:13:00Z", async (clock) => {
      const t = await seedAlertTenant("alerts_digest", { webhook: false });
      try {
        await psql(`
          INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, plan, outcome, provider_session_id,
                                         attempt_id, state, error_code, closed_at, occurred_at)
          SELECT ${sqlLit(t.id)}::uuid, CASE WHEN i % 2 = 0 THEN 'stripe' ELSE 'razorpay' END, 'live', 'u-' || i,
                 'pro-monthly', 'abandoned', 'cs_dg_' || i || '_' || ${sqlLit(t.id)}, 'att-dg-' || i || '-' || ${sqlLit(t.id)},
                 'abandoned', 'no_result_120m', '2026-11-25T10:05:00Z'::timestamptz + make_interval(mins => i * 7),
                 '2026-11-25T08:00:00Z'
            FROM generate_series(0, 6) i`);
        const run = await engine.runDigest(db, clock.now());
        assertEquals(run.errors, []);
        const alerts = await alertsOf(t.id, "abandon_digest");
        assertEquals(alerts.length, 1);
        assertEquals(alerts[0][1], "hour-2026-11-25T10");
        assertEquals(alerts[0][2], "digest");
        assertStringIncludes(alerts[0][3], "7 checkouts abandoned between 10:00 and 11:00 UTC");
        const d = await deliveriesOf(alerts[0][0]);
        assertEquals(Object.keys(d).sort(), ["email", "inbox", "slack"]);
        assertStringIncludes(JSON.parse(forTenant(slack, "/slack", t.id)[0].body).text, "razorpay 3");

        await engine.runDigest(db, clock.plus(20 * 60_000));
        assertEquals((await alertsOf(t.id, "abandon_digest")).length, 1, "a second digest call in the same hour adds no row");
        assertEquals((await alertsOf(t.id, "decline_digest")).length, 0, "no declines → no decline digest");
      } finally {
        await dropTenant(t.id);
      }
    }),
});

Deno.test({
  ...opts,
  name: "S3 one failed channel never blocks others — Slack 500 is failed + retried when due, the rest are sent",
  fn: () =>
    withClock("2026-11-25T12:00:00Z", async (clock) => {
      const t = await seedAlertTenant("alerts_fault");
      slack.status = 500;
      try {
        const r = await channels.deliverAlert(db, {
          tenantId: t.id, kind: "webhook_sig_fail", severity: "critical", dedupeKey: "stripe_signature",
          title: "Webhook signature check failing — stripe", body: "3 stripe webhooks refused.", at: clock.now(),
        }, { now: () => clock.now() });
        assert(r.alertId);
        let d = await deliveriesOf(r.alertId);
        assertEquals([d.slack.status, d.slack.attempts, d.slack.http], ["failed", 1, "500"]);
        assertEquals(new Date(d.slack.next).toISOString(), clock.plus(2 * 60_000).toISOString());
        for (const c of ["email", "webhook", "inbox"]) assertEquals(d[c].status, "sent", c);

        // Not due yet → nothing re-sent; due → only Slack re-sent, now succeeding.
        const early = await engine.runRetry(db, clock.plus(60_000));
        assertEquals(early.retried, 0);
        slack.status = 200;
        const hooksBefore = forTenant(hook, "/hook", t.id).length;
        const due = await engine.runRetry(db, clock.plus(3 * 60_000));
        assert(due.retried >= 1);
        d = await deliveriesOf(r.alertId);
        assertEquals([d.slack.status, d.slack.attempts, d.slack.next], ["sent", 2, ""]);
        assertEquals(forTenant(hook, "/hook", t.id).length, hooksBefore, "a delivered channel is never re-sent");
      } finally {
        slack.status = 200;
        await dropTenant(t.id);
      }
    }),
});

Deno.test({
  ...opts,
  name: "S4 failure_rate_spike only fires at >= 5 failures AND >= 3x the trailing 7-day hourly rate",
  fn: () =>
    withClock("2026-11-25T13:30:00Z", async (clock) => {
      const t = await seedAlertTenant("alerts_spike", { slack: false, webhook: false });
      const failures = (sql: string) => psql(`INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, occurred_at) ${sql}`);
      try {
        // 1 failure an hour for 7 days at stage 'webhook' → baseline 1/h.
        await failures(`SELECT 'att-b-' || h, ${sqlLit(t.id)}::uuid, 'webhook', 'failure', 'stripe_webhook',
                               ${sqlLit(clock.iso())}::timestamptz - make_interval(hours => h) - interval '30 minutes'
                          FROM generate_series(1, 168) h`);
        await failures(`SELECT 'att-c-' || i, ${sqlLit(t.id)}::uuid, 'webhook', 'failure', 'stripe_webhook',
                               ${sqlLit(clock.iso())}::timestamptz - make_interval(mins => i * 5)
                          FROM generate_series(1, 4) i`);
        await engine.runCritical(db, clock.now());
        assertEquals((await alertsOf(t.id, "failure_rate_spike")).length, 0, "4 failures < 5 → no spike");

        await failures(`SELECT 'att-c-5', ${sqlLit(t.id)}::uuid, 'webhook', 'failure', 'stripe_webhook',
                               ${sqlLit(clock.iso())}::timestamptz - interval '1 minute'`);
        await engine.runCritical(db, clock.plus(60_000));
        const spikes = await alertsOf(t.id, "failure_rate_spike");
        assertEquals(spikes.length, 1, "5 failures >= 5 and >= 3 x 1/h → one spike");
        assertEquals(spikes[0][1], "webhook");
        assertStringIncludes(spikes[0][3], "Failure spike at the webhook stage — 5 failures");
        const d = await deliveriesOf(spikes[0][0]);
        assertEquals([d.email.status, d.inbox.status], ["sent", "sent"]);
      } finally {
        await dropTenant(t.id);
      }
    }),
});

Deno.test({
  ...opts,
  name: "S5 webhook signature refusals → one webhook_sig_fail per provider, processing failures → webhook_proc_fail",
  fn: () =>
    withClock("2026-11-25T14:00:00Z", async (clock) => {
      const t = await seedAlertTenant("alerts_webhook", { slack: false });
      try {
        await psql(`
          INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, error_code, error_message, occurred_at)
          SELECT 'att-s-' || i, ${sqlLit(t.id)}::uuid, 'webhook', 'signature_failed', 'signature', 'stripe_signature',
                 'No signatures found matching the expected signature', ${sqlLit(clock.iso())}::timestamptz - make_interval(mins => i)
            FROM generate_series(1, 3) i
          UNION ALL
          SELECT 'att-p-1', ${sqlLit(t.id)}::uuid, 'webhook', 'failure', 'razorpay_webhook', 'db_error', 'insert failed',
                 ${sqlLit(clock.iso())}::timestamptz - interval '2 minutes'`);
        await engine.runCritical(db, clock.now());
        const sig = await alertsOf(t.id, "webhook_sig_fail");
        assertEquals(sig.map((a) => a[1]), ["stripe_signature"]);
        assertStringIncludes(sig[0][3], "stripe");
        const proc = await alertsOf(t.id, "webhook_proc_fail");
        assertEquals(proc.map((a) => a[1]), ["razorpay_webhook"]);
        const body = JSON.parse(forTenant(hook, "/hook", t.id).map((r) => r.body).find((b) => b.includes("webhook_sig_fail"))!);
        assertEquals([body.payload.failures, body.payload.provider], [3, "stripe"]);
      } finally {
        await dropTenant(t.id);
      }
    }),
});

Deno.test({
  ...opts,
  name: "attempt-alerts (served): refuses a caller that is not the service role, and nothing is stored",
  fn: async () => {
    const before = await psql(`SELECT count(*) FROM tenant_alerts`);
    const r = await fetch(`${FUNCTIONS_URL}/attempt-alerts?mode=digest&now=2099-01-01T00:00:00Z`, { method: "POST" });
    await r.body?.cancel();
    assertEquals(r.status, 401);
    assertEquals(await psql(`SELECT count(*) FROM tenant_alerts`), before);
  },
});

Deno.test({
  ...opts,
  name: "e2e: close local receivers",
  fn: async () => {
    await Promise.all([slack.close(), hook.close(), resend.close()]);
  },
});
