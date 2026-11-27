import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Status — PayCraft",
  description: "Operational status of the PayCraft platform, SDK config API, and webhooks.",
}

const SYSTEMS = [
  { name: "Dashboard", note: "paycraft.mobilebytesensei.com" },
  { name: "SDK config API", note: "/functions/v1/config" },
  { name: "Provider webhooks", note: "Stripe · Razorpay · Play · App Store" },
  { name: "Realtime", note: "config & entitlement push" },
  { name: "Docs", note: "docs.paycraft.mobilebytesensei.com" },
]

export default function StatusPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-brand-600 font-semibold">Product</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink-900">System status</h1>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span className="text-sm font-medium text-emerald-800">All systems operational</span>
      </div>

      <ul className="mt-8 divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white">
        {SYSTEMS.map((s) => (
          <li key={s.name} className="flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-sm font-medium text-ink-900">{s.name}</div>
              <div className="text-xs text-ink-400">{s.note}</div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Operational
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-ink-500">
        Seeing an issue? Email{" "}
        <a href="mailto:support@paycraft.mobilebytesensei.com" className="text-brand-600 underline">
          support@paycraft.mobilebytesensei.com
        </a>
        .
      </p>
    </main>
  )
}
