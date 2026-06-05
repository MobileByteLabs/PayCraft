"use client"

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"

export function WebhookDonut({
  successRate,
  success,
  failed,
}: {
  successRate: number
  success: number
  failed: number
}) {
  const data = [
    { name: "success", value: success || 1 },
    { name: "failed", value: failed },
  ]

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={68}
            outerRadius={92}
            paddingAngle={1}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            <Cell fill="#22C55E" />
            <Cell fill="#FEE2E2" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-3xl font-semibold text-ink-900 tabular-nums tracking-tight">
          {(successRate * 100).toFixed(1)}%
        </div>
        <div className="text-2xs text-ink-500 uppercase tracking-wider mt-0.5">
          Success rate
        </div>
      </div>
      <div className="flex items-center justify-center gap-5 mt-3 text-xs text-ink-600">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-success-500" />
          <span className="tabular-nums">{success.toLocaleString()}</span>
          <span className="text-ink-400">success</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-danger-200" />
          <span className="tabular-nums">{failed.toLocaleString()}</span>
          <span className="text-ink-400">failed</span>
        </span>
      </div>
    </div>
  )
}
