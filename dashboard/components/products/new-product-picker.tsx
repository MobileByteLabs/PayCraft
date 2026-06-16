"use client"

import { useState } from "react"
import { Layers, Settings2, Zap } from "lucide-react"
import { ProductFormShell } from "@/components/products/product-form-shell"
import { QuickSetupForm } from "@/components/products/quick-setup-form"

type Mode = "quick" | "manual"

export function NewProductPicker({
  initial,
  subscriptions,
  defaultMode,
}: {
  initial: any
  subscriptions: any[]
  defaultMode: Mode
}) {
  const [mode, setMode] = useState<Mode>(defaultMode)

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Mode chooser pill */}
      <div className="bg-white border-b border-ink-200 px-8 py-3 flex items-center justify-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-1">
          <button
            onClick={() => setMode("quick")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              mode === "quick"
                ? "bg-white text-ink-900 shadow-sm border border-ink-200"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <Zap className="w-4 h-4" />
            Quick setup
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-bold tracking-wide ${
                mode === "quick" ? "bg-brand-100 text-brand-700" : "bg-ink-200 text-ink-500"
              }`}
            >
              RECOMMENDED
            </span>
          </button>
          <button
            onClick={() => setMode("manual")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              mode === "manual"
                ? "bg-white text-ink-900 shadow-sm border border-ink-200"
                : "text-ink-500 hover:text-ink-700"
            }`}
          >
            <Settings2 className="w-4 h-4" />
            Manual
          </button>
        </div>
        <div className="text-xs text-ink-500 ml-4 hidden md:block">
          {mode === "quick" ? (
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" /> Batch-create monthly · quarterly · annual · lifetime in one go.
            </span>
          ) : (
            <span>Full control over a single product (features, preview, custom pricing rows).</span>
          )}
        </div>
      </div>

      {mode === "quick" ? (
        <QuickSetupForm />
      ) : (
        <ProductFormShell initial={initial} subscriptions={subscriptions} />
      )}
    </div>
  )
}
