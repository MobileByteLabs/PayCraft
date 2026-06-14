"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronDown, Check, Plus } from "lucide-react"

interface App {
  id: string
  name: string
  plan: string
}

export function AppSwitcher({
  apps,
  activeId,
}: {
  apps: App[]
  activeId: string
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const ref = useRef<HTMLDivElement>(null)
  const active = apps.find((a) => a.id === activeId) ?? apps[0]

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  async function switchApp(id: string) {
    await fetch("/api/apps/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: id }),
    })
    setOpen(false)
    router.refresh()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-ink-700 hover:bg-ink-100 transition-colors"
      >
        <span className="w-5 h-5 rounded bg-brand-600 flex items-center justify-center text-white text-[9px] font-black uppercase">
          {active?.name?.[0] ?? "A"}
        </span>
        <span className="max-w-[120px] truncate">{active?.name ?? "Select app"}</span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-xl border border-ink-200 shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-ink-100">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              Your apps
            </p>
          </div>
          <ul className="py-1">
            {apps.map((app) => (
              <li key={app.id}>
                <button
                  onClick={() => switchApp(app.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 transition-colors"
                >
                  <span className="w-5 h-5 rounded bg-ink-200 flex items-center justify-center text-ink-600 text-[9px] font-black uppercase flex-shrink-0">
                    {app.name[0]}
                  </span>
                  <span className="flex-1 text-left truncate">{app.name}</span>
                  {app.id === activeId && (
                    <Check className="w-3.5 h-3.5 text-brand-600 flex-shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-100 py-1">
            <Link
              href="/apps/new"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-brand-600 hover:bg-brand-50 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Add new app
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
