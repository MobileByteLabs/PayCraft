import { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  breadcrumb?: { label: string; href?: string }[]
  actions?: ReactNode
  badge?: ReactNode
}

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  badge,
}: PageHeaderProps) {
  return (
    <header className="flex justify-between items-start w-full pt-10 pb-8 sticky top-0 z-30 bg-ink-50/85 backdrop-blur-md -mx-10 px-10 animate-fade-in">
      <div className="min-w-0 flex-1">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1.5 text-xs text-ink-500 mb-2">
            {breadcrumb.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-ink-300">/</span>}
                {c.href ? (
                  <a
                    href={c.href}
                    className="hover:text-ink-700 transition-colors"
                  >
                    {c.label}
                  </a>
                ) : (
                  <span className="text-ink-700">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-ink-900 leading-tight">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="text-ink-500 text-sm max-w-2xl leading-relaxed mt-1.5">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 ml-6">
          {actions}
        </div>
      )}
    </header>
  )
}
