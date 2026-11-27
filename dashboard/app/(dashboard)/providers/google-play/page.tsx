export const runtime = "edge"

import { GooglePlaySetup } from "@/components/providers/google-play-setup"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function GooglePlaySetupPage() {
  return <GooglePlaySetup />
}
