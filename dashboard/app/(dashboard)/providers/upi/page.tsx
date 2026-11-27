import { UpiSetup } from "@/components/providers/upi-setup"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function UpiSetupPage() {
  return <UpiSetup />
}
