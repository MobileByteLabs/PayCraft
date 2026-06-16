import { ReactNode } from "react"
import Link from "next/link"
import { clsx } from "clsx"

interface Column<T> {
  key: string
  header: ReactNode
  width?: string
  align?: "left" | "right" | "center"
  cell: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  rowHref?: (row: T) => string
  onRowClick?: (row: T) => void
  footer?: ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  rowHref,
  onRowClick,
  footer,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>
  }
  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead className="bg-ink-50/60 border-b border-ink-200">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width }}
                  className={clsx(
                    "px-6 py-3 text-2xs font-bold text-ink-400 uppercase tracking-widest",
                    c.align === "right"
                      ? "text-right"
                      : c.align === "center"
                      ? "text-center"
                      : "text-left",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => {
              const key = rowKey(row)
              const cells = columns.map((c) => (
                <td
                  key={c.key}
                  className={clsx(
                    "px-6 py-3.5 text-sm",
                    c.align === "right"
                      ? "text-right"
                      : c.align === "center"
                      ? "text-center"
                      : "text-left",
                  )}
                >
                  {c.cell(row)}
                </td>
              ))
              if (rowHref) {
                return (
                  <tr
                    key={key}
                    className="hover:bg-ink-50/70 transition-colors group cursor-pointer"
                    onClick={(e) => {
                      if (
                        e.target instanceof HTMLElement &&
                        (e.target.closest("a") || e.target.closest("button"))
                      )
                        return
                      window.location.href = rowHref(row)
                    }}
                  >
                    {cells}
                  </tr>
                )
              }
              return (
                <tr
                  key={key}
                  className={clsx(
                    "transition-colors group",
                    onRowClick && "hover:bg-ink-50/70 cursor-pointer",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {cells}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="border-t border-ink-100 bg-ink-50/30 px-6 py-3 flex items-center justify-between text-xs text-ink-500">
          {footer}
        </div>
      )}
    </div>
  )
}
