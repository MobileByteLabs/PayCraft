import chalk from "chalk";
import ora from "ora";
import { execSync } from "child_process";

interface DeployOptions {
  provider?: string;
}

const PROVIDERS = [
  "stripe", "paddle", "paypal", "razorpay",
  "lemonsqueezy", "flutterwave", "paystack", "midtrans", "btcpay",
];

export async function deploy(options: DeployOptions) {
  const providers = options.provider ? [options.provider] : PROVIDERS;

  // Check supabase CLI is installed
  try {
    execSync("supabase --version", { stdio: "pipe" });
  } catch {
    console.error(chalk.red("\n  Supabase CLI not found. Install with:"));
    console.error(chalk.cyan("  npm install -g supabase\n"));
    process.exit(1);
  }

  for (const provider of providers) {
    if (!PROVIDERS.includes(provider)) {
      console.error(chalk.red(`  Unknown provider: ${provider}`));
      console.error(chalk.gray(`  Available: ${PROVIDERS.join(", ")}`));
      continue;
    }

    const funcName = `${provider}-webhook`;
    const spinner = ora(`Deploying ${funcName}...`).start();

    try {
      execSync(`supabase functions deploy ${funcName} --no-verify-jwt`, {
        stdio: "pipe",
      });
      spinner.succeed(`Deployed ${funcName}`);
    } catch (err: any) {
      spinner.fail(`Failed to deploy ${funcName}`);
      console.error(chalk.red(`  ${err.stderr?.toString() || err.message}`));
    }
  }

  console.log(chalk.green("\n  Don't forget to set webhook secrets:"));
  console.log(chalk.cyan("  supabase secrets set STRIPE_SECRET_KEY=sk_test_...\n"));
}
