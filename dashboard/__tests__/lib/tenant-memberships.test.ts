/**
 * A failed membership lookup must never read as "this user has no apps".
 *
 * `requireTenant()` treated any RPC error from `tenant_admins_list_for_user` as an empty list and
 * redirected the signed-in owner to /onboarding. Local Kong returns transient 502s on that RPC
 * (keep-alive race with PostgREST), and a production gateway blip would do the same thing: an owner
 * with apps lands on "name your first app". `listMemberships` retries once and then throws, so a
 * real outage surfaces as an error page instead of a wrong page.
 */
import { listMemberships, MembershipLookupError } from "@/lib/tenant"

jest.mock("@/lib/supabase-server", () => ({ __esModule: true, createClient: jest.fn() }))
jest.mock("next/navigation", () => ({ __esModule: true, redirect: jest.fn() }))
jest.mock("next/headers", () => ({ __esModule: true, cookies: () => ({ get: () => undefined }) }))

type RpcResult = { data: unknown; error: { message: string } | null }

function client(results: RpcResult[]) {
  const rpc = jest.fn(async () => results.shift() ?? { data: null, error: { message: "exhausted" } })
  return { rpc } as unknown as Parameters<typeof listMemberships>[0] & { rpc: jest.Mock }
}

const ONE = [{ tenant_id: "11111111-1111-1111-1111-111111111111" }]
const GATEWAY = { message: "An invalid response was received from the upstream server" }

describe("listMemberships", () => {
  it("returns memberships on success without retrying", async () => {
    const sb = client([{ data: ONE, error: null }])
    await expect(listMemberships(sb)).resolves.toEqual(ONE)
    expect(sb.rpc).toHaveBeenCalledTimes(1)
  })

  it("returns an empty list only when the RPC succeeds with no rows", async () => {
    const sb = client([{ data: [], error: null }])
    await expect(listMemberships(sb)).resolves.toEqual([])
  })

  it("retries once after a transient error and returns the second answer", async () => {
    const sb = client([{ data: null, error: GATEWAY }, { data: ONE, error: null }])
    await expect(listMemberships(sb)).resolves.toEqual(ONE)
    expect(sb.rpc).toHaveBeenCalledTimes(2)
  })

  it("throws MembershipLookupError when both attempts fail — never an empty list", async () => {
    const sb = client([{ data: null, error: GATEWAY }, { data: null, error: GATEWAY }])
    await expect(listMemberships(sb)).rejects.toBeInstanceOf(MembershipLookupError)
    expect(sb.rpc).toHaveBeenCalledTimes(2)
  })
})
