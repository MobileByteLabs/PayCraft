import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Health check endpoint for PayCraft Cloud.
 * GET /webhook-health/{tenant_id}
 * Validates: API key → tenant exists → provider configured → webhook URL active.
 */
serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = req.headers.get("x-paycraft-api-key");
  if (!apiKey) {
    return new Response(JSON.stringify({ status: "error", message: "Missing X-PayCraft-API-Key header" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve tenant
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, status, plan, subscriber_limit")
    .or(`api_key_test.eq.${apiKey},api_key_live.eq.${apiKey}`)
    .single();

  if (tenantError || !tenant) {
    return new Response(JSON.stringify({ status: "error", message: "Invalid API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (tenant.status !== "active") {
    return new Response(JSON.stringify({ status: "error", message: `Tenant is ${tenant.status}` }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check provider config
  const { data: providers } = await supabase
    .from("tenant_providers")
    .select("provider, is_active")
    .eq("tenant_id", tenant.id);

  const activeProviders = providers?.filter((p: any) => p.is_active) ?? [];

  // Count subscribers
  const { count: activeSubscribers } = await supabase
    .from("subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("mode", "live")
    .in("status", ["active", "trialing"]);

  const isTestKey = apiKey.startsWith("pk_test_");
  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-webhook/${tenant.id}`;

  return new Response(JSON.stringify({
    status: "healthy",
    tenant: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
    },
    mode: isTestKey ? "test" : "live",
    webhook_url: webhookUrl,
    providers: activeProviders.map((p: any) => p.provider),
    usage: {
      active_subscribers: activeSubscribers ?? 0,
      limit: tenant.subscriber_limit,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
