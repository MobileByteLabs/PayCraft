export const runtime = "edge"

import { AuditLog } from "@/components/dashboard/audit-log"

// Data is read in the browser (TanStack Query) — this page renders instantly and is cached between visits.
export default function AuditPage() {
  return <AuditLog />
}
