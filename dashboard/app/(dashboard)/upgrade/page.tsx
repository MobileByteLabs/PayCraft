import { requireTenant } from "@/lib/tenant"
import { UpgradeCards } from "./upgrade-cards"

export default async function UpgradePage() {
  const { tenant } = await requireTenant()

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Upgrade Plan</h1>
      <p className="text-gray-500 mb-8">
        Current plan: <span className="font-medium capitalize">{tenant.plan}</span>
        {" "}({tenant.subscriber_limit.toLocaleString()} subscribers)
      </p>
      <UpgradeCards currentPlan={tenant.plan} tenantId={tenant.id} />
    </div>
  )
}
