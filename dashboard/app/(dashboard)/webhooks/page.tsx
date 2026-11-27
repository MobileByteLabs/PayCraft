export const runtime = "edge"

import { WebhooksView } from "./webhooks-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function WebhooksPage() {
  return <WebhooksView />
}
