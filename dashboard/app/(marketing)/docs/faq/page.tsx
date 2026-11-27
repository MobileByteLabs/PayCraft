import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "FAQ — PayCraft",
  description: "Frequently asked questions about PayCraft — providers, pricing, trials, and the SDK.",
}

const FAQS: { q: string; a: string }[] = [
  {
    q: "Which payment providers does PayCraft support?",
    a: "Stripe, Razorpay, and native store billing (Google Play Billing and Apple StoreKit). You connect the providers you want per app; the SDK renders one paywall and routes checkout to the right provider per platform automatically.",
  },
  {
    q: "Does the app talk to the payment provider directly?",
    a: "No. The app only queries Supabase (the source of truth). Provider webhooks keep Supabase in sync, so the SDK never handles raw card data — it just reads the resulting entitlement.",
  },
  {
    q: "How do free trials work?",
    a: "Configure a trial length per product in the dashboard. PayCraft provisions the matching offer on every connected provider — Google Play & App Store free-trial offers, Stripe trial period, Razorpay — for new subscribers. Changes reflect in the app in realtime.",
  },
  {
    q: "How is billing state kept up to date in the app?",
    a: "The SDK is cache-first with a tiered refresh policy, plus realtime push: a config or entitlement change broadcasts to the SDK, which refetches immediately — so a dashboard price/trial change or a new purchase reflects without a cold relaunch.",
  },
  {
    q: "Is there a test mode?",
    a: "Yes — Stripe-style. Inject a pk_test_… key in debug builds and pk_live_… in release builds; the SDK and dashboard pick mode-appropriate payment links and webhook routes automatically.",
  },
  {
    q: "Can I self-host?",
    a: "Yes. Point the SDK at your own Supabase backend via PayCraftBackend.SelfHosted(...). See the self-host guide for Docker Compose and Helm.",
  },
  {
    q: "What does it cost?",
    a: "See the Pricing page. There's a free tier to start with no card required.",
  },
]

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">Documentation</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink-900">Frequently asked questions</h1>
      <div className="mt-10 space-y-8">
        {FAQS.map((f) => (
          <div key={f.q}>
            <h2 className="text-lg font-semibold text-ink-900">{f.q}</h2>
            <p className="mt-2 text-ink-600 leading-relaxed">{f.a}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
