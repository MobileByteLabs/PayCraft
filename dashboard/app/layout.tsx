export const runtime = "edge"

import type { Metadata } from "next"
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google"
import "./globals.css"
import { GoogleAnalytics } from "@/components/google-analytics"

// IBM Plex, not Inter. The docs site was type-set deliberately in Plex and the dashboard never
// joined it, so the two halves of the same product read as different products. Plex was
// commissioned for technical documentation: neutral at text sizes, with enough character at 600
// to hold a heading. In a product asking developers to trust it with money, the type should
// recede and let the content carry the authority. One superfamily for prose, UI and code means
// they feel like one system rather than three fonts negotiating.
// Decision recorded in idea-layer/design-system/DESIGN.md.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
})
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "PayCraft Dashboard",
  description: "Manage your PayCraft billing: subscribers, analytics, webhooks",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-sans">{children}</body>
      <GoogleAnalytics />
    </html>
  )
}