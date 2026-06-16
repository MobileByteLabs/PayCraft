"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase-browser"
import { Button } from "@/components/ui/button"

/**
 * Nuke any stale Supabase auth artifacts before initiating a fresh OAuth flow.
 *
 * Past failed flows (cancelled at Google, network blip during PKCE exchange,
 * stale code_verifier cookies from an older `@supabase/ssr` version) can leave
 * the browser holding cookies / localStorage keys that supabase-js still treats
 * as "current". When the next signInWithOAuth fires, those stale artifacts get
 * mixed into the new request and GoTrue rejects with `{"message":"Bad request"}`.
 *
 * Clearing on mount makes every visit to /auth/login a guaranteed clean slate.
 * Safe to run unconditionally — there's no scenario where an already-signed-in
 * user benefits from landing on the login page with their session intact.
 */
function purgeStaleSupabaseAuthState() {
  if (typeof window === "undefined") return

  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("sb-") || k.startsWith("supabase.")) localStorage.removeItem(k)
    })
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith("sb-") || k.startsWith("supabase.")) sessionStorage.removeItem(k)
    })
    document.cookie
      .split(";")
      .map((c) => c.trim().split("=")[0])
      .filter((n) => n.startsWith("sb-") || n.startsWith("supabase-") || n === "paycraft_active_app_id")
      .forEach((name) => {
        document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
        document.cookie = `${name}=; Path=/; Domain=${location.hostname}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
      })
  } catch {
    // localStorage may throw in private-mode or strict-cookie browsers — ignore.
  }
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  // Purge stale Supabase auth state on every mount of /auth/login. Any prior
  // failed OAuth round-trip can leave `sb-*` cookies / localStorage keys behind
  // that poison the next signInWithOAuth call (GoTrue then 400s with
  // {"message":"Bad request"} before the browser even reaches Google). This
  // guarantees a clean slate.
  useEffect(() => {
    purgeStaleSupabaseAuthState()
    // Tell gotrue-js to forget any in-memory session too — defense in depth.
    void supabase.auth.signOut({ scope: "local" }).catch(() => {})
  }, [supabase])

  async function signInWithGoogle() {
    setLoading(true)
    setError(null)

    // Idempotent re-purge right before kicking off OAuth — protects against
    // any state the user accumulated since the page first mounted (extensions,
    // back-button into a stale tab, etc.).
    purgeStaleSupabaseAuthState()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    })
    if (error) {
      // If GoTrue rejected the call (e.g. lingering server-side state from a
      // racing tab), nuke once more so the next click starts fresh.
      purgeStaleSupabaseAuthState()
      setError(error.message)
      setLoading(false)
    }
    // On success the browser redirects — no further action needed
  }

  return (
    <main className="flex min-h-screen">
      {/* Left Column: Auth form (60%) */}
      <section className="flex flex-col flex-1 lg:flex-[0.6] bg-white items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px] flex flex-col gap-8">
          {/* Brand & Header */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="inline-flex">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-md shadow-brand-500/30">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
            </Link>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
                Sign in to your dashboard
              </h1>
              <p className="mt-2 text-ink-500 text-sm">
                Welcome back. Enter your credentials to manage your billing.
              </p>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 text-danger-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Google Sign-in */}
          <Button
            onClick={signInWithGoogle}
            loading={loading}
            size="lg"
            variant="secondary"
            className="w-full gap-3 justify-center"
          >
            {!loading && <GoogleIcon />}
            {loading ? "Redirecting…" : "Continue with Google"}
          </Button>

          {/* Divider */}
          <div className="relative">
            <div aria-hidden="true" className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ink-200" />
            </div>
            <div className="relative flex justify-center text-sm font-medium">
              <span className="bg-white px-4 text-ink-400">OR</span>
            </div>
          </div>

          {/* GitHub OAuth (visual only — not wired; extend as needed) */}
          <button
            type="button"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50 transition-colors"
          >
            <GitHubIcon />
            Continue with GitHub
          </button>

          {/* Footer */}
          <div className="flex flex-col gap-6">
            <Link
              href="/auth/signup"
              className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors inline-flex items-center"
            >
              New to PayCraft? Create an account →
            </Link>
            <p className="text-xs text-ink-400 leading-relaxed">
              By signing in you agree to our{" "}
              <Link
                href="/legal/terms"
                className="underline hover:text-ink-600 transition-colors"
              >
                Terms
              </Link>{" "}
              and{" "}
              <Link
                href="/legal/privacy"
                className="underline hover:text-ink-600 transition-colors"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Right Column: Visual narrative (40%) */}
      <section className="hidden lg:flex lg:flex-[0.4] bg-gradient-to-br from-brand-600 to-brand-900 relative overflow-hidden items-center justify-center p-12">
        {/* Decorative blobs */}
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-white rounded-full blur-[120px]" />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-brand-300 rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 flex flex-col items-center text-center max-w-lg gap-12">
          <h2 className="text-2xl font-bold text-white leading-tight">
            Trusted by developers shipping subscription apps across Android,
            iOS, Desktop, and Web.
          </h2>

          {/* Dashboard mockup preview (placeholder block) */}
          <div className="w-full rounded-xl border border-white/20 shadow-2xl overflow-hidden bg-ink-950/80 backdrop-blur-md">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              <span className="ml-auto text-[11px] font-mono text-white/30">
                paycraft.cloud/dashboard
              </span>
            </div>
            <div className="p-5 space-y-3">
              <div className="h-3 bg-white/10 rounded w-3/4" />
              <div className="h-3 bg-white/10 rounded w-1/2" />
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="h-16 bg-brand-600/30 rounded-lg border border-brand-400/20" />
                <div className="h-16 bg-brand-600/30 rounded-lg border border-brand-400/20" />
              </div>
              <div className="h-3 bg-white/10 rounded w-2/3" />
              <div className="h-3 bg-white/10 rounded w-5/6" />
            </div>
          </div>

          {/* Brand badge */}
          <div className="w-full flex flex-col items-center gap-2">
            <div className="text-white font-bold text-2xl tracking-tight">PayCraft</div>
            <div className="text-white/50 text-[11px] font-medium tracking-[0.25em] uppercase">
              by MobileByteSensei
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="absolute bottom-8 left-8 flex gap-6">
          <p className="text-white/40 text-xs">© 2026 MobileByteSensei. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/legal/privacy" className="text-white/40 hover:text-white transition-colors text-xs">
              Privacy Policy
            </Link>
            <Link href="/legal/terms" className="text-white/40 hover:text-white transition-colors text-xs">
              Terms of Service
            </Link>
          </div>
        </footer>
      </section>
    </main>
  )
}
