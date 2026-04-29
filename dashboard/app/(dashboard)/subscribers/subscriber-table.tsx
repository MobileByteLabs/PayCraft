"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import type { Subscription } from "@/lib/types"

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  trialing: "bg-blue-100 text-blue-800",
  canceled: "bg-red-100 text-red-800",
  past_due: "bg-yellow-100 text-yellow-800",
  unpaid: "bg-orange-100 text-orange-800",
}

export function SubscriberTable({
  subscribers,
  totalCount,
  page,
  perPage,
  currentMode,
}: {
  subscribers: Subscription[]
  totalCount: number
  page: number
  perPage: number
  currentMode: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get("q") || "")

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v)
      else sp.delete(k)
    })
    router.push(`/subscribers?${sp.toString()}`)
  }

  const totalPages = Math.ceil(totalCount / perPage)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            navigate({ q: search, page: "1" })
          }}
          className="flex-1"
        >
          <input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </form>
        <select
          value={searchParams.get("status") || ""}
          onChange={(e) => navigate({ status: e.target.value, page: "1" })}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="canceled">Canceled</option>
          <option value="past_due">Past due</option>
        </select>
        <select
          value={currentMode}
          onChange={(e) => navigate({ mode: e.target.value, page: "1" })}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="live">Live</option>
          <option value="test">Test</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expires</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {subscribers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No subscribers found
                </td>
              </tr>
            ) : (
              subscribers.map((sub) => (
                <tr key={sub.id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/subscribers/${sub.id}`)}
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{sub.email}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{sub.plan}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[sub.status] || "bg-gray-100 text-gray-800"}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{sub.provider}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {sub.current_period_end
                      ? new Date(sub.current_period_end).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(sub.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center">
          <p className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => navigate({ page: String(page - 1) })}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => navigate({ page: String(page + 1) })}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
