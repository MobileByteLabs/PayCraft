export const metadata = {
  title: "Privacy Policy · PayCraft",
  description:
    "How PayCraft (MobileByteSensei Pvt Ltd) collects, uses, shares, and protects personal data for the PayCraft billing platform and the paywalls it powers.",
}

const LAST_UPDATED = "2026-08-23"
const EFFECTIVE = "2026-08-23"

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
        Last updated <span className="tabular-nums">{LAST_UPDATED}</span> ·
        Effective <span className="tabular-nums">{EFFECTIVE}</span>
      </p>

      <p className="mt-6 text-ink-600 text-sm leading-relaxed">
        This Privacy Policy explains how <strong>MobileByteSensei Pvt Ltd</strong>{" "}
        (&ldquo;PayCraft&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
        &ldquo;our&rdquo;) handles personal data in connection with the PayCraft
        subscription-billing platform, dashboard, SDK, and the in-app paywalls it
        powers (together, the &ldquo;Service&rdquo;). It applies to two groups:{" "}
        <strong>Developers</strong> who build apps with PayCraft, and{" "}
        <strong>End Users</strong> who see a PayCraft-powered paywall or subscribe
        inside a Developer&rsquo;s app.
      </p>

      <Callout>
        For End Users: PayCraft provides the billing technology inside the app you
        are using. The app&rsquo;s developer is the <em>controller</em> of your
        data and decides how it is used; PayCraft acts as their{" "}
        <em>processor</em>. If you have a request about your data, contact the
        app&rsquo;s developer first — we will assist them in fulfilling it.
      </Callout>

      <Section title="1. Information we collect">
        <p className="font-medium text-ink-800">From Developers (our customers)</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Account data — name, work email, hashed password, organization and app names.</li>
          <li>Configuration — products, prices, paywall design, and provider connection metadata (never your raw provider secret keys, which are encrypted at rest and never returned to the browser).</li>
          <li>Usage &amp; audit — dashboard actions, API calls, and webhook events, recorded in your tenant audit trail.</li>
          <li>Billing — the Stripe customer ID for your own PayCraft subscription (card data is held by Stripe, never by us).</li>
        </ul>
        <p className="font-medium text-ink-800 mt-4">
          From End Users (on a Developer&rsquo;s behalf)
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Subscription identity — an email or an anonymous app-scoped user ID used to link a purchase to an account and to restore it.</li>
          <li>Entitlement state — which product was purchased, its status, renewal and expiry dates, and the originating store (Google Play, App Store, Stripe, or Razorpay).</li>
          <li>Device signal — a device identifier and platform, used for cross-device restore and to enforce a fair per-account device limit.</li>
          <li>Coarse location — country, derived from IP at request time, to show the correct currency and price. We do not store your IP address in the entitlement record.</li>
        </ul>
        <p className="mt-3">
          PayCraft never receives or stores full payment-card numbers, CVCs, or
          bank credentials. All card processing happens on the payment
          provider&rsquo;s systems.
        </p>
      </Section>

      <Section title="2. How we use data">
        <ul className="list-disc pl-5 space-y-2">
          <li>Operate the Service — authenticate accounts, route store and provider webhooks, render the SDK paywall, and grant or restore entitlements.</li>
          <li>Bill our own plans — Stripe processes payment for the PayCraft subscription; we retain only your customer ID and invoice metadata.</li>
          <li>Keep it working — detect webhook failures, abuse, and fraud, and notify Developers of account activity and usage limits.</li>
          <li>Improve reliability — aggregated, non-identifying diagnostics on conversion and error rates.</li>
          <li>Meet legal obligations — tax, accounting, and fraud-prevention records.</li>
        </ul>
        <p className="mt-3">
          Where the GDPR applies, our legal bases are performance of a contract,
          our legitimate interests in operating and securing the Service, and
          compliance with legal obligations. We do not sell personal data and we
          do not use it for cross-context behavioral advertising.
        </p>
      </Section>

      <Section title="3. How we share data">
        <p>
          We share personal data only with the subprocessors below, only as
          needed to run the Service, and each under a data-processing agreement:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Supabase</strong> — database, authentication, and edge functions (US region).</li>
          <li><strong>Cloudflare</strong> — dashboard &amp; marketing hosting (Cloudflare Pages), DNS, and edge security.</li>
          <li><strong>Stripe</strong> — payment processing for our own SaaS billing, and for Developer paywalls that connect Stripe.</li>
          <li><strong>Google Play &amp; Apple App Store</strong> — store billing and receipt validation for in-app subscriptions.</li>
          <li><strong>Razorpay</strong> — payment processing where a Developer connects it.</li>
          <li><strong>Postmark</strong> — transactional email (account and system notices).</li>
        </ul>
        <p className="mt-3">
          We may also disclose data to comply with law, enforce our Terms, or
          protect the rights and safety of users. If we are ever part of a merger
          or acquisition, we will notify affected accounts before their data
          becomes subject to a different policy.
        </p>
      </Section>

      <Section title="4. Data retention">
        <p>
          We keep personal data only as long as needed for the purposes above.
          Audit logs follow the Developer&rsquo;s tier — 7 days (Free), 90 days
          (Pro), 365 days (Enterprise). Entitlements and registered devices live
          for the life of the tenant so that End Users can restore purchases.
          When a Developer closes their account we delete or anonymize their
          tenant data within 30 days, except records we must retain for legal or
          tax reasons.
        </p>
      </Section>

      <Section title="5. Security">
        <p>
          Data is encrypted in transit (TLS) and at rest. Provider secret keys are
          encrypted with authenticated symmetric encryption and are never returned
          to any browser or SDK. Access to production data is restricted,
          logged, and reviewed. No system is perfectly secure, but we work to
          protect your data using industry-standard safeguards.
        </p>
      </Section>

      <Section title="6. International transfers">
        <p>
          The Service is operated from, and data is primarily stored in, the
          United States. Where we transfer personal data out of the EEA, UK, or
          other regions, we rely on appropriate safeguards such as the European
          Commission&rsquo;s Standard Contractual Clauses.
        </p>
      </Section>

      <Section title="7. Your rights">
        <p>
          Depending on where you live (including under the GDPR and the CCPA/CPRA),
          you may have the right to access, correct, delete, port, or restrict the
          use of your personal data, and to object to certain processing. You will
          not be discriminated against for exercising these rights.
        </p>
        <ul className="list-disc pl-5 space-y-2 mt-2">
          <li><strong>Developers</strong> can export or delete tenant data from the dashboard, or email us.</li>
          <li><strong>End Users</strong> should contact the app&rsquo;s developer, who controls your data; we will help them respond.</li>
        </ul>
        <p className="mt-3">
          To reach us directly, email{" "}
          <a
            href="mailto:privacy@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            privacy@paycraft.mobilebytesensei.com
          </a>
          . We respond to verifiable requests within 30 days.
        </p>
      </Section>

      <Section title="8. Children">
        <p>
          The Service is not directed to children under 13 (or the minimum age in
          your jurisdiction), and we do not knowingly collect their personal data.
          If you believe a child has provided us data, contact us and we will
          delete it.
        </p>
      </Section>

      <Section title="9. Cookies">
        <p>
          The PayCraft dashboard uses strictly necessary cookies for
          authentication and security. The SDK paywall does not set advertising or
          cross-site tracking cookies.
        </p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will be
          announced in the dashboard or by email, and the &ldquo;Last
          updated&rdquo; date above will change. Continued use of the Service
          after an update means you accept the revised policy.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          MobileByteSensei Pvt Ltd — Data Protection Officer:{" "}
          <a
            href="mailto:dpo@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            dpo@paycraft.mobilebytesensei.com
          </a>
          . General privacy questions:{" "}
          <a
            href="mailto:privacy@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            privacy@paycraft.mobilebytesensei.com
          </a>
          .
        </p>
      </Section>

      <p className="mt-12 text-2xs text-ink-400">
        This document is provided for transparency and does not constitute legal
        advice. Developers remain responsible for their own privacy disclosures to
        their End Users.
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/60 px-5 py-4 text-sm text-ink-700 leading-relaxed">
      {children}
    </div>
  )
}
