# PayCraft Disaster Recovery Runbook

> Phase 3 of paycraft-v2-production-readiness — durable backup + tested
> restore procedure for framework-supabase.

**Authoritative since:** 2026-06-17
**Owner:** PayCraft Cloud ops on-call

---

## Recovery objectives

| Metric | Target | Notes |
|---|---|---|
| **RPO** (max data loss) | **24 hours** | Daily dumps at 02:00 UTC; worst case loss = up to 24h of writes |
| **RTO** (max recovery time) | **4 hours** | Fresh Supabase project + R2 download + pg_restore + verify |
| Backup retention | 30 days | Cloudflare R2 free tier (10 GB) — auto-pruned by `daily-backup.yml` |
| Drill cadence | Monthly | First Monday; restore into ephemeral local Supabase |

For real-time loss tolerance (RPO < 24h) PayCraft would need Supabase Pro
PITR ($25/mo). Deferred per RESEARCH.md D3 until ARR justifies the spend.

---

## Architecture

```
┌─────────────────────────┐
│ framework-supabase      │
│ (mlwfgytjxlqyfxcgpysm)  │
└────────────┬────────────┘
             │ pg_dump --format=custom | gzip
             │ (daily 02:00 UTC, GitHub Actions)
             ▼
┌─────────────────────────────────────────┐
│ Cloudflare R2: paycraft-backups         │
│ (free 10 GB tier, S3-compatible API)    │
│                                          │
│ Layout:                                  │
│   YYYY/MM/DD/backup-YYYYMMDD-HHMMSS.dump.gz │
│                                          │
│ Retention:                               │
│   Auto-prune objects older than 30 days │
└─────────────────────────────────────────┘
```

---

## Prerequisites

Before running a restore:

1. **Local tools installed**
   - `pg_restore` (postgresql-client 15+)
   - `aws` CLI (configured for R2 endpoint)
   - `gunzip`

2. **Credentials in env**
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`
   - Resolve from vault: `bash core/scripts/secrets-get.sh mbs-paycraft-r2-access-key-id --to-file /tmp/k`
   - Or set inline before running the script.

3. **A target DB**
   - **NEVER prod.** `infra/restore-from-r2.sh` refuses if `TARGET_DB_URL`
     contains `mlwfgytjxlqyfxcgpysm` (prod ref) without an explicit
     `--confirm-prod-restore=YES` flag.
   - Spin up a fresh Supabase project, or run `supabase start` locally for
     drills.

---

## Restore procedure (5 steps)

### Step 1 — Identify which day's backup to restore

```bash
export AWS_ACCESS_KEY_ID="$(bash core/scripts/secrets-get.sh mbs-paycraft-r2-access-key-id --allow-claude-stdout)"
export AWS_SECRET_ACCESS_KEY="$(bash core/scripts/secrets-get.sh mbs-paycraft-r2-secret-access-key --allow-claude-stdout)"
export R2_ENDPOINT_URL="https://<account-id>.r2.cloudflarestorage.com"

aws s3 ls s3://paycraft-backups/ --recursive --endpoint-url "${R2_ENDPOINT_URL}" \
  | tail -20
```

### Step 2 — Provision a fresh target Supabase project

For monthly drills:
```bash
cd workspaces/mbs/PayCraft/source/PayCraft
supabase stop || true
supabase start            # local target on :54322
export TARGET_DB_URL="postgresql://postgres:postgres@localhost:54322/postgres"
```

For real DR (prod is down):
- Create a new Supabase project via dashboard.
- Note the new DB connection string and project ref.
- `export TARGET_DB_URL='postgresql://postgres:<password>@db.<new-ref>.supabase.co:6543/postgres'`

### Step 3 — Run the restore script

```bash
cd workspaces/mbs/PayCraft/source/PayCraft
bash infra/restore-from-r2.sh             # most recent dump (today)
bash infra/restore-from-r2.sh 2026/06/16  # specific day
```

The script downloads, decompresses, runs `pg_restore --clean --if-exists`,
then prints row counts for the 5 canonical tables.

### Step 4 — Verify integrity

Compare counts of these 5 tables vs production (or vs the prior known-good
backup):

| Table | Expected tolerance |
|---|---|
| `tenants` | exact match |
| `tenant_providers` | exact match |
| `tenant_products` | exact match |
| `tier_definitions` | exact match (always 3 — Free/Pro/Enterprise) |
| `subscriptions` | within ±1 (transactional table — small drift OK) |

```bash
psql "${TARGET_DB_URL}" -t -A -c "
  SELECT 'tenants'          AS t, count(*) FROM tenants
  UNION ALL SELECT 'tenant_providers', count(*) FROM tenant_providers
  UNION ALL SELECT 'tenant_products',  count(*) FROM tenant_products
  UNION ALL SELECT 'tier_definitions', count(*) FROM tier_definitions
  UNION ALL SELECT 'subscriptions',    count(*) FROM subscriptions
  ORDER BY 1;
"
```

### Step 5 — Cutover (real DR only) OR teardown (drill)

**Real DR:**
1. Update `framework-supabase-db-url` vault alias to point at the new project.
2. `bash infra/sync-to-vercel.sh --apply --env production` to push new env.
3. Trigger redeploy via `/paycraft-deploy ship`.
4. Verify `/api/health` returns `status: ok`.
5. Update DNS if changed (rare — Supabase projects keep same FQDN unless reprovisioned).

**Drill:**
1. `supabase stop` to tear down local target.
2. Append a drill row to the log below.

---

## Monthly drill checklist

Run the **first Monday** of every month:

- [ ] Ensure `daily-backup.yml` has run today (check Actions tab)
- [ ] Spin up ephemeral target (`supabase start`)
- [ ] Execute Steps 1-4 above
- [ ] Confirm row counts within tolerance
- [ ] Note any issues encountered
- [ ] Append a row to the **Drill log** below
- [ ] Tear down ephemeral target (`supabase stop`)

---

## Drill log

| Date | Operator | Backup restored | RTO observed | Tables verified | Outcome | Notes |
|---|---|---|---|---|---|---|
| _bootstrap_ | claude | _(none — first drill scheduled at P3 execution)_ | _TBD_ | tenants/tenant_providers/tenant_products/tier_definitions/subscriptions | _pending first drill_ | This row is a placeholder; replace at first real drill |

---

## Related

- Daily backup workflow: `.github/workflows/daily-backup.yml`
- Restore script: `infra/restore-from-r2.sh`
- PCI scope statement: `docs/PCI_SCOPE.md`
- DPA sub-processor list: `dashboard/app/(marketing)/legal/dpa/page.tsx`
- RESEARCH.md D3: free-tier DR strategy rationale
- GOAL.md AC21-AC26: phase-3 acceptance criteria covering this runbook
