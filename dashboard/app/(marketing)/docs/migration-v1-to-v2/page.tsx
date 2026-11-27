import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Migration v1 → v2 — PayCraft",
  description: "Migrate from the v1 PayCraft.configure { } builder to the v2 dashboard-driven model.",
}

export default function MigrationPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 prose prose-slate">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold not-prose">
        Documentation
      </p>
      <h1>Migration: v1 → v2</h1>
      <p className="lead">
        v2 moves products, pricing, providers, and paywall styling out of code and into the
        dashboard. Your app shrinks to a single <code>initialize</code> call.
      </p>

      <h2>What changed</h2>
      <ul>
        <li>
          <strong><code>PayCraft.configure {"{ … }"}</code> was removed.</strong> Products, prices,
          payment links, and paywall styling now live in the dashboard and are fetched at runtime.
        </li>
        <li>The paywall re-renders automatically when you change config in the dashboard (realtime).</li>
        <li>Test/live mode is derived from the API key prefix (<code>pk_test_</code> / <code>pk_live_</code>).</li>
      </ul>

      <h2>Before (v1)</h2>
      <pre><code>{`PayCraft.configure {
    apiKey = "pk_live_…"
    product("pro_monthly") { price = 4.99; interval = MONTH }
    provider(StripeProvider(...))
    paywall { theme = ... }
}`}</code></pre>

      <h2>After (v2)</h2>
      <pre><code>{`// One line — everything else is configured in the dashboard.
PayCraft.initialize(apiKey = "pk_live_…")`}</code></pre>

      <h2>Migration steps</h2>
      <ol>
        <li>Create your app in the dashboard and re-create your products, prices, and providers there.</li>
        <li>Copy your API key from <strong>Settings → API Keys</strong>.</li>
        <li>
          Replace the <code>PayCraft.configure {"{ … }"}</code> block with{" "}
          <code>PayCraft.initialize(apiKey = …)</code>.
        </li>
        <li>Move any custom paywall styling into the dashboard&apos;s paywall designer.</li>
        <li>Bump the dependency to the latest <code>cmp-paycraft</code> and rebuild.</li>
      </ol>

      <p>
        Need the full reference?{" "}
        <a href="https://docs.paycraft.mobilebytesensei.com" target="_blank" rel="noopener noreferrer">
          docs.paycraft.mobilebytesensei.com
        </a>
        .
      </p>
    </main>
  )
}
