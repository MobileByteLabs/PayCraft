export const runtime = "edge"

import { PlatformKeysGate } from "@/components/admin/platform-keys-gate"

// The owner check runs in the browser (TanStack Query); the wizard reads /api/admin/platform-keys itself.
export default function PlatformKeysPage() {
  return <PlatformKeysGate />
}
