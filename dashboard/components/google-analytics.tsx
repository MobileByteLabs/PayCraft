// dashboard/components/google-analytics.tsx
//
// GA4 gtag.js loader + init. Renders nothing when NEXT_PUBLIC_GA_ID is unset,
// so local / unconfigured environments stay clean. The measurement id is
// public (not a secret) and is inlined at build time.

import Script from "next/script"
import { GA_ID } from "@/lib/analytics"

export function GoogleAnalytics() {
  if (!GA_ID) return null
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  )
}
