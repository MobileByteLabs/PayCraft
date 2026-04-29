"use client"

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts"

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"]

export function AnalyticsCharts({
  cohorts,
  churn,
  statusCounts,
  planCounts,
}: {
  cohorts: any[]
  churn: any[]
  statusCounts: Record<string, number>
  planCounts: Record<string, number>
}) {
  // Aggregate cohorts by month
  const cohortByMonth: Record<string, number> = {}
  cohorts.forEach((c) => {
    const month = new Date(c.cohort_month).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    cohortByMonth[month] = (cohortByMonth[month] || 0) + c.subscriber_count
  })
  const cohortData = Object.entries(cohortByMonth).map(([month, count]) => ({ month, count }))

  const churnData = churn.map((c) => ({
    month: new Date(c.churn_month).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    churned: c.churned_count,
  }))

  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }))
  const planData = Object.entries(planCounts).map(([name, value]) => ({ name, value }))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Subscriber Growth */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Subscriber Growth</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={cohortData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Churn */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Monthly Churn</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={churnData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Bar dataKey="churned" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Status Breakdown */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Status Breakdown</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={statusData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label>
              {statusData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Plan Distribution */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Revenue by Plan</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie data={planData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label>
              {planData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
