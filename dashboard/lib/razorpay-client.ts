import { razorpayRest, type RazorpayRestClient } from "@/lib/razorpay-rest"
import { createClient } from "@/lib/supabase-server"
import type { SupabaseClient } from "@supabase/supabase-js"

export async function getConnectedRazorpayClient(
  tenantId: string,
  mode: "test" | "live" = "live",
  /**
   * `supa` — the client to authenticate the credential lookup with.
   *
   * Omit it and this falls back to the cookie-scoped session client, which is correct for a request
   * made by a logged-in operator and WRONG for anything else. The management API authenticates with a
   * bearer key and has no cookies, so the fallback ran as `anon` and the decrypt RPC answered
   * "permission denied for function tenant_providers_decrypt_key" — surfaced to the operator as
   * "No Razorpay live keys for tenant …", naming the wrong cause entirely.
   *
   * Callers that already hold a privileged client must pass it rather than letting this reach for a
   * session that is not there.
   */
  supa?: SupabaseClient<any>,
): Promise<RazorpayRestClient> {
  const supabase = supa ?? createClient()
  const { data, error } = await supabase
    .rpc("tenant_providers_decrypt_key", {
      p_tenant_id: tenantId,
      p_provider: "razorpay",
      p_mode: mode,
    })
    .single<{ secret_key: string; key_id: string }>()

  if (error || !data?.secret_key) {
    throw new Error(
      `No Razorpay ${mode} keys for tenant ${tenantId}: ${error?.message ?? "no row"}`,
    )
  }

  return razorpayRest(data.key_id!, data.secret_key)
}
