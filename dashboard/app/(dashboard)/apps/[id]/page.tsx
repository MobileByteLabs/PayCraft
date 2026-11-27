export const runtime = "edge"

import { AppDetail } from "@/components/dashboard/app-detail"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function AppDetailPage({ params }: { params: { id: string } }) {
  return <AppDetail id={params.id} />
}
