import { RoutingRulesView } from "@/components/providers/routing-rules-view"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function RoutingRulesPage() {
  return <RoutingRulesView />
}
