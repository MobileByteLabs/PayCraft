import Razorpay from "razorpay"
import { createClient } from "@/lib/supabase-server"

export async function getConnectedRazorpayClient(
  tenantId: string,
  mode: "test" | "live" = "live",
): Promise<Razorpay> {
  const supabase = createClient()
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

  return new Razorpay({ key_id: data.key_id!, key_secret: data.secret_key })
}
