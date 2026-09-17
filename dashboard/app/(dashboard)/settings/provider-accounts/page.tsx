export const runtime = "edge"

import Link from "next/link"
import { ArrowLeft, Info } from "lucide-react"
import { ProviderConnectionsManager } from "@/components/providers/provider-connections-manager"

/**
 * Provider connections — ACCOUNT level.
 *
 * Credentials belong to the operator, not to an app: one Play console, one Stripe account, many
 * apps. Managing them from inside a single app's provider page made that backwards — the list you
 * saw depended on which app you had open, and rotating a key looked like a local edit when it was
 * really a change to every app sharing that connection.
 *
 * The per-app provider pages keep the part that IS per-app: choosing which connection this app
 * bills through. Choosing is app-scoped; owning is not.
 */
export default function ProviderAccountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to settings
        </Link>
        <h1 className="text-2xl font-bold text-ink-900">Provider connections</h1>
        <p className="text-sm text-ink-500 mt-1 max-w-3xl">
          The payment and store accounts your apps bill through. A connection holds one set of
          credentials and can serve any number of apps — connect a Play console or a Stripe account
          once here, and every app can use it without pasting the key again.
        </p>
      </div>

      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-xs text-brand-900">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong>One default per provider.</strong> An app that has not been pointed at a specific
            connection inherits the default, so a newly created app bills correctly without being
            configured. An app that already has its own credentials keeps them — a default never
            takes over an app that is already set up.{" "}
            <Link href="/providers" className="underline font-bold">
              Choose per-app connections
            </Link>{" "}
            from each provider&rsquo;s page.
          </div>
        </div>
      </div>

      <ProviderConnectionsManager />
    </div>
  )
}
