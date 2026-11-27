"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { clsx } from "clsx"
import {
  BarChart3,
  Bell,
  CreditCard,
  History,
  Home,
  KeyRound,
  Terminal,
  Layers,
  LayoutGrid,
  LogOut,
  Menu,
  X,
  MessageSquareText,
  Package,
  Plug,
  Settings,
  ShieldCheck,
  FlaskConical,
  Sparkles,
  Tag,
  Users,
  Users2,
  Link2,
  Webhook,
} from "lucide-react"
import { UnreadBadge } from "@/components/alerts/unread-badge"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<any>
  /** Renders the unread-alerts pill after the label. */
  badge?: "unread-alerts"
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutGrid },
      { href: "/ai", label: "PayCraft AI", icon: Sparkles },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/coupons", label: "Coupons", icon: Tag },
      { href: "/providers", label: "Providers", icon: Plug },
      { href: "/providers/platform", label: "Platform providers", icon: Layers },
      { href: "/paywall", label: "Paywall", icon: LayoutGrid },
      { href: "/paywall/exit-survey", label: "Exit survey", icon: MessageSquareText },
      { href: "/paywall/experiments", label: "Experiments", icon: FlaskConical },
    ],
  },
  {
    label: "Monitor",
    items: [
      { href: "/subscribers", label: "Subscribers", icon: Users },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/alerts", label: "Alerts", icon: Bell, badge: "unread-alerts" },
      { href: "/audit", label: "Audit log", icon: History },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/team", label: "Team", icon: Users2 },
      { href: "/settings/provider-accounts", label: "Provider connections", icon: Link2 },
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound },
      { href: "/settings/developer-api", label: "Developer API", icon: Terminal },
      { href: "/settings/account-tokens", label: "Access tokens", icon: ShieldCheck },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
]

// Admin-only group rendered when the current user owns the platform.
const adminGroup: NavGroup = {
  label: "Admin",
  items: [
    { href: "/admin/platform-keys", label: "Platform keys", icon: ShieldCheck },
  ],
}

interface SidebarProps {
  tenantName: string
  tenantPlan: string
  ownerEmail: string
  appSwitcher?: React.ReactNode
  isPlatformOwner?: boolean
  /** Unread owner alerts of the active app (read server-side in the layout). */
  alertsUnread?: { count: number; critical: number }
}

export function Sidebar({
  tenantName,
  tenantPlan,
  ownerEmail,
  appSwitcher,
  isPlatformOwner,
  alertsUnread,
}: SidebarProps) {
  const pathname = usePathname()
  const navGroups = isPlatformOwner ? [...groups, adminGroup] : groups
  // The most specific item wins: /paywall/exit-survey lights "Exit survey", not "Paywall" as well (same for
  // /providers/platform and the /settings/* pages).
  const activeHref = navGroups
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || (href !== "/" && pathname.startsWith(href + "/")))
    .sort((a, b) => b.length - a.length)[0]
  // Below lg the sidebar is a drawer: a fixed 256 px column covered a phone screen. Any navigation closes it.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname])
  return (
    <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open menu"
      aria-expanded={open}
      className="fixed left-3 top-2 z-40 rounded-md p-2 text-ink-700 hover:bg-ink-100 lg:hidden"
    >
      <Menu className="h-5 w-5" strokeWidth={2} />
    </button>
    {open && (
      <div aria-hidden className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden" onClick={() => setOpen(false)} />
    )}
    <aside
      className={clsx(
        "fixed left-0 top-0 h-screen w-64 bg-white border-r border-ink-200 flex flex-col py-6 px-4 z-50",
        "transition-transform duration-200 lg:translate-x-0",
        open ? "translate-x-0 shadow-xl" : "-translate-x-full",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close menu"
        className="absolute right-3 top-5 rounded-md p-1 text-ink-500 hover:bg-ink-100 lg:hidden"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-2 mb-6 group"
      >
        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm shadow-brand-500/30">
          <Sparkles
            className="w-4 h-4 text-white"
            strokeWidth={2.5}
          />
        </div>
        <div>
          <h1 className="text-[15px] font-bold tracking-tight text-ink-900 leading-none">
            PayCraft
          </h1>
          <p className="text-[10px] text-ink-400 font-medium tracking-wide mt-0.5">
            by MobileByteSensei
          </p>
        </div>
      </Link>

      {/* App switcher / tenant card */}
      <div className="mb-7 px-2">
        {appSwitcher ? (
          <div className="bg-ink-50 rounded-lg border border-ink-100">
            {appSwitcher}
          </div>
        ) : (
          <div className="bg-ink-50 rounded-lg p-3 border border-ink-100 relative">
            <span className="text-[10px] font-bold text-ink-400 tracking-widest uppercase block mb-1">
              App
            </span>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink-800 truncate">
                {tenantName}
              </span>
              <span
                className={clsx(
                  "text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider flex-shrink-0",
                  tenantPlan === "enterprise"
                    ? "bg-brand-50 text-brand-700 border-brand-200"
                    : tenantPlan === "pro"
                    ? "bg-success-50 text-success-700 border-success-200"
                    : "bg-ink-100 text-ink-700 border-ink-200",
                )}
              >
                {tenantPlan}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-1 -mx-1">
        {navGroups.map((group) => (
          <div key={group.label}>
            <h3 className="text-[11px] font-bold text-ink-400 tracking-wider uppercase px-2 mb-2">
              {group.label}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = item.href === activeHref
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={clsx(
                        "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-all",
                        active
                          ? "bg-brand-50 text-brand-700 shadow-[0_0_15px_-3px_rgba(124,58,237,0.1)]"
                          : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
                      )}
                    >
                      <Icon
                        className={clsx(
                          "w-4 h-4 flex-shrink-0",
                          active ? "text-brand-600" : "",
                        )}
                        strokeWidth={2}
                      />
                      {item.label}
                      {item.badge === "unread-alerts" && alertsUnread && (
                        <UnreadBadge count={alertsUnread.count} critical={alertsUnread.critical} />
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="mt-auto border-t border-ink-100 pt-4 px-2">
        <div className="flex items-center justify-between group">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-ink-400 font-medium uppercase tracking-wider">
              Signed in as
            </span>
            <span className="text-xs font-semibold text-ink-700 truncate w-40">
              {ownerEmail}
            </span>
          </div>
          <form action="/auth/logout" method="POST" className="flex-shrink-0">
            <button
              type="submit"
              aria-label="Sign out"
              className="text-ink-400 hover:text-danger-600 transition-colors p-1 -m-1 rounded"
            >
              <LogOut className="w-4 h-4" strokeWidth={2} />
            </button>
          </form>
        </div>
      </div>
    </aside>
    </>
  )
}
