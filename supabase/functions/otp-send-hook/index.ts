/**
 * otp-send-hook — Supabase Auth Hook: runs after each OTP email is dispatched.
 *
 * Wire this in Supabase Dashboard → Auth → Hooks → Send Email.
 *
 * Responsibility: Increment the daily OTP send counter in otp_send_log.
 * The app checks check_otp_gate() before showing the "Send code" button.
 * When the counter hits the Brevo free limit (300/day), the app switches
 * to the manual support fallback.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Increment daily send counter — idempotent upsert
    const { error } = await supabase.rpc("record_otp_send");

    if (error) {
      console.error("[otp-send-hook] record_otp_send error:", error.message);
      // Non-fatal — don't block the OTP send; just log
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[otp-send-hook] Unexpected error:", err);
    // Return 200 anyway — auth hooks that return non-2xx block the OTP send
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
});
