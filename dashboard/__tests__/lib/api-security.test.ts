import fs from "fs"
import path from "path"
import { namesInfraInResponse, selectsCredentialColumn } from "../support/guards"
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
    expect(selectsCredentialColumn(f.src)).toBe(false)
  })

  it.each(v1.map((f) => [f.rel, f]))("%s does not wildcard-select a table with secrets", (_r, f: any) => {
    // select("*") is allowed only where the table holds no credentials — tenant_products,
    // tenant_paywall. On `tenants` it would publish every key the row carries.
    const wildcardOnTenants = /from\("tenants"\)[\s\S]{0,80}select\(["'`]\*/.test(f.src)
    const wildcardOnProviders = /from\("(tenant_providers|provider_accounts)"\)[\s\S]{0,80}select\(["'`]\*/.test(f.src)
    expect(wildcardOnTenants || wildcardOnProviders).toBe(false)
  })
})

/**
 * No response body may name our infrastructure.
 *
 * The specific instance: `requireApiKey` returned `500 server_misconfigured` with the detail
 * "SUPABASE_SERVICE_ROLE_KEY is not set". That 500 sits BEFORE authentication, so any anonymous
 * caller learned which infrastructure variable we run on. Fixing that one line is not a permanent
 * fix — the next endpoint to add a helpful error can reintroduce it, and nothing would object.
 *
 * This is the rule rather than the instance: a variable name may go to the LOG, never to a caller.
 * `console.error` is explicitly allowed; a response body is not.
 */
describe("no response names our infrastructure", () => {
  const fs2 = require("fs") as typeof import("fs")
  const path2 = require("path") as typeof import("path")
  const ROOT2 = path2.join(__dirname, "..", "..")

  function routeFiles(dir: string, out: string[] = []): string[] {
    if (!fs2.existsSync(dir)) return out
    for (const e of fs2.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue
      const p = path2.join(dir, e.name)
      if (e.isDirectory()) routeFiles(p, out)
      else if (e.name === "route.ts") out.push(p)
    }
    return out
  }

  // The predicate lives in ../support/guards and is proven to fire in
  // guard-predicates.test.ts. Inlining a regex here is how the first version of this guard came
  // to pass on the very line it was written to reject.

  const routes = routeFiles(path2.join(ROOT2, "app", "api")).map((f) => ({
    rel: path2.relative(ROOT2, f),
    src: fs2.readFileSync(f, "utf8"),
  }))

  const libs = ["lib/api-key-auth.ts", "lib/api-security.ts", "lib/api-v1-helpers.ts"]
    .filter((p) => fs2.existsSync(path2.join(ROOT2, p)))
    .map((p) => ({ rel: p, src: fs2.readFileSync(path2.join(ROOT2, p), "utf8") }))

  it("scans a meaningful number of files", () => {
    expect(routes.length + libs.length).toBeGreaterThan(15)
  })

  it.each([...routes, ...libs].map((f) => [f.rel, f]))(
    "%s never puts an infrastructure name in a response",
    (_r, f: any) => {
      const offending = f.src.split("\n").filter(namesInfraInResponse)
      expect(offending).toEqual([])
    },
  )
})

/**
 * The indirect case the scan above CANNOT see.
 *
 * `detail: `missing: ${missing.join(", ")}`` carries no literal variable name — the names arrive at
 * runtime from an array. A line-based scan is blind to it, which was proven by reintroducing that
 * exact line and watching the rule stay green.
 *
 * Two things close it: this assertion, pinned to the one endpoint that enumerates env names, and
 * `scripts/security-audit.sh`, which probes the LIVE response and therefore sees the rendered
 * output regardless of how it was built. Static analysis and runtime probing catch different
 * halves; neither alone is enough.
 */
describe("/api/health reports a count, never the names", () => {
  const fs3 = require("fs") as typeof import("fs")
  const path3 = require("path") as typeof import("path")
  const src = fs3.readFileSync(
    path3.join(__dirname, "..", "..", "app", "api", "health", "route.ts"),
    "utf8",
  )

  it("does not interpolate the missing-variable list into the response", () => {
    expect(src).not.toMatch(/detail:[^\n]*missing\.join/)
    expect(src).not.toMatch(/`missing: \$\{/)
  })

  it("returns a count instead", () => {
    expect(src).toMatch(/missing\.length\} required variable/)
  })

  it("still logs the names for whoever is on call", () => {
    expect(src).toMatch(/console\.error[^\n]*missing\.join/)
  })
})
