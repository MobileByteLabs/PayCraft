import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react"
import Link from "next/link"
import { clsx } from "clsx"

type Variant = "primary" | "secondary" | "ghost" | "danger"
type Size = "sm" | "md" | "lg"

const variants: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
}
const sizes: Record<Size, string> = {
  sm: "btn-sm",
  md: "btn-md",
  lg: "btn-lg",
}

interface ButtonOwnProps {
  variant?: Variant
  size?: Size
  leading?: ReactNode
  trailing?: ReactNode
  loading?: boolean
}

interface ButtonProps
  extends ButtonOwnProps,
    ButtonHTMLAttributes<HTMLButtonElement> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    leading,
    trailing,
    loading = false,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Spinner />
      ) : (
        leading && <span className="flex-shrink-0">{leading}</span>
      )}
      {children}
      {!loading && trailing && (
        <span className="flex-shrink-0">{trailing}</span>
      )}
    </button>
  )
})

interface ButtonLinkProps extends ButtonOwnProps {
  href: string
  children: ReactNode
  className?: string
  target?: string
  rel?: string
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  leading,
  trailing,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={clsx(variants[variant], sizes[size], className)}
      {...rest}
    >
      {leading && <span className="flex-shrink-0">{leading}</span>}
      {children}
      {trailing && <span className="flex-shrink-0">{trailing}</span>}
    </Link>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
