import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Changelog — PayCraft",
  description: "Release notes and version history for the PayCraft SDK and platform.",
}

const RELEASES: { version: string; date: string; notes: string[] }[] = [
  {
    version: "v2.3",
    date: "2026",
    notes: [
      "Realtime everywhere — config & entitlement changes push to the SDK instantly (no cache-TTL lag).",
      "Multi-provider trial & coupon sync — trials and discounts fan out to every connected provider by default.",
      "Redesigned restore-purchases surface and store-compliant paywall trial disclosure.",
    ],
  },
  {
    version: "v2.0",
    date: "2026",
    notes: [
      "Dashboard-driven model — products, pricing, providers, and paywall styling move out of code.",
      "One-line integration: PayCraft.initialize(apiKey = …).",
      "Multi-tenant SaaS dashboard with per-app provider connections.",
    ],
  },
]

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">Product</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink-900">Changelog</h1>
      <p className="mt-3 text-ink-600">
        Highlights below. Full release notes and version tags live on{" "}
        <a
          href="https://github.com/MobileByteLabs/PayCraft/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 underline"
        >
          GitHub Releases
        </a>
        .
      </p>

      <div className="mt-10 space-y-10">
        {RELEASES.map((r) => (
          <div key={r.version} className="border-l-2 border-ink-200 pl-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold text-ink-900">{r.version}</h2>
              <span className="text-xs text-ink-400">{r.date}</span>
            </div>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-ink-600 leading-relaxed">
              {r.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  )
}
