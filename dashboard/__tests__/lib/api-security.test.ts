import fs from "fs"
import path from "path"
import {
  SECURITY_HEADERS,
  DOCS_HEADERS,
  MAX_BODY_BYTES,
  bodyTooLarge,
  checkAuthAttempts,
  recordAuthFailure,
  withSecurityHeaders,
} from "@/lib/api-security"

/**
 * Security properties of the machine API.
 *
 * Each block corresponds to a finding from probing the live API, so these are regression tests for
 * things that were genuinely missing rather than a checklist copied from a guide.
 */

const ROOT = path.join(__dirname, "..", "..")
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

function reqFrom(ip: string, headers: Record<string, string> = {}) {
  return new Request("https://api.paycraft.test/v1/readiness", {
    headers: { "x-forwarded-for": ip, ...headers },
  })
}

describe("security headers", () => {
  it("forbids caching of authenticated responses", () => {
    // These bodies carry a tenant's billing state. An un-hinted 200 is heuristically cacheable, so
    // silence would let a CDN or corporate proxy serve one tenant's data to the next caller.
    expect(SECURITY_HEADERS["Cache-Control"]).toBe("no-store")
  })

  it("sets the headers that cost nothing and close real classes", () => {
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff")
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY")
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer")
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/)
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/)
  })

  it("applies them to a response object", () => {
    const res = withSecurityHeaders(new Response("{}"))
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("gives the docs pages a policy that permits their own assets but still denies framing", () => {
    // The API policy (`default-src 'none'`) would break Swagger UI, which needs jsDelivr. The docs
    // policy widens exactly that and nothing else.
    expect(DOCS_HEADERS["Content-Security-Policy"]).toMatch(/cdn\.jsdelivr\.net/)
    expect(DOCS_HEADERS["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/)
    expect(DOCS_HEADERS["X-Content-Type-Options"]).toBe("nosniff")
  })

  it("does not let the docs policy leak into API responses", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(/jsdelivr/)
  })
})

describe("failed-authentication throttling", () => {
  it("allows a fresh source", () => {
    expect(checkAuthAttempts(reqFrom("10.0.0.1")).allowed).toBe(true)
  })

  it("blocks a source that keeps guessing", () => {
    const ip = "10.0.0.2"
    for (let i = 0; i < 25; i++) recordAuthFailure(reqFrom(ip))
    const o = checkAuthAttempts(reqFrom(ip))
    expect(o.allowed).toBe(false)
    expect(o.retryAfterSec).toBeGreaterThan(0)
  })

  it("throttles per source, not globally", () => {
    // A global counter would let one attacker deny service to every legitimate caller.
    const ip = "10.0.0.3"
    for (let i = 0; i < 25; i++) recordAuthFailure(reqFrom(ip))
    expect(checkAuthAttempts(reqFrom(ip)).allowed).toBe(false)
    expect(checkAuthAttempts(reqFrom("10.0.0.4")).allowed).toBe(true)
  })

  it("does not charge successful calls", () => {
    // checkAuthAttempts must be side-effect free; only recordAuthFailure consumes budget. If the
    // check itself counted, a busy legitimate client would throttle itself.
    const ip = "10.0.0.5"
    for (let i = 0; i < 40; i++) checkAuthAttempts(reqFrom(ip))
    expect(checkAuthAttempts(reqFrom(ip)).allowed).toBe(true)
  })
})

describe("request body cap", () => {
  it("rejects an oversized declared body", async () => {
    const res = bodyTooLarge(
      new Request("https://api.paycraft.test/v1/sync", {
        method: "POST",
        headers: { "content-length": String(MAX_BODY_BYTES + 1) },
      }),
    )
    expect(res?.status).toBe(413)
  })

  it("permits a normal body", () => {
    expect(
      bodyTooLarge(
        new Request("https://api.paycraft.test/v1/sync", {
          method: "POST",
          headers: { "content-length": "42" },
        }),
      ),
    ).toBeNull()
  })
})

describe("the auth layer wires the protections in the right order", () => {
  const src = read("lib/api-key-auth.ts")

  it("throttles before doing any work", () => {
    // Everything before the throttle is work a stranger can compel for free.
    const throttleAt = src.indexOf("checkAuthAttempts")
    const headerAt = src.indexOf('req.headers.get("authorization")')
    const dbAt = src.indexOf("tenant_api_key_verify")
    expect(throttleAt).toBeGreaterThan(-1)
    expect(throttleAt).toBeLessThan(headerAt)
    expect(throttleAt).toBeLessThan(dbAt)
  })

  it("charges a rejected key but not a wrong scope", () => {
    // A valid key lacking a scope is a misconfigured client, not a guess; throttling it would
    // punish the honest case.
    const invalidBlock = src.slice(src.indexOf('if (!row?.tenant_id)'), src.indexOf("const scopes"))
    expect(invalidBlock).toMatch(/recordAuthFailure/)
    const scopeBlock = src.slice(src.indexOf("!scopes.includes(scope)"), src.indexOf("Token bucket"))
    expect(scopeBlock).not.toMatch(/recordAuthFailure/)
  })

  it("reports unknown, revoked and expired keys identically", () => {
    // Distinguishing them tells an attacker which guess was once real.
    expect(src).toMatch(/identically on purpose/)
    expect(src).not.toMatch(/"key_revoked"|"key_expired"/)
  })
})

describe("no endpoint leaks a secret column", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (e.name === "route.ts") out.push(p)
    }
    return out
  }

  /**
   * Strip comments before judging. The tenant route names every credential column in a comment
   * explaining why it does NOT select them — the best possible reason for the string to appear, and
   * a test that fails on it teaches the next author to delete the explanation. Assert on what
   * executes.
   */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

  const v1 = walk(path.join(ROOT, "app", "api", "v1")).map((f) => ({
    rel: path.relative(ROOT, f),
    src: stripComments(fs.readFileSync(f, "utf8")),
  }))

  it.each(v1.map((f) => [f.rel, f]))("%s never selects a credential column", (_r, f: any) => {
    // `tenants` holds api_key_live / webhook_secret_live beside the safe columns; tenant_providers
    // and provider_accounts hold encrypted credentials. None may appear in a response.
    for (const col of [
      "api_key_live",
      "api_key_test",
      "webhook_secret_live",
      "webhook_secret_test",
      "credential_enc",
      "store_credential_enc",
      "secret_key_enc",
      "razorpay_key_secret_encrypted",
    ]) {
      expect(f.src).not.toContain(col)
    }
  })

  it.each(v1.map((f) => [f.rel, f]))("%s does not wildcard-select a table with secrets", (_r, f: any) => {
    // select("*") is allowed only where the table holds no credentials — tenant_products,
    // tenant_paywall. On `tenants` it would publish every key the row carries.
    const wildcardOnTenants = /from\("tenants"\)[\s\S]{0,80}select\(["'`]\*/.test(f.src)
    const wildcardOnProviders = /from\("(tenant_providers|provider_accounts)"\)[\s\S]{0,80}select\(["'`]\*/.test(f.src)
    expect(wildcardOnTenants || wildcardOnProviders).toBe(false)
  })
})
