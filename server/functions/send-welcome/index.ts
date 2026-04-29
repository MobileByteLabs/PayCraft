import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, welcomeEmail } from "../_shared/email.ts";

/**
 * Send Welcome Email — triggered after tenant provisioning.
 * POST { tenant_id, email, app_name }
 * Requires service_role authorization.
 */

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { tenant_id, email, app_name } = await req.json();
  if (!tenant_id || !email) {
    return new Response("Missing tenant_id or email", { status: 400 });
  }

  // Fetch tenant's test API key
  const { data: tenant } = await supabase
    .from("tenants")
    .select("api_key_test")
    .eq("id", tenant_id)
    .single();

  const apiKeyTest = tenant?.api_key_test || "pk_test_...";
  const name = app_name || "My App";

  const emailData = welcomeEmail(name, apiKeyTest);
  emailData.to = email;

  const result = await sendEmail(emailData);

  // Log the alert
  try {
    await supabase.from("tenant_alert_log").insert({
      tenant_id,
      alert_type: "welcome",
      recipient: email,
      resend_id: result.id || null,
    });
  } catch (err) {
    console.error("Failed to log welcome alert:", err);
  }

  return new Response(JSON.stringify({ sent: result.ok, id: result.id }), {
    status: result.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});
