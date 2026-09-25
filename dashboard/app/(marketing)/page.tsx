export const runtime = "edge"

import type { Metadata } from "next"
import Link from "next/link"
import { ButtonLink } from "@/components/ui/button"

/**
 * paycraft.mobilebytesensei.com — the marketing front door.
 *
 * Built from idea-layer/screens/home/ui.yaml and its Stitch mockup. Design decisions and their
 * reasoning live in idea-layer/design-system/DESIGN.md; the short version, because it explains
 * every choice below:
 *
 * The audience is KMP developers evaluating PayCraft against RevenueCat and Adapty, and what
 * they are buying is OWNERSHIP. That audience reads growth-hacked SaaS styling as exactly the
 * thing they are trying to escape, so this page looks like infrastructure: hairline borders
 * rather than drop shadows, one violet accent spent sparingly, real code above the fold, and
 * providers laid out as equal peers rather than Stripe-first.
 *
 * No em-dashes anywhere in copy. The docs site, the mockups and this page share that rule.
 */

export const metadata: Metadata = {
  title: "PayCraft: self-hosted billing for Kotlin Multiplatform",
  description:
    "Subscriptions across Stripe, Razorpay, Cashfree, Google Play and the App Store, behind one Kotlin Multiplatform SDK. Self-hosted, so the money and the data stay yours.",
}

const PROVIDERS = [
  { name: "Stripe", note: "Cards, wallets, global" },
  { name: "Razorpay", note: "India, UPI, netbanking" },
  { name: "Google Play", note: "Android in-app" },
  { name: "App Store", note: "iOS in-app" },
  { name: "Cashfree", note: "India, payouts" },
]

const PLATFORMS = ["Android", "iOS", "Desktop", "Web", "macOS", "wasm"]

const COMPARISON = [
  { capability: "Takes a cut of revenue", paycraft: "No", others: "Yes, a percentage" },
  { capability: "You own the subscriber data", paycraft: "Yes", others: "No" },
  { capability: "Self-hostable", paycraft: "Yes", others: "No" },
  { capability: "One KMP SDK, all platforms", paycraft: "Yes", others: "Partial" },
]

/** Uppercase mono micro-caps. The label treatment that makes a page read as instrumentation. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
      {children}
    </div>
  )
}

function SectionHeading({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-8 max-w-[68ch]">
      <h2 className="text-2xl font-semibold tracking-tight text-ink-900 text-balance">{title}</h2>
      {lede && <p className="mt-2 text-ink-600">{lede}</p>}
    </div>
  )
}

export default function MarketingHome() {
  return (
    <div className="mx-auto max-w-6xl px-6">
      {/* ── Hero ──────────────────────────────────────────────────────────────
          Deliberately NOT full-viewport. A hero that fills the screen is a
          landing-page move; the code block is the proof and it is one line,
          because one line IS the claim. */}
      <section className="border-b border-ink-200 py-16 md:py-20">
        <div className="grid gap-12 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div>
            <Eyebrow>Kotlin Multiplatform billing</Eyebrow>
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.025em] text-ink-950 md:text-5xl">
              Craft your own billing
            </h1>
            <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-ink-600">
              Subscriptions across Stripe, Razorpay, Cashfree, Google Play and the App Store,
              behind one Kotlin Multiplatform SDK. Self-hosted, so the money and the data stay
              yours.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/auth/login" size="lg">
                Start free
              </ButtonLink>
              <ButtonLink href="/docs" size="lg" variant="secondary">
                Read the docs
              </ButtonLink>
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 bg-ink-950 p-5 font-mono text-sm leading-relaxed text-ink-100">
            <div className="mb-3 flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-ink-700" />
              <span className="ml-2 text-2xs uppercase tracking-wider text-ink-500">
                shared/App.kt
              </span>
            </div>
            <pre className="overflow-x-auto">
              <code>
                <span className="text-brand-300">PayCraft</span>
                <span className="text-ink-400">.</span>
                <span className="text-ink-100">initialize</span>
                <span className="text-ink-400">(</span>
                {"\n  "}
                <span className="text-ink-300">apiKey</span>
                <span className="text-ink-400"> = </span>
                <span className="text-success-500">&quot;pk_live_…&quot;</span>
                {"\n"}
                <span className="text-ink-400">)</span>
              </code>
            </pre>
          </div>
        </div>
      </section>

      {/* ── Platform proof strip ──────────────────────────────────────────────
          Names, not logos. A logo wall reads as borrowed credibility. */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-200 py-6">
        <Eyebrow>One SDK. Six targets.</Eyebrow>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-600">
          {PLATFORMS.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      </section>

      {/* ── Providers ────────────────────────────────────────────────────────
          Equal-size cards on purpose. The product's claim is provider
          agnosticism, and making Stripe bigger would contradict the copy. */}
      <section className="py-16">
        <SectionHeading
          title="Any provider. Equal peers."
          lede="Connect at account level once. Every app you ship shares the connection."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p) => (
            <div
              key={p.name}
              className="rounded-xl border border-ink-200 bg-white p-5 transition-colors hover:border-brand-400"
            >
              <div className="font-semibold text-ink-900">{p.name}</div>
              <div className="mt-1 text-sm text-ink-500">{p.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Account model ────────────────────────────────────────────────────
          This is the product's actual data model, not a diagram for decoration:
          provider_accounts keys on the ACCOUNT, everything else on the app. */}
      <section className="border-t border-ink-200 py-16">
        <SectionHeading
          title="Account-level by design"
          lede="Providers, keys, plan and billing belong to your account. Apps consume them. Connect Stripe once, ship five apps."
        />
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-8">
          <div className="mx-auto max-w-md">
            <div className="rounded-lg border border-brand-300 bg-brand-50 px-5 py-4 text-center">
              <div className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-brand-700">
                Account
              </div>
              <div className="mt-1 text-sm text-ink-700">
                Stripe · Razorpay · Play · App Store
              </div>
            </div>
            <div className="mx-auto h-8 w-px bg-ink-300" aria-hidden="true" />
            <div className="grid grid-cols-3 gap-3">
              {["App one", "App two", "App three"].map((a) => (
                <div
                  key={a}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-3 text-center text-sm text-ink-700"
                >
                  {a}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── What you keep ────────────────────────────────────────────────────
          Competitors are not named in the header. The reader knows who "hosted
          platforms" means, and naming them looks defensive. */}
      <section className="border-t border-ink-200 py-16">
        <SectionHeading title="What you keep" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="py-3 pr-4 text-left font-mono text-2xs font-semibold uppercase tracking-[0.07em] text-ink-500">
                  Capability
                </th>
                <th className="py-3 pr-4 text-left font-mono text-2xs font-semibold uppercase tracking-[0.07em] text-ink-500">
                  PayCraft
                </th>
                <th className="py-3 text-left font-mono text-2xs font-semibold uppercase tracking-[0.07em] text-ink-500">
                  Hosted platforms
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.capability} className="border-b border-ink-200 last:border-0">
                  <td className="py-4 pr-4 text-ink-800">{row.capability}</td>
                  <td className="py-4 pr-4 font-medium text-ink-900">{row.paycraft}</td>
                  <td className="py-4 text-ink-500">{row.others}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── The limit we state plainly ───────────────────────────────────────
          The strongest trust signal this product has. No alarm colour: it is
          not a warning, it is honesty, and it is the most-asked support
          question. */}
      <section className="pb-16">
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-6 md:p-8">
          <h3 className="text-lg font-semibold text-ink-900">What we cannot do</h3>
          <p className="mt-2 max-w-[68ch] text-ink-600">
            Google Play and App Store test mode cannot be enabled by any API, because neither
            store exposes one. PayCraft reports those providers ready only when a real sandbox
            purchase arrives, and hands you the exact steps to get there: in the dashboard, in
            the API response, and to your assistant.
          </p>
        </div>
      </section>

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <section className="border-t border-ink-200 py-16 text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink-950">
          Fifteen minutes to your first subscription
        </h2>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/auth/login" size="lg">
            Start free
          </ButtonLink>
          <ButtonLink href="/self-host" size="lg" variant="secondary">
            Self-host instead
          </ButtonLink>
        </div>
        <p className="mt-5 text-sm text-ink-500">
          Apache-2.0 SDK ·{" "}
          <Link href="/pricing" className="text-brand-700 underline underline-offset-4">
            no revenue share on any tier
          </Link>
        </p>
      </section>
    </div>
  )
}
