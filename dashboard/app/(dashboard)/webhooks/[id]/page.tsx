"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Copy, CheckCircle2 } from "lucide-react"

// Static mock data — real implementation would fetch from Supabase
const MOCK_EVENT = {
  id: "evt_1NqABC123xyz",
  type: "payment.succeeded",
  status: "success",
  timestamp: "2024-05-24T14:22:10Z",
  provider: "stripe",
  processing_ms: 142,
  webhook_id: "wh_83y...2k",
  idempotency_key: "idk_92j...7f",
  payload: {
    object: "event",
    type: "payment.succeeded",
    data: {
      subscription_id: "sub_12345",
      amount: 2900,
      currency: "usd",
      customer_email: "rahul.kumar@gmail.com",
      provider: "stripe",
      status: "succeeded",
    },
  },
  response: {
    received: true,
    message: "Webhook processed successfully",
    timestamp: "2024-05-24T14:22:11.450Z",
  },
  delivery_history: [
    {
      id: "del_3",
      attempt: "success",
      label: "Success",
      http_status: 200,
      status_text: "200 OK",
      timestamp: "May 24, 14:22:10",
      success: true,
    },
    {
      id: "del_2",
      attempt: "retry_1",
      label: "Failed",
      note: "Retry 1",
      http_status: 500,
      status_text: "500",
      timestamp: "May 24, 14:20:05",
      success: false,
    },
    {
      id: "del_1",
      attempt: "initial",
      label: "Failed",
      note: "Initial",
      http_status: 500,
      status_text: "500",
      timestamp: "May 24, 14:18:00",
      success: false,
    },
  ],
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={`text-[11px] font-semibold transition-colors ${
        copied ? "text-success-600" : "text-brand-600 hover:underline"
      }`}
    >
      {copied ? "Copied!" : label}
    </button>
  )
}

function InlineCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="text-ink-400 hover:text-brand-600 transition-colors"
    >
      {copied ? (
        <CheckCircle2 className="w-4 h-4 text-success-600" strokeWidth={2} />
      ) : (
        <Copy className="w-4 h-4" strokeWidth={2} />
      )}
    </button>
  )
}

export default function WebhookDetailPage({ params }: { params: { id: string } }) {
  const event = MOCK_EVENT // In production: fetch from Supabase by params.id

  const payloadStr = JSON.stringify(event.payload, null, 2)
  const responseStr = JSON.stringify(event.response, null, 2)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-4 mb-2">
        <Link
          href="/webhooks"
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-ink-100 transition-colors text-ink-500"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2} />
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-ink-900 tracking-tight">{event.type}</h2>
          <span className="px-2 py-0.5 rounded-full bg-success-50 text-success-600 border border-success-100 text-[10px] font-bold uppercase tracking-wide">
            Success
          </span>
          <span className="text-sm text-ink-400 font-medium">{event.timestamp}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column — Payload + Response */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          {/* Request Payload */}
          <section className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between bg-ink-50/50">
              <h3 className="text-[13px] font-bold text-ink-900 uppercase tracking-wider flex items-center gap-2">
                <svg className="w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Request Payload
              </h3>
              <CopyButton text={payloadStr} label="Copy JSON" />
            </div>
            <div className="bg-ink-950 p-6 overflow-x-auto">
              <pre className="text-[13px] font-mono leading-relaxed text-ink-200 whitespace-pre">
                <JsonDisplay data={event.payload} />
              </pre>
            </div>
          </section>

          {/* Response */}
          <section className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between bg-ink-50/50">
              <div className="flex items-center gap-4">
                <h3 className="text-[13px] font-bold text-ink-900 uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                  </svg>
                  Response
                </h3>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-[12px] font-bold text-success-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-500" />
                    HTTP 200
                  </span>
                  <span className="text-[12px] text-ink-400 font-medium">{event.processing_ms}ms</span>
                </div>
              </div>
              <CopyButton text={responseStr} label="Copy Response" />
            </div>
            <div className="bg-ink-950 p-6 overflow-x-auto">
              <pre className="text-[13px] font-mono leading-relaxed text-ink-200 whitespace-pre">
                <JsonDisplay data={event.response} />
              </pre>
            </div>
          </section>
        </div>

        {/* Right Column — History + Metadata */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* Delivery History */}
          <section className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-ink-100 bg-ink-50/50">
              <h3 className="text-[13px] font-bold text-ink-900 uppercase tracking-wider flex items-center gap-2">
                <svg className="w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                Delivery History
              </h3>
            </div>
            <div className="p-5">
              <div className="relative space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-ink-100">
                {event.delivery_history.map((attempt) => (
                  <div key={attempt.id} className="relative flex gap-4 items-start">
                    <div className={`relative z-10 w-6 h-6 rounded-full bg-white border-2 flex items-center justify-center flex-shrink-0 ${
                      attempt.success ? "border-success-500" : "border-danger-500"
                    }`}>
                      {attempt.success ? (
                        <svg className="w-3 h-3 text-success-600" viewBox="0 0 24 24" fill="currentColor">
                          <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 text-danger-600" viewBox="0 0 24 24" fill="currentColor">
                          <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5 gap-2">
                        <p className="text-[13px] font-bold text-ink-900">
                          {attempt.label}
                          {attempt.note && (
                            <span className="font-normal text-ink-400 ml-1">({attempt.note})</span>
                          )}
                        </p>
                        <span className={`text-[12px] font-mono px-1.5 py-0.5 rounded ${
                          attempt.success
                            ? "text-ink-600 bg-ink-100"
                            : "text-danger-600 bg-danger-50 border border-danger-100"
                        }`}>
                          {attempt.status_text}
                        </span>
                      </div>
                      <p className="text-[12px] text-ink-500">{attempt.timestamp}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Metadata */}
          <section className="bg-white border border-ink-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-ink-100 bg-ink-50/50">
              <h3 className="text-[13px] font-bold text-ink-900 uppercase tracking-wider flex items-center gap-2">
                <svg className="w-4 h-4 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                Metadata
              </h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink-500 font-medium">Provider</span>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-[#635BFF] rounded-sm" />
                  <span className="text-[13px] font-semibold text-ink-900 capitalize">{event.provider}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-400 font-medium uppercase tracking-tight">Webhook ID</span>
                <div className="flex items-center justify-between bg-ink-50 p-2 rounded border border-ink-100">
                  <code className="text-[12px] text-ink-700 font-mono">{event.webhook_id}</code>
                  <InlineCopyButton text={event.webhook_id} />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-400 font-medium uppercase tracking-tight">Idempotency Key</span>
                <div className="flex items-center justify-between bg-ink-50 p-2 rounded border border-ink-100">
                  <code className="text-[12px] text-ink-700 font-mono">{event.idempotency_key}</code>
                  <InlineCopyButton text={event.idempotency_key} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink-500 font-medium">Duration</span>
                <span className="text-[13px] font-semibold text-ink-900">{event.processing_ms}ms</span>
              </div>
            </div>
          </section>

          {/* Developer Insight */}
          <div className="bg-brand-50 border border-brand-100 p-5 rounded-xl">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-brand-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.355a7.5 7.5 0 0 1-3.75 0m0 0A7.482 7.482 0 0 1 4.5 12a7.5 7.5 0 0 1 7.5-7.5A7.5 7.5 0 0 1 19.5 12a7.482 7.482 0 0 1-4.5 6.478" />
              </svg>
              <div>
                <p className="text-[13px] font-bold text-brand-700 mb-1">Developer Insight</p>
                <p className="text-[12px] text-ink-600 leading-relaxed">
                  This event was delivered after 2 retries. Consider checking your endpoint&apos;s timeout settings to prevent future 500 errors during heavy loads.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Simple JSON syntax highlighter rendered as React
function JsonDisplay({ data }: { data: unknown }) {
  const str = JSON.stringify(data, null, 2)
  // Tokenize and render with color spans
  const tokens = str.split(/("(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g)

  return (
    <>
      {tokens.map((token, i) => {
        if (/^"/.test(token)) {
          // Check if it looks like a key (followed by :) — but we're splitting on the string itself,
          // so we check context: if the next non-whitespace char in the surrounding text is ":"
          const isKey = i + 1 < tokens.length && tokens[i + 1].trimStart().startsWith(":")
          return (
            <span key={i} style={{ color: isKey ? "#a78bfa" : "#34d399" }}>
              {token}
            </span>
          )
        }
        if (/^\d/.test(token) || token === "true" || token === "false" || token === "null") {
          return <span key={i} style={{ color: "#fbbf24" }}>{token}</span>
        }
        return <span key={i}>{token}</span>
      })}
    </>
  )
}
