"use client"

import { useState } from "react"
import { Sparkles, X } from "lucide-react"
import { AiChat } from "@/components/ai-chat"

/**
 * Persistent PayCraft AI entry point — a floating bubble (bottom-right) on every dashboard
 * page that opens a slide-over chat panel. Shares the AiChat component + deterministic
 * /api/ai/ask endpoint with the full /ai page.
 */
export function AiBubble() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open PayCraft AI"
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside className="fixed bottom-0 right-0 z-50 flex h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl border bg-white shadow-2xl sm:bottom-6 sm:right-6 sm:h-[600px] sm:w-[400px] sm:rounded-2xl">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <span className="font-semibold">PayCraft AI</span>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1">
              <AiChat />
            </div>
          </aside>
        </>
      )}
    </>
  )
}
