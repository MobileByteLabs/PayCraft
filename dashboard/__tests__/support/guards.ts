/**
 * Guard predicates — the matching logic behind every source-scanning test, extracted so it can be
 * proven to FIRE.
 *
 * WHY THIS EXISTS
 * Three source-scanning guards written in this codebase passed on the very code they were written
 * to catch:
 *
 *   1. A tenant-isolation guard matched `body.tenant_id` and missed `(body as any).tenant_id`.
 *   2. A public-endpoint guard banned the word "tenant" and failed on documentation prose.
 *   3. An infrastructure-leak guard required the line to also contain `detail|message|error`, and
 *      `return fail(500, "…", "SUPABASE_SERVICE_ROLE_KEY is not set")` contains none of them.
 *
 * Each was caught only because the bug was reintroduced by hand afterwards. That check is manual,
 * and it was forgotten twice.
 *
 * THE FIX
 * A guard is a pure function over a line or a file, and it ships with the strings it MUST flag and
 * the strings it MUST NOT. `guard-predicates.test.ts` asserts both for every predicate in
 * `ALL_GUARDS`, so weakening one fails immediately and an unfireable assertion cannot be written.
 * Every `mustFlag` entry below is a verbatim line from a real defect in this codebase; every
 * `mustNotFlag` is a verbatim false positive one of these guards actually produced.
 */

export interface Guard {
  id: string
  what: string
  /** True when the input is a violation. */
  test: (input: string) => boolean
  /** Granularity: a guard reads either one line or a whole file. */
  scope: "line" | "file"
  mustFlag: string[]
  mustNotFlag: string[]
}

// ── shared helpers ────────────────────────────────────────────────────────────────────────────

/** Comments explain rules; they are never behaviour. Judging them produced false positive #2. */
const isComment = (l: string) => {
  const t = l.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")
}

export const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

// ── 1. infrastructure names must not reach a response ─────────────────────────────────────────

const INFRA =
  /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE|SERVICE_ROLE_KEY|DATABASE_URL|CLOUDFLARE_API_TOKEN/

export const namesInfraInResponse = (line: string): boolean => {
  const l = line.trim()
  if (isComment(l)) return false
  if (/console\.(error|warn|log|info)/.test(l)) return false // the log is the sanctioned destination
  if (/process\.env/.test(l)) return false // reading a variable is using it, not leaking it
  if (/^["'`][A-Z_]+["'`],?$/.test(l)) return false // a bare list entry is a declaration
  return INFRA.test(l)
}

// ── 2. a tenant must never come from the request ──────────────────────────────────────────────

export const takesTenantFromRequest = (line: string): boolean => {
  let l = line.trim()
  if (isComment(l)) return false
  // `ctx.tenantId` is the one sanctioned source; remove it before judging, or the correct call —
  // which mentions ctx.tenantId and body.confirm_count on one line — reads as a violation.
  l = l.split("ctx.tenantId").join("")
  if (!/tenant/i.test(l)) return false
  return /\bbody\b|searchParams|req\.|request\.|headers|params/i.test(l)
}

// ── 3. a click handler that returns a function instead of calling it ──────────────────────────

export const hasDoubleArrowHandler = (src: string): boolean =>
  /on[A-Z]\w+=\{\(\s*\)\s*=>\s*\(\s*\)\s*=>/.test(src)

// ── 4. no endpoint may select a credential column ─────────────────────────────────────────────

const CREDENTIAL_COLUMNS = [
  "api_key_live",
  "api_key_test",
  "webhook_secret_live",
  "webhook_secret_test",
  "credential_enc",
  "store_credential_enc",
  "secret_key_enc",
  "razorpay_key_secret_encrypted",
]

export const selectsCredentialColumn = (src: string): boolean => {
  const code = stripComments(src)
  return CREDENTIAL_COLUMNS.some((c) => code.includes(c))
}

// ── the register ──────────────────────────────────────────────────────────────────────────────

export const ALL_GUARDS: Guard[] = [
  {
    id: "infra-name-in-response",
    what: "an infrastructure variable name reaching a caller",
    test: namesInfraInResponse,
    scope: "line",
    mustFlag: [
      // The exact line an earlier version of this guard did not catch.
      'return fail(500, "server_misconfigured", "SUPABASE_SERVICE_ROLE_KEY is not set")',
      'throw new Error("DATABASE_URL is not set")',
      'return NextResponse.json({ detail: "NEXT_PUBLIC_SUPABASE_URL missing" }, { status: 500 })',
      'res.send(`CLOUDFLARE_API_TOKEN is not configured`)',
    ],
    mustNotFlag: [
      'console.error("api-key-auth: SUPABASE_SERVICE_ROLE_KEY is not set")',
      "const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!",
      '"SUPABASE_SERVICE_ROLE_KEY",',
      "// naming SUPABASE_SERVICE_ROLE_KEY in the body would tell an anonymous caller",
      "if (!SUPABASE_URL || !SERVICE_ROLE) {",
    ],
  },
  {
    id: "tenant-from-request",
    what: "a tenant id read from the request rather than the key",
    test: takesTenantFromRequest,
    scope: "line",
    mustFlag: [
      // The cast that slipped past the first version of this guard.
      "return runSyncDrain(ctx.admin as never, (body as any).tenant_id, body.confirm_count)",
      "const tenantId = body.tenant_id",
      'const tenantId = searchParams.get("tenant_id")',
      'const tenantId = req.headers.get("x-tenant-id")',
    ],
    mustNotFlag: [
      // The correct call — mentions both ctx.tenantId and body on one line.
      'return runSyncDrain(ctx.admin as never, ctx.tenantId, body.confirm_count, "/api/v1/sync")',
      "// No endpoint takes a tenant id — in a body, a query or a header.",
      '.eq("tenant_id", ctx.tenantId)',
    ],
  },
  {
    id: "double-arrow-handler",
    what: "a click handler that returns a function instead of calling it",
    test: hasDoubleArrowHandler,
    scope: "file",
    mustFlag: [
      "<button onClick={() => () => save(false, true)}>Connect</button>",
      "<a onMouseDown={() => ()  => doThing()} />",
    ],
    mustNotFlag: [
      "<button onClick={() => save()}>Save</button>",
      "<button onClick={() => void save(true)}>Replace</button>",
      "const f = () => () => 1 // not a handler",
    ],
  },
  {
    id: "credential-column",
    what: "a credential column selected into a response",
    test: selectsCredentialColumn,
    scope: "file",
    mustFlag: [
      'const { data } = await ctx.admin.from("tenants").select("id, api_key_live")',
      '.select("provider, credential_enc")',
    ],
    mustNotFlag: [
      "// `tenants` also holds api_key_live and webhook_secret_live beside the safe columns",
      '/* a select("*") here would publish api_key_test */',
      '.select("id, name, plan, status")',
    ],
  },
]
