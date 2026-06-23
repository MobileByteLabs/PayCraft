"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { clsx } from "clsx"
import {
  BarChart3,
  CreditCard,
  History,
  Home,
  KeyRound,
  LayoutGrid,
  LogOut,
  Package,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Users2,
  Webhook,
} from "lucide-react"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<any>
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Home", icon: Home },
      { href: "/ai", label: "PayCraft AI", icon: Sparkles },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/coupons", label: "Coupons", icon: Tag },
      { href: "/providers", label: "Providers", icon: Plug },
      { href: "/paywall", label: "Paywall", icon: LayoutGrid },
    ],
  },
  {
    label: "Monitor",
    items: [
      { href: "/subscribers", label: "Subscribers", icon: Users },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/audit", label: "Audit log", icon: History },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/team", label: "Team", icon: Users2 },
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound },
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
}

export function Sidebar({
  tenantName,
  tenantPlan,
  ownerEmail,
  appSwitcher,
  isPlatformOwner,
}: SidebarProps) {
  const pathname = usePathname()
  const navGroups = isPlatformOwner ? [...groups, adminGroup] : groups
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-ink-200 flex flex-col py-6 px-4 z-50">
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
                const active =
                  pathname === item.href ||
                  (item.href !== "/settings" &&
                    item.href !== "/" &&
                    pathname.startsWith(item.href + "/"))
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
  )
}
