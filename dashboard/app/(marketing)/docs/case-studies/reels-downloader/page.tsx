import Link from "next/link"
import { ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react"

export const metadata = {
  title: "reels-downloader × PayCraft — Case Study",
  description:
    "How reels-downloader adopted PayCraft v2.0 for Android, iOS, Web, and Desktop in production since April 2026.",
}

export default function ReelsCaseStudy() {
  return (
    <article className="max-w-4xl mx-auto px-6 py-16">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4" /> Back to home
      </Link>

      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">
        Case study
      </p>
      <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-ink-950 mt-2 leading-[1.1]">
        reels-downloader × PayCraft
      </h1>
      <p className="text-lg text-ink-500 mt-4">
        A real-world adoption — Android · iOS · Web · Desktop — in production since
        April 2026.
      </p>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
        <Stat label="First production tx" value="2026-04-26" />
        <Stat label="Platforms shipping" value="4" />
        <Stat label="Real-card E2E latency" value="≤ 5s" />
        <Stat label="Infra cost / month" value="$0" />
      </div>

      <Section title="Why PayCraft">
        <p>
          reels-downloader needed multi-platform subscription billing without
          writing 4 platform-specific paywalls (Play Billing, App Store
          StoreKit, Stripe Web, custom Desktop) and 2 webhook routers (Stripe
          + Razorpay). PayCraft delivers a single KMP{" "}
          <code>BillingManager.isPremium(uid)</code> contract that wires the
          same gating decision into every target.
        </p>
      </Section>

      <Section title="Integration in 5 commits">
        <ol className="list-decimal pl-6 space-y-2">
          <li>Sign up at paycraft.mobilebytesensei.com, pick slug <code>reels-downloader</code></li>
          <li>One-click Stripe Connect OAuth — keys never typed in chat</li>
          <li>Create monthly + annual products on the dashboard</li>
          <li>
            Wire <code>cmp-paycraft</code> in <code>commonMain</code> + call{" "}
            <code>PayCraft.initialize()</code> in app start
          </li>
          <li>
            Gate features with <code>BillingManager.isPremium(uid)</code>
          </li>
        </ol>
        <p className="mt-4">
          The SDK is cache-first (weekly default, hourly during trial) — zero
          network on the happy path.
        </p>
      </Section>

      <Section title="End-to-end proof points">
        <ul className="space-y-2">
          {[
            "Tenant signup creates a row in `tenants`",
            "Stripe Connect OAuth completes without secrets typed in chat",
            "Webhook signature verification (edge function logs)",
            "subscriptions lifecycle (created → active → canceled)",
            "isPremium returns true within 5s of invoice.payment_succeeded",
            "Trial-sticky-fields survive renewal",
            "RLS prevents tenant A reading tenant B's subscriptions",
            "Webhook idempotency (Stripe retry → same DB state)",
            "Refund flow (charge.refunded) downgrades subscriptions.status",
          ].map((p) => (
            <li key={p} className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
              <span className="text-ink-700">{p}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Cost the day they shipped">
        <table className="min-w-full text-sm">
          <tbody className="text-ink-700">
            {[
              ["Supabase Free", "500 MB DB · 2 GB egress · 50K MAU", "$0"],
              ["Vercel Hobby", "100 GB bandwidth", "$0"],
              ["Stripe", "2.9% + $0.30 per success (pass-through)", "$0 fixed"],
              ["Resend Free", "100 emails/day · 3K/month", "$0"],
              ["Cloudflare R2 Free", "10 GB storage · 10M reads/mo", "$0"],
            ].map(([k, v, c]) => (
              <tr key={k} className="border-b border-ink-100">
                <td className="py-2 pr-4 font-medium">{k}</td>
                <td className="py-2 pr-4 text-ink-500">{v}</td>
                <td className="py-2 pr-4 font-mono text-right">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Full case study">
        <p>
          The full step-by-step integration walkthrough — including DB schema
          snippets, webhook event payloads, anti-patterns we hit, and the
          monthly drill log — lives in the PayCraft repo:
        </p>
        <a
          href="https://github.com/MobileByteLabs/PayCraft/blob/main/docs/REELS_DOWNLOADER_INTEGRATION.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
        >
          docs/REELS_DOWNLOADER_INTEGRATION.md
          <ExternalLink className="w-4 h-4" />
        </a>
      </Section>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-4">
      <div className="text-xs uppercase tracking-wider text-ink-400 font-semibold">
        {label}
      </div>
      <div className="text-xl font-bold text-ink-900 mt-1">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-bold text-ink-900 mb-4">{title}</h2>
      <div className="text-ink-600 leading-relaxed space-y-3">{children}</div>
    </section>
  )
}
