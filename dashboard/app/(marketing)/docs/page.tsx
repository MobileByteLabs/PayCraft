import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Docs — PayCraft",
  description: "PayCraft documentation — quickstart, migration, self-hosting, and guides.",
}

const CARDS: { title: string; body: string; href: string; external?: boolean }[] = [
  { title: "Quickstart", body: "Add subscription billing to your KMP app in under 15 minutes.", href: "/docs/quickstart-cloud" },
  { title: "SDK integration modes", body: "Drop-in themed paywall, or the headless billing API with your own UI.", href: "/docs/sdk-integration" },
  { title: "Migration v1 → v2", body: "Move from PayCraft.configure { } to the v2 dashboard-driven model.", href: "/docs/migration-v1-to-v2" },
  { title: "FAQ", body: "Common questions on providers, pricing, trials, and the SDK.", href: "/docs/faq" },
  { title: "Self-host", body: "Run PayCraft on your own Supabase backend — Docker Compose or Helm.", href: "/self-host" },
  { title: "Case study — Reels Downloader", body: "How a real KMP app shipped billing with PayCraft.", href: "/docs/case-studies/reels-downloader" },
  { title: "Full reference docs", body: "The complete API + guide reference site.", href: "https://docs.paycraft.mobilebytesensei.com", external: true },
]

export default function DocsIndexPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">Documentation</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink-900">PayCraft docs</h1>
      <p className="mt-3 text-ink-600">
        Everything you need to add multi-provider subscription billing to your Kotlin
        Multiplatform app with one SDK call.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => {
          const inner = (
            <div className="h-full rounded-xl border border-ink-200 bg-white p-5 transition-colors hover:border-brand-400 hover:shadow-sm">
              <div className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-900">
                {c.title}
                {c.external && <span className="text-ink-400">↗</span>}
              </div>
              <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">{c.body}</p>
            </div>
          )
          return c.external ? (
            <a key={c.href} href={c.href} target="_blank" rel="noopener noreferrer">
              {inner}
            </a>
          ) : (
            <Link key={c.href} href={c.href}>
              {inner}
            </Link>
          )
        })}
      </div>
    </main>
  )
}
