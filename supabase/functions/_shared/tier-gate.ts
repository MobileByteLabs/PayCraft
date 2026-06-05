// supabase/functions/_shared/tier-gate.ts
// Shared tier-gate helper used at every edge function entry.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export class TierGateError extends Error {
  constructor(public gate: string) {
    super(`tier_gate_blocked:${gate}`)
    this.name = "TierGateError"
  }
}

/**
 * Throws TierGateError if the tenant's tier does not include the gate.
 * Called via SECURITY DEFINER RPC `enforce_tier_gate`.
 */
export async function requireGate(
  supabase: SupabaseClient,
  tenantId: string,
  gateName: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("enforce_tier_gate", {
    p_tenant_id: tenantId,
    p_gate_name: gateName,
  })
  if (error) throw error
  if (!data) throw new TierGateError(gateName)
}

export function tierGateResponse(e: TierGateError): Response {
  return new Response(
    JSON.stringify({
      error: "tier_gate_blocked",
      gate: e.gate,
      upgrade_url: "/billing/upgrade",
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  )
}
