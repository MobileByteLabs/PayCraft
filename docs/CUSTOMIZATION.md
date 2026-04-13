# PayCraft Customization Guide

## Theme Customization

### Default Theme (Zero Config)

PayCraft uses Material3 adaptive colors by default — it automatically matches your app's color scheme.

```kotlin
// Default — no customization needed
PayCraftPaywall(onDismiss = { })
```

### Custom Theme

```kotlin
val myTheme = PayCraftTheme(
    colors = PayCraftColorScheme(
        accent = Color(0xFF6200EE),
        activeBadge = Color(0xFF4CAF50),
        premiumGradientStart = Color(0xFF6200EE),
        premiumGradientEnd = Color(0xFF3700B3),
        // ... other tokens or leave as defaults
    ),
    typography = PayCraftTypography(
        titleLarge = MaterialTheme.typography.headlineMedium,
        priceText = TextStyle(
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
        ),
    ),
)

PayCraftPaywall(
    onDismiss = { },
    theme = myTheme,
)
```

### Theme Builder

```kotlin
val theme = PayCraftTheme.materialAdaptive(
    accentColor = Color(0xFF6200EE),
    activeBadgeColor = Color(0xFF4CAF50),
)
```

---

## UI Customization

### Option 1: Default UI (Zero Code)

```kotlin
// Full-screen paywall
PayCraftPaywall(onDismiss = { })

// Bottom sheet
PayCraftSheet(visible = show, onDismiss = { show = false })

// Settings banner
PayCraftBanner(
    onClick = { showPaywall = true },
    onRestoreClick = { showRestore = true },
)

// Restore sheet
PayCraftRestore(visible = showRestore, onDismiss = { showRestore = false })
```

### Option 2: Custom Plan Card (Slot API)

Override just the plan card while keeping everything else:

```kotlin
PayCraftPaywall(
    onDismiss = { },
    planCard = { plan, isSelected, isCurrentPlan, onClick ->
        // Your completely custom plan card
        MyPlanCard(
            plan = plan,
            isSelected = isSelected,
            onClick = onClick,
        )
    },
)
```

### Option 3: Custom Benefits

```kotlin
PayCraftPaywall(
    onDismiss = { },
    benefitRow = { benefit ->
        // Your custom benefit row
        Row {
            Text(benefit.text, style = MaterialTheme.typography.bodyLarge)
        }
    },
)
```

### Option 4: Custom Header

```kotlin
PayCraftPaywall(
    onDismiss = { },
    header = {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painter = painterResource(Res.drawable.app_logo), contentDescription = null)
            Text("Unlock ${BuildConfig.APP_NAME} Premium", style = MaterialTheme.typography.headlineMedium)
        }
    },
)
```

### Option 5: Fully Custom UI

Use `BillingManager` directly and build your own paywall:

```kotlin
@Composable
fun MyCustomPaywall(onDismiss: () -> Unit) {
    val billingManager: BillingManager = koinInject()
    val billingState by billingManager.billingState.collectAsState()
    val plans = PayCraft.requireConfig().plans
    val benefits = PayCraft.requireConfig().benefits
    var selectedPlan by remember { mutableStateOf(plans.first { it.isPopular }) }

    when (billingState) {
        is BillingState.Loading -> LoadingSpinner()

        is BillingState.Premium -> {
            val status = (billingState as BillingState.Premium).status
            PremiumContent(status = status)
        }

        is BillingState.Free -> {
            FreeContent(
                plans = plans,
                benefits = benefits,
                selectedPlan = selectedPlan,
                onPlanSelected = { selectedPlan = it },
                onCheckout = {
                    PayCraft.checkout(selectedPlan, billingManager.userEmail.value)
                },
                onRestore = { email ->
                    billingManager.logIn(email)
                },
            )
        }

        is BillingState.Error -> ErrorContent(
            message = (billingState as BillingState.Error).message,
            onRetry = billingManager::refreshStatus,
        )
    }
}
```

---

## Plans Customization

### Dynamic Plans

Plans are defined in `PayCraft.configure()` — change them without modifying the library:

```kotlin
plans(
    BillingPlan(id = "weekly",    name = "Weekly",    price = "₹29",    interval = "/week",   rank = 1),
    BillingPlan(id = "monthly",   name = "Monthly",   price = "₹99",    interval = "/month",  rank = 2),
    BillingPlan(id = "yearly",    name = "Yearly",    price = "₹799",   interval = "/year",   rank = 3, isPopular = true),
    BillingPlan(id = "lifetime",  name = "Lifetime",  price = "₹1,999", interval = "once",   rank = 4),
)
```

### Benefits with Custom Icons

```kotlin
benefits(
    BillingBenefit(icon = Icons.Default.Block,       text = "No advertisements"),
    BillingBenefit(icon = Icons.Default.Download,    text = "Unlimited downloads"),
    BillingBenefit(icon = Icons.Default.HighQuality, text = "HD quality"),
    BillingBenefit(icon = Icons.Default.Speed,       text = "Faster downloads"),
    BillingBenefit(icon = Icons.Default.Refresh,     text = "Background sync"),
)
```

---

## Premium Guard

Gate any content behind premium status:

```kotlin
PayCraftPremiumGuard(
    lockedContent = {
        // Shown when user is not premium
        Button(onClick = { showPaywall = true }) {
            Text("Upgrade to Premium")
        }
    }
) {
    // Shown only to premium users
    PremiumFeatureScreen()
}
```
