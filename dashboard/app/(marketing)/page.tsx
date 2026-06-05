import Link from "next/link"
import {
  ArrowRight,
  Code2,
  LayoutDashboard,
  Server,
  ShieldCheck,
} from "lucide-react"
import { ButtonLink } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <>
      {/* HERO */}
      <section className="relative pt-24 pb-32 overflow-hidden">
        {/* Background gradient + grid */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-50/30 via-white to-white" />
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, #18181B 1px, transparent 0)",
              backgroundSize: "32px 32px",
            }}
          />
        </div>
        <div className="absolute top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand-200 rounded-full opacity-20 blur-[150px] -z-10" />

        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 border border-brand-200 px-3 py-1 mb-8 animate-fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse-soft" />
            <span className="text-xs font-semibold text-brand-700">
              v2.0 — Cloud SaaS now in preview
            </span>
          </div>
          <h1 className="text-7xl font-bold tracking-tight text-ink-900 text-balance leading-[1.05] animate-slide-up">
            One SDK call.
            <br />
            <span className="text-brand-600">All your billing.</span>
          </h1>
          <p
            className="text-lg text-ink-600 mt-8 max-w-2xl mx-auto text-pretty leading-relaxed animate-slide-up"
            style={{ animationDelay: "60ms" }}
          >
            PayCraft is the multi-provider subscription billing platform for
            Kotlin Multiplatform. Wire in Stripe, Razorpay, and 8 more —
            configure plans, pricing, and paywall in the dashboard, integrate
            with one line.
          </p>

          {/* Code block */}
          <div
            className="mt-12 max-w-2xl mx-auto animate-slide-up"
            style={{ animationDelay: "120ms" }}
          >
            <div className="rounded-2xl bg-ink-950 border border-ink-900 shadow-2xl shadow-brand-900/20 overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-ink-800">
                <span className="w-2.5 h-2.5 rounded-full bg-ink-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-ink-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-ink-700" />
                <span className="ml-auto text-2xs font-mono text-ink-500">
                  Application.kt
                </span>
              </div>
              <pre className="px-6 py-5 text-left text-[13px] font-mono text-ink-300 leading-relaxed overflow-x-auto">
                <code>
                  <span className="text-brand-300">PayCraft</span>
                  <span className="text-ink-400">.</span>
                  <span className="text-info-300">initialize</span>
                  <span className="text-ink-400">(</span>
                  <span className="text-ink-400">apiKey = </span>
                  <span className="text-success-300">"pk_live_…"</span>
                  <span className="text-ink-400">)</span>
                  {"\n\n"}
                  <span className="text-brand-300">PayCraftPaywall</span>
                  <span className="text-ink-400">()</span>
                </code>
              </pre>
            </div>
          </div>

          {/* CTAs */}
          <div
            className="mt-10 flex flex-wrap items-center justify-center gap-3 animate-slide-up"
            style={{ animationDelay: "180ms" }}
          >
            <ButtonLink
              href="/auth/signup"
              size="lg"
              trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
            >
              Start free
            </ButtonLink>
            <ButtonLink href="/pricing" size="lg" variant="ghost">
              See pricing
            </ButtonLink>
          </div>

          {/* Social proof */}
          <div className="mt-20 animate-fade-in" style={{ animationDelay: "250ms" }}>
            <p className="text-2xs uppercase font-semibold tracking-widest text-ink-400 mb-6">
              Trusted by developers building with
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-ink-400">
              {[
                "Reels Downloader",
                "Mood Movies",
                "FocusFlow",
                "PocketPay",
                "QuickWord",
                "PlanIt",
              ].map((n) => (
                <span
                  key={n}
                  className="text-sm font-semibold tracking-tight grayscale opacity-70"
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHY PAYCRAFT */}
      <section className="py-20 border-t border-ink-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-2xs uppercase font-semibold tracking-widest text-brand-600 mb-2">
              Why PayCraft
            </p>
            <h2 className="text-4xl font-bold tracking-tight text-ink-900 text-balance">
              The billing platform built for KMP.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<LayoutDashboard className="w-5 h-5" />}
              title="Multi-provider checkout"
              body="Wire Stripe, Razorpay, Paddle, and 7 more behind a single SDK. The bottom-sheet picker shows only providers eligible for the user's locale."
            />
            <FeatureCard
              icon={<Code2 className="w-5 h-5" />}
              title="Dashboard-driven"
              body="Change products, pricing, and paywall design in the dashboard. The SDK refreshes config within 1 hour — no app store re-submit."
            />
            <FeatureCard
              icon={<Server className="w-5 h-5" />}
              title="Self-host ready"
              body="Enterprise tier ships a Docker compose stack under BSL license. Run PayCraft on your own infra. Same SDK, your data."
            />
          </div>
        </div>
      </section>

      {/* CODE-VS-DASHBOARD */}
      <section className="py-20 border-t border-ink-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold tracking-tight text-ink-900 text-balance leading-tight">
              Code stays simple.
              <br />
              Dashboard does the heavy lifting.
            </h2>
            <p className="text-ink-500 text-base mt-4 max-w-2xl mx-auto text-pretty">
              Your app calls{" "}
              <code className="code-inline">PayCraft.initialize</code>. Everything else
              — products, providers, paywall, pricing, trials — happens in the
              dashboard.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start mt-16">
            {/* IDE-style code */}
            <div className="rounded-2xl bg-ink-950 border border-ink-900 shadow-2xl shadow-brand-900/20 overflow-hidden">
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-ink-800">
                <span className="w-2.5 h-2.5 rounded-full bg-ink-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-ink-700" />
                <span className="w-2.5 h-2.5 rounded-full bg-ink-700" />
                <span className="ml-auto text-2xs font-mono text-ink-500">
                  composeApp/Application.kt
                </span>
              </div>
              <pre className="px-6 py-5 text-left text-[13px] font-mono text-ink-300 leading-relaxed">
                <code>
                  <span className="text-info-300">import</span>
                  <span className="text-ink-400">
                    {" com.mobilebytelabs.paycraft.*"}
                  </span>
                  {"\n\n"}
                  <span className="text-info-300">class</span>
                  <span className="text-warning-300"> MyApplication </span>
                  <span className="text-ink-400">: </span>
                  <span className="text-warning-300">Application</span>
                  <span className="text-ink-400">{"() {"}</span>
                  {"\n    "}
                  <span className="text-info-300">override fun</span>
                  <span className="text-warning-300"> onCreate</span>
                  <span className="text-ink-400">{"() {"}</span>
                  {"\n        "}
                  <span className="text-brand-300">PayCraft</span>
                  <span className="text-ink-400">.</span>
                  <span className="text-info-300">initialize</span>
                  <span className="text-ink-400">(</span>
                  {"\n            "}
                  <span className="text-ink-400">apiKey = </span>
                  <span className="text-success-300">"pk_live_8f0c…"</span>
                  {"\n        "}
                  <span className="text-ink-400">)</span>
                  {"\n    "}
                  <span className="text-ink-400">{"}"}</span>
                  {"\n"}
                  <span className="text-ink-400">{"}"}</span>
                </code>
              </pre>
            </div>

            {/* Dashboard preview */}
            <div className="relative">
              <div className="absolute -inset-4 bg-brand-100/40 rounded-3xl blur-3xl -z-10" />
              <div className="rounded-2xl border border-ink-200 shadow-xl overflow-hidden bg-white transform lg:rotate-1 hover:rotate-0 transition-transform duration-500">
                <div className="bg-ink-50 border-b border-ink-200 px-4 py-3 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-danger-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-warning-400" />
                  <span className="w-2.5 h-2.5 rounded-full bg-success-400" />
                  <span className="ml-3 text-xs text-ink-500 font-mono">
                    paycraft.cloud/products
                  </span>
                </div>
                <div className="p-5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-ink-900">
                      Products
                    </h3>
                    <span className="text-2xs bg-brand-600 text-white px-2 py-1 rounded font-bold">
                      + NEW
                    </span>
                  </div>
                  {[
                    {
                      sku: "monthly",
                      name: "Monthly Premium",
                      tag: "SUB",
                      price: "$1.99",
                      tone: "neutral",
                    },
                    {
                      sku: "yearly",
                      name: "Yearly Premium",
                      tag: "SUB",
                      price: "$19.99",
                      tone: "neutral",
                    },
                    {
                      sku: "lifetime",
                      name: "Lifetime Access",
                      tag: "LIFE",
                      price: "$49.99",
                      tone: "brand",
                    },
                    {
                      sku: "trial-7d",
                      name: "7-day Trial",
                      tag: "TRIAL",
                      price: "—",
                      tone: "info",
                    },
                  ].map((p) => (
                    <div
                      key={p.sku}
                      className="flex items-center justify-between px-3 py-2 rounded-lg border border-ink-200/60 hover:bg-ink-50/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <code className="text-2xs font-mono text-ink-500">
                          {p.sku}
                        </code>
                        <span className="text-xs font-semibold text-ink-900">
                          {p.name}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
                            p.tone === "brand"
                              ? "bg-brand-50 text-brand-700 border-brand-200"
                              : p.tone === "info"
                              ? "bg-info-50 text-info-700 border-info-200"
                              : "bg-ink-100 text-ink-700 border-ink-200"
                          }`}
                        >
                          {p.tag}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-ink-900 tabular-nums">
                        {p.price}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="py-24 border-t border-ink-100">
        <div className="max-w-3xl mx-auto px-6">
          <div className="relative rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 overflow-hidden p-12 text-center text-white">
            <div
              className="absolute inset-0 opacity-[0.06]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
                backgroundSize: "24px 24px",
              }}
            />
            <div className="absolute -top-32 -right-32 w-80 h-80 bg-brand-400 rounded-full opacity-30 blur-[100px]" />

            <h2 className="relative text-4xl font-bold tracking-tight text-balance leading-tight">
              Ship subscription billing in 15 minutes.
            </h2>
            <p className="relative text-white/70 mt-3 text-base text-pretty">
              Free tier is forever. No card required.
            </p>
            <div className="relative mt-8 flex items-center justify-center gap-3">
              <ButtonLink
                href="/auth/signup"
                size="lg"
                className="!bg-white !text-brand-700 !shadow-lg hover:!bg-ink-50"
                trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
              >
                Get your API key
              </ButtonLink>
              <ButtonLink
                href="/docs/quickstart-cloud"
                size="lg"
                variant="ghost"
                className="!text-white hover:!bg-white/10"
              >
                Read the docs
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="p-6 rounded-2xl border border-ink-200 bg-white hover:border-brand-200 hover:shadow-md transition-all">
      <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-bold tracking-tight text-ink-900">
        {title}
      </h3>
      <p className="text-sm text-ink-500 mt-2 leading-relaxed">{body}</p>
    </div>
  )
}
