export const runtime = "edge"

import { CouponsManager } from "@/components/coupons/coupons-manager"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function CouponsPage() {
  return <CouponsManager />
}
