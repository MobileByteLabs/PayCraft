import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { PlatformKeysWizard } from "@/components/admin/platform-keys-wizard"

export default async function PlatformKeysPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  // First-deployer self-claim — idempotent on the RPC side.
  await supabase.rpc("claim_platform_owner")
  const { data: isOwner } = await supabase.rpc("is_platform_owner")

  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto pt-20 text-center">
        <h1 className="text-2xl font-bold text-ink-900">Platform settings are admin-only</h1>
        <p className="mt-3 text-ink-500 text-sm">
          Ask the deployer of this PayCraft instance to configure Stripe Connect
          platform credentials from this page.
        </p>
      </div>
    )
  }

  return <PlatformKeysWizard />
}
