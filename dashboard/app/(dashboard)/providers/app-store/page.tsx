export const runtime = "edge"

import { AppStoreSetup } from "@/components/providers/app-store-setup"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function AppStoreSetupPage() {
  return <AppStoreSetup />
}
