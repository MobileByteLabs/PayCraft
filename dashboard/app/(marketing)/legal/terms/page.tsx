export const metadata = {
  title: "Terms of Service · PayCraft",
  description:
    "The terms governing use of the PayCraft billing platform, SDK, and the subscriptions purchased through PayCraft-powered paywalls.",
}

const LAST_UPDATED = "2026-08-23"
const EFFECTIVE = "2026-08-23"

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
        Last updated <span className="tabular-nums">{LAST_UPDATED}</span> ·
        Effective <span className="tabular-nums">{EFFECTIVE}</span>
      </p>

      <p className="mt-6 text-ink-600 text-sm leading-relaxed">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the
        PayCraft platform, dashboard, SDK, and the paywalls and subscriptions it
        powers (the &ldquo;Service&rdquo;), operated by{" "}
        <strong>MobileByteSensei Pvt Ltd</strong> (&ldquo;PayCraft&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;). They apply to{" "}
        <strong>Developers</strong> who integrate PayCraft and to{" "}
        <strong>End Users</strong> who purchase a subscription through a
        PayCraft-powered paywall. By using the Service you agree to these Terms.
      </p>

      <Section title="1. Definitions">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Developer</strong> — a person or company that integrates PayCraft into an app.</li>
          <li><strong>End User</strong> — a person who uses a Developer&rsquo;s app and may purchase a subscription.</li>
          <li><strong>Store / Provider</strong> — Google Play, Apple App Store, Stripe, or Razorpay, which process the actual payment.</li>
          <li><strong>Subscription</strong> — an auto-renewing entitlement purchased through a Store or Provider and recognized by PayCraft.</li>
        </ul>
      </Section>

      <Section title="2. The Service">
        <p>
          PayCraft is subscription-billing infrastructure. It renders paywalls,
          hands off checkout to a Store or Provider, validates receipts and
          webhooks, and keeps a source-of-truth record of each End User&rsquo;s
          entitlement so it can be restored across devices. PayCraft is a
          technology provider — it is <strong>not</strong> the merchant of record
          and does not itself charge End Users. The charge is made by the Store or
          Provider the Developer has connected.
        </p>
      </Section>

      <Section title="3. Accounts &amp; eligibility">
        <p>
          You must provide accurate information, keep your credentials secure, and
          be old enough to form a binding contract in your jurisdiction. You are
          responsible for all activity under your account. Notify us promptly of
          any unauthorized use.
        </p>
      </Section>

      <Section title="4. Subscriptions, billing &amp; auto-renewal">
        <p className="font-medium text-ink-800">For End Users</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>A subscription <strong>automatically renews</strong> at the end of each billing period at the then-current price, unless you cancel at least 24 hours before the period ends.</li>
          <li>Payment is charged by, and managed in, your <strong>store account</strong> (Google Play or the App Store) or the connected payment provider — not by PayCraft.</li>
          <li>Where a <strong>free trial</strong> is offered, it converts to a paid subscription automatically when it ends unless you cancel before then. Any unused trial period is forfeited when you purchase.</li>
          <li><strong>Manage or cancel</strong> anytime in your store&rsquo;s subscription settings (Google Play → Subscriptions, or App Store → Apple ID → Subscriptions).</li>
          <li><strong>Refunds</strong> are governed by the Store or Provider that processed your payment and by applicable law; PayCraft does not independently issue refunds.</li>
        </ul>
        <p className="font-medium text-ink-800 mt-4">For Developers</p>
        <p>
          Your use of PayCraft&rsquo;s own paid plans is billed through Stripe on a
          recurring basis until cancelled. Fees are non-refundable except where
          required by law. We may change plan pricing with prior notice; changes
          take effect at your next renewal.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>use the Service for unlawful, deceptive, or fraudulent purposes;</li>
          <li>circumvent Store or Provider payment rules, or misrepresent prices, trials, or terms on a paywall;</li>
          <li>reverse engineer, resell, or overload the Service beyond documented limits;</li>
          <li>upload malware or attempt to gain unauthorized access to other tenants&rsquo; data.</li>
        </ul>
      </Section>

      <Section title="6. Developer responsibilities">
        <p>
          Developers are responsible for their own app, its content, its
          compliance with Store policies and applicable law, and for providing
          their End Users with their own privacy policy and any legally required
          disclosures. You must accurately represent subscription prices, renewal
          terms, and trial conditions, and you must honor entitlements PayCraft
          reports.
        </p>
      </Section>

      <Section title="7. Third-party stores &amp; providers">
        <p>
          Purchases are subject to the terms of the Store or Provider that
          processes them (Google Play, Apple, Stripe, Razorpay). Those parties
          control payment, taxes, receipts, and refunds. PayCraft is not
          responsible for their availability, decisions, or fees.
        </p>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          PayCraft, its SDK, dashboard, and brand are owned by MobileByteSensei
          Pvt Ltd. We grant Developers a limited, non-exclusive, non-transferable
          license to use the SDK to integrate billing into their apps for the term
          of their agreement. You retain ownership of your app and your content.
        </p>
      </Section>

      <Section title="9. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; without warranties of any kind, whether express or
          implied, including merchantability, fitness for a particular purpose,
          and non-infringement. We do not warrant that the Service will be
          uninterrupted, error-free, or that every webhook or receipt will be
          processed without delay.
        </p>
      </Section>

      <Section title="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, PayCraft will not be liable for
          any indirect, incidental, special, consequential, or punitive damages,
          or for lost profits or revenues. Our total liability for any claim
          arising out of the Service is limited to the amount you paid us for the
          Service in the 12 months before the claim (or, for End Users, the amount
          of the subscription at issue).
        </p>
      </Section>

      <Section title="11. Indemnification">
        <p>
          Developers agree to indemnify and hold PayCraft harmless from claims
          arising out of their app, their content, their use of the Service, or
          their breach of these Terms or applicable law.
        </p>
      </Section>

      <Section title="12. Term &amp; termination">
        <p>
          These Terms apply while you use the Service. You may stop at any time. We
          may suspend or terminate access for breach, legal risk, or non-payment,
          with notice where practicable. On termination, your license ends; the
          sections that by their nature should survive (ownership, disclaimers,
          liability, indemnity, governing law) continue to apply.
        </p>
      </Section>

      <Section title="13. Governing law &amp; disputes">
        <p>
          These Terms are governed by the laws of India, without regard to
          conflict-of-laws rules. The courts of India will have jurisdiction,
          except where mandatory local consumer-protection law grants you rights in
          your own place of residence. Nothing here limits an End User&rsquo;s
          non-waivable statutory rights.
        </p>
      </Section>

      <Section title="14. Changes">
        <p>
          We may update these Terms. Material changes will be announced in the
          dashboard or by email, and the &ldquo;Last updated&rdquo; date will
          change. Continued use after an update means you accept the revised Terms.
        </p>
      </Section>

      <Section title="15. Contact">
        <p>
          Questions about these Terms:{" "}
          <a
            href="mailto:legal@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            legal@paycraft.mobilebytesensei.com
          </a>
          .
        </p>
      </Section>

      <p className="mt-12 text-2xs text-ink-400">
        This document is provided for transparency and does not constitute legal
        advice.
      </p>
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
