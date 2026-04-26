# paycraft-adopt-client — Phase 4: Client Integration

> **PHASE 4 of 5** — Wires PayCraft into the target KMP app.
> 8 steps. Reads all values from .env — no manual copy-paste required.
> Ask before touching any app file. Verify every write.

---

## ⚠️ STRICTLY ENFORCED: KMP-FIRST — NO PLATFORM-SPECIFIC CODE

PayCraft is a **Kotlin Multiplatform library**. Every integration step MUST target `commonMain`.

**HARD RULES — violation = HARD STOP:**

| NEVER do this | DO this instead |
|---------------|-----------------|
| Add code to `MainActivity.kt`, `AppDelegate.swift`, `iosMain/` | Add to `commonMain/` Composables or shared KMP classes |
| Use `onResume()` override in Activity/Fragment | Use `LifecycleEventEffect(Lifecycle.Event.ON_RESUME)` in the Composable |
| Inject `SubscriptionManager` in Android Activity | Inject via `koinInject()` in the `@Composable` function |
| Add `PayCraft.configure()` in Android Application class | Add in `initPayCraft()` called from the KMP Koin init block |
| Add `PayCraftPlatform.init()` anywhere other than `androidMain` (Android) or `iosMain` (iOS) | `PayCraftPlatform.init()` is the ONLY call allowed in platform-specific code — everything else is commonMain |
| Call `subscriptionManager.refreshStatus()` in `Activity.onResume()` | Call `subscriptionManager.refreshStatus()` inside `LifecycleEventEffect(Lifecycle.Event.ON_RESUME)` in the paywall/settings Composable |

**Subscription refresh after checkout — KMP pattern:**
```kotlin
// In PaywallScreen.kt (commonMain) — NOT in MainActivity.kt
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

@Composable
fun PaywallScreen(...) {
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        subscriptionManager.refreshStatus()   // fires on every resume, including return from Stripe
    }
    // ...
}
```

**Why:** `LifecycleEventEffect` is from `androidx.lifecycle:lifecycle-runtime-compose` which is KMP-compatible (Jetbrains Lifecycle). It works on Android, iOS, and Desktop — no platform fork needed.

---

## Prerequisites (verify before starting)

Read `.env` → confirm:
- `PAYCRAFT_SUPABASE_URL` non-empty
- `PAYCRAFT_SUPABASE_ANON_KEY` non-empty
- `PAYCRAFT_PROVIDER` non-empty
- `PAYCRAFT_PLAN_1_ID` non-empty
- `PAYCRAFT_SUPPORT_EMAIL` non-empty

READ: PAYCRAFT_PROVIDER and PAYCRAFT_MODE from .env
IF PAYCRAFT_PROVIDER = "stripe":
  IF PAYCRAFT_MODE = "test" OR PAYCRAFT_MODE is empty:
    VERIFY: At least one of PAYCRAFT_STRIPE_TEST_LINK_MONTHLY, PAYCRAFT_STRIPE_TEST_LINK_QUARTERLY,
            PAYCRAFT_STRIPE_TEST_LINK_YEARLY is non-empty
    IF ALL EMPTY:
      HARD STOP: "No Stripe TEST payment links set in .env.
                  Run /paycraft-adopt-stripe (Phase 3A) first to create test payment links."
  IF PAYCRAFT_MODE = "live":
    VERIFY: At least one of PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY, PAYCRAFT_STRIPE_LIVE_LINK_QUARTERLY,
            PAYCRAFT_STRIPE_LIVE_LINK_YEARLY is non-empty
    IF ALL EMPTY:
      HARD STOP: "No Stripe LIVE payment links set in .env.
                  Run /paycraft-adopt-stripe (Phase 3B) first to create live payment links."
IF PAYCRAFT_PROVIDER = "razorpay":
  VERIFY: At least one of PAYCRAFT_RAZORPAY_LINK_MONTHLY, PAYCRAFT_RAZORPAY_LINK_QUARTERLY,
          PAYCRAFT_RAZORPAY_LINK_YEARLY is non-empty
  IF ALL EMPTY:
    HARD STOP: "No Razorpay payment links set in .env.
                Run /paycraft-adopt-razorpay first to create payment links."

IF ANY BASE KEY MISSING: HARD STOP — "Required .env keys missing. Complete Phase 1–3 first."

---

## Phase 4 Steps

### STEP 4.1 — Ask target app path (or skip)

```
DISPLAY:
  "Phase 4: Client Integration"
  "Which KMP app should I wire PayCraft into?"
  "(Enter the absolute path to your app root, or 'skip' for manual code)"

WAIT: user enters path or "skip"

IF "skip":
  DISPLAY: "Skipping automatic client integration."
  Generate manual integration code block (see STEP 4.5 for PayCraft.configure format)
  Display: "Add this to your app manually:"
  [print full PayCraft.configure() block + Koin + UI instructions]
  SKIP remaining Phase 4 steps
  MARK Phase 4 as MANUAL

IF path provided:
  VALIDATE: Directory exists at path
  IF NOT: HARD STOP — "Path not found: [path]. Enter the correct absolute path to your app."

  SEARCH: Find libs.versions.toml in [path] (recursive, max 3 levels)
  IF NOT FOUND: HARD STOP — "libs.versions.toml not found in [path].
                 Is this a Gradle-based KMP project?
                 Verify path and try again."

  SEARCH: Find settings.gradle.kts or settings.gradle in [path]
  CAPTURE: app root, gradle structure
  OUTPUT : "✓ KMP project found at [path]"
           "  Gradle config: [libs.versions.toml location]"
```

### STEP 4.2 — Check latest PayCraft version

```
TRY     : GET https://central.sonatype.com/api/v1/publisher/search?q=io.github.mobilebytelabs:paycraft
          Parse response → extract latest stable version string
IF FAILS OR RESPONSE UNPARSEABLE:
  FALLBACK 1: Read {paycraft-root}/gradle.properties → look for version= or VERSION= line
              IF FOUND: use that version
  FALLBACK 2: Ask user: "What PayCraft version should I add?
                         (Check: https://central.sonatype.com/artifact/io.github.mobilebytelabs/paycraft)"

CAPTURE : latest stable version (e.g. 1.0.2)
OUTPUT  : "✓ Latest PayCraft version: [version] (from [Sonatype/gradle.properties/user])"
```

### STEP 4.3 — Add PayCraft dependency to Gradle

```
READ    : {app}/gradle/libs.versions.toml (absolute path from Step 4.1)

CHECK   : Does [versions] section contain "paycraft"?
IF YES  :
  READ  : current version
  IF current version = latest: OUTPUT "✓ PayCraft dependency already at [version] — no change"
  IF outdated: DISPLAY "PayCraft [current] → update to [latest]?"
               IF user confirms → update version line
ELSE    :
  ADD under [versions] section:
    paycraft = "[latest_version]"
  ADD under [libraries] section:
    paycraft = { module = "io.github.mobilebytelabs:paycraft", version.ref = "paycraft" }

VERIFY  : Re-read libs.versions.toml → both entries present with correct version
IF MISSING: HARD STOP — "Failed to write PayCraft entries to libs.versions.toml."
OUTPUT  : "✓ PayCraft [version] added to libs.versions.toml"

SEARCH  : Find shared/build.gradle.kts or common module's build.gradle.kts
READ    : File content
NOTE    : "IMPORTANT: PayCraft is a KMP library — add to commonMain.dependencies ONLY.
           Do NOT add to androidMain, iosMain, or any platform-specific module."
CHECK   : Does commonMain.dependencies contain "libs.paycraft"?
IF NOT  :
  FIND  : commonMain.dependencies { ... } block
  ADD   : implementation(libs.paycraft)
  VERIFY: Re-read file → "libs.paycraft" present in commonMain.dependencies
  IF MISSING: HARD STOP — "Failed to add PayCraft to commonMain.dependencies."
OUTPUT  : "✓ implementation(libs.paycraft) added to commonMain"
```

### STEP 4.4 — Locate KoinModules file (or Koin init pattern)

```
ARCHITECTURAL NOTE:
  PayCraft.configure() must be called BEFORE Koin starts (PayCraftModule uses requireConfig()
  at instantiation). The correct pattern is:
  1. Create PayCraftConfig.kt in the settings/billing feature module (keeps config co-located
     with billing UI — same module as SettingsScreen)
  2. Expose initPayCraft() top-level function
  3. Call initPayCraft() from the Koin module assembly init {} block

  This mirrors the initProductTickets() pattern found in KMP apps.

SEARCH in [app]:
  - Look for file named KoinModules.kt containing "object KoinModules" with init {} block
  - OR file containing "startKoin {" (traditional approach)
  - OR file named "Application.kt" / "App.kt" / "AppModule.kt"
  - Search in: cmp-navigation/, androidApp/, composeApp/, androidMain/, app/, di/

IF KoinModules pattern found (object with init {}):
  koin_init_file = detected path
  use_init_block = true
  OUTPUT: "✓ KoinModules init block: [path]"

IF startKoin {} found:
  koin_init_file = detected path
  use_init_block = false
  OUTPUT: "✓ Koin init file: [path]"

IF NOT FOUND:
  DISPLAY: "Could not auto-detect Koin initialization."
           "Where do you initialize Koin? (Enter path relative to app root)"
  WAIT: user enters path
  VALIDATE: file exists
  IF NOT: HARD STOP — "File not found: [path]"
```

### STEP 4.4B — Ask key storage method (before writing configure())

```
DISPLAY:
  "How does your app store API keys? This determines what references go in PayCraft.configure()."
  "[1] Existing SupabaseConfig.kt (recommended — reuse app's existing Supabase config object)"
  "[2] local.properties + BuildConfig (standard Android)"
  "[3] Config.kt or Constants.kt file"
  "[4] Other — enter file path"
  "[5] Inline values (I'll handle key management separately)"

DETECT: Search for SupabaseConfig.kt, AppConfig.kt, or files containing SUPABASE_URL constant
IF FOUND:
  DISPLAY: "Found existing config: [file] — recommended to reuse it"
  PRE-SELECT: option [1] (show as default)

WAIT: user selects
STORE: key_storage_choice = [1/2/3/4/5]
OUTPUT: "✓ Key storage: [description of choice]"
```

### STEP 4.5 — Create PayCraftConfig.kt (single source of truth) + update initPayCraft()

```
NOTE: PayCraftConfig.kt is a separate object (NOT inside NetworkModule) that centralizes
      all payment links, portal URLs, and the IS_TEST_MODE flag. This way, flipping
      test ↔ live is one line change in one file.

      initPayCraft() in NetworkModule (or equivalent) reads from PayCraftConfig — it does NOT
      hardcode any URLs. This pattern keeps the library call clean and the config auditable.

READ ALL from .env:
  PROVIDER = PAYCRAFT_PROVIDER
  SUPABASE_URL = PAYCRAFT_SUPABASE_URL
  ANON_KEY = PAYCRAFT_SUPABASE_ANON_KEY
  SUPPORT_EMAIL = PAYCRAFT_SUPPORT_EMAIL
  PLAN_COUNT = PAYCRAFT_PLAN_COUNT
  For each plan: PAYCRAFT_PLAN_[i]_ID, _NAME, _PRICE, _INTERVAL, _POPULAR
  If stripe:
    TEST_LINKS = PAYCRAFT_STRIPE_LINK_MONTHLY/QUARTERLY/SEMIANNUAL/YEARLY
    TEST_PORTAL = PAYCRAFT_STRIPE_PORTAL_URL (or PAYCRAFT_STRIPE_TEST_PORTAL_URL)
  If razorpay: PAYCRAFT_RAZORPAY_PLAN_*

DETERMINE supabase reference based on key_storage_choice (from Step 4.4B):
  IF choice = 1 (SupabaseConfig.kt):
    DETECT config object name (e.g. "SupabaseConfig")
    url_ref  = "[SupabaseConfig].SHARED_URL" (or .URL / .PROJECT_URL — match existing)
    key_ref  = "[SupabaseConfig].SHARED_ANON_KEY" (or .ANON_KEY — match existing)
    inline_values = false
  IF choice = 2 (BuildConfig):
    url_ref  = "BuildConfig.SUPABASE_URL"
    key_ref  = "BuildConfig.SUPABASE_ANON_KEY"
    inline_values = false
  IF choice = 3 (Config.kt):
    config_class = detected class name
    url_ref  = "[config_class].SUPABASE_URL"
    key_ref  = "[config_class].SUPABASE_ANON_KEY"
    inline_values = false
  IF choice = 4 (Other):
    ASK: "Class/object name that holds your keys?"
    config_class = user input
    url_ref  = "[config_class].SUPABASE_URL"
    key_ref  = "[config_class].SUPABASE_ANON_KEY"
    inline_values = false
  IF choice = 5 (inline):
    url_ref  = "\"[PAYCRAFT_SUPABASE_URL literal]\""
    key_ref  = "\"[PAYCRAFT_SUPABASE_ANON_KEY literal]\""
    inline_values = true
    NOTE: Add "// TODO: move to SupabaseConfig or BuildConfig" comment inline

DETERMINE isPopular per plan:
  FOR EACH PLAN i:
    popular_flag = (PAYCRAFT_PLAN_[i]_POPULAR == "true")

PRICE FORMATTING:
  INR: ₹[amount/100]   (e.g. 10000 → ₹100)
  USD: $[amount/100.0] formatted (e.g. 999 → $9.99)
  EUR/GBP: same pattern

FIND: core/network module's commonMain package (same package as SupabaseConfig if present)
  SEARCH: [app]/core/network/src/commonMain/kotlin/.../
  IF NOT FOUND: nearest commonMain package root

STEP A — Create PayCraftConfig.kt in that directory:

```kotlin
package [core_network_package]

/**
 * Single source of truth for PayCraft billing configuration.
 *
 * To switch between test and live mode, set [IS_TEST_MODE]:
 *   - true  → uses [TEST_PAYMENT_LINKS] + [TEST_PORTAL_URL]  (sandbox, test cards)
 *   - false → uses [LIVE_PAYMENT_LINKS] + [LIVE_PORTAL_URL]  (production)
 */
object PayCraftConfig {

    /** Flip to false before production release. */
    const val IS_TEST_MODE = true

    // ── Test / Sandbox ──────────────────────────────────────────────────────
    val TEST_PAYMENT_LINKS = mapOf(
        [FOR EACH PLAN: "[plan_id]" to "[PAYCRAFT_STRIPE_LINK_[PLAN_ID] value]",]
    )
    const val TEST_PORTAL_URL = "[PAYCRAFT_STRIPE_PORTAL_URL value]"

    // ── Live / Production ───────────────────────────────────────────────────
    val LIVE_PAYMENT_LINKS = mapOf(
        [FOR EACH PLAN: "[plan_id]" to "",]
    )
    const val LIVE_PORTAL_URL = ""

    // ── Active (resolved at runtime based on mode) ──────────────────────────
    val ACTIVE_PAYMENT_LINKS: Map<String, String>
        get() = if (IS_TEST_MODE) TEST_PAYMENT_LINKS else LIVE_PAYMENT_LINKS

    val ACTIVE_PORTAL_URL: String
        get() = if (IS_TEST_MODE) TEST_PORTAL_URL else LIVE_PORTAL_URL
}
```

STEP B — Locate or create initPayCraft() function (in NetworkModule.kt or equivalent DI file):
  SEARCH: [app] for existing initPayCraft() function
  IF FOUND: update it to use PayCraftConfig (see template below)
  IF NOT FOUND: find NetworkModule.kt or create PayCraftInit.kt in core/network DI

  Write initPayCraft() using PayCraftConfig references:

```kotlin
fun initPayCraft() {
    PayCraft.configure {
        supabase(
            url = [url_ref],
            anonKey = [key_ref],
        )
        provider(
            // Payment links + mode managed in PayCraftConfig — flip IS_TEST_MODE for production
            [IF STRIPE]
            StripeProvider(
                paymentLinks = PayCraftConfig.ACTIVE_PAYMENT_LINKS,
                customerPortalUrl = PayCraftConfig.ACTIVE_PORTAL_URL,
            )
            [IF RAZORPAY]
            RazorpayProvider(
                paymentLinks = PayCraftConfig.ACTIVE_PAYMENT_LINKS,
            )
        )
        plans(
            [FOR EACH PLAN i:
              BillingPlan(
                id = "[PAYCRAFT_PLAN_[i]_ID]",
                name = "[PAYCRAFT_PLAN_[i]_NAME]",
                price = "[formatted price]",
                interval = "[PAYCRAFT_PLAN_[i]_INTERVAL]",
                rank = [i],
                [IF popular_flag: isPopular = true,]
              ),]
        )
        benefits(*PayCraftBenefits.full.toTypedArray())
        supportEmail("[PAYCRAFT_SUPPORT_EMAIL]")
    }
}
```

VERIFY: Re-read PayCraftConfig.kt → IS_TEST_MODE, ACTIVE_PAYMENT_LINKS, ACTIVE_PORTAL_URL present
VERIFY: Re-read initPayCraft() → uses PayCraftConfig.ACTIVE_PAYMENT_LINKS (no hardcoded URLs)
IF MISSING: HARD STOP — "PayCraftConfig.kt or initPayCraft() not written correctly."
OUTPUT: "✓ PayCraftConfig.kt created (single source of truth for payment links + mode flag)"
        "✓ initPayCraft() updated to reference PayCraftConfig"
```

### STEP 4.6 — Wire initPayCraft() + PayCraftModule into Koin

```
READ    : koin_init_file (from Step 4.4)

[IF use_init_block = true (KoinModules.kt pattern)]:
  CHECK   : Is "initPayCraft()" in the init {} block?
  IF YES  : OUTPUT "✓ initPayCraft() already in init block — no change"
  IF NO   :
    FIND  : init { ... } block containing initProductTickets() or similar calls
    ADD   : initPayCraft() on the line AFTER initProductTickets() (if present) or at end of init {}
    ADD import: import [settings_di_package].initPayCraft

  CHECK   : Is "PayCraftModule" in the featureModule or modules list?
  IF YES  : OUTPUT "✓ PayCraftModule already in modules — no change"
  IF NO   :
    FIND  : The includes(...) list in the feature module
    ADD   : PayCraftModule as last entry
    ADD import: import com.mobilebytelabs.paycraft.di.PayCraftModule

[IF use_init_block = false (startKoin {} pattern)]:
  CHECK: Is "initPayCraft()" called BEFORE startKoin {}?
  IF NO:
    FIND: The code just before startKoin { ... }
    INSERT: initPayCraft()
    ADD import: import [settings_di_package].initPayCraft
  FIND: modules(...) list inside startKoin {}
  ADD: PayCraftModule as last entry
  ADD import: import com.mobilebytelabs.paycraft.di.PayCraftModule

VERIFY: Re-read koin_init_file → "initPayCraft()" AND "PayCraftModule" both present
IF MISSING: HARD STOP — "Koin wiring incomplete.
             Missing: [list of missing items]"
OUTPUT: "✓ initPayCraft() and PayCraftModule wired into Koin"
```

### STEP 4.7 — Add PayCraft UI to SettingsScreen

```
SEARCH  : Find SettingsScreen.kt (or equivalent) in [app]
          Search in priority order:
          1. Files matching *Settings*.kt anywhere in [app]
          2. Files matching *Premium*.kt anywhere in [app]
          3. Files matching *Billing*.kt anywhere in [app]
          4. Files matching *Profile*.kt in feature/settings/ or ui/settings/ path
          5. Files containing "isPremium" or "isSubscribed" StateFlow/collectAsState usage

IF NOT FOUND using any of the above:
  DISPLAY: "Could not auto-detect your settings/billing screen. Where should the PayCraft UI go?"
           "Enter the file path relative to [app] (e.g. feature/settings/SettingsScreen.kt):"
           "Enter relative path:"
  WAIT: user enters path
  VALIDATE: file exists
  IF NOT: HARD STOP — "File not found."

READ    : SettingsScreen.kt content

CHECK   : Is "PayCraftBanner" already present?
IF YES  : OUTPUT "✓ PayCraft UI already in SettingsScreen — no change"
IF NO   :
  FIND  : First composable function in the file (the @Composable Screen function)
  ADD at top of function body (after any existing remember { } state):
    var showPaywall by remember { mutableStateOf(false) }
    var showRestore by remember { mutableStateOf(false) }

  FIND  : A logical place in the screen body (near end of content, before closing brace)
  ADD   :
    PayCraftBanner(
        onUpgradeClick = { showPaywall = true },
        onManageClick = { showPaywall = true },
        onRestoreClick = { showRestore = true },
    )

  FIND  : The outermost composable scope (after the main content)
  ADD   :
    if (showPaywall) {
        PayCraftPaywallSheet(
            onDismiss = { showPaywall = false },
        )
    }
    if (showRestore) {
        PayCraftRestore(
            visible = showRestore,
            onDismiss = { showRestore = false },
        )
    }

  ADD imports at top of file:
    import com.mobilebytelabs.paycraft.ui.PayCraftBanner
    import com.mobilebytelabs.paycraft.ui.PayCraftPaywallSheet
    import com.mobilebytelabs.paycraft.ui.PayCraftRestore

VERIFY  : Re-read file → PayCraftBanner, PayCraftPaywallSheet, PayCraftRestore all present
IF ANY MISSING: HARD STOP — "PayCraft UI components not fully added.
                Missing: [list of missing components]"
OUTPUT  : "✓ PayCraft UI added to SettingsScreen"
```

### STEP 4.7B — Register deep link intent filter in AndroidManifest.xml

```
NOTE: PayCraft uses an external browser for checkout. After payment, the browser
      can redirect back to the app via a deep link (e.g. reelsdownloader://premium/success).
      Without this intent filter, the redirect goes nowhere.

READ    : PAYCRAFT_APP_REDIRECT_URL from .env
          (e.g. reelsdownloader://premium/success)
          EXTRACT: scheme = part before "://" (e.g. "reelsdownloader")
          EXTRACT: host   = part after "://" up to "/" (e.g. "premium")
          EXTRACT: path   = part after host (e.g. "/success")

IF PAYCRAFT_APP_REDIRECT_URL is empty:
  DISPLAY: "No app redirect URL configured. Deep link registration skipped."
           "Set PAYCRAFT_APP_REDIRECT_URL in .env to enable post-payment deep links."
  SKIP remaining STEP 4.7B
  MARK: deep_link_configured = false

SEARCH  : AndroidManifest.xml in [app] (androidMain/AndroidManifest.xml or androidApp/)
IF NOT FOUND: HARD STOP — "AndroidManifest.xml not found in [app]"

READ    : AndroidManifest.xml content
CHECK   : Is "[scheme]://" already registered as an intent filter?
IF YES  : OUTPUT "✓ Deep link scheme [scheme]:// already in AndroidManifest — no change"
          MARK: deep_link_configured = true
          SKIP remaining STEP 4.7B

IF NO   :
  FIND  : The <activity> element for the main activity (android:name containing "MainActivity" or ".MainActivity")
  ADD inside that <activity> element, after existing <intent-filter> blocks:

    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data
            android:scheme="[scheme]"
            android:host="[host]"
            android:pathPrefix="[path]" />
    </intent-filter>

  VERIFY: Re-read AndroidManifest.xml → scheme "[scheme]" present in an intent-filter
  IF MISSING: HARD STOP — "Failed to add deep link intent filter to AndroidManifest.xml"
  MARK: deep_link_configured = true
  OUTPUT: "✓ Deep link intent filter added: [scheme]://[host][path]"
```

### STEP 4.8 — Write API keys to app key storage

```
READ    : key_storage_choice from Step 4.4B

[IF 1 — SupabaseConfig.kt]:
  NOTE  : Keys are already in SupabaseConfig.kt and referenced via [SupabaseConfig].SHARED_URL
          in PayCraftConfig.kt (Step 4.5). No additional writes needed.
  VERIFY: Re-read PayCraftConfig.kt → url_ref references the SupabaseConfig object
  OUTPUT: "✓ PayCraftConfig.kt references existing SupabaseConfig — no key writes needed"

[IF 2 — local.properties + BuildConfig]:
  READ    : {app}/local.properties (or create if not exists)
  CHECK   : SUPABASE_URL and SUPABASE_ANON_KEY present?
  IF NO   : ADD to local.properties:
              SUPABASE_URL=[PAYCRAFT_SUPABASE_URL]
              SUPABASE_ANON_KEY=[PAYCRAFT_SUPABASE_ANON_KEY]
  CHECK   : local.properties in {app}/.gitignore
  IF NOT  : ADD local.properties line to .gitignore
            DISPLAY "⚠️  Added local.properties to .gitignore (was missing)"
  VERIFY  : Re-read local.properties → both keys present
  OUTPUT  : "✓ Keys written to local.properties (gitignored)"
  DISPLAY:
    "Add these lines to your app's build.gradle.kts to expose keys as BuildConfig fields:"
    "---"
    "val localProps = java.util.Properties().apply {"
    "    load(rootProject.file(\"local.properties\").inputStream())"
    "}"
    "android {"
    "    buildFeatures { buildConfig = true }"
    "    defaultConfig {"
    "        buildConfigField(\"String\", \"SUPABASE_URL\", \"\\\"${localProps[\"SUPABASE_URL\"]}\\\"\")"
    "        buildConfigField(\"String\", \"SUPABASE_ANON_KEY\", \"\\\"${localProps[\"SUPABASE_ANON_KEY\"]}\\\"\")"
    "    }"
    "}"
    "---"
    "PayCraft.configure() already uses BuildConfig.SUPABASE_URL and BuildConfig.SUPABASE_ANON_KEY"
    "(written correctly in Step 4.5 — no further edits needed)"

[IF 3 — Config.kt]:
  SEARCH  : Find Config.kt or Constants.kt in [app]
  IF NOT FOUND: Ask user for path
  READ    : file content
  CHECK   : SUPABASE_URL constant present?
  IF NO   : ADD:
              const val SUPABASE_URL = "[PAYCRAFT_SUPABASE_URL]"
              const val SUPABASE_ANON_KEY = "[PAYCRAFT_SUPABASE_ANON_KEY]"
  VERIFY  : Re-read file → both constants present
  OUTPUT  : "✓ Keys written to [Config.kt path]"
  DISPLAY : "PayCraft.configure() uses Config.SUPABASE_URL — no further edits needed"

[IF 4 — Other]:
  WAIT: user enters path
  VALIDATE: file exists
  READ + WRITE appropriate format based on file type
  VERIFY  : Re-read → keys present
  OUTPUT  : "✓ Keys written to [path]"

[IF 5 — Inline (chose in Step 4.4B)]:
  OUTPUT  : "✓ Inline values used in PayCraft.configure() — key storage is your responsibility"
  DISPLAY : "⚠️  Reminder: Do not commit literal keys to git."
            "When ready, move to BuildConfig or a config file."
```

---

## Phase 4 Checkpoint

```
╔══ PHASE 4 COMPLETE — Client Integration ═════════════════════════════╗
║                                                                        ║
║  ✓ PayCraft [version] dependency in Gradle                           ║
║  ✓ PayCraft.configure() in [app init file]                           ║
║    - Supabase: [project-ref]                                          ║
║    - Provider: [stripe/razorpay]                                      ║
║    - Plans: [N] plans with real payment links                         ║
║  ✓ PayCraftModule in Koin modules                                     ║
║  ✓ PayCraftBanner + PayCraftPaywallSheet + PayCraftRestore in Settings ║
║  ✓ Deep link intent filter registered in AndroidManifest.xml          ║
║  ✓ API keys in [storage location]                                     ║
║                                                                        ║
║  Ready to proceed to Phase 5: End-to-End Verification?               ║
║  [Y] Continue   [Q] Quit                                             ║
╚════════════════════════════════════════════════════════════════════════╝
```

Wait for user `[Y]` before proceeding.
