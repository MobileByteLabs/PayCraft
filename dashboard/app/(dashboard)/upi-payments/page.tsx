export const runtime = "edge"

import { UpiPaymentsView } from "@/components/upi-payments/upi-payments-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function UpiPaymentsPage() {
  return <UpiPaymentsView />
}
