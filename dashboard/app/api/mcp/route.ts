import { MCP_TOOLS, TOOLS_BY_NAME } from "@/lib/mcp-tools"
import {
  SECURITY_HEADERS,
  bodyTooLarge,
  checkAuthAttempts,
  recordAuthFailure,
  tooManyAttempts,
  withSecurityHeaders,
} from "@/lib/api-security"

export const dynamic = "force-dynamic"

/**
 * Model Context Protocol server — Streamable HTTP transport.
 *
 * Implemented directly rather than via the official SDK: this runs on the Cloudflare edge runtime
 * through next-on-pages, and the SDK's transports assume Node. The protocol surface an agent
 * actually needs here is small — initialize, tools/list, tools/call, ping — and writing it plainly
 * costs less than shimming a Node server into a Worker.
 *
 * AUTHORIZATION is the same PayCraft key as the REST API, sent as a bearer token. Tools invoke the
 * REST handlers, so an agent has exactly the permissions its key carries, enforced by exactly the
 * code that enforces them for curl. There is no MCP-specific permission model to keep in step, and
 * no path by which connecting an agent grants more than the key already allowed.
 */

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const LATEST = SUPPORTED_PROTOCOLS[0]

const SERVER_INFO = {
  name: "paycraft",
  title: "PayCraft",
  version: "1.0.0",
}

const INSTRUCTIONS = [
  "PayCraft manages subscription billing across Stripe, Razorpay, Cashfree, Google Play and the App Store.",
  "",
  "Start with paycraft_readiness to see whether each provider can transact, live and in test.",
  "",
  "Before running a sync: call paycraft_sync_report, read confirm_count, then pass that exact number",
  "to paycraft_sync_run. The count is a safety gate — it proves the write acts on a set that was",
  "actually seen. A mismatch returns 409, which means re-read the report rather than retrying.",
  "",
  "A 200 from a sync does NOT mean every provider succeeded: read the `skipped` and `failed` arrays.",
  "",
  "Google Play and App Store test mode cannot be enabled through any API. Those readiness rows carry",
  "`manual_steps` — ordered instructions for a person with a device. Relay them; do not claim to have",
  "completed them.",
].join("\n")

type JsonRpcId = string | number | null

function rpcResult(id: JsonRpcId, result: unknown) {
  return jsonResponse({ jsonrpc: "2.0", id, result })
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } })
}

function jsonResponse(payload: unknown, status = 200) {
  return withSecurityHeaders(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
    }),
  )
}

/** JSON-RPC error codes. -32000..-32099 is the implementation-defined server range. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const UNAUTHORIZED = -32001

export async function POST(req: Request) {
  const oversized = bodyTooLarge(req)
  if (oversized) return oversized

  const attempts = checkAuthAttempts(req)
  if (!attempts.allowed) return tooManyAttempts(attempts)

  let msg: any
  try {
    msg = await req.json()
  } catch {
    return rpcError(null, PARSE_ERROR, "Parse error: body is not valid JSON")
  }

  // A batch is an array. Each entry is handled independently and the results returned together;
  // notifications inside a batch still produce no entry.
  if (Array.isArray(msg)) {
    const out = []
    for (const m of msg) {
      const r = await handle(m, req)
      if (r) out.push(r)
    }
    return out.length ? jsonResponse(out) : new Response(null, { status: 202 })
  }

  const result = await handle(msg, req)
  // A notification (no `id`) gets 202 with no body, per the transport spec.
  return result ? jsonResponse(result) : new Response(null, { status: 202, headers: SECURITY_HEADERS })
}

async function handle(msg: any, req: Request): Promise<unknown | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: INVALID_REQUEST, message: "Invalid Request" } }
  }

  const id: JsonRpcId = msg.id ?? null
  const isNotification = msg.id === undefined

  switch (msg.method) {
    case "initialize": {
      // Echo the client's version when we speak it; otherwise answer with ours and let it decide.
      const asked = msg.params?.protocolVersion
      const version = SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: version,
          // Only what is actually implemented. Advertising prompts or resources we do not serve
          // would make a client issue calls that can only fail.
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      }
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null

    case "ping":
      return { jsonrpc: "2.0", id, result: {} }

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              readOnlyHint: !t.destructive,
              destructiveHint: !!t.destructive,
              // Every write here is idempotent in effect: a second run with nothing to do reports
              // zero changes rather than duplicating work.
              idempotentHint: true,
              openWorldHint: true,
            },
          })),
        },
      }

    case "tools/call": {
      if (isNotification) return null
      const name = msg.params?.name
      const tool = typeof name === "string" ? TOOLS_BY_NAME.get(name) : undefined
      if (!tool) return { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Unknown tool: ${name}` } }

      const auth = req.headers.get("authorization") ?? ""
      if (!/^Bearer\s+pcsk_/i.test(auth)) {
        recordAuthFailure(req)
        // A protocol-level error, not a tool result: the call never reached the tool, and reporting
        // it as tool output would let an agent treat "you are not authenticated" as data.
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: UNAUTHORIZED,
            message:
              "Missing or malformed credential. Send a PayCraft secret key as 'Authorization: Bearer pcsk_…'.",
          },
        }
      }

      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      if (typeof args !== "object" || Array.isArray(args)) {
        return { jsonrpc: "2.0", id, error: { code: INVALID_PARAMS, message: "arguments must be an object" } }
      }

      const origin = new URL(req.url).origin
      let res: Response
      try {
        res = await tool.invoke(args as Record<string, any>, auth, origin)
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Tool execution failed: ${e instanceof Error ? e.message : String(e)}` }],
            isError: true,
          },
        }
      }

      const text = await res.text()
      // A failing HTTP status becomes `isError` on a successful JSON-RPC response — the protocol
      // distinction is "did the call happen" vs "did it succeed", and a 403 is a real answer the
      // model should read and act on, not a transport failure.
      const isError = !res.ok
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: isError ? `HTTP ${res.status}\n${text}` : text,
            },
          ],
          isError,
          ...(isError ? {} : { structuredContent: safeParse(text) }),
        },
      }
    }

    default:
      if (isNotification) return null
      return { jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${msg.method}` } }
  }
}

function safeParse(text: string): unknown {
  try {
    const v = JSON.parse(text)
    return v && typeof v === "object" ? v : { value: v }
  } catch {
    return undefined
  }
}

/**
 * GET is used by the transport to open a server→client SSE stream. This server never initiates
 * messages — no subscriptions, no progress notifications — so it declines rather than holding a
 * connection open that will only ever be idle. 405 with Allow is the spec's prescribed answer.
 */
export async function GET() {
  return withSecurityHeaders(
    new Response(JSON.stringify({ error: "method_not_allowed", detail: "This server does not offer an SSE stream." }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST, DELETE", ...SECURITY_HEADERS },
    }),
  )
}

/** Session teardown. Stateless server, so there is nothing to discard — acknowledge and move on. */
export async function DELETE() {
  return new Response(null, { status: 204, headers: SECURITY_HEADERS })
}
