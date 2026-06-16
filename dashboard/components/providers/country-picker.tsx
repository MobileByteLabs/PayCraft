"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Eye, Globe, Loader2 } from "lucide-react"
import { SUPPORTED_COUNTRIES } from "@/lib/provider-recommendations"

/**
 * Compact country picker shown at the top of /providers. Two modes:
 *
 *   MODE = "set"      — when the merchant hasn't picked yet OR explicitly
 *                       changes their primary country. Updates
 *                       `tenants.country_code` and reloads the page so the
 *                       new recommendations take effect.
 *
 *   MODE = "preview"  — when the merchant wants to peek at "what would my
 *                       US customers see?" without changing the saved
 *                       country. Updates a `?preview=US` URL param; the
 *                       page reads this and uses it instead of the saved
 *                       country for that render only.
 *
 * We deliberately don't auto-detect via IP — false positives ("I'm
 * traveling, why does it think I'm in Germany?") create more confusion
 * than the small onboarding cost of explicit selection.
 */
export function CountryPicker({
  savedCountry,
  activeCountry,
  isPreview,
}: {
  savedCountry: string | null
  activeCountry: string | null  // saved OR preview
  isPreview: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeRow = SUPPORTED_COUNTRIES.find((c) => c.code === activeCountry)

  async function setSavedCountry(code: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/tenant/country", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country_code: code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "save failed")
        return
      }
      setOpen(false)
      // Drop any preview= param when explicitly setting a real country.
      router.push("/providers")
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  function previewCountry(code: string) {
    setOpen(false)
    router.push(`/providers?preview=${code}`)
  }

  function exitPreview() {
    router.push("/providers")
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
          isPreview
            ? "bg-warning-50 border-warning-200 text-warning-800 hover:bg-warning-100"
            : "bg-white border-ink-200 text-ink-700 hover:bg-ink-50"
        }`}
      >
        {isPreview ? (
          <Eye className="w-3.5 h-3.5" />
        ) : (
          <Globe className="w-3.5 h-3.5" />
        )}
        {activeRow ? (
          <>
            <span className="text-base leading-none">{activeRow.flag}</span>
            <span>{activeRow.name}</span>
          </>
        ) : (
          <span>Pick your country</span>
        )}
        {isPreview && <span className="text-[10px] uppercase">Preview</span>}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {isPreview && (
        <button
          onClick={exitPreview}
          className="ml-2 text-[11px] font-bold text-ink-500 underline hover:text-ink-700"
        >
          Exit preview
        </button>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-1 w-72 bg-white border border-ink-200 rounded-lg shadow-lg z-20 py-2">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400 border-b border-ink-100">
              Your primary market
            </div>
            <div className="max-h-64 overflow-y-auto">
              {SUPPORTED_COUNTRIES.map((c) => (
                <div
                  key={c.code}
                  className="flex items-center justify-between px-3 py-1.5 hover:bg-ink-50"
                >
                  <button
                    type="button"
                    onClick={() => setSavedCountry(c.code)}
                    disabled={saving}
                    className="flex items-center gap-2 text-left flex-1 text-xs text-ink-700 disabled:opacity-50"
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span>{c.name}</span>
                    {savedCountry === c.code && (
                      <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded ml-auto">
                        Active
                      </span>
                    )}
                  </button>
                  {savedCountry !== c.code && (
                    <button
                      onClick={() => previewCountry(c.code)}
                      title="Preview what merchants in this country see"
                      className="ml-2 text-[10px] font-bold text-ink-400 hover:text-ink-700 px-1.5"
                    >
                      Preview
                    </button>
                  )}
                </div>
              ))}
            </div>
            {saving && (
              <div className="px-3 py-2 text-[11px] text-ink-500 flex items-center gap-1.5 border-t border-ink-100">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving…
              </div>
            )}
            {error && (
              <div className="px-3 py-2 text-[11px] text-danger-700 border-t border-ink-100">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
