export const metadata = {
  title: "Subprocessors · PayCraft",
  description: "The third-party subprocessors PayCraft (MobileByteSensei Pvt Ltd) uses to run the Service.",
}

const LAST_UPDATED = "2026-08-24"

const SUBPROCESSORS: { name: string; purpose: string; location: string }[] = [
  { name: "Supabase", purpose: "Database, authentication, and edge functions", location: "United States" },
  { name: "Cloudflare", purpose: "Dashboard & marketing hosting (Pages), DNS, edge security", location: "Global edge" },
  { name: "Stripe", purpose: "Payment processing (our SaaS billing + tenant Stripe paywalls)", location: "United States / Global" },
  { name: "Google Play", purpose: "Store billing & receipt validation for in-app subscriptions", location: "Global" },
  { name: "Apple App Store", purpose: "Store billing & receipt validation for in-app subscriptions", location: "Global" },
  { name: "Razorpay", purpose: "Payment processing where a tenant connects it", location: "India" },
  { name: "Postmark", purpose: "Transactional email (account & system notices)", location: "United States" },
]

export default function SubprocessorsPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">Legal</p>
      <h1 className="text-4xl font-bold tracking-tight text-ink-900 mt-2">Subprocessors</h1>
      <p className="text-sm text-ink-500 mt-2">
        Last updated <span className="tabular-nums">{LAST_UPDATED}</span>
      </p>

      <p className="mt-6 text-ink-600 text-sm leading-relaxed">
        PayCraft (MobileByteSensei Pvt Ltd) uses the third-party subprocessors below to run the
        Service. Each processes personal data only as needed and under a data-processing agreement.
        We&apos;ll update this page before adding or replacing a subprocessor.
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-ink-500 border-b border-ink-200">
              <th className="py-2 pr-4 font-semibold">Subprocessor</th>
              <th className="py-2 pr-4 font-semibold">Purpose</th>
              <th className="py-2 font-semibold">Location</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name} className="border-b border-ink-100 align-top">
                <td className="py-3 pr-4 font-medium text-ink-900">{s.name}</td>
                <td className="py-3 pr-4 text-ink-600">{s.purpose}</td>
                <td className="py-3 text-ink-600">{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-8 text-sm text-ink-600 leading-relaxed">
        Questions? Email{" "}
        <a href="mailto:privacy@paycraft.mobilebytesensei.com" className="text-brand-600 underline">
          privacy@paycraft.mobilebytesensei.com
        </a>
        . See also our{" "}
        <a href="/legal/privacy" className="text-brand-600 underline">Privacy Policy</a> and{" "}
        <a href="/legal/dpa" className="text-brand-600 underline">DPA</a>.
      </p>
    </article>
  )
}
