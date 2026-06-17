export const metadata = { title: "Privacy Policy · PayCraft" }

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">
        Legal
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-ink-900 mt-2">
        Privacy Policy
      </h1>
      <p className="text-sm text-ink-500 mt-2">
        Last updated: <span className="tabular-nums">2026-06-06</span>
      </p>

      <Section title="What we collect">
        <p>
          When you sign up: email, password (hashed), org/app name. When you
          use the dashboard: every mutation is logged in your tenant audit
          trail. When end users subscribe: their email, device ID, and
          subscription state arrive via your provider's webhook.
        </p>
      </Section>

      <Section title="Why">
        <ul className="list-disc pl-5 space-y-2">
          <li>Run the Service — authenticate you, route webhooks, render the SDK paywall.</li>
          <li>Bill paid tiers — Stripe processes payment; we hold only your customer ID.</li>
          <li>Notify on account activity — usage limits, webhook failures.</li>
          <li>Comply with legal obligations — tax records, fraud prevention.</li>
        </ul>
      </Section>

      <Section title="How long">
        <p>
          Audit logs follow your tier — 7 days (Free), 90 days (Pro), 365 days
          (Enterprise). Subscriptions and registered devices live for the life
          of your tenant. We delete all data 30 days after you terminate.
        </p>
      </Section>

      <Section title="Subprocessors">
        <ul className="list-disc pl-5 space-y-2">
          <li>Supabase — database, auth, edge functions (US East).</li>
          <li>Vercel — dashboard + marketing site hosting.</li>
          <li>Stripe — payment processing for our own SaaS billing.</li>
          <li>Postmark — transactional email.</li>
          <li>Cloudflare — DNS + edge protection.</li>
        </ul>
      </Section>

      <Section title="Your rights">
        <p>
          You can export, correct, or delete your data anytime. Email{" "}
          <a
            href="mailto:privacy@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            privacy@paycraft.mobilebytesensei.com
          </a>{" "}
          with your request — we respond within 30 days.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Data Protection Officer:{" "}
          <a
            href="mailto:dpo@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            dpo@paycraft.mobilebytesensei.com
          </a>
          .
        </p>
      </Section>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight text-ink-900">
        {title}
      </h2>
      <div className="mt-3 text-ink-600 text-sm leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  )
}
