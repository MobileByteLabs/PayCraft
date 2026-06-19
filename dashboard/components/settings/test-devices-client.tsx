"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Smartphone } from "lucide-react"
import type { TestDeviceRow } from "@/app/(dashboard)/settings/test-devices/page"

const DEVICE_ID_PATTERN = /^[0-9a-f]{16}$/i

export function TestDevicesClient({
  initialDevices,
}: {
  initialDevices: TestDeviceRow[]
}) {
  const [devices, setDevices] = useState<TestDeviceRow[]>(initialDevices)
  const [deviceId, setDeviceId] = useState("")
  const [label, setLabel] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const trimmedDeviceId = deviceId.trim().toLowerCase()
  const canSubmit =
    DEVICE_ID_PATTERN.test(trimmedDeviceId) &&
    !devices.some((d) => d.device_id === trimmedDeviceId)

  async function register(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    try {
      const res = await fetch("/api/test-devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_id: trimmedDeviceId,
          label: label.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "register failed")
      }
      const row: TestDeviceRow = await res.json()
      setDevices([row, ...devices])
      setDeviceId("")
      setLabel("")
      startTransition(() => router.refresh())
    } catch (e: any) {
      setError(String(e.message ?? e))
    }
  }

  async function revoke(id: string) {
    setError(null)
    try {
      const res = await fetch(`/api/test-devices/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "revoke failed")
      }
      setDevices(devices.filter((d) => d.id !== id))
      startTransition(() => router.refresh())
    } catch (e: any) {
      setError(String(e.message ?? e))
    }
  }

  return (
    <div className="space-y-6">
      {/* Register form */}
      <form
        onSubmit={register}
        className="bg-white border border-ink-200 rounded-lg p-5 space-y-4 shadow-sm"
      >
        <h3 className="text-sm font-semibold text-ink-900">
          Register a new device
        </h3>
        <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">
              Device ID (16-char hex)
            </label>
            <input
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="a1b2c3d4e5f60718"
              maxLength={16}
              className="w-full font-mono text-sm border border-ink-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">
              Label (optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="OnePlus dev"
              maxLength={120}
              className="w-full text-sm border border-ink-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            type="submit"
            disabled={!canSubmit || pending}
            className="rounded bg-brand-600 text-white px-5 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {pending ? "Saving…" : "Register device"}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}
        {deviceId && !DEVICE_ID_PATTERN.test(trimmedDeviceId) && (
          <p className="text-xs text-amber-700">
            Device ID must be exactly 16 hexadecimal characters (the value
            logged at <code>PayCraft: [initialize] device_id = …</code>).
          </p>
        )}
      </form>

      {/* Registered devices list */}
      <div>
        <h3 className="text-sm font-semibold text-ink-900 mb-3">
          Registered devices ({devices.length})
        </h3>
        {devices.length === 0 ? (
          <div className="bg-ink-50 border border-dashed border-ink-300 rounded-lg p-8 text-center">
            <Smartphone className="w-8 h-8 text-ink-400 mx-auto mb-2" />
            <p className="text-sm text-ink-500">
              No devices registered yet. Test-only products are hidden from
              every device until you register at least one.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between p-4 bg-white border border-ink-200 rounded-lg shadow-sm"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <Smartphone className="w-5 h-5 text-ink-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <code className="font-mono text-xs text-ink-900 block truncate">
                      {d.device_id}
                    </code>
                    <p className="text-xs text-ink-500 mt-0.5 truncate">
                      {d.label ?? "—"} · registered{" "}
                      {new Date(d.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(d.id)}
                  disabled={pending}
                  className="rounded text-ink-500 hover:text-red-600 hover:bg-red-50 p-2 disabled:opacity-50"
                  aria-label={`Revoke ${d.device_id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
