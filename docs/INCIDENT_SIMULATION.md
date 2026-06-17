# PayCraft Incident-Response Simulation Runbook

> Phase 4 of paycraft-v2-production-readiness — quarterly tabletop exercise
> that proves the on-call (currently single-person, founder-led) can actually
> detect, mitigate, and post-mortem a real-world incident before customers
> demand it.

**Cadence:** Quarterly, first Thursday.
**Owner:** Founder (no rotation today; promote to oncall.com rotation when
ARR > $50K).
**Last exercised:** _(none — bootstrap scheduled at P4 sign-off)_

---

## Three rehearsable scenarios

Run **one per quarter** in rotation. Each scenario is timed; targets follow
the published SLA in `docs/SLA_DASHBOARD.md`.

### Scenario 1 — Stripe webhook ingress goes 5xx

**Trigger (simulated):**
1. In a staging environment, force the `stripe-webhook` edge function to
   `throw new Error("simulated")` on every event.
2. Send a Stripe-CLI replay of `payment_intent.succeeded` from `stripe trigger`.

**Expected detection (target ≤ 5 min):**
- upptime probe to `/api/webhooks/stripe/__ping` flips RED.
- Sentry shows a spike of `webhook_retry` events tagged `provider=stripe`.
- Status page (manual update) goes to "Partial outage".

**Expected mitigation (target ≤ 15 min):**
- Identify offending code path (last deploy SHA in Vercel dashboard).
- Rollback via `/paycraft-deploy ship` from the previous good SHA, OR
  hotfix the bug and redeploy.
- Verify upptime probe returns GREEN.
- Verify Sentry retry rate drops.

**Expected post-mortem (target ≤ 24 h):**
- Post-mortem written in `docs/reports/postmortem-YYYYMMDD-webhook-5xx.md`.
- Linked from public status page.

---

### Scenario 2 — Framework-supabase database is down (or wiped)

**Trigger (simulated):**
1. Use a fresh local Supabase: `supabase stop && supabase start`.
2. Point `dashboard/.env.local` at the empty local instance.
3. Open `http://localhost:3000/dashboard` — observe RLS-empty / 500s.

**Expected detection (target ≤ 5 min):**
- `/api/health` returns `status: error` (Postgres `connection refused` or
  empty schema).
- upptime flips RED on the "Health endpoint" probe.

**Expected mitigation (target ≤ 4 h per DR_RUNBOOK):**
- Follow `docs/DR_RUNBOOK.md` Step 2-4.
- Pull latest dump from R2.
- Restore into a fresh Supabase project.
- Repoint Vercel env to new project.

**Expected post-mortem:**
- Verify the daily backup that was restored from.
- Note actual RTO observed vs target (4 h).
- Append a drill row in `docs/DR_RUNBOOK.md#drill-log`.

---

### Scenario 3 — Suspected tenant data leak (cross-tenant access)

**Trigger (simulated):**
1. In staging, deliberately add a row in `tenant_products` with the wrong
   `tenant_id` foreign key (bypassing the FK constraint via SQL editor).
2. Sign in as tenant A; navigate to `/products`.
3. Observe whether RLS hides the row (it should — `tenant_products.select`
   policy on `tenant_id = current_setting('app.tenant_id')`).

**Expected detection (target ≤ immediate):**
- Tenant A's `/products` page renders correctly — does NOT include
  tenant B's products.
- `dashboard/__tests__/api/rls-isolation.test.ts` PASSES (CI gate).

**Expected mitigation:**
- If RLS *did* leak: file a SEV-1, freeze deploys, audit recent migrations
  touching `tenant_products` RLS, revoke any `BYPASSRLS` grants.
- Email all tenants within 72 h per GDPR / DPA Section 7.
- Rotate every tenant's API keys (forced via `rotate_api_key` for all).

**Expected post-mortem:**
- Public post-mortem (no PII, just timeline + root cause + fix).
- Add a regression test to `__tests__/api/rls-isolation.test.ts`.

---

## Exercise checklist (per drill)

- [ ] Pick scenario from rotation
- [ ] Schedule 1-hour block on first Thursday of quarter
- [ ] Walk through Trigger / Detection / Mitigation / Post-Mortem above
- [ ] Time each phase against the target
- [ ] Identify ONE gap (broken alert, missing runbook entry, unclear ownership)
- [ ] Open a Linear ticket to close the gap before next quarter
- [ ] Append a row to the drill log below

---

## Drill log

| Date | Operator | Scenario | Detect | Mitigate | Post-mortem | Gap identified |
|---|---|---|---|---|---|---|
| _bootstrap_ | claude | (placeholder — first real drill scheduled at P4 sign-off) | _TBD_ | _TBD_ | _TBD_ | _none yet_ |

---

## Related

- `docs/SLA_DASHBOARD.md` — public SLA targets
- `docs/DR_RUNBOOK.md` — Scenario 2 mitigation procedure
- `dashboard/__tests__/api/rls-isolation.test.ts` — Scenario 3 CI gate
- `dashboard/lib/sentry-events.ts` — failure-mode capture surface
- GOAL.md AC44-AC48 — Phase 4 acceptance criteria covering this runbook
