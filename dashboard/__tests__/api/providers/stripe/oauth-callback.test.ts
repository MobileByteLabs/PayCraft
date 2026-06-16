/**
 * Unit tests for the Stripe Connect OAuth callback handler.
 *
 * Scope (AC-1 of sub-plan 01-stripe-connect-oauth):
 *  1. Valid state + valid code → exchanges code, registers webhook, calls
 *     tenant_stripe_connect_save + tenant_stripe_connect_set_webhook RPCs,
 *     302-redirects to /providers/stripe?connected=1
 *  2. Invalid state (HMAC mismatch) → 302 ?error=invalid_state, NO Stripe calls
 *  3. Missing code → 302 ?error=missing_params
 *  4. Stripe oauth.token rejects → 302 ?error=token_exchange:...
 *  5. Webhook endpoint creation fails AFTER token exchange → tokens still
 *     persisted, set_webhook RPC NOT called, redirect still ?connected=1
 *
 * Mocking strategy:
 *  - `@/lib/stripe-client` is mocked so getPlatformStripeClient returns a fake
 *    Stripe with a controllable `oauth.token` jest.fn().
 *  - The `stripe` SDK constructor (used to build the connected-account client
 *    inside the route) is mocked at the module factory level so we can capture
 *    webhookEndpoints.create calls and inject failures.
 *  - `@/lib/supabase-server` is mocked to expose a recording `rpc` jest.fn so
 *    we can assert payloads.
 *
 * The route imports `next/server` which expects a Web-platform Request. Node 18+
 * already provides global `Request`/`Response`/`URL`. We construct
 * `NextRequest`-shaped objects via `new NextRequest(url)` from the package.
 */

import { NextRequest } from "next/server"

// ---------- Mocks (must be declared before importing the route under test) ----------

const mockOauthToken = jest.fn()
const mockWebhookCreate = jest.fn()
const mockSupabaseRpc = jest.fn()

// Mock the platform Stripe wrapper.
jest.mock("@/lib/stripe-client", () => ({
  getPlatformStripeClient: jest.fn(async () => ({
    oauth: { token: mockOauthToken },
  })),
}))

// Mock the supabase-server createClient.
jest.mock("@/lib/supabase-server", () => ({
  createClient: jest.fn(() => ({
    rpc: mockSupabaseRpc,
  })),
}))

// Mock the `stripe` SDK constructor used inside the route to build a
// connected-account client. The route does `new Stripe(access_token, ...)`
// AFTER getPlatformStripeClient — that path needs `webhookEndpoints.create`.
jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    webhookEndpoints: { create: mockWebhookCreate },
  }))
})

// Import AFTER mocks so the route picks up the mocked modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require("@/app/api/providers/stripe/oauth/callback/route")
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { makeState } = require("@/lib/stripe-oauth-state")

// ---------- Helpers ----------

const TENANT_ID = "11111111-2222-3333-4444-555555555555"
const DASHBOARD_URL = "https://dash.test"
const CONNECT_REDIRECT_BASE = `${DASHBOARD_URL}/providers/stripe`

function buildReq(params: Record<string, string>): NextRequest {
  const url = new URL(`${DASHBOARD_URL}/api/providers/stripe/oauth/callback`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

beforeEach(() => {
  mockOauthToken.mockReset()
  mockWebhookCreate.mockReset()
  mockSupabaseRpc.mockReset()
  // Default: RPCs resolve OK.
  mockSupabaseRpc.mockResolvedValue({ data: null, error: null })
})

describe("GET /api/providers/stripe/oauth/callback", () => {
  // ---------- Case 1: happy path ----------
  it("exchanges code, persists tokens, registers webhook, redirects to ?connected=1", async () => {
    const state = makeState(TENANT_ID)
    mockOauthToken.mockResolvedValue({
      access_token: "sk_acct_access",
      refresh_token: "rt_refresh",
      stripe_user_id: "acct_TEST123",
      livemode: false,
      scope: "read_write",
    })
    mockWebhookCreate.mockResolvedValue({ id: "we_TEST_endpoint" })

    const res = await GET(buildReq({ code: "ac_valid_code", state }))

    expect(res.status).toBe(307) // Next.js redirect default
    expect(res.headers.get("location")).toBe(`${CONNECT_REDIRECT_BASE}?connected=1`)

    // Token exchange called with the auth code.
    expect(mockOauthToken).toHaveBeenCalledWith({
      grant_type: "authorization_code",
      code: "ac_valid_code",
    })

    // Persistence RPC payload.
    const saveCall = mockSupabaseRpc.mock.calls.find(
      (c) => c[0] === "tenant_stripe_connect_save",
    )
    expect(saveCall).toBeDefined()
    expect(saveCall![1]).toMatchObject({
      p_tenant_id: TENANT_ID,
      p_stripe_account_id: "acct_TEST123",
      p_access_token: "sk_acct_access",
      p_refresh_token: "rt_refresh",
      p_livemode: false,
      p_scope: "read_write",
    })

    // Webhook created on the connected account.
    expect(mockWebhookCreate).toHaveBeenCalledTimes(1)
    const whArg = mockWebhookCreate.mock.calls[0][0]
    expect(whArg.url).toBe(
      `https://test.supabase.co/functions/v1/stripe-webhook/${TENANT_ID}`,
    )
    expect(whArg.enabled_events).toEqual(
      expect.arrayContaining([
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.payment_succeeded",
        "invoice.payment_failed",
        "checkout.session.completed",
      ]),
    )

    // Webhook id persisted via set_webhook RPC.
    const setWhCall = mockSupabaseRpc.mock.calls.find(
      (c) => c[0] === "tenant_stripe_connect_set_webhook",
    )
    expect(setWhCall![1]).toMatchObject({
      p_tenant_id: TENANT_ID,
      p_webhook_endpoint_id: "we_TEST_endpoint",
    })
  })

  // ---------- Case 2: invalid state (HMAC mismatch) ----------
  it("rejects an HMAC-mismatched state with ?error=invalid_state and makes NO Stripe calls", async () => {
    // Forge a state with a junk signature.
    const forged = Buffer.from(`${TENANT_ID}:${Date.now()}:DEADBEEF`).toString("base64url")

    const res = await GET(buildReq({ code: "ac_valid_code", state: forged }))

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(`${CONNECT_REDIRECT_BASE}?error=invalid_state`)
    expect(mockOauthToken).not.toHaveBeenCalled()
    expect(mockWebhookCreate).not.toHaveBeenCalled()
    expect(mockSupabaseRpc).not.toHaveBeenCalled()
  })

  // ---------- Case 3: missing code param ----------
  it("returns ?error=missing_params when code is absent", async () => {
    const state = makeState(TENANT_ID)
    const res = await GET(buildReq({ state })) // no code

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(`${CONNECT_REDIRECT_BASE}?error=missing_params`)
    expect(mockOauthToken).not.toHaveBeenCalled()
  })

  // ---------- Case 4: oauth.token rejects ----------
  it("redirects with ?error=token_exchange:... when Stripe rejects the auth code", async () => {
    const state = makeState(TENANT_ID)
    mockOauthToken.mockRejectedValue(new Error("invalid_grant: code expired"))

    const res = await GET(buildReq({ code: "ac_bad", state }))

    expect(res.status).toBe(307)
    const loc = res.headers.get("location") ?? ""
    expect(loc).toContain(`${CONNECT_REDIRECT_BASE}?error=token_exchange:`)
    expect(loc).toContain(encodeURIComponent("invalid_grant"))
    // No persistence attempted.
    expect(mockSupabaseRpc).not.toHaveBeenCalled()
    expect(mockWebhookCreate).not.toHaveBeenCalled()
  })

  // ---------- Case 4b: "Connect not enabled" hint ----------
  it("redirects with ?error=connect_disabled:... when Stripe reports Connect is not enabled", async () => {
    const state = makeState(TENANT_ID)
    mockOauthToken.mockRejectedValue(
      new Error("Stripe Connect is not enabled on this account."),
    )

    const res = await GET(buildReq({ code: "ac_ok", state }))
    expect(res.headers.get("location")).toMatch(/error=connect_disabled:/)
  })

  // ---------- Case 5: webhook creation fails AFTER token persistence ----------
  it("persists tokens but skips set_webhook when webhookEndpoints.create throws — redirect still ?connected=1", async () => {
    const state = makeState(TENANT_ID)
    mockOauthToken.mockResolvedValue({
      access_token: "sk_acct_access",
      refresh_token: "rt_refresh",
      stripe_user_id: "acct_TEST123",
      livemode: false,
      scope: "read_write",
    })
    mockWebhookCreate.mockRejectedValue(new Error("api_connection_error"))
    // Silence the route's console.error noise during the assertion window.
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    const res = await GET(buildReq({ code: "ac_valid_code", state }))

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe(`${CONNECT_REDIRECT_BASE}?connected=1`)

    // Save RPC ran (tokens persisted)…
    expect(
      mockSupabaseRpc.mock.calls.some(
        (c) => c[0] === "tenant_stripe_connect_save",
      ),
    ).toBe(true)
    // …but set_webhook did NOT (because create() threw before that RPC).
    expect(
      mockSupabaseRpc.mock.calls.some(
        (c) => c[0] === "tenant_stripe_connect_set_webhook",
      ),
    ).toBe(false)
    // The failure was logged for retry.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[stripe-oauth-callback] webhook registration failed"),
      expect.any(String),
    )
    errSpy.mockRestore()
  })

  // ---------- Bonus: incomplete token response ----------
  it("redirects with ?error=incomplete_token when Stripe returns a partial token payload", async () => {
    const state = makeState(TENANT_ID)
    mockOauthToken.mockResolvedValue({
      access_token: "sk_acct_access",
      // refresh_token + stripe_user_id missing → incomplete
    })

    const res = await GET(buildReq({ code: "ac_ok", state }))
    expect(res.headers.get("location")).toBe(`${CONNECT_REDIRECT_BASE}?error=incomplete_token`)
    expect(mockSupabaseRpc).not.toHaveBeenCalled()
  })

  // ---------- Bonus: persist RPC rejects ----------
  it("redirects with ?error=persist:... when the save RPC fails", async () => {
    const state = makeState(TENANT_ID)
    mockOauthToken.mockResolvedValue({
      access_token: "sk_acct_access",
      refresh_token: "rt_refresh",
      stripe_user_id: "acct_TEST123",
      livemode: true,
      scope: "read_write",
    })
    mockSupabaseRpc.mockImplementationOnce(async (fn: string) => {
      if (fn === "tenant_stripe_connect_save") {
        return { data: null, error: { message: "rls_violation" } }
      }
      return { data: null, error: null }
    })

    const res = await GET(buildReq({ code: "ac_ok", state }))
    expect(res.headers.get("location")).toContain("error=persist:")
    expect(res.headers.get("location")).toContain("rls_violation")
    expect(mockWebhookCreate).not.toHaveBeenCalled()
  })
})
