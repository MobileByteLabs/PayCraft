// supabase/functions/billing/index.ts
// PayCraft Cloud tier upgrade / downgrade orchestration.
//
// POST /functions/v1/billing/upgrade   {tenant_id, target_tier}  → {checkout_url}
// POST /functions/v1/billing/downgrade {tenant_id, target_tier}  → {ok: true}

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno"

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const url = new URL(req.url)
  const action = url.pathname.split("/").pop() ?? ""
  const body = await req.json().catch(() => ({}))
  const tenant_id = body.tenant_id as string | undefined
  const target_tier = body.target_tier as string | undefined

  if (!tenant_id || !target_tier) {
    return new Response(
      JSON.stringify({ error: "missing_fields", required: ["tenant_id", "target_tier"] }),
      { status: 400, headers: { "content-type": "application/json" } },
    )
  }
  if (!["free", "pro", "enterprise"].includes(target_tier)) {
    return new Response(
      JSON.stringify({ error: "unknown_tier" }),
      { status: 400, headers: { "content-type": "application/json" } },
    )
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
  const stripe = new Stripe(
    Deno.env.get("PAYCRAFT_PLATFORM_STRIPE_SECRET_KEY")!,
    { apiVersion: "2024-06-20" },
  )

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id,owner_email,stripe_customer_id,plan")
    .eq("id", tenant_id)
    .single()

  if (!tenant) {
    return new Response("not found", { status: 404 })
  }

  if (action === "upgrade") {
    const { data: tierDef } = await supabase
      .from("tier_definitions")
      .select("base_price_cents,base_currency,metered_per_subscriber_cents")
      .eq("tier_name", target_tier)
      .single()

    if (!tierDef) {
      return new Response("tier def missing", { status: 500 })
    }

    if (target_tier === "enterprise" || tierDef.base_price_cents === 0) {
      // Enterprise → sales flow, no Stripe checkout
      return new Response(
        JSON.stringify({
          checkout_url: null,
          contact_url: "mailto:sales@paycraft.mobilebytesensei.com?subject=Enterprise%20inquiry",
        }),
        { headers: { "content-type": "application/json" } },
      )
    }

    // Ensure Stripe customer exists
    let customerId = tenant.stripe_customer_id as string | null
    if (!customerId) {
      const cust = await stripe.customers.create({
        email: tenant.owner_email,
        metadata: { tenant_id: tenant.id },
      })
      customerId = cust.id
      await supabase
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", tenant.id)
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: (tierDef.base_currency as string).toLowerCase(),
            product_data: { name: `PayCraft ${target_tier}` },
            unit_amount: tierDef.base_price_cents as number,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      metadata: { tenant_id: tenant.id, target_tier },
      success_url: `${Deno.env.get("PAYCRAFT_DASHBOARD_URL")}/billing?upgraded=1`,
      cancel_url: `${Deno.env.get("PAYCRAFT_DASHBOARD_URL")}/billing?canceled=1`,
    })

    await supabase.rpc("audit_log_emit", {
      p_tenant_id: tenant_id,
      p_actor_user_id: null,
      p_actor_type: "system",
      p_action: "billing.checkout_created",
      p_resource: `tenants:id=${tenant_id}`,
      p_after: { target_tier, session_id: session.id },
    })

    return new Response(JSON.stringify({ checkout_url: session.url }), {
      headers: { "content-type": "application/json" },
    })
  }

  if (action === "downgrade") {
    const { error: upErr } = await supabase.rpc("upgrade_tenant_plan", {
      p_tenant_id: tenant_id,
      p_target_plan: target_tier,
    })
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    }
    await supabase.rpc("audit_log_emit", {
      p_tenant_id: tenant_id,
      p_actor_user_id: null,
      p_actor_type: "system",
      p_action: "billing.downgraded",
      p_resource: `tenants:id=${tenant_id}`,
      p_after: { from_plan: tenant.plan, to_plan: target_tier },
    })
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    })
  }

  return new Response("unknown action", { status: 400 })
})
