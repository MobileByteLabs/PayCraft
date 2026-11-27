export const runtime = "edge"

import { CashfreeSetup } from "@/components/providers/cashfree-setup"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function CashfreeSetupPage() {
  return <CashfreeSetup />
}
