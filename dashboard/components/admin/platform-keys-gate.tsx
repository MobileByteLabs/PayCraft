"use client"

import { usePlatformOwner, LoadingRows, LoadError } from "@/components/dashboard/account-queries"
import { PlatformKeysWizard } from "@/components/admin/platform-keys-wizard"

/** Platform-owner gate for the Stripe Connect platform keys (the first deployer self-claims, idempotently). */
export function PlatformKeysGate() {
  const ownerQuery = usePlatformOwner()
  if (ownerQuery.isPending) {
    return (
      <div className="max-w-2xl mx-auto pt-20">
        <LoadingRows label="Checking access…" rows={2} />
      </div>
    )
  }
  if (ownerQuery.isError) {
    return (
      <div className="max-w-2xl mx-auto pt-20">
        <LoadError what="your access" error={ownerQuery.error} onRetry={() => void ownerQuery.refetch()} />
      </div>
    )
  }
  if (!ownerQuery.data) {
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
