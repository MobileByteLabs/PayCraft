"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  X,
} from "lucide-react"

interface UpiIntent {
  id: string
  product_id: string
  product_sku: string
  product_display_name: string
  reference: string
  vpa: string
  vpa_display_name: string | null
  amount_paise: number
  currency: string
  customer_email: string | null
  customer_name: string | null
  status: "pending" | "paid" | "abandoned" | "expired"
  subscription_id: string | null
  bank_transaction_id: string | null
  created_at: string
  paid_at: string | null
  expires_at: string
  is_expired: boolean
}

type Status = "pending" | "paid" | "abandoned"

/**
 * Reconciliation table — one row per UPI intent. For pending intents
 * surfaces "Mark paid" + "Abandon" actions. For paid/abandoned, read-only
 * with subscription_id deep-link.
 *
 * "Mark paid" pops an inline form for the operator to enter the customer
 * email (required for sub keying), the bank UTR (optional but
 * recommended), and any notes. We never auto-fill the email — the
 * operator's bank notification doesn't include it, so they need to type
 * it from the customer's order context.
 */
export function UpiIntentsList({
  intents,
  status,
}: {
  intents: UpiIntent[]
  status: Status
}) {
  return (
    <div className="bg-white border border-ink-200 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead className="bg-ink-50/50 border-b border-ink-200">
          <tr>
            <Th>Reference</Th>
            <Th>Product</Th>
            <Th right>Amount</Th>
            <Th>Customer</Th>
            <Th>Created</Th>
            <Th right>—</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {intents.map((i) => (
            <Row key={i.id} intent={i} status={status} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ intent, status }: { intent: UpiIntent; status: Status }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState(intent.customer_email ?? "")
  const [bankTxn, setBankTxn] = useState("")
  const [notes, setNotes] = useState("")
  const [pending, setPending] = useState<"none" | "mark" | "abandon">("none")
  const [error, setError] = useState<string | null>(null)
  const [refCopied, setRefCopied] = useState(false)

  async function markPaid() {
    if (!email) {
      setError("customer email required — the subscription is keyed on email")
      return
    }
    setPending("mark")
    setError(null)
    try {
      const res = await fetch(`/api/upi-intents/${intent.id}/mark-paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_email: email,
          bank_transaction_id: bankTxn || null,
          notes: notes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "mark-paid failed")
        return
      }
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setPending("none")
    }
  }

  async function abandon() {
    if (!confirm(`Abandon intent ${intent.reference}? Customer can still pay; this just clears the row from your pending queue.`)) {
      return
    }
    setPending("abandon")
    try {
      const res = await fetch(`/api/upi-intents/${intent.id}/abandon`, {
        method: "POST",
      })
      if (res.ok) router.refresh()
    } finally {
      setPending("none")
    }
  }

  const amount = `₹${(intent.amount_paise / 100).toFixed(2)}`
  const created = new Date(intent.created_at).toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
  })

  return (
    <>
      <tr className="hover:bg-ink-50/40">
        <Td>
          <div className="flex items-center gap-1.5">
            <code className="font-mono text-[11px] bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded">
              {intent.reference}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(intent.reference)
                setRefCopied(true)
                setTimeout(() => setRefCopied(false), 1500)
              }}
              className="text-ink-400 hover:text-ink-700"
              title="Copy reference"
            >
              {refCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
            {intent.is_expired && (
              <span className="text-[10px] font-bold uppercase tracking-tighter bg-warning-100 text-warning-700 px-1.5 py-0.5 rounded">
                Expired
              </span>
            )}
          </div>
        </Td>
        <Td>
          <div className="text-xs font-semibold text-ink-900">
            {intent.product_display_name}
          </div>
          <div className="text-[10px] font-mono text-ink-500">
            {intent.product_sku}
          </div>
        </Td>
        <Td right>
          <span className="text-sm font-bold text-ink-900 tabular-nums">{amount}</span>
        </Td>
        <Td>
          {intent.customer_email ?? (
            <span className="text-ink-400 italic text-[11px]">unknown</span>
          )}
        </Td>
        <Td>
          <span className="text-[11px] text-ink-500">{created}</span>
        </Td>
        <Td right>
          {status === "pending" ? (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={abandon}
                disabled={pending !== "none"}
                className="text-ink-400 hover:text-danger-600 p-1"
                title="Abandon"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setExpanded((v) => !v)}
                disabled={pending !== "none"}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700"
              >
                {expanded ? "Cancel" : "Mark paid"}
              </button>
            </div>
          ) : intent.subscription_id ? (
            <span className="text-[10px] text-emerald-700 font-bold inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Sub created
            </span>
          ) : (
            <span className="text-[10px] text-ink-400">—</span>
          )}
        </Td>
      </tr>
      {expanded && status === "pending" && (
        <tr className="bg-emerald-50/40 border-b border-emerald-200">
          <td colSpan={6} className="p-4">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <Field label="Customer email *">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="customer@example.com"
                  className="w-full px-3 py-2 bg-white border border-ink-200 rounded text-sm focus:outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Bank UTR (optional)">
                <input
                  type="text"
                  value={bankTxn}
                  onChange={(e) => setBankTxn(e.target.value)}
                  placeholder="UTR / txn id from bank SMS"
                  className="w-full px-3 py-2 bg-white border border-ink-200 rounded text-sm focus:outline-none focus:border-emerald-500"
                />
              </Field>
              <Field label="Notes (optional)">
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="any context"
                  className="w-full px-3 py-2 bg-white border border-ink-200 rounded text-sm focus:outline-none focus:border-emerald-500"
                />
              </Field>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-ink-600 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Look for{" "}
                <code className="font-mono bg-white px-1 rounded">{intent.reference}</code>{" "}
                in your bank SMS / UPI app for confirmation.
              </div>
              <div className="flex items-center gap-3">
                {error && (
                  <span className="text-[11px] text-danger-700 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {error}
                  </span>
                )}
                <button
                  onClick={markPaid}
                  disabled={pending !== "none" || !email}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60"
                >
                  {pending === "mark" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Marking…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Confirm payment + activate subscription
                    </>
                  )}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode
  right?: boolean
}) {
  return (
    <th
      className={`px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-400 ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  right,
}: {
  children: React.ReactNode
  right?: boolean
}) {
  return (
    <td className={`px-4 py-3 text-xs text-ink-800 ${right ? "text-right" : ""}`}>
      {children}
    </td>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-wider text-ink-500 block">
        {label}
      </label>
      {children}
    </div>
  )
}
