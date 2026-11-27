// `next/link` for the Vite build: a plain <a> whose dashboard links navigate in-app; any other link (the public
// site, /auth, /docs, another origin, a new tab) is an ordinary browser navigation.
import { forwardRef } from "react"
import { useRouter } from "@tanstack/react-router"
import { go } from "./navigation"

type Href = string | { pathname?: string; query?: Record<string, string>; hash?: string }

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: Href
  replace?: boolean
  prefetch?: boolean | null
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
}

function toHref(href: Href): string {
  if (typeof href === "string") return href
  const q = href.query ? `?${new URLSearchParams(href.query)}` : ""
  return `${href.pathname ?? ""}${q}${href.hash ?? ""}`
}

const Link = forwardRef<HTMLAnchorElement, Props>(function Link(
  { href, replace, prefetch: _p, scroll: _s, shallow: _sh, passHref: _ph, legacyBehavior: _l, onClick, target, ...rest },
  ref,
) {
  const router = useRouter()
  const url = toHref(href)
  return (
    <a
      ref={ref}
      href={url}
      target={target}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        if (target && target !== "_self") return
        e.preventDefault()
        go(router.history, url, replace)
      }}
      {...rest}
    />
  )
})

export default Link
