# /setup-supabase — Supabase Table + RPC + Webhook

Child command called by `/setup-paycraft` Steps 1–2. Applies migrations and deploys the webhook.

## Prerequisites

`.env` must exist with these set:
- `PAYCRAFT_SUPABASE_URL`
- `PAYCRAFT_SUPABASE_PROJECT_REF`
- `PAYCRAFT_SUPABASE_ACCESS_TOKEN`
- `PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY`

## MCP Detection

```
Try calling a Supabase MCP tool (e.g., list tables or execute SQL)
```
- If available → **Path A (MCP)**
- If unavailable → **Path B (Management API)**

---

## STEP 1: Apply Migrations

### Path A — Supabase MCP

Read `server/migrations/001_create_subscriptions.sql` and execute via Supabase MCP SQL executor.
Read `server/migrations/002_create_rpcs.sql` and execute via Supabase MCP SQL executor.

### Path B — Management API

Load `.env` values. For each migration file:

```bash
# 001 — subscriptions table
SQL_001=$(cat server/migrations/001_create_subscriptions.sql)
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL_001" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

# 002 — RPCs
SQL_002=$(cat server/migrations/002_create_rpcs.sql)
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL_002" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
```

### Verify migrations

```bash
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT routine_name FROM information_schema.routines WHERE routine_name IN ('"'"'is_premium'"'"','"'"'get_subscription'"'"')"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"RPCs found: {len(d)}")'
```

Expected: `RPCs found: 2`

---

## STEP 2: Deploy Webhook

Provider is read from Step 0 of `/setup-paycraft` context.

### Path A — Supabase CLI

```bash
# Deploy function
supabase functions deploy ${PROVIDER}-webhook \
  --project-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}" \
  --no-verify-jwt

# Set provider secrets
# Stripe:
supabase secrets set \
  STRIPE_SECRET_KEY="${PAYCRAFT_STRIPE_SECRET_KEY}" \
  --project-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}"

# Razorpay:
supabase secrets set \
  RAZORPAY_KEY_SECRET="${PAYCRAFT_RAZORPAY_KEY_SECRET}" \
  --project-ref "${PAYCRAFT_SUPABASE_PROJECT_REF}"
```

### Path B — Management API

```bash
# Read function source
FUNCTION_BODY=$(cat "server/functions/${PROVIDER}-webhook/index.ts")

# Deploy
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/functions" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"slug\": \"${PROVIDER}-webhook\",
    \"name\": \"${PROVIDER}-webhook\",
    \"body\": $(echo "$FUNCTION_BODY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
    \"verify_jwt\": false
  }"

# Set secrets via API
curl -s -X POST \
  "https://api.supabase.com/v1/projects/${PAYCRAFT_SUPABASE_PROJECT_REF}/secrets" \
  -H "Authorization: Bearer ${PAYCRAFT_SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "[{\"name\":\"STRIPE_SECRET_KEY\",\"value\":\"${PAYCRAFT_STRIPE_SECRET_KEY}\"}]"
```

### Verify webhook is live

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "https://${PAYCRAFT_SUPABASE_PROJECT_REF}.functions.supabase.co/${PROVIDER}-webhook"
```

Expected: `200` or `405` (both mean the function is running).

---

## Output

```
✅ Supabase setup complete
   Table:        subscriptions ✓
   RPC:          is_premium() ✓
   RPC:          get_subscription() ✓
   Webhook URL:  https://<ref>.functions.supabase.co/<provider>-webhook ✓
```
