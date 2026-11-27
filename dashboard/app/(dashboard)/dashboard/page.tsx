export const runtime = "edge"

import { AccountOverview } from "@/components/dashboard/account-overview"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function OverviewPage() {
  return <AccountOverview />
}
