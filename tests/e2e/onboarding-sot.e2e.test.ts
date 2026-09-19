/**
 * End-to-end contract for the onboarding SoT (RULE-PAYCRAFT-ONBOARD-SOT-001).
 *
 * The dashboard route is the SOLE writer of onboarding state; `/idea-paycraft*` reads it and writes
 * corrections back through it. That makes two things testable against the REAL database:
 *
 *   1. the route's `blocked_reason` allowlist must match the `onboarding_blocked_reason` enum — it
 *      is duplicated in TypeScript so a bad value returns an actionable 400 instead of the trigger's
 *      raw enum error, and a duplicated list is a list that drifts;
 *   2. the trigger's guarantees must be exactly what the route assumes — `passed` needs evidence,
 *      `blocked` needs a valid reason — because the route validates ahead of the constraint and a
 *      mismatch means it either rejects something legal or forwards something the DB will refuse.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { dropTenant, psql, psqlRows, seedTenant, sqlLit } from "./harness.ts"

const ROUTE = new URL(
  "../../dashboard/app/api/onboarding/state/route.ts",
  import.meta.url,
)

async function routeSource(): Promise<string> {
  return await Deno.readTextFile(ROUTE)
}

Deno.test("route blocked_reason allowlist matches the onboarding_blocked_reason enum", async () => {
  const rows = await psqlRows(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'onboarding_blocked_reason' ORDER BY enumsortorder`,
  )
  const dbValues = rows.map((r) => r[0]).filter(Boolean).sort()
  assert(dbValues.length > 0, "enum onboarding_blocked_reason has no members")

  const src = await routeSource()
  const block = src.match(/const BLOCKED_REASONS = \[([\s\S]*?)\] as const/)
  assert(block, "BLOCKED_REASONS literal not found in the route")
  const routeValues = [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort()

  assertEquals(
    routeValues,
    dbValues,
    "route allowlist has drifted from the DB enum — a blocked step would be rejected or 500",
  )
})

Deno.test("trigger refuses passed-without-evidence (the route's 400 mirrors a real constraint)", async () => {
  const t = await seedTenant({ name: "sot_evidence" })
  const tenant = t.id
  try {
  const out = await psql(
    `INSERT INTO onboarding_app_state (tenant_id, current_step, steps)
     VALUES (${sqlLit(tenant)}, 'A1',
       '[{"id":"A1","status":"passed"}]'::jsonb)`,
  ).catch((e) => String(e))
  assert(
    /evidence IS NULL|23514|no-skip/i.test(out),
    `expected the trigger to refuse passed-without-evidence, got: ${out.slice(0, 200)}`,
  )
  } finally {
    await dropTenant(tenant)
  }
})

Deno.test("trigger refuses blocked-without-reason, and accepts a valid one", async () => {
  const t = await seedTenant({ name: "sot_blocked" })
  const tenant = t.id

  const bad = await psql(
    `INSERT INTO onboarding_app_state (tenant_id, current_step, steps)
     VALUES (${sqlLit(tenant)}, 'A2', '[{"id":"A2","status":"blocked"}]'::jsonb)`,
  ).catch((e) => String(e))
  assert(
    /blocked_reason|23514|AC-2/i.test(bad),
    `expected refusal for blocked-without-reason, got: ${bad.slice(0, 200)}`,
  )

  try {
    // A drifted step recorded with its FAILURE evidence — the OS-5 case the route now supports.
    await psql(
      `INSERT INTO onboarding_app_state (tenant_id, current_step, steps)
       VALUES (${sqlLit(tenant)}, 'A5',
         '[{"id":"A5","status":"blocked","blocked_reason":"provider-api-unavailable",
            "evidence":{"probe":"store-readiness","ready":false}}]'::jsonb)`,
    )
    const rows = await psqlRows(
      `SELECT steps->0->>'status', steps->0->>'blocked_reason'
       FROM onboarding_app_state WHERE tenant_id = ${sqlLit(tenant)}`,
    )
    assertEquals(rows[0], ["blocked", "provider-api-unavailable"])
  } finally {
    await psql(`DELETE FROM onboarding_app_state WHERE tenant_id = ${sqlLit(tenant)}`).catch(() => {})
    await dropTenant(tenant)
  }
})
