import { TeamClient } from "./team-client"

/**
 * Team — REAL membership, from tenant_admins.
 *
 * WHAT THIS REPLACES. The page rendered entirely from two module-level fixtures, `MOCK_MEMBERS`
 * and `MOCK_PENDING`, so every account saw the same invented colleagues (including one at
 * "alex.dev@hotmail.com" who had supposedly joined in July 2024). On an access-control screen that
 * is the worst possible thing to fabricate: an operator auditing who can reach their billing data
 * saw people who do not exist, and would NOT have seen a real teammate who does.
 *
 * Membership now comes from `tenant_admins`, which is the same table the app's own authorization
 * checks read, so this page and the permission system cannot disagree.
 *
 * PENDING INVITATIONS have no backing table in the schema at all. Rather than keep a fixture
 * standing in for a feature that was never built, the list is passed through empty and the client
 * renders an honest empty state.
 *
 * Data is read in the browser (TanStack Query, inside TeamClient) — instant render, cached between visits. A fake pending invite implies an invitation was sent, which is a
 * worse failure than an empty section.
 */
export default function TeamPage() {
  return <TeamClient />
}
