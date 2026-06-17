/**
 * Phase 4 of paycraft-v2-production-readiness — edge-rate-limit token bucket.
 *
 * Verifies:
 *   - First request from a new IP is allowed
 *   - 60 sustained requests succeed, 61st fails
 *   - Different IPs have isolated buckets
 *   - `extractIp` resolves cf-connecting-ip > x-forwarded-for > x-real-ip
 *     (in that order) with sane fallback
 *   - `rateLimitHeaders` produces the canonical X-RateLimit-* triple
 */

import {
  checkEdgeRateLimit,
  extractIp,
  rateLimitHeaders,
} from "@/lib/edge-rate-limit"

describe("checkEdgeRateLimit", () => {
  test("first request from a new IP is allowed and reports max-1 remaining", () => {
    const ip = `test-ip-${Date.now()}-${Math.random()}`
    const outcome = checkEdgeRateLimit(ip)
    expect(outcome.ok).toBe(true)
    expect(outcome.remaining).toBe(59) // 60 limit, this consumed 1
    expect(outcome.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  test("60 sustained requests succeed, 61st is denied", () => {
    const ip = `burst-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 60; i++) {
      const out = checkEdgeRateLimit(ip)
      expect(out.ok).toBe(true)
      expect(out.remaining).toBe(59 - i)
    }
    const overflow = checkEdgeRateLimit(ip)
    expect(overflow.ok).toBe(false)
    expect(overflow.remaining).toBe(0)
    expect(overflow.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  test("different IPs have isolated buckets", () => {
    const a = `iso-a-${Date.now()}-${Math.random()}`
    const b = `iso-b-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 60; i++) {
      expect(checkEdgeRateLimit(a).ok).toBe(true)
    }
    // a is exhausted; b should still have a fresh 60-token bucket
    const fromB = checkEdgeRateLimit(b)
    expect(fromB.ok).toBe(true)
    expect(fromB.remaining).toBe(59)
  })
})

describe("rateLimitHeaders", () => {
  test("produces the canonical 3-header set", () => {
    const headers = rateLimitHeaders({
      ok: true,
      remaining: 42,
      resetAt: 9876543210,
    })
    expect(headers["X-RateLimit-Limit"]).toBe("60")
    expect(headers["X-RateLimit-Remaining"]).toBe("42")
    expect(headers["X-RateLimit-Reset"]).toBe("9876543210")
  })
})

describe("extractIp", () => {
  function makeHeaders(entries: Record<string, string>): Headers {
    return new Headers(entries)
  }

  test("prefers cf-connecting-ip when present", () => {
    const h = makeHeaders({
      "cf-connecting-ip": "1.2.3.4",
      "x-forwarded-for": "9.9.9.9",
      "x-real-ip": "5.6.7.8",
    })
    expect(extractIp(h)).toBe("1.2.3.4")
  })

  test("falls back to first x-forwarded-for entry when cf-connecting-ip absent", () => {
    const h = makeHeaders({
      "x-forwarded-for": "5.5.5.5, 6.6.6.6, 7.7.7.7",
      "x-real-ip": "8.8.8.8",
    })
    expect(extractIp(h)).toBe("5.5.5.5")
  })

  test("uses x-real-ip when other headers absent", () => {
    const h = makeHeaders({ "x-real-ip": "10.0.0.1" })
    expect(extractIp(h)).toBe("10.0.0.1")
  })

  test("returns 'unknown' when no IP headers are present", () => {
    expect(extractIp(makeHeaders({}))).toBe("unknown")
  })
})
