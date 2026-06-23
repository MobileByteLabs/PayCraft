"use client"

import { useRef, useState } from "react"

interface Proposal {
  action_id: string
  summary: string
  expected_impact: string
  reversal: string
  risk: "low" | "high"
}
interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const STARTERS = [
  "How do I increase my MRR?",
  "Why is my revenue flat?",
  "How do I reduce churn?",
  "Automate everything — what should I fix?",
]

/**
 * Shared PayCraft AI chat — used by the full /ai page and the floating bubble panel.
 * Talks to the deterministic /api/ai/ask endpoint (no paid AI).
 */
export function AiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [proposals, setProposals] = useState<Proposal[][]>([]) // parallel to assistant turns
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function send(text: string) {
    const q = text.trim()
    if (!q || loading) return
    setError(null)
    const next = [...messages, { role: "user" as const, content: q }]
    setMessages(next)
    setInput("")
    setLoading(true)
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "Request failed")
      setMessages((m) => [...m, { role: "assistant", content: data.text || "(no response)" }])
      setProposals((p) => [...p, data.proposals || []])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      requestAnimationFrame(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight))
    }
  }

  const assistantTurn = (msgIndex: number) =>
    messages.slice(0, msgIndex + 1).filter((m) => m.role === "assistant").length - 1

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                m.role === "user"
                  ? "inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2 text-left text-white"
                  : "inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl bg-gray-100 px-4 py-2 text-gray-900"
              }
            >
              {m.content}
            </div>
            {m.role === "assistant" &&
              (proposals[assistantTurn(i)] ?? []).map((p, j) => <ProposalCard key={j} proposal={p} />)}
          </div>
        ))}

        {loading && <div className="text-sm text-gray-400">PayCraft AI is thinking…</div>}
        {error && <div className="text-sm text-red-600">⚠ {error}</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="flex gap-2 border-t p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your MRR, churn, pricing, paywall…"
          className="flex-1 rounded-lg border px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const high = proposal.risk === "high"
  return (
    <div
      className={`mt-2 max-w-[90%] rounded-xl border p-3 text-left text-sm ${
        high ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{proposal.summary}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            high ? "bg-amber-200 text-amber-900" : "bg-emerald-200 text-emerald-900"
          }`}
        >
          {high ? "HIGH risk" : "low risk"}
        </span>
      </div>
      {proposal.expected_impact && <p className="mt-1 text-gray-700">📈 {proposal.expected_impact}</p>}
      {proposal.reversal && <p className="mt-1 text-xs text-gray-500">↩ Reversal: {proposal.reversal}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          title="Applying proposals from chat ships in the next increment — for now, make this change on the relevant dashboard page."
          className="cursor-not-allowed rounded-lg bg-gray-300 px-3 py-1 text-xs font-medium text-gray-600"
          disabled
        >
          Confirm &amp; apply (coming soon)
        </button>
        <span className="text-xs text-gray-400">{proposal.action_id}</span>
      </div>
    </div>
  )
}
