import { ProvidersOverview } from "@/components/providers/providers-overview"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function ProvidersPage() {
  return <ProvidersOverview />
}
