"use client"

// PreviewIframe — loads the cmp-paycraft Kotlin/JS paywall preview bundle.
//
// Per sub-plan 01 of paycraft-paywall-v2-production-ui (AC#5): wired ON by
// default — points at the public preview deploy at
// `https://paywall-preview.paycraft.mobilebytesensei.com` (Cloudflare Pages
// project `paycraft-paywall-preview`, deployed by
// `.github/workflows/deploy-paywall-preview.yml`). The
// `NEXT_PUBLIC_PAYWALL_PREVIEW_URL` env var still works as a local-dev
// override (e.g. point at localhost:8080 when iterating on the bundle).
//
// The previous fallback to an inline React mockup in paywall-designer.tsx is
// removed in T4 — the iframe is now the only preview surface, so what the
// dashboard shows is exactly what cmp-paycraft renders on device (true-WYSIWYG).
//
// postMessage protocol (matches cmp-paycraft/preview-js/.../Preview.kt):
//   1. Iframe boots, calls window.parent.postMessage("paycraft-preview-ready", "*")
//   2. We send: JSON.stringify({ config: {…full PaywallConfig…}, stateName: "Free" })
//   3. Iframe re-renders. Repeat on every config/state change.
//
// Latency target (AC#5): warm-path re-render ≤ 500ms after every config edit.

import { useEffect, useRef, useState } from "react"
import { PaywallConfig } from "@/lib/types"

const DEFAULT_PREVIEW_URL = "https://paywall-preview.paycraft.mobilebytesensei.com"

export function PreviewIframe({
  config,
  state,
}: {
  config: PaywallConfig
  state: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  // Env-var override stays for local dev (e.g. localhost:8080). The default is
  // ALWAYS on — no env-var-gated fallback to a React mockup any more.
  const previewBase = process.env.NEXT_PUBLIC_PAYWALL_PREVIEW_URL ?? DEFAULT_PREVIEW_URL

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
    // Use targetOrigin = previewBase origin for the postMessage so a malicious
    // iframe can't intercept config payloads. Use "*" only if previewBase
    // doesn't parse as a URL (very unusual — defensive only).
    let targetOrigin = "*"
    try { targetOrigin = new URL(previewBase).origin } catch { /* keep "*" */ }
    win.postMessage(
      JSON.stringify({ config, stateName: state }),
      targetOrigin,
    )
  }, [config, state, ready, previewBase])

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
