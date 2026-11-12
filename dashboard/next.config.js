/** @type {import('next').NextConfig} */

// Phase 2 T11 of paycraft-v2-production-readiness — CORS allowlist for the
// dashboard's /api/* routes. The PayCraft SDK calls back into the dashboard
// from end-user apps (Web + Desktop variants), so we must accept the
// canonical paycraft.mobilebytesensei.com subdomain set + localhost (dev).
//
// Webhook routes intentionally do NOT need CORS — those are server-to-server
// from Stripe/Razorpay, never browser-driven.

const ALLOWED_ORIGINS = [
  'https://paycraft.mobilebytesensei.com',
  'https://docs.paycraft.mobilebytesensei.com',
  'https://status.paycraft.mobilebytesensei.com',
  // Local dev + Vercel preview wildcards handled at the dashboard layer when
  // process.env.NODE_ENV === 'development' (added below in `if` block).
]

if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:4173')
}

const CORS_HEADERS = [
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
  { key: 'Access-Control-Allow-Origin', value: ALLOWED_ORIGINS.join(', ') },
  { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, DELETE, OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Tenant-Id' },
  { key: 'Access-Control-Max-Age', value: '86400' },
]

const nextConfig = {
  // Vercel Hobby tier compatible
  async redirects() {
    return [
      // Folded in from the retired dashboard/vercel.json on the Cloudflare
      // migration (2026-08-23) — host-agnostic now that we run on Workers.
      { source: '/app', destination: '/dashboard', permanent: false },
    ]
  },
  // paycraft.mobilebytesensei.com/health — the one public health URL uptime monitors and
  // .github/workflows/health-check.yml poll (served by app/api/health).
  async rewrites() {
    return [{ source: '/health', destination: '/api/health' }]
  },
  async headers() {
    return [
      // Security headers — previously in dashboard/vercel.json (Vercel-specific).
      // Moved into next.config so they apply on Cloudflare Workers too.
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // API responses are never cached (auth/tenant-scoped data).
        source: '/api/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
      {
        // Apply CORS to all SDK-facing /api routes EXCEPT webhooks (which
        // never come from browsers, and a permissive CORS header on them
        // would weaken the signature-only auth model).
        source: '/api/((?!webhooks).*)',
        headers: CORS_HEADERS,
      },
    ]
  },
}

module.exports = nextConfig
