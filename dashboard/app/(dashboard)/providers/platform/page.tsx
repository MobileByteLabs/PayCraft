export const runtime = "edge"

import { PlatformProvidersView } from "@/components/providers/platform-providers-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function PlatformProvidersPage() {
  return <PlatformProvidersView />
}
