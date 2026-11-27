export const runtime = "edge"

import { BillingOverview } from "@/components/billing/billing-overview"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function BillingPage() {
  return <BillingOverview />
}
