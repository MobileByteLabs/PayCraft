export const runtime = "edge"

import { WebhookEventLoader } from "./event-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function WebhookEventPage({ params }: { params: { id: string } }) {
  return <WebhookEventLoader id={params.id} />
}
