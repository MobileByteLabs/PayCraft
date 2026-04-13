# /status — Show Subscription Stats

Displays subscription statistics from your Supabase project.

## Steps

### Step 1: Get Credentials

Ask user for:
- Supabase project ref
- Supabase access token

### Step 2: Query Stats

Run the following queries:

**Total Subscribers**:
```sql
SELECT COUNT(*) FROM subscriptions WHERE status IN ('active', 'trialing')
```

**By Plan**:
```sql
SELECT plan, COUNT(*) as count
FROM subscriptions
WHERE status IN ('active', 'trialing')
GROUP BY plan ORDER BY count DESC
```

**By Provider**:
```sql
SELECT provider, COUNT(*) as count
FROM subscriptions
WHERE status IN ('active', 'trialing')
GROUP BY provider ORDER BY count DESC
```

**Canceled This Month**:
```sql
SELECT COUNT(*) FROM subscriptions
WHERE status = 'canceled'
AND updated_at >= date_trunc('month', now())
```

**Expiring in 7 Days**:
```sql
SELECT COUNT(*) FROM subscriptions
WHERE status = 'active'
AND current_period_end BETWEEN now() AND now() + interval '7 days'
AND cancel_at_period_end = true
```

### Step 3: Display Stats

```
PayCraft Subscription Stats — [project-ref]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Active Subscribers: [N]
  Monthly:    [N]  ([N]%)
  Quarterly:  [N]  ([N]%)
  Yearly:     [N]  ([N]%)

By Provider:
  Stripe:    [N]
  Razorpay:  [N]

Churned This Month:   [N]
Expiring in 7 Days:   [N]  ← at risk

MRR (estimate):       ₹[N]
ARR (estimate):       ₹[N]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Note: MRR/ARR are estimates based on plan prices defined in PayCraft.configure() if available.
