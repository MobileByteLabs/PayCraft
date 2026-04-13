# /add-provider — Add a New Payment Provider

Guides through adding support for a new payment provider to the PayCraft library.

## When to Use

Use this when you want to add support for a payment provider that is not yet built into PayCraft (e.g., PayPal, Paddle, Lemon Squeezy, Gumroad, etc.).

## Steps

### Step 1: Get Provider Details

Ask the user:
1. Provider name (e.g., "paypal", "paddle")
2. How checkout works (payment links? redirect URL? SDK?)
3. How subscription management works
4. Webhook event names for: subscription activated, renewed, canceled

### Step 2: Create Provider Implementation

Create `cmp-paycraft/src/commonMain/kotlin/com/mobilebytelabs/paycraft/provider/[Name]Provider.kt`:

```kotlin
package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.BillingPlan

class [Name]Provider(
    private val paymentLinks: Map<String, String>,
    private val managementUrl: String? = null,
) : PaymentProvider {

    override val name = "[name]"
    override val webhookFunctionName = "[name]-webhook"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        return paymentLinks[plan.id]
            ?: error("No payment link configured for plan '${plan.id}'")
    }

    override fun getManageUrl(email: String): String? = managementUrl
}
```

### Step 3: Create Webhook Edge Function

Create `server/functions/[name]-webhook/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

serve(async (req) => {
    // 1. Verify webhook signature
    // 2. Parse event body
    // 3. Map to handleSubscriptionEvent() call
    // 4. Return 200 OK
});
```

Use `server/functions/_shared/subscription-handler.ts` for the upsert logic — don't duplicate it.

### Step 4: Update PROVIDERS.md

Add a section to `docs/PROVIDERS.md` documenting:
- How to get payment links for this provider
- Webhook setup instructions
- Any provider-specific limitations

### Step 5: Output Integration Code

Show the user how to use the new provider:

```kotlin
PayCraft.configure {
    provider(
        [Name]Provider(
            paymentLinks = mapOf("monthly" to "..."),
            managementUrl = "...",
        )
    )
}
```
