import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tenantIdFromPath } from "../webhook-path.ts";

const T = "bba1842f-3a57-41cd-8705-94db588de056";

Deno.test("hosted runtime path (no /functions/v1 prefix) yields the tenant", () => {
  assertEquals(tenantIdFromPath(`https://x.supabase.co/stripe-webhook/${T}`, "stripe-webhook"), T);
});

Deno.test("local gateway path (with /functions/v1 prefix) yields the tenant", () => {
  assertEquals(tenantIdFromPath(`http://127.0.0.1:54321/functions/v1/stripe-webhook/${T}`, "stripe-webhook"), T);
});

Deno.test("legacy single-tenant URL yields null on both shapes", () => {
  assertEquals(tenantIdFromPath("https://x.supabase.co/stripe-webhook", "stripe-webhook"), null);
  assertEquals(tenantIdFromPath("https://x.supabase.co/functions/v1/stripe-webhook/", "stripe-webhook"), null);
});
