"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Mail, Send } from "lucide-react"
import { Button } from "@/components/ui/button"

type Role = "owner" | "admin" | "viewer"

export function InviteForm({ tenantId: _ }: { tenantId: string }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("viewer")
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFeedback(null)
    const res = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    })
    setSubmitting(false)
    if (res.ok) {
      setFeedback({
        kind: "success",
        text: `Invite sent to ${email}. They'll see PayCraft once they accept.`,
      })
      setEmail("")
      router.refresh()
    } else {
      const body = await res.json().catch(() => ({}))
      setFeedback({
        kind: "error",
        text: body.error ?? "Couldn't send invite. Try again.",
      })
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-ink-700 mb-1.5">
            Email address
          </label>
          <div className="relative">
            <Mail
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              strokeWidth={2}
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@yourcompany.com"
              className="input pl-9"
            />
          </div>
        </div>
        <div className="md:w-44">
          <label className="block text-xs font-medium text-ink-700 mb-1.5">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="input"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div>
          <Button
            type="submit"
            loading={submitting}
            leading={<Send className="w-4 h-4" strokeWidth={2.5} />}
          >
            Send invite
          </Button>
        </div>
      </div>
      {feedback && (
        <div
          className={
            feedback.kind === "success"
              ? "rounded-lg bg-success-50 border border-success-200 text-success-700 px-3 py-2 text-sm animate-fade-in"
              : "rounded-lg bg-danger-50 border border-danger-200 text-danger-700 px-3 py-2 text-sm animate-fade-in"
          }
        >
          {feedback.text}
        </div>
      )}
    </form>
  )
}
