// The one place the PayCraft Brain reaches attempt-level facts (paycraft-attempt-observability GOAL D13 / AC-17).
//
// It reads through the SAME `paycraft_*` MCP tool rows an external agent calls (lib/mcp-tools.ts), by name, so a
// question asked in the dashboard chat and the same question asked by Claude over MCP run one handler body on one
// request shape and cannot disagree. The difference is only who authenticated: an MCP agent presents an API key
// (the tool's `invoke` → /api/v1 route → withApiKey); the dashboard chat is a signed-in member whose tenant
// requireTenant() resolved, so the bridge runs the tool's `session` path with that member's own client — RLS
// still applies, and the tenant is the one the session resolved, never one a question names.
//
// Reader-only: only tools with a `session` path are reachable, and every one of them is a GET.

import type { SupabaseClient } from "@supabase/supabase-js"
import { MCP_TOOLS } from "@/lib/mcp-tools"

export const BRIDGE_TOOLS = ["paycraft_attempts", "paycraft_attempt", "paycraft_payment_health", "paycraft_funnel"] as const
export type BridgeTool = (typeof BRIDGE_TOOLS)[number]

/** A tool answer: the HTTP status the route would have returned plus its parsed JSON body. */
export type ToolResult<T = unknown> = { ok: boolean; status: number; body: T }

export type ToolReader = <T = unknown>(name: BridgeTool, args: Record<string, unknown>) => Promise<ToolResult<T>>

/** A reader bound to the signed-in member's client and resolved tenant. */
export function sessionToolReader(sb: SupabaseClient, tenantId: string): ToolReader {
  return async <T>(name: BridgeTool, args: Record<string, unknown>): Promise<ToolResult<T>> => {
    const tool = MCP_TOOLS.find((t) => t.name === name)
    if (!tool?.session) throw new Error(`MCP tool ${name} has no in-process session path`)
    // `tenant_id` is dropped by the tool itself; the session's tenant is the only one that reaches the handler.
    const res = await tool.session(sb, tenantId, args)
    const body = (await res.json().catch(() => ({ error: "unreadable_response" }))) as T
    return { ok: res.ok, status: res.status, body }
  }
}

/** One attempt with its timeline — what `paycraft_attempt` returns. */
export function readAttempt(read: ToolReader, id: string) {
  return read("paycraft_attempt", { id })
}

/** Payment health over a window — what `paycraft_payment_health` returns. */
export function readPaymentHealth(read: ToolReader, window: { since: string; until: string; mode: "live" | "test" }) {
  return read("paycraft_payment_health", window)
}
