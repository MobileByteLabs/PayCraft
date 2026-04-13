# /add-plan — Add a New Subscription Plan

Guides through adding a new billing plan to a client app's PayCraft configuration.

## Steps

### Step 1: Get Plan Details

Ask the user:
1. Plan ID (e.g., "weekly", "lifetime")
2. Display name (e.g., "Weekly", "Lifetime")
3. Price (e.g., "₹29", "$2.99")
4. Interval (e.g., "/week", "one-time")
5. Is it the popular/recommended plan?
6. Rank (display order — lower = first)

### Step 2: Create Payment Link

Depending on provider:

**Stripe**: Create a new Payment Link in Stripe Dashboard or use `/setup-stripe`
**Razorpay**: Create a new Payment Link in Razorpay Dashboard or use `/setup-razorpay`

### Step 3: Update PayCraft.configure()

Find the existing `PayCraft.configure()` call in the app and add the new plan:

```kotlin
plans(
    // existing plans...
    BillingPlan(
        id = "[PLAN_ID]",
        name = "[PLAN_NAME]",
        price = "[PRICE]",
        interval = "[INTERVAL]",
        rank = [RANK],
        isPopular = [true/false],
    ),
)
```

### Step 4: Update Payment Links

Add the new plan's payment link to the provider config:

```kotlin
// Stripe
StripeProvider(
    paymentLinks = mapOf(
        // existing...
        "[PLAN_ID]" to "[NEW_PAYMENT_LINK]",
    ),
    // ...
)
```

### Step 5: Verify

Run `/verify` to confirm the new plan works end-to-end.
