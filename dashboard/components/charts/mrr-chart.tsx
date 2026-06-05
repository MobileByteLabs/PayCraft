"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

interface DataPoint {
  month: string
  mrr: number
}

export function MRRChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={data}
        margin={{ top: 10, right: 12, left: -8, bottom: 0 }}
      >
        <defs>
          <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#F4F4F5" vertical={false} />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#71717A" }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "#71717A" }}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            background: "white",
            border: "1px solid #E4E4E7",
            borderRadius: 8,
            fontSize: 12,
            padding: "8px 10px",
            boxShadow: "0 4px 8px -2px rgba(0,0,0,0.05)",
          }}
          labelStyle={{ fontSize: 11, color: "#71717A" }}
          formatter={(value: number) => [`$${value.toFixed(2)}`, "MRR"]}
        />
        <Area
          type="monotone"
          dataKey="mrr"
          stroke="#7C3AED"
          strokeWidth={2}
          fill="url(#mrrGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
