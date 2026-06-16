"use client"

import { useState, useEffect } from "react"
import { UserPlus, Mail, Clock, Shield, Edit2, Trash2, X, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface Member {
  id: string
  name: string
  email: string
  role: "owner" | "admin" | "viewer"
  status: "active" | "inactive"
  joined: string
  initials?: string
  avatarBg?: string
}

interface PendingInvite {
  id: string
  email: string
  role: "admin" | "viewer"
  sentDaysAgo: number
}

// Static mock data — real implementation fetches from Supabase tenant_admins
const MOCK_MEMBERS: Member[] = [
  {
    id: "1",
    name: "Rajan P.",
    email: "rajan@paycraft.cloud",
    role: "owner",
    status: "active",
    joined: "May 2024",
    avatarBg: "from-brand-400 to-brand-600",
  },
  {
    id: "2",
    name: "Sarah J.",
    email: "sarah.j@paycraft.cloud",
    role: "admin",
    status: "active",
    joined: "June 2024",
    initials: "SJ",
    avatarBg: "from-info-400 to-info-600",
  },
  {
    id: "3",
    name: "Mike D.",
    email: "mike.dev@paycraft.cloud",
    role: "viewer",
    status: "active",
    joined: "July 2024",
    initials: "MD",
    avatarBg: "from-ink-400 to-ink-600",
  },
]

const MOCK_PENDING: PendingInvite[] = [
  {
    id: "pi_1",
    email: "alex.dev@hotmail.com",
    role: "viewer",
    sentDaysAgo: 2,
  },
]

const ROLE_CONFIG = {
  owner: { tone: "neutral" as const, label: "Owner" },
  admin: { tone: "info" as const, label: "Admin" },
  viewer: { tone: "neutral" as const, label: "Viewer" },
}

const RBAC_ROLES = [
  {
    name: "Owner",
    description: "Full access to all dashboard features, billing, and team management.",
  },
  {
    name: "Admin",
    description: "Manage products, plans, and billing. Cannot manage owners.",
  },
  {
    name: "Viewer",
    description: "Read-only access to analytics, logs, and product details.",
  },
]

export default function TeamPage() {
  const [members] = useState<Member[]>(MOCK_MEMBERS)
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(MOCK_PENDING)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"viewer" | "admin">("viewer")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  // Close modal on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowInviteModal(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      if (res.ok) {
        setFeedback({ kind: "success", text: `Invite sent to ${inviteEmail}.` })
        setPendingInvites((prev) => [
          ...prev,
          { id: `pi_${Date.now()}`, email: inviteEmail, role: inviteRole, sentDaysAgo: 0 },
        ])
        setInviteEmail("")
        setInviteRole("viewer")
        setTimeout(() => {
          setShowInviteModal(false)
          setFeedback(null)
        }, 1800)
      } else {
        const body = await res.json().catch(() => ({}))
        setFeedback({ kind: "error", text: body.error ?? "Couldn't send invite. Try again." })
      }
    } catch {
      setFeedback({ kind: "error", text: "Network error. Try again." })
    } finally {
      setSubmitting(false)
    }
  }

  function revokeInvite(id: string) {
    setPendingInvites((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div>
      {/* Page Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-extrabold text-ink-900 tracking-tight">Team</h2>
          <p className="text-ink-500 mt-1">
            Manage your team members and their roles.{" "}
            <span className="font-semibold text-ink-700">{members.length} members</span> active in your organization.
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="px-5 py-2.5 bg-brand-600 text-white font-bold text-sm rounded-lg hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-600/20 transition-all active:scale-95 flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" strokeWidth={2} />
          Invite member
        </button>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Main content (9 cols) */}
        <div className="col-span-12 lg:col-span-9 space-y-8">
          {/* Members Table */}
          <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-ink-50/50 border-b border-ink-200">
                  <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Member</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Role</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Joined</th>
                  <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {members.map((member) => {
                  const isOwner = member.role === "owner"
                  return (
                    <tr key={member.id} className="hover:bg-ink-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-full bg-gradient-to-br ${member.avatarBg ?? "from-ink-400 to-ink-600"} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}
                          >
                            {member.initials ?? member.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-[13px] font-semibold text-ink-900">{member.name}</p>
                            <p className="text-[12px] text-ink-500">{member.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          tone={
                            member.role === "owner"
                              ? "neutral"
                              : member.role === "admin"
                              ? "info"
                              : "neutral"
                          }
                        >
                          {ROLE_CONFIG[member.role].label}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-success-600 font-semibold text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-success-500" />
                          Active
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[12px] text-ink-500 font-medium">{member.joined}</td>
                      <td className="px-6 py-4 text-right">
                        <div className={`flex justify-end gap-1 ${isOwner ? "opacity-20 pointer-events-none" : ""}`}>
                          <button className="p-1.5 text-ink-400 hover:text-brand-600 transition-colors rounded-md hover:bg-ink-50">
                            <Edit2 className="w-4 h-4" strokeWidth={2} />
                          </button>
                          <button className="p-1.5 text-ink-400 hover:text-danger-600 transition-colors rounded-md hover:bg-ink-50">
                            <Trash2 className="w-4 h-4" strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pending Invites */}
          {pendingInvites.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-sm font-bold text-ink-900 uppercase tracking-widest whitespace-nowrap">
                  Pending Invites
                </h3>
                <div className="h-px flex-1 bg-ink-200" />
              </div>
              <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between px-6 py-4 hover:bg-ink-50/50 transition-colors border-b border-ink-100 last:border-b-0"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-ink-100 flex items-center justify-center text-ink-400 flex-shrink-0">
                        <Mail className="w-4 h-4" strokeWidth={2} />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-ink-900">{invite.email}</p>
                        <p className="text-[11px] text-ink-500 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" strokeWidth={2} />
                          Sent {invite.sentDaysAgo === 0 ? "just now" : `${invite.sentDaysAgo} day${invite.sentDaysAgo !== 1 ? "s" : ""} ago`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <Badge tone="neutral" className="capitalize">{invite.role}</Badge>
                      <div className="flex items-center gap-3">
                        <button className="text-[12px] font-bold text-brand-600 hover:underline transition-all">
                          Resend
                        </button>
                        <button
                          onClick={() => revokeInvite(invite.id)}
                          className="text-[12px] font-bold text-danger-600 hover:underline transition-all"
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RBAC Sidebar (3 cols) */}
        <div className="col-span-12 lg:col-span-3">
          <div className="sticky top-24 space-y-4">
            <div className="bg-white rounded-xl border border-ink-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-ink-900">
                <Shield className="w-4 h-4 text-brand-600" strokeWidth={2} />
                <h3 className="font-bold text-sm">Role Permissions</h3>
              </div>
              <div className="space-y-6">
                {RBAC_ROLES.map((r) => (
                  <div key={r.name} className="flex gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-lg bg-ink-100 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-ink-500" strokeWidth={2} />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-ink-900 mb-0.5">{r.name}</p>
                      <p className="text-[12px] text-ink-500 leading-relaxed">{r.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t border-ink-100">
                <a
                  href="#"
                  className="text-[12px] font-semibold text-brand-600 flex items-center gap-1 hover:gap-2 transition-all"
                >
                  View full RBAC guide
                  <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.5} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink-900/40 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-ink-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 pt-6 pb-4 flex justify-between items-center">
              <h3 className="text-xl font-extrabold text-ink-900 tracking-tight">Invite team member</h3>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-2 text-ink-400 hover:text-ink-600 transition-colors rounded-full hover:bg-ink-50"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleInvite}>
              <div className="px-6 py-4 space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@company.com"
                    className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-ink-400 uppercase tracking-widest">
                    Select Role
                  </label>
                  <div className="relative">
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "viewer" | "admin")}
                      className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm appearance-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all outline-none"
                    >
                      <option value="viewer">Viewer (Read-only)</option>
                      <option value="admin">Admin (Management access)</option>
                    </select>
                    <svg
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                  <p className="text-[11px] text-ink-500 italic mt-2">
                    New members will receive an activation link via email.
                  </p>
                </div>

                {feedback && (
                  <div
                    className={`rounded-lg px-3 py-2 text-sm animate-fade-in ${
                      feedback.kind === "success"
                        ? "bg-success-50 border border-success-200 text-success-700"
                        : "bg-danger-50 border border-danger-200 text-danger-700"
                    }`}
                  >
                    {feedback.text}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-6 bg-ink-50/50 flex justify-end gap-3 border-t border-ink-100">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 text-sm font-bold text-ink-600 hover:text-ink-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-brand-600 text-white font-bold text-sm rounded-lg hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-600/20 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
