export const metadata = {
  title: "Terms of Service · PayCraft",
}

export default function TermsPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-16 prose-doc">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">
        Legal
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-ink-900 mt-2">
        Terms of Service
      </h1>
      <p className="text-sm text-ink-500 mt-2">
        Last updated: <span className="tabular-nums">2026-06-06</span>
      </p>

      <Section title="1. Acceptance">
        <p>
          By signing up for PayCraft Cloud (operated by MobileByteSensei Pvt
          Ltd, "we", "us"), you ("Customer") agree to these Terms of Service.
          If you do not agree, do not use the Service.
        </p>
      </Section>

      <Section title="2. Service">
        <p>
          PayCraft Cloud is a multi-tenant subscription billing platform that
          routes checkout through Customer-configured payment providers
          (Stripe, Razorpay, etc.) and synchronizes subscription state via
          provider webhooks.
        </p>
      </Section>

      <Section title="3. Free Tier">
        <p>
          The Free tier permits up to 100 active subscribers, 10,000 webhook
          events per month, 1 connected provider, and 1 product. The free
          tier displays PayCraft attribution in the SDK-rendered paywall.
        </p>
      </Section>

      <Section title="4. Paid Tiers">
        <p>
          Pro tier ($29/month + $0.10 per active subscriber over 1,000) and
          Enterprise tier (custom) are billed monthly via Stripe. Tier
          changes take effect at the next billing cycle.
        </p>
      </Section>

      <Section title="5. Customer Data">
        <p>
          Customer retains all rights to data submitted to the Service. We
          act as a Data Processor for end-user data (subscribers' emails,
          devices, etc.) and as a Data Controller for Customer's own account
          data (login, billing).
        </p>
      </Section>

      <Section title="6. Acceptable Use">
        <p>
          You may not use the Service for fraudulent transactions, mass
          unsolicited messaging, or to circumvent your payment provider's
          terms. We may suspend tenants that violate these rules.
        </p>
      </Section>

      <Section title="7. Termination">
        <p>
          Either party may terminate by ending their subscription. We retain
          tenant data for 30 days post-termination, then delete it
          permanently.
        </p>
      </Section>

      <Section title="8. Liability">
        <p>
          Our aggregate liability is limited to the fees Customer paid in
          the 12 months preceding the claim. We are not liable for indirect
          or consequential damages, including lost revenue from payment
          provider downtime.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          For questions about these terms, email{" "}
          <a
            href="mailto:legal@paycraft.cloud"
            className="text-brand-600 underline"
          >
            legal@paycraft.cloud
          </a>
          .
        </p>
      </Section>

      <p className="text-2xs text-ink-400 mt-12">
        This is a customer-facing summary. For Enterprise customers, a signed
        Master Services Agreement supersedes these terms.
      </p>
    </article>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight text-ink-900">
        {title}
      </h2>
      <div className="prose-doc-body mt-3 text-ink-600 text-sm leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  )
}
