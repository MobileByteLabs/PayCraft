// supabase/functions/_shared/__tests__/subscription-handler.audit.test.ts
// AC-24 — Verify that handleSubscriptionEvent emits an audit_log_emit RPC
// call after a successful subscription upsert/update.
//
// Strategy: stub globalThis.fetch so the supabase-js client's HTTP traffic is
// intercepted. We assert that:
//   1. An audit_log_emit RPC call fires for an upsert with tenant_id set
//   2. The action verb is derived correctly from `status`
//   3. An RPC failure on audit_log_emit does NOT throw out of the handler
//
// Run:  deno test --allow-env --allow-net supabase/functions/_shared/__tests__/subscription-handler.audit.test.ts
//
// NOTE: env vars MUST be set before the module is imported because the
// supabase client is constructed at module top-level.

Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

interface CapturedCall {
  url: string;
  method: string;
  body: any;
}

function installFetchStub(opts: {
  beforeRow?: Record<string, any> | null;
  upsertError?: { message: string } | null;
  auditError?: { message: string } | null;
}): { calls: CapturedCall[]; restore: () => void } {
  const calls: CapturedCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: any = null;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    calls.push({ url, method, body });

    // /rest/v1/subscriptions?... (SELECT pre-image, UPSERT, UPDATE)
    if (url.includes("/rest/v1/subscriptions")) {
      if (method === "GET") {
        const row = opts.beforeRow ?? null;
        return new Response(JSON.stringify(row ? [row] : []), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (opts.upsertError) {
        return new Response(JSON.stringify({ message: opts.upsertError.message }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
    }

    // /rest/v1/rpc/audit_log_emit (the call we're verifying)
    if (url.includes("/rest/v1/rpc/audit_log_emit")) {
      if (opts.auditError) {
        return new Response(JSON.stringify({ message: opts.auditError.message }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify("00000000-0000-0000-0000-000000000001"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // /rest/v1/webhook_logs insert
    if (url.includes("/rest/v1/webhook_logs")) {
      return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
    }

    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

// Dynamic import AFTER env vars are set + after we have the ability to stub
// fetch per-test. The handler module is small; one import for all tests works
// because supabase-js fetch is dispatched through globalThis.fetch every call.
const { handleSubscriptionEvent } = await import("../subscription-handler.ts");

const baseEvent = {
  email: "user@example.com",
  provider: "stripe",
  customerId: "cus_TEST",
  subscriptionId: "sub_TEST",
  plan: "pro_monthly",
  status: "active" as const,
  periodStart: new Date("2026-06-01T00:00:00Z"),
  periodEnd: new Date("2026-07-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  mode: "test" as const,
  tenantId: "11111111-1111-1111-1111-111111111111",
  eventType: "customer.subscription.created",
};

Deno.test({
  name: "AC-24: handleSubscriptionEvent emits audit_log_emit after successful upsert (multi-tenant)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { calls, restore } = installFetchStub({ beforeRow: null });
    try {
      await handleSubscriptionEvent({ ...baseEvent });
    } finally {
      restore();
    }

    const auditCalls = calls.filter((c) =>
      c.url.includes("/rest/v1/rpc/audit_log_emit") && c.method === "POST"
    );
    assertEquals(auditCalls.length, 1, "expected exactly one audit_log_emit RPC call");

    const body = auditCalls[0].body;
    assertEquals(body.p_tenant_id, baseEvent.tenantId);
    assertEquals(body.p_actor_type, "webhook");
    assertEquals(body.p_action, "subscription.upsert");
    assert(typeof body.p_resource === "string" && body.p_resource.includes("subscriptions:email="));
    assertEquals(body.p_user_agent, "stripe-webhook");
  },
});

Deno.test({
  name: "AC-24: action verb is 'subscription.cancel' when status=canceled",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { calls, restore } = installFetchStub({ beforeRow: null });
    try {
      await handleSubscriptionEvent({ ...baseEvent, status: "canceled" });
    } finally {
      restore();
    }

    const auditCalls = calls.filter((c) =>
      c.url.includes("/rest/v1/rpc/audit_log_emit") && c.method === "POST"
    );
    assertEquals(auditCalls.length, 1);
    assertEquals(auditCalls[0].body.p_action, "subscription.cancel");
  },
});

Deno.test({
  name: "AC-24: action verb is 'subscription.update' on partial update (no email)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { calls, restore } = installFetchStub({ beforeRow: null });
    try {
      await handleSubscriptionEvent({ ...baseEvent, email: null });
    } finally {
      restore();
    }

    const auditCalls = calls.filter((c) =>
      c.url.includes("/rest/v1/rpc/audit_log_emit") && c.method === "POST"
    );
    assertEquals(auditCalls.length, 1);
    assertEquals(auditCalls[0].body.p_action, "subscription.update");
    assert(auditCalls[0].body.p_resource.includes("provider_subscription_id="));
  },
});

Deno.test({
  name: "AC-24: audit RPC failure does NOT throw out of handler (audit is best-effort)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { calls, restore } = installFetchStub({
      beforeRow: null,
      auditError: { message: "audit RPC down" },
    });
    try {
      // Should NOT throw — audit failure is swallowed.
      await handleSubscriptionEvent({ ...baseEvent });
    } finally {
      restore();
    }

    const auditCalls = calls.filter((c) =>
      c.url.includes("/rest/v1/rpc/audit_log_emit") && c.method === "POST"
    );
    assertEquals(auditCalls.length, 1, "audit was attempted exactly once");
  },
});

Deno.test({
  name: "AC-24: self-hosted single-tenant (tenantId=null) skips audit emit",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { calls, restore } = installFetchStub({ beforeRow: null });
    try {
      await handleSubscriptionEvent({ ...baseEvent, tenantId: null });
    } finally {
      restore();
    }

    const auditCalls = calls.filter((c) =>
      c.url.includes("/rest/v1/rpc/audit_log_emit") && c.method === "POST"
    );
    assertEquals(auditCalls.length, 0, "no audit emit when tenant_id is null");
  },
});
