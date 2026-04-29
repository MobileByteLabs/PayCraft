import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";

interface InitOptions {
  cloud?: boolean;
  selfHosted?: boolean;
}

export async function init(options: InitOptions) {
  console.log(chalk.bold("\n  PayCraft Setup\n"));

  // Step 1: Hosting mode
  let mode = options.cloud ? "cloud" : options.selfHosted ? "self-hosted" : "";
  if (!mode) {
    const { hosting } = await inquirer.prompt([
      {
        type: "list",
        name: "hosting",
        message: "How do you want to run PayCraft?",
        choices: [
          { name: "PayCraft Cloud (hosted — no server setup)", value: "cloud" },
          { name: "Self-hosted (your own Supabase project)", value: "self-hosted" },
        ],
      },
    ]);
    mode = hosting;
  }

  if (mode === "cloud") {
    await setupCloud();
  } else {
    await setupSelfHosted();
  }
}

async function setupCloud() {
  console.log(chalk.cyan("\n  PayCraft Cloud Setup\n"));

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "apiKey",
      message: "Your PayCraft Cloud API key (from dashboard.paycraft.dev):",
      validate: (v: string) => v.startsWith("pk_") || "API key should start with pk_test_ or pk_live_",
    },
    {
      type: "list",
      name: "provider",
      message: "Payment provider:",
      choices: ["stripe", "paddle", "paypal", "razorpay", "lemonsqueezy", "flutterwave", "paystack", "midtrans", "btcpay", "custom"],
    },
    {
      type: "list",
      name: "platform",
      message: "Primary platform:",
      choices: ["Android (Compose)", "iOS (SwiftUI)", "Desktop (JVM)", "Web (WasmJs)", "Multiplatform (all)"],
    },
  ]);

  const spinner = ora("Generating configuration...").start();

  // Generate Kotlin config snippet
  const isTest = answers.apiKey.startsWith("pk_test_");
  const configSnippet = generateKotlinConfig({
    mode: "cloud",
    apiKey: answers.apiKey,
    provider: answers.provider,
    isTest,
  });

  spinner.succeed("Configuration generated!");

  console.log(chalk.green("\n  Add this to your Application/App init:\n"));
  console.log(chalk.gray("  ─".repeat(30)));
  console.log(configSnippet);
  console.log(chalk.gray("  ─".repeat(30)));

  // Write .env file
  const envContent = `# PayCraft Cloud\nPAYCRAFT_API_KEY=${answers.apiKey}\n`;
  writeFileIfConfirmed(".env.paycraft", envContent);

  console.log(chalk.green("\n  Next steps:"));
  console.log("  1. Add PayCraft dependency to build.gradle.kts:");
  console.log(chalk.cyan('     implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")'));
  console.log(`  2. Configure your ${answers.provider} payment links in the dashboard`);
  console.log("  3. Test with a sandbox transaction");
  console.log("");
}

async function setupSelfHosted() {
  console.log(chalk.cyan("\n  Self-Hosted Setup\n"));

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "supabaseUrl",
      message: "Supabase project URL:",
      validate: (v: string) => v.includes("supabase") || "Should be a Supabase project URL",
    },
    {
      type: "input",
      name: "supabaseAnonKey",
      message: "Supabase anon key:",
      validate: (v: string) => v.length > 20 || "Anon key seems too short",
    },
    {
      type: "list",
      name: "provider",
      message: "Payment provider:",
      choices: ["stripe", "paddle", "paypal", "razorpay", "lemonsqueezy", "flutterwave", "paystack", "midtrans", "btcpay", "custom"],
    },
    {
      type: "confirm",
      name: "multiTenant",
      message: "Enable multi-tenant support?",
      default: false,
    },
    {
      type: "confirm",
      name: "generateMigrations",
      message: "Generate SQL migrations?",
      default: true,
    },
  ]);

  const spinner = ora("Generating files...").start();

  // Generate Kotlin config
  const configSnippet = generateKotlinConfig({
    mode: "self-hosted",
    supabaseUrl: answers.supabaseUrl,
    supabaseAnonKey: answers.supabaseAnonKey,
    provider: answers.provider,
    isTest: true,
  });

  // Generate migrations if requested
  if (answers.generateMigrations) {
    generateMigrations(answers.multiTenant);
  }

  // Generate .env
  const envLines = [
    "# PayCraft Self-Hosted",
    `SUPABASE_URL=${answers.supabaseUrl}`,
    `SUPABASE_ANON_KEY=${answers.supabaseAnonKey}`,
    `PAYCRAFT_PROVIDER=${answers.provider}`,
    "",
    `# ${answers.provider} keys (fill in)`,
    `${answers.provider.toUpperCase()}_SECRET_KEY=`,
    `${answers.provider.toUpperCase()}_WEBHOOK_SECRET=`,
  ];

  spinner.succeed("Files generated!");

  console.log(chalk.green("\n  Add this to your Application/App init:\n"));
  console.log(chalk.gray("  ─".repeat(30)));
  console.log(configSnippet);
  console.log(chalk.gray("  ─".repeat(30)));

  writeFileIfConfirmed(".env.paycraft", envLines.join("\n") + "\n");

  console.log(chalk.green("\n  Next steps:"));
  console.log("  1. Run the SQL migrations against your Supabase project");
  console.log(`  2. Deploy the ${answers.provider}-webhook Edge Function`);
  console.log(`  3. Add your ${answers.provider} webhook secret to Supabase secrets`);
  console.log("  4. Test with a sandbox transaction");
  console.log("");
}

function generateKotlinConfig(opts: {
  mode: string;
  apiKey?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  provider: string;
  isTest: boolean;
}): string {
  const providerClass = {
    stripe: "StripeProvider",
    paddle: "PaddleProvider",
    paypal: "PayPalProvider",
    razorpay: "RazorpayProvider",
    lemonsqueezy: "LemonSqueezyProvider",
    flutterwave: "FlutterwaveProvider",
    paystack: "PaystackProvider",
    midtrans: "MidtransProvider",
    btcpay: "BTCPayProvider",
    custom: "CustomProvider",
  }[opts.provider] || "StripeProvider";

  if (opts.mode === "cloud") {
    return `
    PayCraft.configure {
        cloud(apiKey = "${opts.apiKey}")
        provider(${providerClass}(
            ${opts.isTest ? "test" : "live"}PaymentLinks = mapOf(
                "pro" to "YOUR_PAYMENT_LINK",
            ),
            isTestMode = ${opts.isTest},
        ))
        plans(
            BillingPlan(id = "pro", name = "Pro", /* ... */),
        )
    }`;
  }

  return `
    PayCraft.configure {
        supabase(
            url = "${opts.supabaseUrl}",
            anonKey = "${opts.supabaseAnonKey}",
        )
        provider(${providerClass}(
            testPaymentLinks = mapOf(
                "pro" to "YOUR_TEST_PAYMENT_LINK",
            ),
            isTestMode = true,
        ))
        plans(
            BillingPlan(id = "pro", name = "Pro", /* ... */),
        )
    }`;
}

function generateMigrations(multiTenant: boolean) {
  const dir = path.resolve("supabase/migrations");
  fs.mkdirSync(dir, { recursive: true });

  // Core tables
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  const coreSql = `-- PayCraft: Core subscription tables
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'stripe',
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active',
    mode TEXT NOT NULL DEFAULT 'test',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    server_token TEXT,
    ${multiTenant ? "tenant_id UUID REFERENCES tenants(id) DEFAULT NULL," : ""}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.registered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ${multiTenant ? "tenant_id UUID REFERENCES tenants(id) DEFAULT NULL," : ""}
    UNIQUE(email, device_id${multiTenant ? ", tenant_id" : ""})
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registered_devices ENABLE ROW LEVEL SECURITY;
`;

  fs.writeFileSync(path.join(dir, `${timestamp}_paycraft_core.sql`), coreSql);
  console.log(`  Generated: supabase/migrations/${timestamp}_paycraft_core.sql`);

  if (multiTenant) {
    const tenantSql = `-- PayCraft: Multi-tenant support
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key_test TEXT UNIQUE NOT NULL,
    api_key_live TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT NOT NULL DEFAULT 'free',
    subscriber_limit INT NOT NULL DEFAULT 100,
    owner_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
`;
    const ts2 = String(Number(timestamp) + 1);
    fs.writeFileSync(path.join(dir, `${ts2}_paycraft_tenants.sql`), tenantSql);
    console.log(`  Generated: supabase/migrations/${ts2}_paycraft_tenants.sql`);
  }
}

function writeFileIfConfirmed(filename: string, content: string) {
  const filePath = path.resolve(filename);
  if (fs.existsSync(filePath)) {
    console.log(chalk.yellow(`\n  ${filename} already exists — skipping.`));
    return;
  }
  fs.writeFileSync(filePath, content);
  console.log(chalk.green(`\n  Created ${filename}`));
}
