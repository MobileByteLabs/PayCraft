'use client'

import Link from "next/link"
import { useState } from "react"
import {
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  Copy,
  CreditCard,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

// Mock connected state — replace with real data fetch via server component or SWR
const MOCK_CONNECTION = {
  connected: true,
  accountId: "acct_1234...5678",
  lastSynced: "2 minutes ago",
}

export default function StripeConnectPage() {
  const [testMode, setTestMode] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText("acct_1234...5678")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="mb-8 pt-10">
        <nav className="flex items-center gap-2 text-xs font-medium text-ink-400 mb-2">
          <Link href="/settings" className="hover:text-ink-600 transition-colors">
            Settings
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/providers" className="hover:text-ink-600 transition-colors">
            Payment Providers
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink-900">Stripe</span>
        </nav>
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-extrabold tracking-tight text-ink-900">
            Stripe
          </h2>
          {MOCK_CONNECTION.connected ? (
            <Badge tone="success" dot>
              Connected
            </Badge>
          ) : (
            <Badge tone="warning">Not connected</Badge>
          )}
        </div>
      </div>

      {/* Dashboard grid */}
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Main: Connect / OAuth panel */}
        <div className="col-span-12 lg:col-span-8">
          <Card className="relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
            <CardBody className="p-10 text-center flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-ink-50 rounded-2xl flex items-center justify-center mb-6 border border-ink-100 shadow-sm">
                <CreditCard className="w-9 h-9 text-[#635BFF]" strokeWidth={1.5} />
              </div>
              <h3 className="text-2xl font-bold text-ink-900 mb-2">
                Connect your Stripe account
              </h3>
              <p className="text-ink-500 max-w-md mx-auto mb-8 leading-relaxed text-sm">
                Integrate Stripe to handle payments, subscriptions, and payouts.
                PayCraft will receive webhooks for subscription events via Stripe
                Connect automatically.
              </p>

              <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full justify-center shadow-lg shadow-brand-500/20"
                  leading={<CreditCard className="w-4 h-4" strokeWidth={2} />}
                >
                  Connect with Stripe
                </Button>

                {/* Test mode toggle */}
                <div className="flex items-center gap-3 px-4 py-3 bg-ink-50 rounded-lg border border-ink-100 w-full cursor-pointer hover:border-ink-200 transition-colors">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={testMode}
                      onChange={(e) => setTestMode(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-ink-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600" />
                  </label>
                  <span className="text-sm font-medium text-ink-600">
                    Use Stripe test mode (sk_test_...)
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Sidebar: current connection + pro-tip */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Current connection card */}
          <Card>
            <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between bg-ink-50/50">
              <span className="text-[11px] font-bold text-ink-500 uppercase tracking-widest">
                Current Connection
              </span>
              <CheckCircle2
                className="w-4 h-4 text-success-500"
                strokeWidth={0}
                style={{ fill: "currentColor" }}
              />
            </div>
            <CardBody className="p-5">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-ink-400 uppercase tracking-wider block mb-1">
                    Stripe Account ID
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-sm font-mono text-ink-700 bg-ink-100 px-2 py-0.5 rounded">
                      {MOCK_CONNECTION.accountId}
                    </code>
                    <button
                      onClick={handleCopy}
                      className="text-ink-400 hover:text-ink-900 transition-colors"
                    >
                      <Copy className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>
                  {copied && (
                    <p className="text-2xs text-success-600 mt-1">Copied!</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="text-ink-400">↻</span>
                  Last synced: {MOCK_CONNECTION.lastSynced}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 border border-danger-200 text-danger-500 hover:bg-danger-50 hover:text-danger-600"
                >
                  Disconnect Account
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Pro-tip card */}
          <div className="bg-ink-900 rounded-xl p-5 text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-ink-800 flex items-center justify-center">
                <span className="text-brand-400 text-lg">✦</span>
              </div>
              <h4 className="text-sm font-bold">Pro-tip: Test Mode</h4>
            </div>
            <p className="text-xs text-ink-400 leading-relaxed">
              Always test your checkout flows using test mode before going live.
              Use Stripe&apos;s card number{" "}
              <code className="bg-ink-800 text-ink-200 px-1 rounded">
                4242...4242
              </code>{" "}
              for successful payments.
            </p>
          </div>
        </div>

        {/* Setup guide */}
        <div className="col-span-12">
          <Card>
            <div className="px-8 py-6 border-b border-ink-100">
              <h3 className="text-lg font-bold text-ink-900">
                Stripe Connect Setup Guide
              </h3>
              <p className="text-sm text-ink-500">
                Follow these steps to ensure your billing infrastructure is
                correctly configured.
              </p>
            </div>
            <CardBody className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                {/* Step 1 */}
                <div className="relative">
                  <div className="absolute -left-1 top-0 text-4xl font-black text-ink-100 -z-0 select-none">
                    01
                  </div>
                  <div className="relative z-10 pt-2">
                    <h4 className="text-sm font-bold text-ink-900 mb-2">
                      Link account via OAuth
                    </h4>
                    <p className="text-xs text-ink-500 leading-relaxed mb-4">
                      Click the connect button above. Stripe will ask you to
                      authorize PayCraft Cloud to manage your subscription data.
                    </p>
                    <a
                      href="https://stripe.com/docs/connect/oauth-reference"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-brand-600 uppercase tracking-wider hover:underline flex items-center gap-1"
                    >
                      Learn more about OAuth{" "}
                      <ExternalLink className="w-3 h-3" strokeWidth={2} />
                    </a>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="relative">
                  <div className="absolute -left-1 top-0 text-4xl font-black text-ink-100 -z-0 select-none">
                    02
                  </div>
                  <div className="relative z-10 pt-2">
                    <h4 className="text-sm font-bold text-ink-900 mb-2">
                      Configure Webhooks
                    </h4>
                    <p className="text-xs text-ink-500 leading-relaxed mb-4">
                      For local development, use the Stripe CLI to forward
                      events to your local PayCraft instance.
                    </p>
                    <div className="bg-ink-950 rounded-lg p-3 relative group/code">
                      <code className="text-ink-300 text-[11px] block overflow-x-auto whitespace-nowrap pb-1">
                        stripe listen --forward-to localhost:8080/webhooks
                      </code>
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(
                            "stripe listen --forward-to localhost:8080/webhooks",
                          )
                        }
                        className="absolute right-2 top-2 text-ink-600 hover:text-white opacity-0 group-hover/code:opacity-100 transition-opacity"
                      >
                        <Copy className="w-3 h-3" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="relative">
                  <div className="absolute -left-1 top-0 text-4xl font-black text-ink-100 -z-0 select-none">
                    03
                  </div>
                  <div className="relative z-10 pt-2">
                    <h4 className="text-sm font-bold text-ink-900 mb-2">
                      Verify API Keys
                    </h4>
                    <p className="text-xs text-ink-500 leading-relaxed mb-4">
                      Ensure your Publishable and Secret keys are stored
                      securely in your environment variables as{" "}
                      <code className="bg-ink-100 text-ink-700 px-1 rounded">
                        STRIPE_PK
                      </code>{" "}
                      and{" "}
                      <code className="bg-ink-100 text-ink-700 px-1 rounded">
                        STRIPE_SK
                      </code>
                      .
                    </p>
                    <div className="flex gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-success-500" />
                      <div className="w-1.5 h-1.5 rounded-full bg-success-500" />
                      <div className="w-1.5 h-1.5 rounded-full bg-ink-200" />
                    </div>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
