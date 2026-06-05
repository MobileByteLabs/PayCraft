"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Sparkles } from "lucide-react"
import { createClient } from "@/lib/supabase-browser"
import { Button } from "@/components/ui/button"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push("/dashboard")
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[1fr_640px]">
      {/* Left: form */}
      <div className="bg-white flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="inline-flex items-center gap-2.5 mb-10">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm shadow-brand-500/30">
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight text-ink-900 leading-none">
                PayCraft
              </div>
              <div className="text-[10px] text-ink-400 font-medium mt-0.5">
                by MobileByteSensei
              </div>
            </div>
          </Link>

          <h1 className="text-3xl font-bold tracking-tight text-ink-900">
            Sign in to your dashboard
          </h1>
          <p className="text-ink-500 text-sm mt-2">
            Welcome back. Enter your credentials to manage your billing.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg bg-danger-50 border border-danger-200 text-danger-700 px-3 py-2 text-sm animate-fade-in">
                {error}
              </div>
            )}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-ink-700 mb-1.5"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
                autoComplete="email"
                autoFocus
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-ink-700"
                >
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Forgot?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              loading={loading}
              size="lg"
              className="w-full"
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-sm text-ink-500 mt-8 text-center">
            New to PayCraft?{" "}
            <Link
              href="/auth/signup"
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              Create an account →
            </Link>
          </p>
          <p className="text-2xs text-ink-400 mt-6 text-center max-w-[320px] mx-auto leading-relaxed">
            By signing in you agree to our{" "}
            <Link href="/legal/terms" className="underline hover:text-ink-600">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="underline hover:text-ink-600">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Right: brand gradient showcase */}
      <div className="hidden lg:flex relative items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-12 overflow-hidden">
        {/* Subtle dot pattern */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        {/* Soft floating orbs */}
        <div className="absolute top-1/4 -right-32 w-96 h-96 bg-brand-400 rounded-full opacity-25 blur-[120px]" />
        <div className="absolute bottom-1/4 -left-32 w-96 h-96 bg-brand-300 rounded-full opacity-15 blur-[120px]" />

        <div className="relative z-10 max-w-md text-white">
          <h2 className="text-3xl font-bold tracking-tight text-balance leading-snug">
            Trusted by developers shipping subscription apps across Android,
            iOS, Desktop, and Web.
          </h2>
          <p className="mt-4 text-white/70 text-sm leading-relaxed text-pretty">
            One SDK call, all your billing. Configure products, providers, and
            paywall in the dashboard. Integrate with one line.
          </p>

          {/* Stack of fake logos as social proof */}
          <div className="mt-10">
            <div className="text-2xs uppercase tracking-widest font-semibold text-white/50 mb-4">
              Used by
            </div>
            <div className="grid grid-cols-3 gap-4 max-w-xs">
              {[
                "Reels Downloader",
                "Mood Movies",
                "FocusFlow",
                "PocketPay",
                "QuickWord",
                "PlanIt",
              ].map((name) => (
                <div
                  key={name}
                  className="text-xs font-semibold text-white/40 truncate"
                >
                  {name}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
