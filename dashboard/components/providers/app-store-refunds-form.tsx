"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { REFUND_PREFERENCES } from "@/lib/appstore-refunds"

/**
 * Whether PayCraft answers Apple's refund requests (CONSUMPTION_REQUEST, migration 207) for this app. Apple only
 * accepts an answer when the customer consented to sharing consumption data, so the switch states that consent.
 */
export function AppStoreRefundsForm({ consent, refundPreference }: { consent: boolean; refundPreference: number }) {
  const [on, setOn] = useState(consent)
  const [pref, setPref] = useState(refundPreference)
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const queryClient = useQueryClient()

  async function save() {
    setState("saving")
    try {
      const res = await fetch("/api/appstore-refunds", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: on, refundPreference: pref }),
      })
      setState(res.ok ? "saved" : "error")
      if (res.ok) queryClient.invalidateQueries({ queryKey: ["providers"] })
    } catch {
      setState("error")
    }
  }

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-ink-900">Refund requests</h2>
        <p className="text-xs text-ink-500 mt-1 max-w-3xl">
          When a customer asks Apple for a refund, Apple gives you 12 hours to say whether the purchase was delivered
          and used. PayCraft can answer for you: delivered, how much of the subscription period was used, and how long
          they have been a customer. Unanswered, Apple decides on the customer&apos;s word alone.
        </p>
      </div>
      <label className="flex items-start gap-2 text-xs text-ink-800">
        <input type="checkbox" className="mt-0.5" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          Answer refund requests. <strong>Turn this on only if your privacy policy covers sharing this
          information with Apple</strong> — Apple requires the customer&apos;s consent.
        </span>
      </label>
      <fieldset disabled={!on} className="space-y-2 disabled:opacity-50">
        <legend className="text-xs font-bold text-ink-700 mb-1">Your refund preference</legend>
        {REFUND_PREFERENCES.map((p) => (
          <label key={p.value} className="flex items-start gap-2 text-xs text-ink-800">
            <input type="radio" name="refund-pref" className="mt-0.5" checked={pref === p.value} onChange={() => setPref(p.value)} />
            <span><strong>{p.label}</strong> — {p.hint}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="inline-flex items-center gap-1.5 text-xs font-bold bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          {state === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-xs text-emerald-700">Saved.</span>}
        {state === "error" && <span role="alert" className="text-xs text-red-700">Couldn&apos;t save — try again.</span>}
      </div>
    </div>
  )
}
