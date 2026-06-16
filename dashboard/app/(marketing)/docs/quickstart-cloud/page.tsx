import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Quick Start — PayCraft',
  description: 'Add subscription billing to your Kotlin Multiplatform app in under 15 minutes.',
}

export default function QuickstartCloudPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 prose prose-slate dark:prose-invert">
      <h1>Quick Start — Cloud Dashboard</h1>
      <p className="lead">
        Add subscription billing to your KMP app in under 15 minutes.
      </p>

      <h2>1. Create your app on PayCraft</h2>
      <ol>
        <li>
          Sign up at{' '}
          <a href="https://paycraft.cloud/auth/login">paycraft.cloud/auth/login</a> (free — no
          card required).
        </li>
        <li>Follow the onboarding wizard: name your app, connect a payment provider, create your first product.</li>
        <li>Copy your API key from <strong>Settings → API Keys</strong>.</li>
      </ol>

      <h2>2. Add the dependency</h2>
      <pre><code>{`// build.gradle.kts (module)
implementation("io.github.mobilebytelabs:cmp-paycraft:2.0.0")`}</code></pre>

      <h2>3. Initialize at app startup</h2>
      <pre><code>{`// Application.kt / MainActivity.kt / AppDelegate
PayCraft.initialize(apiKey = "pk_live_YOUR_KEY_HERE")`}</code></pre>
      <p>
        That&apos;s all the code you need. Products, pricing, paywall template, and branding are
        configured in the dashboard.
      </p>

      <h2>4. Show the paywall</h2>
      <pre><code>{`@Composable
fun App() {
    // Show when the user taps "Upgrade" or hits a paywall gate
    PayCraftPaywall()
}`}</code></pre>

      <h2>5. Check subscription status</h2>
      <pre><code>{`val billingManager = PayCraft.billingManager
val state: BillingState = billingManager.billingState.collectAsState().value

when (state) {
    is BillingState.Free    -> { /* show upgrade prompt */ }
    is BillingState.Premium -> { /* unlock premium features */ }
    is BillingState.Loading -> { /* show shimmer */ }
}`}</code></pre>

      <h2>Self-hosted Enterprise</h2>
      <p>If you&apos;re running your own Supabase backend:</p>
      <pre><code>{`PayCraft.initialize(
    apiKey  = "pk_live_YOUR_KEY_HERE",
    backend = PayCraftBackend.SelfHosted(
        supabaseUrl     = "https://billing.yourcompany.com",
        supabaseAnonKey = "eyJ...",
    )
)`}</code></pre>
      <p>
        See the{' '}
        <a href="/docs/self-host">self-hosting guide</a> for full setup instructions including
        Docker Compose and Helm chart.
      </p>

      <h2>Sample app</h2>
      <p>
        A minimal working app is at{' '}
        <a href="https://github.com/MobileByteLabs/paycraft-sample-cloud">
          github.com/MobileByteLabs/paycraft-sample-cloud
        </a>
        . Clone it, paste your API key, run.
      </p>

      <h2>Next steps</h2>
      <ul>
        <li>
          <a href="/docs/products">Configure products and pricing</a>
        </li>
        <li>
          <a href="/docs/paywall-designer">Customize paywall template and branding</a>
        </li>
        <li>
          <a href="/docs/providers">Connect additional payment providers</a>
        </li>
        <li>
          <a href="/docs/webhooks">Set up webhooks</a>
        </li>
      </ul>
    </main>
  )
}
