import { ReactNode } from "react"

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  secondary?: ReactNode
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 bg-white border border-dashed border-ink-200 rounded-2xl animate-fade-in">
      {icon && (
        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
      {description && (
        <p className="mt-1.5 text-sm text-ink-500 max-w-sm text-pretty">
          {description}
        </p>
      )}
      {(action || secondary) && (
        <div className="mt-6 flex items-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  )
}
