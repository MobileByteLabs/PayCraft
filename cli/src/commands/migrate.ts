import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";

interface MigrateOptions {
  multiTenant?: boolean;
  output?: string;
}

export async function migrate(options: MigrateOptions) {
  const outDir = path.resolve(options.output || "./supabase/migrations");
  const spinner = ora("Generating migrations...").start();

  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const files: string[] = [];

  // 1. Core subscriptions + devices
  const corePath = path.join(outDir, `${timestamp}_paycraft_subscriptions.sql`);
  fs.writeFileSync(corePath, MIGRATION_SUBSCRIPTIONS(options.multiTenant));
  files.push(corePath);

  // 2. RPCs
  const rpcPath = path.join(outDir, `${String(Number(timestamp) + 1)}_paycraft_rpcs.sql`);
  fs.writeFileSync(rpcPath, MIGRATION_RPCS(options.multiTenant));
  files.push(rpcPath);

  // 3. Multi-tenant (optional)
  if (options.multiTenant) {
    const tenantPath = path.join(outDir, `${String(Number(timestamp) + 2)}_paycraft_tenants.sql`);
    fs.writeFileSync(tenantPath, MIGRATION_TENANTS);
    files.push(tenantPath);
  }

  spinner.succeed(`Generated ${files.length} migration(s)`);

  files.forEach((f) => {
    console.log(chalk.green(`  ${path.relative(process.cwd(), f)}`));
  });

  console.log(chalk.cyan("\n  Apply with:"));
  console.log(`  supabase db push\n`);
}

function MIGRATION_SUBSCRIPTIONS(multiTenant?: boolean): string {
  const tenantCol = multiTenant ? "\n    tenant_id UUID DEFAULT NULL," : "";
  return `-- PayCraft: Subscriptions & Registered Devices
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
    server_token TEXT,${tenantCol}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_email ON public.subscriptions(email);

CREATE TABLE IF NOT EXISTS public.registered_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),${tenantCol}
    UNIQUE(email, device_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registered_devices ENABLE ROW LEVEL SECURITY;

-- RLS: service_role only (SDK uses RPCs, not direct table access)
CREATE POLICY "subscriptions_service_role" ON public.subscriptions
    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "devices_service_role" ON public.registered_devices
    FOR ALL USING (auth.role() = 'service_role');
`;
}

function MIGRATION_RPCS(multiTenant?: boolean): string {
  const apiKeyParam = multiTenant ? ", p_api_key TEXT DEFAULT NULL" : "";
  return `-- PayCraft: Core RPCs
CREATE OR REPLACE FUNCTION is_premium(p_email TEXT, p_server_token TEXT DEFAULT NULL${apiKeyParam})
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(p_email)
        AND status IN ('active', 'trialing')
        AND mode = 'live'
    );
END;
$$;

CREATE OR REPLACE FUNCTION get_subscription(p_email TEXT, p_server_token TEXT DEFAULT NULL${apiKeyParam})
RETURNS TABLE(
    email TEXT, provider TEXT, plan TEXT, status TEXT, mode TEXT,
    current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT s.email, s.provider, s.plan, s.status, s.mode,
           s.current_period_start, s.current_period_end, s.cancel_at_period_end
    FROM subscriptions s
    WHERE s.email = lower(p_email)
    ORDER BY s.updated_at DESC LIMIT 1;
END;
$$;
`;
}

const MIGRATION_TENANTS = `-- PayCraft: Multi-Tenant Registry
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    api_key_test TEXT UNIQUE NOT NULL,
    api_key_live TEXT UNIQUE NOT NULL,
    webhook_secret_test TEXT NOT NULL,
    webhook_secret_live TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT NOT NULL DEFAULT 'free',
    subscriber_limit INT NOT NULL DEFAULT 100,
    owner_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants_service_role" ON public.tenants
    FOR ALL USING (auth.role() = 'service_role');

-- Add tenant_id FK to subscriptions + devices
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) DEFAULT NULL;
ALTER TABLE public.registered_devices
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) DEFAULT NULL;

-- Tenant resolution function
CREATE OR REPLACE FUNCTION resolve_tenant(p_api_key TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
    IF p_api_key IS NULL THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM tenants
    WHERE (api_key_test = p_api_key OR api_key_live = p_api_key)
    AND status = 'active';
    IF v_id IS NULL THEN RAISE EXCEPTION 'Invalid API key'; END IF;
    RETURN v_id;
END;
$$;
`;
