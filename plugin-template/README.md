# PayCraft Provider Plugin Template

Use this template to create a community-contributed payment provider for PayCraft.

## Quick Start

1. Copy this directory as your new module
2. Rename the package from `com.example.paycraft` to your own
3. Implement `ProviderPlugin` interface
4. Create a webhook Edge Function
5. Publish to Maven Central

## Structure

```
your-plugin/
├── build.gradle.kts          ← KMP library config
├── src/commonMain/kotlin/
│   └── YourGatewayPlugin.kt  ← ProviderPlugin implementation
└── webhook/
    └── index.ts               ← Supabase Edge Function
```

## Implementation

```kotlin
class YourGatewayPlugin : ProviderPlugin {
    override val id = "yourgateway"
    override val displayName = "YourGateway"
    override val version = "1.0.0"

    override fun createProvider(config: PluginConfig): PaymentProvider {
        val serverUrl = config.requireExtra("server_url")
        return CustomProvider(
            name = "yourgateway",
            webhookFunctionName = "yourgateway-webhook",
            checkoutUrlBuilder = { plan, email ->
                config.paymentLinks[plan.id]
                    ?: error("No payment link for ${plan.id}")
            },
        )
    }
}
```

## Usage (consumers)

```kotlin
// build.gradle.kts
implementation("com.example:paycraft-yourgateway:1.0.0")

// App init
PayCraft.configure {
    supabase(url = "...", anonKey = "...")
    provider(YourGatewayPlugin().createProvider(
        PluginConfig.builder()
            .paymentLink("pro", "https://yourgateway.com/pay/pro")
            .testMode(true)
            .extra("server_url", "https://yourgateway.com")
            .build()
    ))
}
```

## Webhook

Your webhook Edge Function should use the shared `handleSubscriptionEvent()`:

```typescript
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

// Map your gateway's events to PayCraft's SubscriptionEvent format
await handleSubscriptionEvent({
  email: "user@example.com",
  provider: "yourgateway",
  subscriptionId: "sub_123",
  status: "active",
  // ... see subscription-handler.ts for full interface
});
```

## Publishing

1. Configure Maven Central credentials
2. Run `./gradlew publishAllPublicationsToMavenCentralRepository`
3. Add your plugin to the [PayCraft Plugin Directory](https://paycraft.dev/plugins)
