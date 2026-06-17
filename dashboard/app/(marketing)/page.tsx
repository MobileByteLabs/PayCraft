import Link from "next/link"
import { ArrowRight, Zap, CheckCircle2, TrendingUp, Plus } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 text-center pt-24 pb-24 overflow-hidden">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-100 mb-6">
          <Zap className="w-4 h-4 fill-brand-600 text-brand-600" />
          <span className="text-xs font-bold uppercase tracking-wider">v2.0 is now live</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-ink-950 mb-6 leading-[1.1]">
          Billing infrastructure for <br />
          <span className="text-gradient-violet">KMP apps</span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg md:text-xl text-ink-500 mb-10 leading-relaxed">
          Any provider. Any platform. 15 minutes to integrate. PayCraft handles
          subscriptions, trials, and paywalls — configured in your dashboard, not
          in code.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <ButtonLink
            href="/auth/login"
            size="lg"
            trailing={<ArrowRight className="w-5 h-5" />}
            className="w-full sm:w-auto shadow-lg shadow-brand-500/20"
          >
            Get started free
          </ButtonLink>
          <ButtonLink
            href="/docs"
            size="lg"
            variant="ghost"
            className="w-full sm:w-auto"
          >
            View documentation
          </ButtonLink>
        </div>

        {/* Social proof — reels-downloader case study, real production usage since 2026-04-26 */}
        <div className="mt-12 inline-flex items-center gap-3 px-4 py-2 rounded-full bg-ink-50 border border-ink-200">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span className="text-sm text-ink-700">
            Powering <span className="font-semibold">reels-downloader</span> on
            Android, iOS, Web & Desktop since April 2026 —{" "}
            <Link
              href="/docs/case-studies/reels-downloader"
              className="font-semibold text-brand-700 hover:text-brand-800 underline-offset-4 hover:underline"
            >
              read the case study
            </Link>
          </span>
        </div>
      </section>

      {/* Dual Card Section */}
      <section className="max-w-7xl mx-auto px-6 mb-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          {/* Left: Terminal / Code Card */}
          <div
            className="rounded-2xl p-px shadow-2xl overflow-hidden"
            style={{ background: "linear-gradient(135deg, #18181B 0%, #27272A 100%)" }}
          >
            <div className="bg-ink-900 rounded-[14px] h-full flex flex-col">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-ink-800">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40" />
                  <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/40" />
                </div>
                <div className="ml-4 text-[11px] font-mono text-ink-500 uppercase tracking-widest">
                  MainApplication.kt
                </div>
              </div>

              {/* Code body */}
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto flex-1">
                {[
                  { n: 1, content: <><span className="text-purple-400">package</span><span className="text-ink-400"> com.example.app</span></> },
                  { n: 2, content: <span> </span> },
                  { n: 3, content: <><span className="text-purple-400">fun</span><span className="text-blue-400"> initBilling</span><span className="text-ink-400">{"() {"}</span></> },
                  { n: 4, content: <><span className="text-ink-400">{"  "}</span><span className="text-brand-400">PayCraft</span><span className="text-ink-400">.</span><span className="text-yellow-200">initialize</span><span className="text-ink-400">{"("}</span></> },
                  { n: 5, content: <><span className="text-ink-400">{"    apiKey = "}</span><span className="text-green-400">{'"pk_live_8392-xx-921"'}</span><span className="text-ink-400">,</span></> },
                  { n: 6, content: <><span className="text-ink-400">{"    sandbox = "}</span><span className="text-orange-400">false</span></> },
                  { n: 7, content: <span className="text-ink-400">{"  )"}</span> },
                  { n: 8, content: <span className="text-ink-400">{"}"}</span> },
                ].map((row) => (
                  <div key={row.n} className="flex gap-4">
                    <span className="text-ink-700 select-none w-4 shrink-0">{row.n}</span>
                    <span>{row.content}</span>
                  </div>
                ))}
              </div>

              {/* Footer hint */}
              <div className="mt-auto border-t border-ink-800 p-4 bg-ink-950/50">
                <p className="text-xs text-ink-500">
                  Unified Kotlin Multiplatform API works on Android, iOS, and Web.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Dashboard Mockup */}
          <div className="bg-white border border-ink-200 rounded-2xl p-8 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-ink-900 font-bold text-lg leading-tight">
                    Revenue Overview
                  </h3>
                  <p className="text-ink-500 text-sm">Last 30 days active performance</p>
                </div>
                <div className="bg-brand-50 text-brand-700 px-3 py-1 rounded-full text-xs font-bold">
                  LIVE MODE
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-10">
                <div className="space-y-1">
                  <p className="text-ink-500 text-[11px] font-bold uppercase tracking-wider">MRR</p>
                  <p className="text-3xl font-black text-ink-950 tracking-tighter">$12,400</p>
                  <div className="flex items-center gap-1 text-green-600 text-xs font-bold">
                    <TrendingUp className="w-3.5 h-3.5" />
                    12.5%
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-ink-500 text-[11px] font-bold uppercase tracking-wider">
                    Active Subscribers
                  </p>
                  <p className="text-3xl font-black text-ink-950 tracking-tighter">847</p>
                  <div className="flex items-center gap-1 text-green-600 text-xs font-bold">
                    <Plus className="w-3.5 h-3.5" />
                    42 today
                  </div>
                </div>
              </div>

              {/* Bar chart */}
              <div className="h-32 flex items-end gap-2 px-2">
                <div className="flex-1 bg-brand-100 rounded-t-sm h-[40%]" />
                <div className="flex-1 bg-brand-100 rounded-t-sm h-[55%]" />
                <div className="flex-1 bg-brand-100 rounded-t-sm h-[45%]" />
                <div className="flex-1 bg-brand-200 rounded-t-sm h-[70%]" />
                <div className="flex-1 bg-brand-300 rounded-t-sm h-[85%]" />
                <div className="flex-1 bg-brand-500 rounded-t-sm h-[95%]" />
                <div className="flex-1 bg-brand-600 rounded-t-sm h-[80%]" />
              </div>
            </div>

            {/* Provider status row */}
            <div className="mt-8 p-4 bg-ink-50 rounded-xl border border-ink-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-ink-900 flex items-center justify-center text-white">
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                  </svg>
                </div>
                <div className="text-sm">
                  <p className="text-ink-900 font-bold">Stripe Integrated</p>
                  <p className="text-ink-500 text-xs">Ready to collect payments</p>
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
          </div>
        </div>
      </section>

      {/* Three-column Features */}
      <section className="max-w-7xl mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Feature 1 */}
          <div className="flex flex-col items-start gap-4 p-4 hover:bg-white hover:shadow-sm rounded-2xl transition-all border border-transparent hover:border-ink-100">
            <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3h18v3H3zm0 9h18v3H3zm0 9h18v3H3z" opacity=".3" />
                <path d="M3 6h18v3H3zm0 9h18v3H3z" />
              </svg>
            </div>
            <div>
              <h4 className="text-ink-900 font-bold text-xl mb-2">Any Provider</h4>
              <p className="text-ink-500 text-sm leading-relaxed">
                Connect Stripe, Razorpay, or Apple/Google Pay in a single
                interface. Mix and match providers based on geographic region
                with zero code changes.
              </p>
            </div>
            <div className="flex gap-3 mt-2">
              <div className="h-6 px-2 bg-ink-100 border border-ink-200 rounded flex items-center grayscale opacity-70">
                <span className="text-[10px] font-bold text-ink-600 uppercase">Stripe</span>
              </div>
              <div className="h-6 px-2 bg-ink-100 border border-ink-200 rounded flex items-center grayscale opacity-70">
                <span className="text-[10px] font-bold text-ink-600 uppercase">Razorpay</span>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex flex-col items-start gap-4 p-4 hover:bg-white hover:shadow-sm rounded-2xl transition-all border border-transparent hover:border-ink-100">
            <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <div>
              <h4 className="text-ink-900 font-bold text-xl mb-2">Cloud Config</h4>
              <p className="text-ink-500 text-sm leading-relaxed">
                Update pricing, trial lengths, and entitlement names instantly
                from your dashboard. No more waiting for app store reviews to
                change your business model.
              </p>
            </div>
            <Link
              href="/docs"
              className="mt-2 text-xs font-bold text-brand-600 flex items-center gap-1 hover:gap-2 transition-all"
            >
              Explore Dashboard <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {/* Feature 3 */}
          <div className="flex flex-col items-start gap-4 p-4 hover:bg-white hover:shadow-sm rounded-2xl transition-all border border-transparent hover:border-ink-100">
            <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm0 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </div>
            <div>
              <h4 className="text-ink-900 font-bold text-xl mb-2">KMP Native</h4>
              <p className="text-ink-500 text-sm leading-relaxed">
                True multiplatform support. Write your billing logic once in
                shared code. Fully supports Android, iOS, and Desktop with a
                native SDK feel.
              </p>
            </div>
            <div className="flex gap-4 mt-2 text-ink-400">
              <div className="flex items-center gap-1">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.523 15.341a1.2 1.2 0 01-.001 1.699l-1.697 1.697a1.2 1.2 0 01-1.698 0l-2.549-2.549a5.5 5.5 0 01-6.437-8.68l2.293 2.293a2.5 2.5 0 003.535 3.535l2.005 2.005zm1.435-8.683a5.5 5.5 0 00-6.437-1.017L14.82 7.94a2.5 2.5 0 013.535 3.535l-2.293 2.293a5.5 5.5 0 001.017-6.437l1.879-1.879 2.293 2.293a1.2 1.2 0 000-1.698l-1.697-1.697a1.2 1.2 0 00-1.596 0z" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-wider">Android</span>
              </div>
              <div className="flex items-center gap-1">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-wider">iOS</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
