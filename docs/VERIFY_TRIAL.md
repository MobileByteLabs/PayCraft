# Verify — Trial-Product Support (v1.1)

> Step-by-step verification checklist for the trial-product support feature.
> Plan: `plan-layer/project-plans/mbs/PayCraft/active/PLAN-paycraft-trial-support.md` (in framework repo).
> Branch: `feat/paycraft-trial-support`.
>
> Run each section in order. Each step is independent — if step N fails, fix and re-run step N before moving on.

---

## 0. Setup

```bash
./scripts/setup-for-verify.sh --check   # report what's missing
./scripts/setup-for-verify.sh           # install missing tools via brew
```

After the script reports `Toolchain ready`, populate `.env` with the values it prompted for. Minimum for local-only verification:

```
PAYCRAFT_SUPABASE_URL=http://localhost:54321
PAYCRAFT_SUPABASE_ANON_KEY=<from `supabase start` output>
PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY=<from `supabase start` output>
PAYCRAFT_PROVIDER=stripe
```

Stripe MCP keys + project ref are only required for `/paycraft-adopt-verify` in section 4.

---

## 1. Kotlin build + unit tests (V1, V2)

Verifies the library compiles and the new tests pass.

```bash
./gradlew :cmp-paycraft:compileKotlinMetadata
```

**Expect:** `BUILD SUCCESSFUL`. If you see `Unresolved reference: TrialInfo`, the build cache may be stale — try `./gradlew clean :cmp-paycraft:compileKotlinMetadata`.

```bash
./gradlew :cmp-paycraft:commonTest --tests "*Trial*" --info
```

**Expect:** `BUILD SUCCESSFUL` with two test classes reporting passes:

- `com.mobilebytelabs.paycraft.model.BillingPlanTest` — 8 tests (null, 1, 7, 30, default, 0-throws, -1-throws, -365-throws)
- `com.mobilebytelabs.paycraft.core.TrialInfoComputeTest` — 9 tests (null/blank/unparseable/past/at-now/3-days/7-days/ceil-2/ceil-1)

If any fail, the impl in `cmp-paycraft/.../core/TrialInfoCompute.kt` or `model/BillingPlan.kt` is the suspect — re-read those files first.

---

## 2. Local Supabase + migration 026 (V3)

```bash
supabase start             # First run pulls ~10 images; ~3-5 min
supabase db reset          # Applies migrations 001..026 in order
```

**Expect:** `Finished supabase db reset on branch <name>` and all 26 migrations listed as applied.

Get connection details:

```bash
supabase status | grep -E "DB URL|API URL|anon key|service_role key"
```

Copy `DB URL` for the next step (looks like `postgresql://postgres:postgres@localhost:54322/postgres`).

Verify schema:

```bash
psql "$(supabase status | grep 'DB URL' | awk '{print $NF}')" -c "\d subscriptions" | grep -E "trial_start|trial_end"
```

**Expect:**
```
 trial_start    | timestamp with time zone |
 trial_end      | timestamp with time zone |
```

If columns missing → migration 026 failed to apply. Inspect `supabase db reset` output for the first error.

---

## 3. SQL trial test (V4)

Runs the in-repo SQL test that asserts the full trial path through `is_premium`, `get_subscription`, and `is_trial_eligible`.

```bash
DB="$(supabase status | grep 'DB URL' | awk '{print $NF}')"
psql "$DB" -f server/tests/test_026_trial.sql      # TR-002 / TR-003 / TR-006 (×2)
psql "$DB" -f server/tests/test_027_trial_preserve.sql   # sticky-field trigger
```

**Expect — test_026:**
```
NOTICE:  OK: TR-002 — is_premium(token) = true for trialing row
NOTICE:  OK: TR-003 — get_subscription returns trialing row with trial_end populated
NOTICE:  OK: TR-006 — is_trial_eligible = false after trial recorded
NOTICE:  OK: TR-006 — is_trial_eligible = true for fresh user
NOTICE:  ALL TRIAL TESTS PASSED
COMMIT
```

**Expect — test_027:**
```
NOTICE:  OK: setup — initial trial_end = ...
NOTICE:  OK: resub UPDATE with NULL trial_end → preserved historical ...
NOTICE:  OK: is_trial_eligible = false after resub (TR-006 holds)
NOTICE:  OK: trial extension UPDATE (NEW non-null) honored → trial_end = ...
NOTICE:  ALL TRIAL-PRESERVATION TESTS PASSED
COMMIT
```

If any RAISE EXCEPTION fires, the script aborts the transaction. Read the EXCEPTION message — it names the failing TR-id.

---

## 4. Deno typecheck (V5)

Validates the TypeScript edge-function changes are sound:

```bash
deno check server/functions/_shared/subscription-handler.ts \
            server/functions/stripe-webhook/index.ts
```

**Expect:** Silent exit (no output) or `Check ... successful`. Errors print as `error: TS####`.

Common gotcha: the Stripe SDK `Subscription` type may not surface `trial_start`/`trial_end` if you're on an old version. Check `import Stripe from "https://esm.sh/stripe@14.0.0?target=deno"` — if you need a newer minor, bump the version pin.

---

## 5. `/paycraft-adopt-verify` end-to-end (V6)

Requires a fully populated `.env` including Stripe test key + project ref + access token, and Stripe MCP configured in Claude Code.

```bash
/paycraft-adopt-verify test
```

This is a 9-step end-to-end check that writes a real test row, reads it back via RPCs, and deletes it. It hits both the Supabase schema and the deployed edge functions.

**The trial-specific checks I'd add to its assertions** (not yet in `paycraft-adopt-verify.md`, treat as manual review):

1. `\d subscriptions` shows `trial_start` + `trial_end` columns (paragraph 3 above already does this — visual confirm).
2. `SELECT is_trial_eligible('<test-token>', NULL);` returns `t` for a fresh email and `f` after a trialing row is inserted.
3. POST a Stripe `customer.subscription.created` event with `trial_start`/`trial_end` non-null to the deployed `stripe-webhook` function (using Stripe CLI `stripe trigger customer.subscription.created` against a trial-period-days price); verify the row lands with both columns populated.

For step 3, you need:
```bash
stripe trigger customer.subscription.created \
  --override "subscription:trial_period_days=7" \
  --add "subscription:metadata[paycraft_plan]=monthly"
```

Then:
```sql
SELECT email, status, trial_start, trial_end
FROM subscriptions
ORDER BY created_at DESC LIMIT 1;
```

`status` should be `trialing`, `trial_end` should be ~7 days from `created_at`.

---

## 6. Manual paywall E2E (T23 from PLAN)

The plan's acceptance gate G-1 calls for a screenshot of the reels-downloader paywall showing "Start 7-day free trial". Steps:

1. In your reels-downloader workspace, update `PayCraft.configure { plans(BillingPlan(..., trialDays = 7), ...) }` to set `trialDays` on the monthly plan.
2. Update reels-downloader's `gradle/libs.versions.toml` to point to your locally-published PayCraft v1.1 build:
   ```bash
   ./gradlew :cmp-paycraft:publishToMavenLocal
   ```
   Then in reels-downloader: `paycraft = "1.1.0-SNAPSHOT"` and ensure `mavenLocal()` is in `repositories {}`.
3. Build + install the Android app: `./gradlew :cmp-android:installDebug`.
4. Launch app → navigate to paywall → expect "Start 7-day free trial" CTA on the monthly plan card.
5. Screenshot. Attach to the PR.

---

## 7. Known gaps + edge cases (handle these before merging to production)

| # | Gap | Severity | Workaround |
|---|---|---|---|
| 1 | ~~`server/functions/razorpay-webhook/` doesn't exist~~ | ~~high~~ | **FIXED.** New handler at `server/functions/razorpay-webhook/index.ts` (also synced to `supabase/functions/`). Handles `subscription.activated/charged/cancelled/halted/completed`. Trial detection via `subscription.start_at > created_at`. Email resolved from `subscription.notes.paycraft_email` (set by adopt-flow). Dual-mode test/live signature verification. Sticky-trigger from migration 027 protects historical `trial_end` on renewal events. |
| 2 | ~~Cancel-and-resubscribe second-trial bypass~~ | ~~medium~~ | **FIXED in migration 027.** Sticky-field trigger (`subscriptions_preserve_trial_fields_trigger`) preserves `trial_start` / `trial_end` across UPDATEs that try to clear them. Legitimate Stripe trial extensions (NEW value non-null) are still honored. Verified by `server/tests/test_027_trial_preserve.sql`. |
| 3 | `BillingPlan.trialDays` ↔ Stripe `trial_period_days` drift | low | Library doesn't reconcile. Always reconfigure through `/paycraft-adopt-stripe` so both stay aligned. |
| 4 | ~~`API_CONTRACTS.md` claims `TrialInfo.endsAt: Instant`~~ | ~~low~~ | **FIXED.** Framework-side `API_CONTRACTS.md` now declares `endsAt: String` (ISO-8601) matching the impl + rationale comment. |

---

## 8. Sign-off

Once steps 1–6 pass (with #5 and #6 done against your local/staging Supabase + Stripe test):

- [ ] Tag your commit: `git tag v1.1.0-rc1 -m "PayCraft trial-product support (RC1)"`
- [ ] Push branch + open PR against `development`
- [ ] Attach paywall screenshot from step 6
- [ ] Reference the plan slug `paycraft-trial-support` in the PR description so docs-sync auto-archives it
- [ ] Open follow-up issues for gaps #1 (razorpay-webhook) and #2 (cancel-resub bypass)

---

## Quick reference — what each verification covers

| # | Step | Validates | Failure mode tells you |
|---|---|---|---|
| 1 | Kotlin compile + unit | `BillingPlan` validation, `computeTrialInfo` derivation, signature compatibility | Bug in `model/` or `core/` Kotlin |
| 2 | Migration apply | SQL syntax, column types, RPC signatures | Bug in `026_trial_columns.sql` |
| 3 | SQL test | End-to-end DB behavior (is_premium gates trialing, get_subscription returns trial fields, is_trial_eligible suppresses after history) | Bug in migration 026 OR upstream migration 016 |
| 4 | Deno typecheck | TS edge functions compile against Stripe SDK + Supabase client types | Bug in webhook handler or shared handler |
| 5 | adopt-verify | Stripe webhook delivers trial fields end-to-end against real (test) Stripe | Bug in `stripe-webhook/index.ts` mapping OR Stripe API surface mismatch |
| 6 | Manual paywall | UI eligibility flow, CTA copy, plan-card chip rendering | Bug in `PayCraftPaywall`, `PlanSelector`, `PayCraftPlanCard`, or `PayCraftPaywallViewModel` |
