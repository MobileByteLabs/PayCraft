#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./commands/init";
import { migrate } from "./commands/migrate";
import { deploy } from "./commands/deploy";

const program = new Command();

program
  .name("paycraft")
  .description("PayCraft CLI — scaffold billing infrastructure in minutes")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize PayCraft in your project (interactive setup)")
  .option("--cloud", "Configure for PayCraft Cloud (hosted backend)")
  .option("--self-hosted", "Configure for self-hosted Supabase")
  .option("--api-key <key>", "PayCraft Cloud API key (pk_test_… / pk_live_…) — enables non-interactive init")
  .option("--provider <name>", "Payment provider (non-interactive)", "stripe")
  .option("--platform <name>", "Primary platform (non-interactive)", "Multiplatform (all)")
  .option("--out <dir>", "Output directory for the generated config", ".")
  .option("--yes", "Assume yes / write files without prompting (non-interactive)")
  .action(init);

program
  .command("migrate")
  .description("Generate Supabase SQL migrations for PayCraft tables")
  .option("--multi-tenant", "Include multi-tenant schema")
  .option("--output <dir>", "Output directory for migrations", "./supabase/migrations")
  .action(migrate);

program
  .command("deploy")
  .description("Deploy webhook Edge Functions to Supabase")
  .option("--provider <name>", "Deploy only a specific provider webhook")
  .action(deploy);

program.parse();
