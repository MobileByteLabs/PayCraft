import { AppsList } from "@/components/dashboard/apps-list"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function AppsPage() {
  return <AppsList />
}
