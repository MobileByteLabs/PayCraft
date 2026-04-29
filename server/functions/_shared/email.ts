/**
 * Email utility using Resend (free tier: 3,000 emails/month).
 * All emails are plain HTML — no template engine dependency.
 */

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("PAYCRAFT_FROM_EMAIL") || "PayCraft <noreply@paycraft.dev>";

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(params: EmailParams): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping email");
    return { ok: false, error: "Resend not configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Resend API error (${res.status}):`, body);
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (err: any) {
    console.error("Email send failed:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Email Templates ──

export function welcomeEmail(appName: string, apiKeyTest: string): EmailParams {
  return {
    to: "", // caller sets this
    subject: `Welcome to PayCraft — ${appName} is ready`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #4f46e5;">Welcome to PayCraft!</h1>
        <p>Your app <strong>${escapeHtml(appName)}</strong> has been provisioned and is ready to go.</p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 8px; font-size: 14px; color: #64748b;">Your test API key:</p>
          <code style="background: #1e293b; color: #34d399; padding: 8px 12px; border-radius: 4px; display: block; font-size: 13px;">${escapeHtml(apiKeyTest)}</code>
        </div>

        <h3>Quick Start</h3>
        <ol style="color: #334155; line-height: 1.8;">
          <li>Add the PayCraft SDK to your KMP project</li>
          <li>Configure with your test API key above</li>
          <li>Set up a payment provider (Stripe, Razorpay, etc.)</li>
          <li>Switch to your live key when ready for production</li>
        </ol>

        <p style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 13px;">
          You're on the <strong>Free plan</strong> (100 subscribers). Upgrade anytime from your dashboard.
        </p>
      </div>
    `,
  };
}

export function limitWarningEmail(appName: string, current: number, limit: number): EmailParams {
  const percent = Math.round((current / limit) * 100);
  return {
    to: "",
    subject: `${appName}: ${percent}% of subscriber limit reached`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #d97706;">Approaching Subscriber Limit</h2>
        <p>Your app <strong>${escapeHtml(appName)}</strong> is at <strong>${percent}%</strong> of its subscriber limit.</p>

        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0; font-size: 16px;"><strong>${current.toLocaleString()}</strong> / ${limit.toLocaleString()} subscribers</p>
          <div style="background: #fef3c7; border-radius: 4px; height: 8px; margin-top: 8px;">
            <div style="background: #f59e0b; border-radius: 4px; height: 8px; width: ${percent}%;"></div>
          </div>
        </div>

        <p>Upgrade your plan to avoid disruption for new subscribers.</p>
        <a href="https://dashboard.paycraft.dev/upgrade" style="display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-top: 8px;">Upgrade Plan</a>
      </div>
    `,
  };
}

export function limitHitEmail(appName: string, limit: number): EmailParams {
  return {
    to: "",
    subject: `${appName}: Subscriber limit reached`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">Subscriber Limit Reached</h2>
        <p>Your app <strong>${escapeHtml(appName)}</strong> has reached its limit of <strong>${limit.toLocaleString()}</strong> subscribers.</p>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0;">New subscribers will be blocked until you upgrade. Existing subscribers are unaffected.</p>
        </div>

        <a href="https://dashboard.paycraft.dev/upgrade" style="display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-top: 8px;">Upgrade Now</a>
      </div>
    `,
  };
}

export function webhookFailEmail(appName: string, failCount: number, lastError: string): EmailParams {
  return {
    to: "",
    subject: `${appName}: ${failCount} consecutive webhook failures`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #dc2626;">Webhook Processing Failures</h2>
        <p>Your app <strong>${escapeHtml(appName)}</strong> has experienced <strong>${failCount}</strong> consecutive webhook failures.</p>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 4px; font-size: 14px; color: #64748b;">Last error:</p>
          <code style="background: #1e293b; color: #f87171; padding: 8px 12px; border-radius: 4px; display: block; font-size: 13px; word-break: break-all;">${escapeHtml(lastError)}</code>
        </div>

        <p>Check your provider configuration and webhook secrets in the dashboard.</p>
        <a href="https://dashboard.paycraft.dev/webhooks" style="display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-top: 8px;">View Webhook Logs</a>
      </div>
    `,
  };
}

export function subscriptionExpiryEmail(appName: string, daysLeft: number): EmailParams {
  return {
    to: "",
    subject: `${appName}: PayCraft subscription expires in ${daysLeft} days`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #d97706;">Subscription Expiring Soon</h2>
        <p>Your PayCraft Cloud subscription for <strong>${escapeHtml(appName)}</strong> expires in <strong>${daysLeft} days</strong>.</p>

        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0;">If your subscription lapses, your account will be downgraded to the Free plan (100 subscribers). Existing data is preserved.</p>
        </div>

        <a href="https://dashboard.paycraft.dev/settings" style="display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-top: 8px;">Manage Subscription</a>
      </div>
    `,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
