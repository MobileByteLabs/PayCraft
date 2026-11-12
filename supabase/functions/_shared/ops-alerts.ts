// Ops alerting shared by every scheduled check (health, store-sync): record each check's state CHANGE
// in health_incidents (migration 185) and email the platform owner + OPS_ALERT_EMAILS once per change.
// One place, so a new monitor gets the same "one email per outage, one per recovery" behaviour for free.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { type Check, type IncidentStore, recordTransitions } from "./health.ts";
import { sendEmail } from "./email.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const incidents: IncidentStore = {
  open: async (check, detail) => {
    const { data, error } = await supabase.rpc("health_incident_open", { p_check: check, p_detail: detail });
    if (error) throw new Error(error.message);
    return data === true;
  },
  resolve: async (check) => {
    const { data, error } = await supabase.rpc("health_incident_resolve", { p_check: check });
    if (error) throw new Error(error.message);
    return data ? new Date(data as string) : null;
  },
};

/** The platform owner (platform_settings, migration 053) plus OPS_ALERT_EMAILS. */
async function alertRecipients(): Promise<string[]> {
  const extra = (Deno.env.get("OPS_ALERT_EMAILS") || "").split(",").map((e) => e.trim()).filter(Boolean);
  const { data: settings } = await supabase.from("platform_settings").select("platform_owner_user_id").maybeSingle();
  if (settings?.platform_owner_user_id) {
    const { data } = await supabase.auth.admin.getUserById(settings.platform_owner_user_id);
    if (data?.user?.email) extra.push(data.user.email);
  }
  return [...new Set(extra)];
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// Alerts send from ALERT_FROM_EMAIL when set: PAYCRAFT_FROM_EMAIL's domain must be verified in Resend, and
// an alert that cannot leave is worse than none. Every recipient is tried — one rejected address (Resend
// refuses unverified-domain mail to anyone but its account owner) must not silence the others.
const ALERT_FROM = Deno.env.get("ALERT_FROM_EMAIL") || undefined;

async function notify(subject: string, text: string): Promise<void> {
  const to = await alertRecipients();
  if (to.length === 0) throw new Error("no alert recipient: no platform owner and OPS_ALERT_EMAILS unset");
  const html = `<pre style="font:14px/1.5 monospace">${escapeHtml(text)}</pre>`;
  const results = await Promise.all(to.map((addr) => sendEmail({ to: addr, subject, html, from: ALERT_FROM })));
  const delivered = results.filter((r) => r.ok).length;
  if (delivered === 0) throw new Error(`alert reached no recipient: ${results.map((r) => r.error).join("; ")}`);
}

export function alertOnTransitions(checks: Record<string, Check>): Promise<void> {
  return recordTransitions(checks, incidents, notify);
}
