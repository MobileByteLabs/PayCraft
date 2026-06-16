"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="p-2 text-ink-400 hover:text-ink-900 transition-colors flex-shrink-0"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-4 h-4 text-success-600" />
      ) : (
        <Copy className="w-4 h-4" />
      )}
    </button>
  )
}
