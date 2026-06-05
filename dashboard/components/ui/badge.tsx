import { ReactNode } from "react"
import { clsx } from "clsx"

type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral"

interface BadgeProps {
  children: ReactNode
  tone?: Tone
  dot?: boolean
  className?: string
}

const toneClasses: Record<Tone, string> = {
  brand:   "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-success-50 text-success-700 ring-success-200",
  warning: "bg-warning-50 text-warning-700 ring-warning-200",
  danger:  "bg-danger-50 text-danger-700 ring-danger-200",
  info:    "bg-info-50 text-info-700 ring-info-200",
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
}

const dotClasses: Record<Tone, string> = {
  brand:   "bg-brand-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger:  "bg-danger-500",
  info:    "bg-info-500",
  neutral: "bg-ink-400",
}

export function Badge({ children, tone = "neutral", dot = false, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-2xs font-medium uppercase tracking-wider ring-1 ring-inset",
        toneClasses[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={clsx(
            "w-1.5 h-1.5 rounded-full animate-pulse-soft",
            dotClasses[tone],
          )}
        />
      )}
      {children}
    </span>
  )
}
