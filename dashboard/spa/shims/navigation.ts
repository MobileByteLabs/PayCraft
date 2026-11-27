// `next/navigation` for the Vite build (aliased in spa/vite.config.ts): the dashboard's components keep their
// Next imports and run on TanStack Router. Only what they use is provided.
import { useMemo } from "react"
import { useParams as useRouterParams, useRouter as useTanStackRouter, useRouterState } from "@tanstack/react-router"
import { isSpaPath } from "@/lib/spa-paths"

/** `router.refresh()`: the shell re-reads the mode / active-app cookies and refetches every query. */
export const SPA_REFRESH_EVENT = "spa:refresh"

export function go(history: { push(p: string): void; replace(p: string): void }, href: string, replace = false) {
  const url = new URL(href, window.location.href)
  if (url.origin !== window.location.origin || !isSpaPath(url.pathname)) {
    // The public site, /auth, /onboarding: a Next.js page — a real navigation.
    if (replace) window.location.replace(url.href)
    else window.location.assign(url.href)
    return
  }
  const to = url.pathname + url.search + url.hash
  if (replace) history.replace(to)
  else history.push(to)
}

export function useRouter() {
  const router = useTanStackRouter()
  return useMemo(
    () => ({
      push: (href: string) => go(router.history, href),
      replace: (href: string) => go(router.history, href, true),
      back: () => router.history.back(),
      forward: () => router.history.forward(),
      refresh: () => window.dispatchEvent(new Event(SPA_REFRESH_EVENT)),
      prefetch: (_href: string) => {},
    }),
    [router],
  )
}

export function usePathname(): string {
  return useRouterState({ select: (s) => s.location.pathname })
}

export function useSearchParams(): URLSearchParams {
  const search = useRouterState({ select: (s) => s.location.searchStr })
  return useMemo(() => new URLSearchParams(search), [search])
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRouterParams({ strict: false } as never) as T
}

export function redirect(href: string): never {
  window.location.assign(href)
  throw new Error(`redirect to ${href}`)
}

export function notFound(): never {
  throw new Error("not found")
}
