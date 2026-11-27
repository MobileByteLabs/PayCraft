import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Self-host — PayCraft",
  description: "Run PayCraft on your own Supabase backend with Docker Compose or Helm.",
}

export default function SelfHostPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 prose prose-slate">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold not-prose">
        Documentation
      </p>
      <h1>Self-hosting PayCraft</h1>
      <p className="lead">
        PayCraft is fully self-hostable. The backend is Supabase (Postgres + Auth + Edge
        Functions); point the SDK at your own instance and you own the entire billing stack.
      </p>

      <h2>Architecture</h2>
      <pre><code>{`Client App → PayCraft SDK → your Supabase (source of truth)
Payment Provider (Stripe / Razorpay) → Webhook → your Supabase`}</code></pre>
      <p>
        The app never talks to the payment provider directly — it only reads entitlement from
        Supabase, which provider webhooks keep in sync.
      </p>

      <h2>Point the SDK at your backend</h2>
      <pre><code>{`PayCraft.initialize(
    apiKey  = "pk_live_YOUR_KEY_HERE",
    backend = PayCraftBackend.SelfHosted(
        supabaseUrl     = "https://billing.yourcompany.com",
        supabaseAnonKey = "eyJ…",
    ),
)`}</code></pre>

      <h2>Deploy the backend</h2>
      <ul>
        <li><strong>Docker Compose</strong> — a single compose file brings up Supabase + the Edge Functions and applies migrations.</li>
        <li><strong>Helm chart</strong> — for Kubernetes deployments.</li>
        <li>Bring your own domain + TLS, and set your provider secrets as Edge Function secrets.</li>
      </ul>

      <p>
        Full setup — compose file, Helm values, migrations, and webhook wiring — is in the{" "}
        <a href="https://docs.paycraft.mobilebytesensei.com" target="_blank" rel="noopener noreferrer">
          reference docs
        </a>
        .
      </p>
    </main>
  )
}
