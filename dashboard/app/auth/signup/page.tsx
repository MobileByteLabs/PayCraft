"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, Mail, Sparkles } from "lucide-react"
import { createClient } from "@/lib/supabase-browser"
import { Button } from "@/components/ui/button"

export default function SignUpPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [appName, setAppName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { app_name: appName } },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="max-w-md w-full text-center px-8 animate-slide-up">
          <div className="w-14 h-14 rounded-2xl bg-success-50 mx-auto flex items-center justify-center mb-6">
            <Mail className="w-6 h-6 text-success-600" strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ink-900">
            Check your email
          </h1>
          <p className="mt-3 text-ink-500 text-sm leading-relaxed">
            We sent a confirmation link to{" "}
            <span className="font-medium text-ink-800">{email}</span>. Click
            the link to activate your PayCraft dashboard.
          </p>
          <Link
            href="/auth/login"
            className="mt-8 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[1fr_640px]">
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
            Create your account
          </h1>
          <p className="text-ink-500 text-sm mt-2">
            Free forever for 100 active subscribers. No card required.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg bg-danger-50 border border-danger-200 text-danger-700 px-3 py-2 text-sm animate-fade-in">
                {error}
              </div>
            )}
            <div>
              <label
                htmlFor="appName"
                className="block text-sm font-medium text-ink-700 mb-1.5"
              >
                App name
              </label>
              <input
                id="appName"
                type="text"
                required
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="Reels Downloader"
                className="input"
                autoFocus
              />
              <p className="text-2xs text-ink-400 mt-1.5">
                Shown to your team in the dashboard. Rename anytime.
              </p>
            </div>
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
                placeholder="you@yourcompany.com"
                className="input"
                autoComplete="email"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-ink-700 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
                autoComplete="new-password"
              />
              <p className="text-2xs text-ink-400 mt-1.5">
                At least 8 characters.
              </p>
            </div>
            <Button
              type="submit"
              loading={loading}
              size="lg"
              className="w-full"
            >
              {loading ? "Creating…" : "Create account"}
            </Button>
          </form>

          <p className="text-sm text-ink-500 mt-8 text-center">
            Already have an account?{" "}
            <Link
              href="/auth/login"
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              Sign in →
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex relative items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-12 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="absolute top-1/3 -right-32 w-96 h-96 bg-brand-400 rounded-full opacity-25 blur-[120px]" />
        <div className="absolute bottom-1/3 -left-32 w-96 h-96 bg-brand-300 rounded-full opacity-15 blur-[120px]" />

        <div className="relative z-10 max-w-md text-white">
          <p className="text-2xs uppercase tracking-widest font-semibold text-white/60 mb-3">
            What you get on Free
          </p>
          <h2 className="text-3xl font-bold tracking-tight leading-tight text-balance">
            Ship paid subscriptions in 15 minutes, then scale as you grow.
          </h2>
          <ul className="mt-8 space-y-3 text-sm text-white/90">
            <FeatureRow text={<><strong>100 active subscribers</strong> included</>} />
            <FeatureRow
              text={<><strong>10,000 webhook events</strong> / month</>}
            />
            <FeatureRow
              text={
                <>
                  <strong>10 payment providers</strong> — Stripe, Razorpay,
                  Paddle, +7 more
                </>
              }
            />
            <FeatureRow
              text={
                <>
                  Dashboard + <strong>multi-tenant</strong> backend
                </>
              }
            />
            <FeatureRow text={<>Free forever, no card required</>} />
          </ul>
        </div>
      </div>
    </div>
  )
}

function FeatureRow({ text }: { text: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{text}</span>
    </li>
  )
}
