"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { clsx } from "clsx"

const navItems = [
  { href: "/subscribers", label: "Subscribers", icon: "Users" },
  { href: "/analytics", label: "Analytics", icon: "BarChart3" },
  { href: "/webhooks", label: "Webhooks", icon: "Webhook" },
  { href: "/settings", label: "Settings", icon: "Settings" },
]

export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-xl font-bold text-brand-600">PayCraft</h1>
        <p className="text-sm text-gray-500 mt-1 truncate">{tenantName}</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              pathname.startsWith(item.href)
                ? "bg-brand-50 text-brand-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <span className="w-5 h-5 flex items-center justify-center text-xs">
              {item.icon.charAt(0)}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-200">
        <form action="/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
