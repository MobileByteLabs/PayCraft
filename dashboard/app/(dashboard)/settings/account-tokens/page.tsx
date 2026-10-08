export const runtime = "edge"

import { ShieldAlert } from "lucide-react"
import { AccountTokensClient } from "@/components/settings/account-tokens-client"
import { requireTenant } from "@/lib/tenant"

export default async function AccountTokensPage() {
  // Gates the page on a real session before any token metadata is fetched.
  await requireTenant()

  return (
    <div className="max-w-[860px] mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900">Access tokens</h2>
        <p className="text-ink-500 mt-1 max-w-2xl">
          Account-level credentials for CI and agents that work across several apps — one token
          instead of one per app.
        </p>
      </div>

      {/*
        Three credential tiers exist and two of them share the `pcsk_` prefix, so the difference is
        stated before anything can be generated. The mistake to design against is granting account
        reach while believing you granted app reach.
      */}
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 flex gap-3">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed space-y-1">
          <p className="font-semibold">This is the widest-reaching credential PayCraft issues.</p>
          <p>
            A token here reaches <strong>every app you administer</strong>. For a credential scoped
            to one app, use{" "}
            <a href="/settings/developer-api" className="underline font-semibold">
              Developer API
            </a>{" "}
            instead — same <code className="font-mono">pcsk_</code> prefix, one app.
          </p>
          <p>
            Neither belongs in client code. The public{" "}
            <code className="font-mono">pk_</code> keys your app ships with live under{" "}
            <a href="/settings/api-keys" className="underline font-semibold">
              API keys
            </a>{" "}
            and are safe to commit; these are secrets.
          </p>
        </div>
      </div>

      <AccountTokensClient />
    </div>
  )
}
