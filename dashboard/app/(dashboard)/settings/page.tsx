import { Bell, Building2, Globe2, Webhook } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card } from "@/components/ui/card"

export default async function SettingsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: alertPrefs } = await supabase
    .from("tenant_alert_prefs")
    .select("welcome, limit_warn, limit_hit, webhook_fail, sub_expiry")
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  const supabaseUrl =
    process.env.NEXT_PUBLIC_PAYCRAFT_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "https://your-project.supabase.co"

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="Org-level config — tenant name, support email, webhook URLs, alert preferences."
      />

      <div className="space-y-6">
        <SettingsSection
          icon={<Building2 className="w-4 h-4" />}
          title="Organization"
          subtitle="Visible to your team in the dashboard."
        >
          <Field label="App name" value={tenant.name} />
          <Field label="Owner email" value={tenant.owner_email} mono />
          <Field label="Tenant ID" value={tenant.id} mono small />
          <Field
            label="Plan"
            value={<span className="capitalize">{tenant.plan}</span>}
          />
        </SettingsSection>

        <SettingsSection
          icon={<Webhook className="w-4 h-4" />}
          title="Webhook URLs"
          subtitle="Register these in your provider dashboards so we can sync subscription state."
        >
          {[
            "stripe",
            "razorpay",
            "paypal",
            "paddle",
            "flutterwave",
            "paystack",
          ].map((p) => (
            <WebhookRow
              key={p}
              provider={p}
              url={`${supabaseUrl}/functions/v1/${p}-webhook/${tenant.id}`}
            />
          ))}
        </SettingsSection>

        <SettingsSection
          icon={<Bell className="w-4 h-4" />}
          title="Email alerts"
          subtitle="Where we email the tenant owner about activity."
        >
          <PrefRow
            label="Welcome email on signup"
            on={alertPrefs?.welcome ?? true}
          />
          <PrefRow
            label="Subscriber limit at 80% (warning)"
            on={alertPrefs?.limit_warn ?? true}
          />
          <PrefRow
            label="Subscriber limit reached (grace period started)"
            on={alertPrefs?.limit_hit ?? true}
          />
          <PrefRow
            label="Webhook delivery failure"
            on={alertPrefs?.webhook_fail ?? true}
          />
          <PrefRow
            label="Subscription about to expire (no renewal)"
            on={alertPrefs?.sub_expiry ?? false}
          />
        </SettingsSection>

        <SettingsSection
          icon={<Globe2 className="w-4 h-4" />}
          title="Region + data residency"
          subtitle="Your data lives in our primary region. EU + APAC residency available on Enterprise."
        >
          <Field label="Primary region" value="US East (Virginia)" />
          <Field
            label="Backups"
            value="Daily snapshots, 30-day retention (Pro) / 365-day (Enterprise)"
          />
        </SettingsSection>

        <div className="text-center text-2xs text-ink-400 mt-12">
          Need to delete your tenant? Email{" "}
          <Link
            href="mailto:support@paycraft.cloud"
            className="text-brand-600 underline"
          >
            support@paycraft.cloud
          </Link>{" "}
          and we'll honor your GDPR right-to-erase within 30 days.
        </div>
      </div>
    </div>
  )
}

function SettingsSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <div className="px-5 py-4 border-b border-ink-100 flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-ink-100 text-ink-600 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          {subtitle && (
            <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="divide-y divide-ink-100">{children}</div>
    </Card>
  )
}

function Field({
  label,
  value,
  mono,
  small,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  small?: boolean
}) {
  return (
    <div className="px-5 py-3.5 flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-ink-700 flex-shrink-0">
        {label}
      </span>
      <span
        className={`text-sm text-ink-900 ${
          mono ? "font-mono" : ""
        } ${small ? "text-xs" : ""} text-right truncate`}
      >
        {value}
      </span>
    </div>
  )
}

function WebhookRow({ provider, url }: { provider: string; url: string }) {
  return (
    <div className="px-5 py-3.5 flex items-center gap-3">
      <span className="capitalize text-sm font-medium text-ink-700 w-24 flex-shrink-0">
        {provider}
      </span>
      <code className="flex-1 text-xs font-mono text-ink-600 bg-ink-50 border border-ink-200 px-2.5 py-1.5 rounded break-all">
        {url}
      </code>
    </div>
  )
}

function PrefRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="px-5 py-3 flex items-center justify-between">
      <span className="text-sm text-ink-700">{label}</span>
      <span
        className={`text-2xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
          on
            ? "bg-success-50 text-success-700 border border-success-200"
            : "bg-ink-100 text-ink-500 border border-ink-200"
        }`}
      >
        {on ? "On" : "Off"}
      </span>
    </div>
  )
}
