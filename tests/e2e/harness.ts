/**
 * End-to-end harness: a REAL database and a REAL edge function, never a stub.
 *
 * WHY THIS EXISTS
 * The suites under `supabase/functions/*​/__tests__/` stub `globalThis.fetch`, so every row the code
 * under test sees is a row the test author imagined. That is useful for branch coverage and useless
 * for contract truth — and it is why a string of production defects walked straight through a green
 * test run:
 *
 *   · `/config` dropped Razorpay from `providers[]` because its payment-link map was `{sku: {}}`,
 *     even though every product carried an INR plan id. A stub returning "some links" never sees it.
 *   · The platform fallback chain resolved NOTHING for web/desktop, so a buyer was offered no way to
 *     pay. The stubbed suite asserted the chain's happy path only.
 *   · `tenant_providers_status` reported a live-only tenant as disconnected — a predicate over real
 *     columns, invisible to a fetch stub.
 *
 * Each of those is a *shape of real data* meeting a *predicate over that shape*. Only a real row in a
 * real table can catch it, which is the whole design of this harness.
 *
 * HOW IT TALKS TO THE STACK
 *   · Postgres — through `docker exec … psql` against the local Supabase container. Deliberately not
 *     supabase-js: that would need the service-role key, a default-deny secret this suite must never
 *     handle (RULE-SECRETS-NO-VALUE-EGRESS-001). Container access needs no credential.
 *   · Edge functions — over plain HTTP, exactly as the SDK calls them, using a tenant's publishable
 *     api key read from the row the test just seeded.
 *
 * ISOLATION
 * Every test seeds its OWN tenant and drops it in a `finally`. No test reads another test's data and
 * none depends on whatever happens to be in the developer's database, so the suite is order- and
 * machine-independent. Tenants are named `e2e_<something>` and `dropAllE2ETenants()` sweeps leftovers
 * from a crashed run.
 */

const DB_CONTAINER = Deno.env.get("PAYCRAFT_DB_CONTAINER") ?? "supabase_db_PayCraft";
export const FUNCTIONS_URL = Deno.env.get("PAYCRAFT_FUNCTIONS_URL") ??
  "http://127.0.0.1:54321/functions/v1";

/** Run SQL and return stdout trimmed. Throws with the REAL psql error on failure. */
export async function psql(sql: string): Promise<string> {
  const cmd = new Deno.Command("docker", {
    args: ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", sql],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout).trim();
  const err = new TextDecoder().decode(stderr).trim();
  if (code !== 0) {
    // Surfacing the real message matters: a swallowed psql error reads as "query returned nothing",
    // which sent one debugging session chasing a phantom for several minutes.
    throw new Error(`psql failed (exit ${code}):\n${err}\n--- sql ---\n${sql}`);
  }
  return stripCommandTag(out);
}

/**
 * Drop psql's trailing COMMAND TAG.
 *
 * `psql -Atc "INSERT … RETURNING id"` prints the returned row AND THEN `INSERT 0 1`, so reading the
 * whole stdout yields "<uuid>\nINSERT 0 1" and every downstream `::uuid` cast fails. The identical
 * trap is documented in the /idea-paycraft tenant runtime, where it produced a silent half-onboard:
 * the tenant was created, then every consumer of the corrupt id quietly did nothing.
 */
function stripCommandTag(out: string): string {
  // Status tags, never data: psql emits them for data-modifying and transaction-control statements.
  // They appear ANYWHERE in a multi-statement script, not only at the end — a test that read the
  // last line of a `BEGIN; …; COMMIT;` script got "COMMIT" instead of its result.
  const TAG = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|SELECT \d+|COPY \d+|BEGIN|COMMIT|ROLLBACK|DO|SET)$/;
  return out.split("\n").filter((l) => !TAG.test(l.trim())).join("\n").trim();
}

/** Rows as arrays of column strings (psql -At with | separator). */
export async function psqlRows(sql: string): Promise<string[][]> {
  const out = await psql(sql);
  if (!out) return [];
  return out.split("\n").map((line) => line.split("|"));
}

export function sqlLit(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}

export interface SeedProduct {
  sku: string;
  /** Matches the product_type enum exactly: there is no "one_time" — it is `lifetime`. */
  type?: "subscription" | "trial" | "lifetime";
  interval?: string | null;
  basePriceCents?: number;
  baseCurrency?: string;
  playProductId?: string | null;
  appStoreProductId?: string | null;
  stripeProductId?: string | null;
  /** currency -> price id */
  stripePriceIds?: Record<string, string> | null;
  /** currency -> plan id. The artifact Razorpay produces for a subscription — NOT a payment link. */
  razorpayPlanIds?: Record<string, string> | null;
}

export interface SeedProvider {
  provider: string;
  isActive?: boolean;
  liveKeyId?: string | null;
  testKeyId?: string | null;
  /** Nested {sku: {currency: url}}, the shape `/config`'s enabled-provider filter reads. */
  livePaymentLinks?: Record<string, Record<string, string>> | null;
  storeConfig?: Record<string, unknown> | null;
  supportedLocales?: string[] | null;
}

export interface SeedSpec {
  name: string;
  products?: SeedProduct[];
  providers?: SeedProvider[];
  /** platform -> ordered methods. Omit to let the defaults apply. */
  routing?: Record<string, string[]>;
  /** [locale, currency, amountCents][] */
  pricing?: Array<[string, string, number]>;
}

export interface SeededTenant {
  id: string;
  apiKeyLive: string;
  apiKeyTest: string;
  name: string;
}

/**
 * Absent maps are written as `{}`, not NULL.
 *
 * `stripe_price_id_by_currency`, `store_config` and friends are NOT NULL WITH DEFAULT `{}` — passing
 * an explicit NULL overrides the default and violates the constraint. Empty is also the honest value:
 * these columns answer "which ids does this hold", and the answer is "none", not "unknown".
 */
function jsonLit(v: unknown | null | undefined): string {
  if (v === null || v === undefined) return "'{}'::jsonb";
  return `${sqlLit(JSON.stringify(v))}::jsonb`;
}

/** Create an isolated tenant with exactly the rows a test declares. */
export async function seedTenant(spec: SeedSpec): Promise<SeededTenant> {
  const name = `e2e_${spec.name}_${crypto.randomUUID().slice(0, 8)}`;
  const id = await psql(`
    INSERT INTO tenants (name, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live,
                         owner_email, plan, subscriber_limit)
    VALUES (${sqlLit(name)},
            'pk_test_' || encode(gen_random_bytes(16),'hex'),
            'pk_live_' || encode(gen_random_bytes(16),'hex'),
            'whsec_test_x', 'whsec_live_x', 'e2e@example.test', 'free', 100)
    RETURNING id`);

  const [apiKeyTest, apiKeyLive] = (await psqlRows(
    `SELECT api_key_test, api_key_live FROM tenants WHERE id = ${sqlLit(id)}::uuid`,
  ))[0];

  for (const p of spec.products ?? []) {
    await psql(`
      INSERT INTO tenant_products (tenant_id, sku, display_name, type, interval, base_price_cents,
                                   base_currency, active, display_order, play_product_id,
                                   app_store_product_id, stripe_product_id,
                                   stripe_price_id_by_currency, razorpay_plan_id_by_currency)
      VALUES (${sqlLit(id)}::uuid, ${sqlLit(p.sku)}, ${sqlLit(p.sku)},
              ${sqlLit(p.type ?? "subscription")}::product_type,
              ${p.interval === undefined ? sqlLit("month") : p.interval === null ? "NULL" : sqlLit(p.interval)},
              ${p.basePriceCents ?? 999}, ${sqlLit(p.baseCurrency ?? "USD")}, true, 0,
              ${p.playProductId ? sqlLit(p.playProductId) : "NULL"},
              ${p.appStoreProductId ? sqlLit(p.appStoreProductId) : "NULL"},
              ${p.stripeProductId ? sqlLit(p.stripeProductId) : "NULL"},
              ${jsonLit(p.stripePriceIds)},
              ${jsonLit(p.razorpayPlanIds)})`);
  }

  for (const pr of spec.providers ?? []) {
    await psql(`
      INSERT INTO tenant_providers (tenant_id, provider, is_active, live_key_id, test_key_id,
                                    live_payment_links, test_payment_links, store_config, supported_locales)
      VALUES (${sqlLit(id)}::uuid, ${sqlLit(pr.provider)}, ${pr.isActive ?? true},
              ${pr.liveKeyId ? sqlLit(pr.liveKeyId) : "NULL"},
              ${pr.testKeyId ? sqlLit(pr.testKeyId) : "NULL"},
              ${jsonLit(pr.livePaymentLinks ?? {})}, '{}'::jsonb,
              ${jsonLit(pr.storeConfig)},
              ${pr.supportedLocales ? `ARRAY[${pr.supportedLocales.map(sqlLit).join(",")}]::text[]` : "NULL"})`);
  }

  for (const [platform, methods] of Object.entries(spec.routing ?? {})) {
    await psql(`
      INSERT INTO tenant_routing_rules (tenant_id, platform, priority_methods, priority)
      VALUES (${sqlLit(id)}::uuid, ${sqlLit(platform)},
              ARRAY[${methods.map(sqlLit).join(",")}]::text[], 10)`);
  }

  for (const [locale, currency, amount] of spec.pricing ?? []) {
    await psql(`
      INSERT INTO tenant_pricing (tenant_id, product_id, locale, currency, amount_cents, source)
      SELECT ${sqlLit(id)}::uuid, p.id, ${sqlLit(locale)}, ${sqlLit(currency)}, ${amount}, 'manual'
      FROM tenant_products p WHERE p.tenant_id = ${sqlLit(id)}::uuid`);
  }

  return { id, apiKeyLive, apiKeyTest, name };
}

export async function dropTenant(id: string): Promise<void> {
  // Child rows first — FKs are not all ON DELETE CASCADE, and a half-dropped tenant would poison
  // the next run's assertions rather than failing loudly here.
  for (
    const t of [
      "tenant_pricing",
      "tenant_routing_rules",
      "tenant_providers",
      "tenant_products",
      "sync_events",
      "request_logs",
      "tenant_admins",
    ]
  ) {
    await psql(`DELETE FROM ${t} WHERE tenant_id = ${sqlLit(id)}::uuid`).catch(() => {});
  }
  await psql(`DELETE FROM tenants WHERE id = ${sqlLit(id)}::uuid`);
}

/** Sweep tenants left behind by a crashed run. */
export async function dropAllE2ETenants(): Promise<number> {
  const ids = (await psqlRows(`SELECT id FROM tenants WHERE name LIKE 'e2e\\_%'`)).map((r) => r[0]);
  for (const id of ids) await dropTenant(id);
  return ids.length;
}

export interface ConfigResult {
  status: number;
  // deno-lint-ignore no-explicit-any
  body: any;
}

/** Call /config exactly as the SDK does: apiKey in the query, platform + locale as headers. */
export async function getConfig(
  apiKey: string,
  opts: { platform?: string; locale?: string } = {},
): Promise<ConfigResult> {
  const headers: Record<string, string> = {};
  if (opts.platform) headers["x-paycraft-platform"] = opts.platform;
  if (opts.locale) headers["Accept-Language"] = opts.locale;
  const res = await fetch(`${FUNCTIONS_URL}/config?apiKey=${encodeURIComponent(apiKey)}`, { headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // A non-JSON body is itself the finding — an edge function that 500s returns plain text, and
    // reporting "could not parse" without the text hides the stack that explains why.
    body = { __nonJson: text.slice(0, 400) };
  }
  return { status: res.status, body };
}

/** The provider ids in `providers[]`, in order. providers[0] is the SDK's primary. */
// deno-lint-ignore no-explicit-any
export function providerIds(body: any): string[] {
  return (body?.providers ?? []).map((p: any) => p.provider ?? p.id).filter(Boolean);
}

/** The store binding for one sku, or null. */
// deno-lint-ignore no-explicit-any
export function bindingFor(body: any, sku: string): { provider: string; product_id: string } | null {
  const p = (body?.products ?? []).find((x: any) => x.sku === sku);
  return p?.store_binding ?? null;
}

/** Skip the whole suite with a clear reason when the local stack is not up. */
export async function requireLocalStack(): Promise<void> {
  try {
    await psql("SELECT 1");
  } catch (e) {
    throw new Error(
      `local Supabase is not reachable (container ${DB_CONTAINER}). Run \`supabase start\` first.\n${e}`,
    );
  }
  const res = await fetch(`${FUNCTIONS_URL}/config`).catch(() => null);
  if (!res) {
    throw new Error(
      `edge functions are not serving at ${FUNCTIONS_URL}. Run \`supabase functions serve\` first.`,
    );
  }
  await res.body?.cancel();
}

// ── Service-role RPC client + injected clock (owner alerts, paycraft-attempt-observability phase 3) ─────

export interface RpcResult {
  // deno-lint-ignore no-explicit-any
  data: any;
  error: { message: string } | null;
}

function rpcLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`rpc literal: non-finite number ${v}`);
    return String(v);
  }
  if (typeof v === "string") return sqlLit(v);
  if (v instanceof Date) return sqlLit(v.toISOString());
  return `${sqlLit(JSON.stringify(v))}::jsonb`;
}

/**
 * A supabase-js-shaped `{ rpc(fn, args) }` that runs the function in Postgres AS THE SERVICE ROLE
 * (`request.jwt.claims` set for the one transaction) — through `docker exec psql`, so the suite still never
 * holds the service-role key. The edge-function modules that take an injected client (the owner-alert engine
 * and its sender) run against REAL SQL this way: the same RPCs, triggers and RLS-bypassing definer functions
 * the deployed function calls. Set-returning functions come back as row arrays, scalar functions as the value
 * — what supabase-js returns. A database error comes back as `{ error: { message } }`, never thrown.
 */
export function serviceRpcClient(): { rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult> } {
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`rpc: bad function name ${fn}`);
      const named = Object.entries(args).map(([k, v]) => {
        if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`rpc: bad argument name ${k}`);
        return `${k} => ${rpcLiteral(v)}`;
      }).join(", ");
      try {
        // supabase-js returns a set-returning function as rows and any other function as its value.
        const isSetOf = (await psql(
          `SELECT proretset FROM pg_proc WHERE proname = ${sqlLit(fn)} AND pronamespace = 'public'::regnamespace LIMIT 1`,
        )) === "t";
        const select = isSetOf
          ? `SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM public.${fn}(${named}) AS r`
          : `SELECT jsonb_build_array(to_jsonb(public.${fn}(${named})))`;
        const out = JSON.parse(await psql(`BEGIN;
          SET LOCAL request.jwt.claims = '{"role":"service_role"}';
          ${select};
          COMMIT;`));
        return { data: isSetOf ? out : out[0], error: null };
      } catch (e) {
        const msg = String((e as Error).message);
        const m = msg.match(/ERROR:\s+(.+)/);
        return { data: null, error: { message: m ? m[1].trim() : msg } };
      }
    },
  };
}

/** A fixed clock a test moves explicitly — the alert rules and the ledger take `now` as a parameter. */
export interface TestClock {
  now(): Date;
  /** The clock moved by [ms]. */
  plus(ms: number): Date;
  iso(): string;
}

export async function withClock<T>(startIso: string, fn: (clock: TestClock) => Promise<T>): Promise<T> {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) throw new Error(`withClock: bad instant ${startIso}`);
  const clock: TestClock = {
    now: () => new Date(start),
    plus: (ms) => new Date(start.getTime() + ms),
    iso: () => start.toISOString(),
  };
  return await fn(clock);
}
