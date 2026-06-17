export const metadata = { title: "Data Processing Addendum · PayCraft" }

export default function DpaPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">
        Legal
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-ink-900 mt-2">
        Data Processing Addendum
      </h1>
      <p className="text-sm text-ink-500 mt-2">
        Last updated: <span className="tabular-nums">2026-06-06</span>
      </p>

      <Section title="1. Parties">
        <p>
          This addendum supplements the Terms of Service between Customer
          ("Controller") and MobileByteSensei Pvt Ltd ("Processor"). It
          applies when Customer processes Personal Data of EU/UK/India data
          subjects through PayCraft.
        </p>
      </Section>

      <Section title="2. Subject Matter">
        <p>
          Processor processes Personal Data on behalf of Controller to deliver
          the PayCraft Service — namely subscriber emails, device identifiers,
          subscription state, and audit metadata.
        </p>
      </Section>

      <Section title="3. Duration">
        <p>
          Processing continues for the duration of the Terms of Service. Upon
          termination, Personal Data is deleted within 30 days unless legal
          retention applies.
        </p>
      </Section>

      <Section title="4. Security">
        <p>
          Processor maintains technical and organizational measures aligned
          with SOC 2 Type 1 (Type 2 in progress), including: encryption at
          rest (pgcrypto), encryption in transit (TLS 1.3), Row-Level Security
          on all tenant-scoped tables, append-only audit logs, MFA on
          production access, and quarterly access reviews.
        </p>
      </Section>

      <Section title="5. Subprocessors">
        <p>
          PayCraft engages the following subprocessors to deliver the service.
          Processor notifies Controller 30 days before adding a new subprocessor.
          Controller may object; if unresolved within 30 days, either party may
          terminate.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 text-left font-semibold">Subprocessor</th>
                <th className="py-2 pr-4 text-left font-semibold">Purpose</th>
                <th className="py-2 pr-4 text-left font-semibold">Region</th>
                <th className="py-2 pr-4 text-left font-semibold">Security</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                {
                  name: "Supabase",
                  purpose: "Postgres database, Auth, Edge Functions",
                  region: "US (default), EU on request",
                  url: "https://supabase.com/security",
                },
                {
                  name: "Vercel",
                  purpose: "Dashboard hosting + global edge CDN",
                  region: "Global edge",
                  url: "https://vercel.com/security",
                },
                {
                  name: "Stripe, Inc.",
                  purpose: "Card capture + payment processing (PCI DSS Level 1)",
                  region: "US / EU / IN",
                  url: "https://stripe.com/docs/security/stripe",
                },
                {
                  name: "Razorpay Software Private Ltd.",
                  purpose: "Card capture + payment processing — India (PCI DSS Level 1)",
                  region: "IN",
                  url: "https://razorpay.com/security/",
                },
                {
                  name: "Resend, Inc.",
                  purpose: "Transactional email (welcome, support auto-reply, alerts)",
                  region: "US",
                  url: "https://resend.com/legal/security",
                },
                {
                  name: "Cloudflare R2",
                  purpose: "Encrypted database backup storage (Phase 3 DR)",
                  region: "Global",
                  url: "https://www.cloudflare.com/trust-hub/compliance-resources/",
                },
                {
                  name: "Sentry, Functional Software, Inc.",
                  purpose: "Error tracking + observability (PII-masked)",
                  region: "US / EU",
                  url: "https://sentry.io/security/",
                },
                {
                  name: "Google LLC",
                  purpose: "OAuth sign-in for dashboard authentication",
                  region: "Global",
                  url: "https://safety.google",
                },
                {
                  name: "GitHub, Inc.",
                  purpose: "Source code + CI/CD pipelines",
                  region: "US",
                  url: "https://github.com/security",
                },
              ].map((sp) => (
                <tr key={sp.name} className="border-b border-border">
                  <td className="py-2 pr-4 font-medium text-foreground">{sp.name}</td>
                  <td className="py-2 pr-4">{sp.purpose}</td>
                  <td className="py-2 pr-4">{sp.region}</td>
                  <td className="py-2 pr-4">
                    <a
                      href={sp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {new URL(sp.url).hostname}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Last updated: 2026-06-17. For changes, see CHANGELOG.md.
        </p>
      </Section>

      <Section title="6. Data Subject Rights">
        <p>
          Processor will assist Controller in responding to data subject
          access, rectification, and erasure requests. Standard turnaround:
          30 days.
        </p>
      </Section>

      <Section title="7. Breach Notification">
        <p>
          Processor notifies Controller within 72 hours of confirming a
          Personal Data breach affecting Controller's tenant.
        </p>
      </Section>

      <Section title="8. International Transfers">
        <p>
          Personal Data is primarily stored in the US East region. EU
          Standard Contractual Clauses are incorporated by reference.
          EU-residency hosting is available on Enterprise tier.
        </p>
      </Section>

      <Section title="9. Audits">
        <p>
          Controller may request a SOC 2 report or completed CAIQ
          questionnaire under NDA. On-site audits are subject to mutual
          scheduling and reasonable fees.
        </p>
      </Section>

      <Section title="10. Termination">
        <p>
          Personal Data is deleted within 30 days of contract termination
          unless required by law to retain. Backup deletion completes within
          90 days.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          For DPA execution, email{" "}
          <a
            href="mailto:legal@paycraft.mobilebytesensei.com"
            className="text-brand-600 underline"
          >
            legal@paycraft.mobilebytesensei.com
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
