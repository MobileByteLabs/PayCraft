export const runtime = "edge"

import { AnalyticsView } from "./analytics-view"

// Data is read in the browser (TanStack Query); each section loads on its own and is cached between visits.
// GA4-backed sections come from /api/dash/analytics (PayCraft's service account stays on the server).
export default function AnalyticsPage() {
  return <AnalyticsView />
}
