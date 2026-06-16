"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { SUPPORTED_COUNTRIES } from "@/lib/provider-recommendations"

interface RegistryRow {
  method: string
  display_name: string
  provider: string
  fee_percent: number
  supports_one_time: boolean
  supports_subscription: boolean
  supported_countries: string[]
  supported_currencies: string[]
}

interface Rule {
  id: string
  country_code: string | null
  currency: string | null
  product_type: string | null
  priority_methods: string[]
  priority: number
}

const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "CAD",
  "AUD",
  "JPY",
  "BRL",
  "MXN",
]

/**
 * Routing rules CRUD UI. Three columns of work:
 *
 *   1. Existing rules list — table with edit-priority arrows + delete.
 *   2. "Add rule" form — match criteria + ordered method list (drag-style
 *      reorder buttons).
 *   3. Live preview — show which methods would be picked for a
 *      hypothetical customer (country picker → see resolved route).
 *
 * Drag-and-drop reorder uses click-up / click-down buttons rather than
 * HTML5 DnD for accessibility + simplicity (works on mobile, screen
 * readers, no library dep).
 */
export function RoutingRulesEditor({
  initialRules,
  registry,
  connectedMethods,
  connectedProviders,
}: {
  initialRules: Rule[]
  registry: RegistryRow[]
  connectedMethods: string[]
  connectedProviders: string[]
}) {
  const router = useRouter()
  const [rules, setRules] = useState<Rule[]>(initialRules)

  // List of method names available for routing: registry rows whose
  // method/provider this tenant has connected. Cards for non-connected
  // methods can still be added (greyed out) — useful when planning ahead.
  const eligibleMethods = registry.filter((r) => {
    if (r.method === "direct_upi") return connectedMethods.includes("direct_upi")
    if (r.method.startsWith("stripe_"))
      return connectedProviders.includes("stripe")
    if (r.method.startsWith("razorpay_"))
      return connectedProviders.includes("razorpay")
    if (r.method.startsWith("cashfree_"))
      return connectedProviders.includes("cashfree")
    return false
  })

  return (
    <div className="space-y-6">
      <RulesList rules={rules} registry={registry} onChange={setRules} router={router} />
      <NewRuleForm
        eligibleMethods={eligibleMethods}
        registry={registry}
        onAdded={(rule) => {
          setRules([...rules, rule])
          router.refresh()
        }}
      />
    </div>
  )
}

function RulesList({
  rules,
  registry,
  onChange,
  router,
}: {
  rules: Rule[]
  registry: RegistryRow[]
  onChange: (r: Rule[]) => void
  router: ReturnType<typeof useRouter>
}) {
  if (rules.length === 0) {
    return (
      <div className="bg-white border border-ink-200 rounded-xl p-8 text-center">
        <p className="text-sm text-ink-500">
          No routing rules yet. The router uses the default cheapest-method
          policy below.
        </p>
      </div>
    )
  }

  async function deleteRule(id: string) {
    if (!confirm("Delete this routing rule?")) return
    const res = await fetch(`/api/routing-rules/${id}`, { method: "DELETE" })
    if (res.ok) {
      onChange(rules.filter((r) => r.id !== id))
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      alert(`Delete failed: ${data?.error ?? res.statusText}`)
    }
  }

  return (
    <div className="bg-white border border-ink-200 rounded-xl overflow-hidden">
      <div className="bg-ink-50/50 border-b border-ink-200 px-5 py-3">
        <h3 className="text-xs font-bold text-ink-700 uppercase tracking-wider">
          Active rules — tried in priority order
        </h3>
      </div>
      <table className="w-full">
        <thead className="bg-ink-50/30 border-b border-ink-100">
          <tr>
            <Th>Priority</Th>
            <Th>Country</Th>
            <Th>Currency</Th>
            <Th>Product type</Th>
            <Th>Method order</Th>
            <Th right>—</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rules.map((r) => (
            <tr key={r.id}>
              <Td>
                <span className="font-mono text-[11px] text-ink-500">
                  {r.priority}
                </span>
              </Td>
              <Td>{r.country_code ?? <span className="text-ink-400">Any</span>}</Td>
              <Td>{r.currency ?? <span className="text-ink-400">Any</span>}</Td>
              <Td>
                {r.product_type ?? <span className="text-ink-400">Any</span>}
              </Td>
              <Td>
                <div className="flex items-center gap-1 flex-wrap">
                  {r.priority_methods.map((m, i) => {
                    const reg = registry.find((x) => x.method === m)
                    return (
                      <span
                        key={`${r.id}-${m}-${i}`}
                        className="inline-flex items-center gap-1 text-[10px] font-mono bg-ink-100 text-ink-700 px-1.5 py-0.5 rounded"
                        title={reg?.display_name ?? m}
                      >
                        {i + 1}. {m}
                      </span>
                    )
                  })}
                </div>
              </Td>
              <Td right>
                <button
                  onClick={() => deleteRule(r.id)}
                  className="text-ink-400 hover:text-danger-600 p-1"
                  aria-label="Delete rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NewRuleForm({
  eligibleMethods,
  registry,
  onAdded,
}: {
  eligibleMethods: RegistryRow[]
  registry: RegistryRow[]
  onAdded: (rule: Rule) => void
}) {
  const [country, setCountry] = useState("")
  const [currency, setCurrency] = useState("")
  const [productType, setProductType] = useState("")
  const [priorityMethods, setPriorityMethods] = useState<string[]>([])
  const [priority, setPriority] = useState(100)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  function addMethod(method: string) {
    if (priorityMethods.includes(method)) return
    setPriorityMethods([...priorityMethods, method])
  }

  function removeMethod(method: string) {
    setPriorityMethods(priorityMethods.filter((m) => m !== method))
  }

  function moveUp(i: number) {
    if (i === 0) return
    const copy = [...priorityMethods]
    ;[copy[i - 1], copy[i]] = [copy[i], copy[i - 1]]
    setPriorityMethods(copy)
  }

  function moveDown(i: number) {
    if (i === priorityMethods.length - 1) return
    const copy = [...priorityMethods]
    ;[copy[i + 1], copy[i]] = [copy[i], copy[i + 1]]
    setPriorityMethods(copy)
  }

  async function submit() {
    if (priorityMethods.length === 0) {
      setError("Add at least one method to the priority list")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/routing-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          country_code: country || null,
          currency: currency || null,
          product_type: productType || null,
          priority_methods: priorityMethods,
          priority,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      onAdded({
        id: data.id,
        country_code: country || null,
        currency: currency || null,
        product_type: productType || null,
        priority_methods: priorityMethods,
        priority,
      })
      // Reset.
      setCountry("")
      setCurrency("")
      setProductType("")
      setPriorityMethods([])
      setPriority(100)
      setExpanded(false)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800"
      >
        <Plus className="w-3.5 h-3.5" />
        Add routing rule
      </button>
    )
  }

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink-900">Add routing rule</h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-ink-400 hover:text-ink-700"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Select
          label="Country"
          value={country}
          onChange={setCountry}
          placeholder="Any"
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.name} ({c.code})
            </option>
          ))}
        </Select>
        <Select
          label="Currency"
          value={currency}
          onChange={setCurrency}
          placeholder="Any"
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          label="Product type"
          value={productType}
          onChange={setProductType}
          placeholder="Any"
        >
          <option value="subscription">Subscription</option>
          <option value="trial">Trial</option>
          <option value="lifetime">Lifetime</option>
        </Select>
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
            Priority
          </label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 100)}
            className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
          />
          <p className="text-[10px] text-ink-400">Lower = tried first</p>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-bold text-ink-700 uppercase tracking-wider mb-2">
          Method order — top method tried first
        </h4>
        {priorityMethods.length === 0 ? (
          <p className="text-[11px] text-ink-400 italic mb-2">
            No methods selected yet. Pick from the list below.
          </p>
        ) : (
          <div className="space-y-1.5 mb-3">
            {priorityMethods.map((m, i) => {
              const reg = registry.find((x) => x.method === m)
              return (
                <div
                  key={m}
                  className="flex items-center gap-2 px-2 py-1.5 bg-ink-50 border border-ink-200 rounded"
                >
                  <GripVertical className="w-3.5 h-3.5 text-ink-300" />
                  <span className="text-[11px] font-bold text-ink-500 w-4">
                    {i + 1}.
                  </span>
                  <span className="text-xs font-bold text-ink-900 flex-1">
                    {reg?.display_name ?? m}
                  </span>
                  <span className="text-[10px] text-ink-400">
                    {reg?.fee_percent.toFixed(1)}%
                  </span>
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="text-ink-400 hover:text-ink-700 disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i === priorityMethods.length - 1}
                    className="text-ink-400 hover:text-ink-700 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeMethod(m)}
                    className="text-ink-400 hover:text-danger-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div>
          <div className="text-[11px] text-ink-500 mb-1.5">
            Available methods (click to add):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {eligibleMethods.map((m) => {
              const isAdded = priorityMethods.includes(m.method)
              return (
                <button
                  key={m.method}
                  type="button"
                  onClick={() => addMethod(m.method)}
                  disabled={isAdded}
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded border transition-colors ${
                    isAdded
                      ? "bg-ink-100 text-ink-400 border-ink-200 cursor-not-allowed"
                      : "bg-white text-ink-700 border-ink-200 hover:bg-brand-50 hover:border-brand-200"
                  }`}
                >
                  {!isAdded && <Plus className="w-3 h-3" />}
                  {m.display_name}
                  <span className="text-[10px] text-ink-400">
                    · {m.fee_percent.toFixed(1)}%
                  </span>
                </button>
              )
            })}
            {eligibleMethods.length === 0 && (
              <span className="text-[11px] text-ink-400 italic">
                No connected methods. Connect at least one provider at{" "}
                <a href="/providers" className="underline">
                  /providers
                </a>{" "}
                first.
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="text-xs text-danger-700 font-mono bg-danger-50 border border-danger-200 px-3 py-2 rounded">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100">
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-ink-600 hover:text-ink-800 font-bold px-3 py-2"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || priorityMethods.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save rule"
          )}
        </button>
      </div>
    </div>
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
      className={`px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-ink-400 ${
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
    <td className={`px-5 py-3 text-xs text-ink-800 ${right ? "text-right" : ""}`}>
      {children}
    </td>
  )
}

function Select({
  label,
  value,
  onChange,
  placeholder,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
    </div>
  )
}
