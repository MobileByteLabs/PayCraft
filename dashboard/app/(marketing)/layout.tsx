import Link from "next/link"
import { Sparkles } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white antialiased">
      <Header />
      {children}
      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-ink-100">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm shadow-brand-500/30">
            <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-tight text-ink-900 leading-none">
              PayCraft
            </div>
            <div className="text-[10px] text-ink-400 font-medium mt-0.5">
              by MobileByteSensei
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link
            href="/pricing"
            className="text-ink-700 hover:text-ink-900 transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/docs"
            className="text-ink-700 hover:text-ink-900 transition-colors"
          >
            Docs
          </Link>
          <Link
            href="/self-host"
            className="text-ink-700 hover:text-ink-900 transition-colors"
          >
            Self-host
          </Link>
          <Link
            href="/auth/login"
            className="text-ink-700 hover:text-ink-900 transition-colors"
          >
            Sign in
          </Link>
          <ButtonLink href="/auth/signup" size="sm">
            Start free
          </ButtonLink>
        </nav>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-ink-50/40 mt-32">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
              </div>
              <div className="text-sm font-bold tracking-tight text-ink-900">
                PayCraft
              </div>
            </div>
            <p className="text-xs text-ink-500 max-w-xs leading-relaxed">
              Multi-provider subscription billing for Kotlin Multiplatform. One
              SDK call, all your billing. Operated by MobileByteSensei Pvt Ltd.
            </p>
          </div>
          <FooterCol
            label="Product"
            items={[
              { label: "Pricing", href: "/pricing" },
              { label: "Docs", href: "/docs" },
              { label: "Changelog", href: "/changelog" },
              { label: "Status", href: "/status" },
            ]}
          />
          <FooterCol
            label="Resources"
            items={[
              { label: "Quickstart", href: "/docs/quickstart-cloud" },
              { label: "Self-host", href: "/self-host" },
              { label: "Migration v1→v2", href: "/docs/migration-v1-to-v2" },
              { label: "FAQ", href: "/docs/faq" },
            ]}
          />
          <FooterCol
            label="Legal"
            items={[
              { label: "Terms", href: "/legal/terms" },
              { label: "Privacy", href: "/legal/privacy" },
              { label: "DPA", href: "/legal/dpa" },
              { label: "Subprocessors", href: "/legal/subprocessors" },
            ]}
          />
        </div>
        <div className="mt-12 pt-6 border-t border-ink-100 flex items-center justify-between text-2xs text-ink-500">
          <div>© 2026 MobileByteSensei Pvt Ltd. All rights reserved.</div>
          <div>Built with care for KMP developers.</div>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({
  label,
  items,
}: {
  label: string
  items: { label: string; href: string }[]
}) {
  return (
    <div>
      <h3 className="text-2xs uppercase font-bold tracking-widest text-ink-400 mb-3">
        {label}
      </h3>
      <ul className="space-y-2 text-xs">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className="text-ink-600 hover:text-ink-900 transition-colors"
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
