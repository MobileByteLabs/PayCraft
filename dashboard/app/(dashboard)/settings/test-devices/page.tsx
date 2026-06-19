import { Info } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { TestDevicesClient } from "@/components/settings/test-devices-client"

export const dynamic = "force-dynamic"

export default async function TestDevicesPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data: devices } = await supabase.rpc("test_devices_list", {
    p_tenant_id: tenant.id,
  })

  return (
    <div className="max-w-[768px] mx-auto">
      <div className="mb-10">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900">
          Testing Devices
        </h2>
        <p className="text-ink-500 mt-1 max-w-2xl">
          Allow-list of device fingerprints that may see products marked{" "}
          <span className="font-medium">Test devices only</span> on the
          product editor. Production users (devices not on this list) never
          receive those products in their <code>/config</code> response — the
          server filters them before the JSON is sent.
        </p>
      </div>

      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-4">
          <div className="text-blue-500 mt-0.5 flex-shrink-0">
            <Info className="w-5 h-5" />
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-blue-900">
              How to register a device
            </h4>
            <ol className="text-sm text-blue-800/80 space-y-1 list-decimal pl-4">
              <li>
                Install the app on the test device. The PayCraft SDK logs the
                device fingerprint at startup:
                <pre className="mt-1 bg-blue-100/60 rounded px-2 py-1 font-mono text-[11px]">
                  PayCraft: [initialize] device_id = a1b2c3d4e5f60718
                </pre>
                On Android: <code>adb logcat | grep PayCraft</code>. On iOS:
                Xcode → Console.
              </li>
              <li>Paste the 16-character device ID into the form below.</li>
              <li>
                Click <span className="font-medium">Register device</span>.
                The next <code>/config</code> fetch from that device (or 1
                hour later, whichever is sooner) surfaces test-only products.
              </li>
              <li>
                Revoke access by deleting the row — the device drops back to
                the production product list on its next fetch.
              </li>
            </ol>
          </div>
        </div>

        <TestDevicesClient
          initialDevices={(devices ?? []) as TestDeviceRow[]}
        />
      </div>
    </div>
  )
}

export type TestDeviceRow = {
  id: string
  tenant_id: string
  device_id: string
  label: string | null
  created_at: string
}
