// One route per app/(dashboard)/**/page.tsx (the same file Next.js serves), each loaded on demand so a page's
// code downloads only when it is first opened. Kept in step with the folders by __tests__/lib/spa-routes.test.ts.
import { createRootRoute, createRoute, createRouter, useParams, useRouterState } from "@tanstack/react-router"
import { Suspense, lazy, useMemo } from "react"
import DashboardLoading from "@/app/(dashboard)/loading"
import { Shell } from "./shell"

// Pages type their own props ({ params: { id } } etc.); the route hands every page both objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageModule = { default: React.ComponentType<any> }

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => <p className="mt-10 text-sm text-ink-500">This page doesn&rsquo;t exist.</p>,
})

/** Next passes `params` and `searchParams` as props; the pages here receive them the same way. */
function page(path: string, load: () => Promise<PageModule>) {
  const Page = lazy(load)
  function Route() {
    const params = useParams({ strict: false }) as Record<string, string>
    const searchStr = useRouterState({ select: (s) => s.location.searchStr })
    const searchParams = useMemo(() => Object.fromEntries(new URLSearchParams(searchStr)), [searchStr])
    return (
      <Suspense fallback={<DashboardLoading />}>
        <Page params={params} searchParams={searchParams} />
      </Suspense>
    )
  }
  return createRoute({ getParentRoute: () => rootRoute, path, component: Route })
}

export const SPA_ROUTE_PATHS = [
  "/admin/health",
  "/admin/platform-keys",
  "/ai",
  "/alerts",
  "/analytics",
  "/apps",
  "/apps/$id",
  "/apps/new",
  "/audit",
  "/billing",
  "/billing/upgrade",
  "/coupons",
  "/dashboard",
  "/paywall",
  "/paywall/designer",
  "/paywall/exit-survey",
  "/paywall/experiments",
  "/paywall/templates",
  "/products",
  "/products/$id",
  "/products/$id/edit",
  "/products/$id/pricing",
  "/products/new",
  "/providers",
  "/providers/app-store",
  "/providers/cashfree",
  "/providers/google-play",
  "/providers/platform",
  "/providers/razorpay",
  "/providers/routing",
  "/providers/stripe",
  "/providers/upi",
  "/settings",
  "/settings/account-tokens",
  "/settings/api-keys",
  "/settings/developer-api",
  "/settings/provider-accounts",
  "/subscribers",
  "/subscribers/$id",
  "/team",
  "/upgrade",
  "/upi-payments",
  "/webhooks",
  "/webhooks/$id",
]

const routeTree = rootRoute.addChildren([
  page("/admin/health", () => import("@/app/(dashboard)/admin/health/page")),
  page("/admin/platform-keys", () => import("@/app/(dashboard)/admin/platform-keys/page")),
  page("/ai", () => import("@/app/(dashboard)/ai/page")),
  page("/alerts", () => import("@/app/(dashboard)/alerts/page")),
  page("/analytics", () => import("@/app/(dashboard)/analytics/page")),
  page("/apps", () => import("@/app/(dashboard)/apps/page")),
  page("/apps/$id", () => import("@/app/(dashboard)/apps/[id]/page")),
  page("/apps/new", () => import("@/app/(dashboard)/apps/new/page")),
  page("/audit", () => import("@/app/(dashboard)/audit/page")),
  page("/billing", () => import("@/app/(dashboard)/billing/page")),
  page("/billing/upgrade", () => import("@/app/(dashboard)/billing/upgrade/page")),
  page("/coupons", () => import("@/app/(dashboard)/coupons/page")),
  page("/dashboard", () => import("@/app/(dashboard)/dashboard/page")),
  page("/paywall", () => import("@/app/(dashboard)/paywall/page")),
  page("/paywall/designer", () => import("@/app/(dashboard)/paywall/designer/page")),
  page("/paywall/exit-survey", () => import("@/app/(dashboard)/paywall/exit-survey/page")),
  page("/paywall/experiments", () => import("@/app/(dashboard)/paywall/experiments/page")),
  page("/paywall/templates", () => import("@/app/(dashboard)/paywall/templates/page")),
  page("/products", () => import("@/app/(dashboard)/products/page")),
  page("/products/$id", () => import("@/app/(dashboard)/products/[id]/page")),
  page("/products/$id/edit", () => import("@/app/(dashboard)/products/[id]/edit/page")),
  page("/products/$id/pricing", () => import("@/app/(dashboard)/products/[id]/pricing/page")),
  page("/products/new", () => import("@/app/(dashboard)/products/new/page")),
  page("/providers", () => import("@/app/(dashboard)/providers/page")),
  page("/providers/app-store", () => import("@/app/(dashboard)/providers/app-store/page")),
  page("/providers/cashfree", () => import("@/app/(dashboard)/providers/cashfree/page")),
  page("/providers/google-play", () => import("@/app/(dashboard)/providers/google-play/page")),
  page("/providers/platform", () => import("@/app/(dashboard)/providers/platform/page")),
  page("/providers/razorpay", () => import("@/app/(dashboard)/providers/razorpay/page")),
  page("/providers/routing", () => import("@/app/(dashboard)/providers/routing/page")),
  page("/providers/stripe", () => import("@/app/(dashboard)/providers/stripe/page")),
  page("/providers/upi", () => import("@/app/(dashboard)/providers/upi/page")),
  page("/settings", () => import("@/app/(dashboard)/settings/page")),
  page("/settings/account-tokens", () => import("@/app/(dashboard)/settings/account-tokens/page")),
  page("/settings/api-keys", () => import("@/app/(dashboard)/settings/api-keys/page")),
  page("/settings/developer-api", () => import("@/app/(dashboard)/settings/developer-api/page")),
  page("/settings/provider-accounts", () => import("@/app/(dashboard)/settings/provider-accounts/page")),
  page("/subscribers", () => import("@/app/(dashboard)/subscribers/page")),
  page("/subscribers/$id", () => import("@/app/(dashboard)/subscribers/[id]/page")),
  page("/team", () => import("@/app/(dashboard)/team/page")),
  page("/upgrade", () => import("@/app/(dashboard)/upgrade/page")),
  page("/upi-payments", () => import("@/app/(dashboard)/upi-payments/page")),
  page("/webhooks", () => import("@/app/(dashboard)/webhooks/page")),
  page("/webhooks/$id", () => import("@/app/(dashboard)/webhooks/[id]/page")),
])

export const router = createRouter({ routeTree, scrollRestoration: true, defaultPreload: "intent" })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
