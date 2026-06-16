"use client"

// PreviewIframe — loads the Kotlin/JS paywall preview bundle when
// NEXT_PUBLIC_PAYWALL_PREVIEW_URL is configured (AC-33b WYSIWYG path).
//
// When that env var is unset (local dev, preview deployments without the
// bundle deployed), the dashboard's existing inline tsx preview in
// paywall-designer.tsx remains the fallback — see <PaywallPreview> there.
//
// postMessage protocol (matches cmp-paycraft/preview-js/.../Preview.kt):
//   1. Iframe boots, calls window.parent.postMessage("paycraft-preview-ready", "*")
//   2. We send: JSON.stringify({ config: {…}, stateName: "Free" })
//   3. Iframe re-renders. Repeat on every config/state change.

import { useEffect, useRef, useState } from "react"

interface Cfg {
  tenant_id: string
  template: string
  primary_color: string | null
  font_family: string | null
  branding: "attribution" | "none" | "custom"
  custom_footer: string | null
  support_email: string | null
}

export function PreviewIframe({
  config,
  state,
}: {
  config: Cfg
  state: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const previewBase = process.env.NEXT_PUBLIC_PAYWALL_PREVIEW_URL

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === "paycraft-preview-ready") setReady(true)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  useEffect(() => {
    if (!ready) return
    const win = ref.current?.contentWindow
    if (!win) return
    win.postMessage(
      JSON.stringify({ config, stateName: state }),
      "*",
    )
  }, [config, state, ready])

  if (!previewBase) {
    return (
      <div className="w-full h-[600px] flex items-center justify-center text-xs text-ink-500 bg-ink-50 rounded-2xl border border-dashed border-ink-300">
        Configure NEXT_PUBLIC_PAYWALL_PREVIEW_URL to load the Kotlin/JS preview bundle.
      </div>
    )
  }

  const src = `${previewBase}/paywall/preview/${config.tenant_id}`
  return (
    <iframe
      ref={ref}
      src={src}
      title="PayCraft paywall preview"
      className="w-full h-[600px] border-0 rounded-2xl bg-white"
      sandbox="allow-scripts allow-same-origin"
    />
  )
}
