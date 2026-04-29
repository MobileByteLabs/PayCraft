"use client"

import { useState } from "react"

interface AlertPrefs {
  welcome: boolean
  limit_warn: boolean
  limit_hit: boolean
  webhook_fail: boolean
  sub_expiry: boolean
}

export function AlertPreferences({
  tenantId,
  initial,
}: {
  tenantId: string
  initial: AlertPrefs | null
}) {
  const [prefs, setPrefs] = useState<AlertPrefs>(
    initial || {
      welcome: true,
      limit_warn: true,
      limit_hit: true,
      webhook_fail: true,
      sub_expiry: true,
    }
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaved(false)

    const res = await fetch("/api/alert-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, ...prefs }),
    })

    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const toggles: { key: keyof AlertPrefs; label: string; desc: string }[] = [
    { key: "welcome", label: "Welcome email", desc: "Sent when your account is created" },
    { key: "limit_warn", label: "Limit warning", desc: "At 80% of subscriber limit" },
    { key: "limit_hit", label: "Limit reached", desc: "When subscriber limit is hit" },
    { key: "webhook_fail", label: "Webhook failures", desc: "After 5+ consecutive failures" },
    { key: "sub_expiry", label: "Subscription expiry", desc: "7 days before plan expires" },
  ]

  return (
    <div className="space-y-4">
      {toggles.map(({ key, label, desc }) => (
        <label key={key} className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={prefs[key]}
            onChange={() => setPrefs((p) => ({ ...p, [key]: !p[key] }))}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <div>
            <p className="text-sm font-medium text-gray-900">{label}</p>
            <p className="text-xs text-gray-500">{desc}</p>
          </div>
        </label>
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save Preferences"}
      </button>
    </div>
  )
}
