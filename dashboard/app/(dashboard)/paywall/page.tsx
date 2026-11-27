import { PaywallView } from "@/components/paywall/paywall-views"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function PaywallPage() {
  return <PaywallView />
}
