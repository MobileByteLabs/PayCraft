import { ReactNode } from "react"
import { clsx } from "clsx"

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        "bg-white border border-ink-200 rounded-xl shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        "px-5 py-4 border-b border-ink-100 flex items-center justify-between",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {title && (
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        )}
        {subtitle && (
          <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={clsx("p-5", className)}>{children}</div>
}

interface StatCardProps {
  label: string
  value: ReactNode
  trend?: { value: string; tone: "success" | "danger" | "info" | "neutral" | "brand" }
  helper?: ReactNode
  icon?: ReactNode
}

const trendToneClasses: Record<
  NonNullable<StatCardProps["trend"]>["tone"],
  string
> = {
  success: "bg-success-50 text-success-700",
  danger: "bg-danger-50 text-danger-700",
  info: "bg-info-50 text-info-700",
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
}

export function StatCard({ label, value, trend, helper, icon }: StatCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-2xs font-semibold text-ink-500 uppercase tracking-wider">
          {label}
        </div>
        {icon && (
          <div className="w-7 h-7 rounded-md bg-ink-100 text-ink-500 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between mt-3">
        <span className="text-2xl font-semibold text-ink-900 tracking-tight tabular-nums">
          {value}
        </span>
        {trend && (
          <span
            className={clsx(
              "text-2xs font-bold px-1.5 py-0.5 rounded",
              trendToneClasses[trend.tone],
            )}
          >
            {trend.value}
          </span>
        )}
      </div>
      {helper && <div className="mt-1 text-xs text-ink-500">{helper}</div>}
    </Card>
  )
}
