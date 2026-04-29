---
sidebar_position: 1
---

# Android (Compose + Koin)

## Dependencies

```kotlin
// build.gradle.kts (app module)
implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
```

## Initialization

In your `Application.onCreate()`:

```kotlin
class MyApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // Initialize PayCraft platform (required for EncryptedSharedPreferences)
        PayCraftPlatform.init(this)

        // Configure PayCraft
        PayCraft.configure {
            supabase(url = "https://xxx.supabase.co", anonKey = "eyJ...")
            provider(StripeProvider(paymentLinks = mapOf(
                "monthly" to "https://buy.stripe.com/...",
            )))
            plans(BillingPlan(id = "monthly", name = "Monthly", price = "$4.99/mo"))
            supportEmail("support@yourapp.com")
        }

        // Register Koin module
        startKoin {
            modules(PayCraftModule)
        }
    }
}
```

## Usage in Compose

```kotlin
@Composable
fun PremiumScreen(navController: NavController) {
    val billingManager: BillingManager = koinInject()
    val isPremium by billingManager.isPremium.collectAsState()

    if (isPremium) {
        Text("Welcome, premium user!")
    } else {
        PayCraftPaywall(onDismiss = { navController.popBackStack() })
    }
}
```

## Encrypted Storage (Optional)

For AES-256 encrypted local cache on Android:

```kotlin
single<PayCraftStore> {
    PayCraftSettingsStore(PayCraftPlatform.encryptedSettings(androidContext()))
}
```
