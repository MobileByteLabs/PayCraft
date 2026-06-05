"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

interface DataPoint {
  month: string
  churn_rate: number
}

export function ChurnChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
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
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
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
          formatter={(value: number) => [
            `${(value * 100).toFixed(1)}%`,
            "Churn",
          ]}
        />
        <Bar dataKey="churn_rate" radius={[6, 6, 0, 0]} maxBarSize={48}>
          {data.map((_, i) => (
            <Cell key={i} fill="#A78BFA" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
