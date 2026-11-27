export const runtime = "edge"

import { SubscriberDetail } from "./subscriber-detail"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function SubscriberDetailPage({ params }: { params: { id: string } }) {
  return <SubscriberDetail id={params.id} />
}
