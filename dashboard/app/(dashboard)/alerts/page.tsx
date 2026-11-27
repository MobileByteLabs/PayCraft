import { AlertsView } from "@/components/alerts/alerts-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function AlertsPage() {
  return <AlertsView />
}
