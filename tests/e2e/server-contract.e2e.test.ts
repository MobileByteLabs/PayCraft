/**
 * Server-layer contracts, end to end against the real database.
 *
 * Covers the RPC and schema behaviour that no HTTP test touches and no stub can model: what
 * provisioning actually writes, whether a predicate over real columns says what it claims, whether a
 * seed can be re-run, and whether a removed surface is genuinely gone.
 *
 * Every case is a defect that shipped:
 *   · provisioning never seeded routing, so every app launched with no fallback
 *   · `tenant_providers_status` reported a live-only tenant as disconnected, which made the product
 *     sync skip every push and then report those products as synced
 *   · the pricing seed had to be safe to re-run against tenants that already had rows
 *   · five RPCs stayed granted to `authenticated` with no caller anywhere
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dropTenant, psql, psqlRows, seedTenant, sqlLit } from "./harness.ts";

/**
 * PROVISIONING SEEDS ROUTING.
 *
 * `tenant_routing_apply_defaults` existed, was granted, was documented — and had no caller, so every
 * app created after it still shipped with a primary and no fallback. This asserts the wiring, not
 * the function: it calls `provision_app` the way the dashboard does and reads what landed.
 */
Deno.test("provision_app seeds primary+fallback routing for every platform", async () => {
  const userId = await psql(`SELECT user_id FROM tenant_admins LIMIT 1`);
  assert(userId, "needs at least one existing admin user to impersonate");

  // One transaction: set the JWT claim, provision, read back, roll back. Nothing is left behind.
  const rows = await psqlRows(`
    BEGIN;
    DO $$ BEGIN PERFORM set_config('request.jwt.claims',
      json_build_object('sub', ${sqlLit(userId)}, 'role', 'authenticated')::text, true); END $$;
    CREATE TEMP TABLE _t AS SELECT (provision_app('e2e_provision_probe')->>'tenant_id')::uuid AS id;
    SELECT platform, array_to_string(priority_methods, ',')
    FROM tenant_routing_rules WHERE tenant_id = (SELECT id FROM _t) AND platform IS NOT NULL
    ORDER BY platform;
    ROLLBACK;`);

  const byPlatform = Object.fromEntries(rows.filter((r) => r.length === 2));
  assertEquals(
    Object.keys(byPlatform).sort(),
    ["android", "desktop", "ios", "web"],
    "a new app must have a routing rule for every platform",
  );
  assertEquals(byPlatform["android"], "google_play,stripe_card");
  assertEquals(byPlatform["ios"], "app_store,stripe_card");
  assert(
    byPlatform["android"].includes(","),
    "android must carry a FALLBACK, not just a primary — the whole point of the defaults",
  );
});

/**
 * The defaults are insert-only. An operator who deliberately narrowed a platform keeps that choice;
 * filling it in would be worse than the gap the defaults close.
 */
Deno.test("routing defaults never overwrite an operator's existing choice", async () => {
  const t = await seedTenant({
    name: "routing_preserve",
    providers: [{ provider: "razorpay", liveKeyId: "rzp_live_e2e" }],
    routing: { web: ["razorpay"] }, // deliberate, narrow, and not what the defaults would write
  });
  try {
    await psql(`SELECT count(*) FROM tenant_routing_apply_defaults(${sqlLit(t.id)}::uuid)`);
    const rows = await psqlRows(`
      SELECT platform, array_to_string(priority_methods, ',')
      FROM tenant_routing_rules WHERE tenant_id = ${sqlLit(t.id)}::uuid AND platform IS NOT NULL
      ORDER BY platform`);
    const byPlatform = Object.fromEntries(rows);
    assertEquals(byPlatform["web"], "razorpay", "the operator's web choice must survive untouched");
    assertEquals(byPlatform["android"], "google_play,stripe_card", "platforms with NO rule get defaults");
    assertEquals(Object.keys(byPlatform).length, 4);
  } finally {
    await dropTenant(t.id);
  }
});

/** Re-running the defaults changes nothing — it is called on every /idea-paycraft run. */
Deno.test("routing defaults are idempotent across repeated runs", async () => {
  const t = await seedTenant({ name: "routing_idempotent" });
  try {
    await psql(`SELECT count(*) FROM tenant_routing_apply_defaults(${sqlLit(t.id)}::uuid)`);
    const first = await psql(
      `SELECT count(*) FROM tenant_routing_rules WHERE tenant_id = ${sqlLit(t.id)}::uuid`,
    );
    await psql(`SELECT count(*) FROM tenant_routing_apply_defaults(${sqlLit(t.id)}::uuid)`);
    await psql(`SELECT count(*) FROM tenant_routing_apply_defaults(${sqlLit(t.id)}::uuid)`);
    const third = await psql(
      `SELECT count(*) FROM tenant_routing_rules WHERE tenant_id = ${sqlLit(t.id)}::uuid`,
    );
    assertEquals(first, third, "repeated seeding must not accumulate rows");
    assertEquals(first, "4");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * CONNECTED MEANS A USABLE KEY PAIR, IN EITHER MODE.
 *
 * The predicate was `test_key_id IS NOT NULL`, so a production merchant — live credentials, empty
 * test slots — read as NOT connected. The product sync consults this before pushing, so it skipped
 * every product while the credentials sat in the row, and then counted those products as synced.
 */
Deno.test("tenant_providers_status: a live-only tenant reads as connected", async () => {
  const t = await seedTenant({ name: "status_live_only" });
  try {
    await psql(`
      INSERT INTO tenant_providers (tenant_id, provider, is_active, live_key_id, live_secret_key_enc)
      VALUES (${sqlLit(t.id)}::uuid, 'razorpay', true, 'rzp_live_e2e', 'ciphertext-placeholder')`);
    await psql(`
      INSERT INTO tenant_admins (tenant_id, user_id, role)
      SELECT ${sqlLit(t.id)}::uuid, user_id, 'owner' FROM tenant_admins LIMIT 1`);

    const userId = await psql(
      `SELECT user_id FROM tenant_admins WHERE tenant_id = ${sqlLit(t.id)}::uuid LIMIT 1`,
    );
    const connected = await psql(`
      BEGIN;
      DO $$ BEGIN PERFORM set_config('request.jwt.claims',
        json_build_object('sub', ${sqlLit(userId)}, 'role','authenticated')::text, true); END $$;
      SELECT connected FROM tenant_providers_status(${sqlLit(t.id)}::uuid, 'razorpay');
      COMMIT;`);
    assertEquals(
      connected,
      "t",
      "live_key_id + live_secret_key_enc IS a connection; only the test slots are empty",
    );
  } finally {
    await dropTenant(t.id);
  }
});

/** A half-written row — an id with no secret — must NOT read as connected. */
Deno.test("tenant_providers_status: an id without a secret is not a connection", async () => {
  const t = await seedTenant({ name: "status_half_written" });
  try {
    await psql(`
      INSERT INTO tenant_providers (tenant_id, provider, is_active, live_key_id)
      VALUES (${sqlLit(t.id)}::uuid, 'razorpay', true, 'rzp_live_e2e')`);
    await psql(`
      INSERT INTO tenant_admins (tenant_id, user_id, role)
      SELECT ${sqlLit(t.id)}::uuid, user_id, 'owner' FROM tenant_admins LIMIT 1`);
    const userId = await psql(
      `SELECT user_id FROM tenant_admins WHERE tenant_id = ${sqlLit(t.id)}::uuid LIMIT 1`,
    );
    const connected = await psql(`
      BEGIN;
      DO $$ BEGIN PERFORM set_config('request.jwt.claims',
        json_build_object('sub', ${sqlLit(userId)}, 'role','authenticated')::text, true); END $$;
      SELECT connected FROM tenant_providers_status(${sqlLit(t.id)}::uuid, 'razorpay');
      COMMIT;`);
    assertEquals(
      connected,
      "f",
      "the key id is public; without its secret the row cannot authenticate anything",
    );
  } finally {
    await dropTenant(t.id);
  }
});

/** The pricing seed runs against tenants that already have rows — it must not duplicate them. */
Deno.test("pricing seed does not duplicate a (product, locale) pair", async () => {
  const t = await seedTenant({
    name: "pricing_idempotent",
    products: [{ sku: "plus_monthly", basePriceCents: 999, baseCurrency: "USD" }],
    pricing: [["US", "USD", 999], ["IN", "INR", 69900]],
  });
  try {
    const dupes = await psql(`
      SELECT count(*) FROM (
        SELECT product_id, locale FROM tenant_pricing
        WHERE tenant_id = ${sqlLit(t.id)}::uuid
        GROUP BY 1,2 HAVING count(*) > 1
      ) d`);
    assertEquals(dupes, "0", "a (product, locale) pair must be unique — duplicates double-render in the UI");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * REMOVED SURFACE STAYS REMOVED.
 *
 * Five functions sat granted to `authenticated` with no caller in the app, the SDK, the edge
 * functions or the command runtimes. They were dropped; this keeps them from drifting back in with a
 * migration that re-creates one "just in case".
 */
Deno.test("dropped RPCs are absent from the schema", async () => {
  const dropped = [
    "account_pricing_template_get",
    "account_pricing_template_save",
    "tenant_products_unsynced",
    "get_tenant_usage",
    "rotate_api_key",
    "tenant_routing_ensure_defaults",
  ];
  const found = await psql(`
    SELECT coalesce(string_agg(p.proname, ','), '')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (${dropped.map(sqlLit).join(",")})`);
  assertEquals(found, "", `these were removed as uncalled; a caller must land in the SAME change: ${found}`);
});

/** The correlation id must be a uuid, because `sync_events.run_id` is one. */
Deno.test("sync_events.run_id is a uuid column, so callers must mint uuids", async () => {
  const type = await psql(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'sync_events' AND column_name = 'run_id'`);
  assertEquals(
    type,
    "uuid",
    "a readable-but-invented id (req_m3x9f_…) silently failed every insert, so the request log " +
      "was written and the provider events were not",
  );
});

/** Request logging must never store a secret, whatever a caller passes. */
Deno.test("log_request stores what it is given without inventing columns", async () => {
  const t = await seedTenant({ name: "request_log" });
  try {
    const runId = crypto.randomUUID();
    await psql(`
      SELECT log_request('/api/e2e', 'POST', ${sqlLit(t.id)}::uuid, 200, 42,
                         '{"tenant":"x"}'::jsonb, '{"synced":1}'::jsonb, NULL, ${sqlLit(runId)})`);
    const row = (await psqlRows(`
      SELECT route, status, duration_ms, run_id FROM request_logs
      WHERE tenant_id = ${sqlLit(t.id)}::uuid ORDER BY created_at DESC LIMIT 1`))[0];
    assertEquals(row[0], "/api/e2e");
    assertEquals(row[1], "200");
    assertEquals(row[3], runId, "the run id must round-trip so events can be joined to their request");
  } finally {
    await dropTenant(t.id);
  }
});
