export const runtime = "edge"

import { SubscribersView } from "./subscribers-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function SubscribersPage() {
  return <SubscribersView />
}
