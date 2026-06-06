"use client"

import { useState } from "react"
import { Eye, EyeOff, AlertTriangle, Globe, Bell, Webhook, Building2 } from "lucide-react"

// Toggle switch component
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="w-11 h-6 bg-ink-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600" />
    </label>
  )
}

// Password field with visibility toggle
function PasswordField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-ink-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none px-3 py-2 pr-10 font-mono transition-all"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600 transition-colors"
      >
        {visible ? <EyeOff className="w-4 h-4" strokeWidth={2} /> : <Eye className="w-4 h-4" strokeWidth={2} />}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  // Organization state
  const [appName, setAppName] = useState("PayCraft Cloud")
  const [supportEmail, setSupportEmail] = useState("support@paycraft.io")

  // Webhooks state
  const [globalSecret, setGlobalSecret] = useState("sk_test_51MzR4VSDv8K0r")
  const [retryPolicy, setRetryPolicy] = useState("5")
  const [timeout, setTimeout] = useState("3000")

  // Alerts state
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [slackUrl, setSlackUrl] = useState("")
  const [churnThreshold, setChurnThreshold] = useState("5")
  const [failedWebhooksThreshold, setFailedWebhooksThreshold] = useState("2")

  // Region state
  const [dataResidency, setDataResidency] = useState("us-east")
  const [timezone, setTimezone] = useState("UTC")

  const inputClass =
    "w-full border border-ink-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none px-3 py-2 transition-all bg-white"
  const labelClass = "block text-xs font-bold text-ink-700 uppercase tracking-wider mb-1.5"
  const sectionHeaderClass = "p-6 border-b border-ink-100"

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-extrabold text-ink-900 tracking-tight">Settings</h2>
        <p className="text-ink-500 mt-1">Manage your platform configuration, team alerts, and data residency.</p>
      </div>

      <div className="space-y-6 max-w-3xl">
        {/* Organization Card */}
        <section className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          <div className={sectionHeaderClass}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-ink-100 text-ink-600 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-4 h-4" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-900">Organization</h3>
                <p className="text-sm text-ink-500 mt-0.5">Manage your brand identity and support contact.</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>App name</label>
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Support email</label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Logo Upload */}
            <div>
              <label className={labelClass}>Logo</label>
              <div className="flex items-center gap-6 p-4 border-2 border-dashed border-ink-200 rounded-xl hover:border-brand-300 transition-colors cursor-pointer group">
                <div className="w-16 h-16 bg-ink-100 rounded-lg flex items-center justify-center overflow-hidden border border-ink-100 flex-shrink-0">
                  <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">P</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900">Click to upload or drag and drop</p>
                  <p className="text-xs text-ink-500">SVG, PNG, JPG or GIF (max. 800×400px)</p>
                </div>
                <svg className="w-5 h-5 text-ink-400 group-hover:text-brand-500 transition-colors flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="16 16 12 12 8 16" />
                  <line x1="12" y1="12" x2="12" y2="21" />
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                </svg>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button className="bg-brand-600 text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-brand-700 transition-all active:scale-95 shadow-sm">
                Save changes
              </button>
            </div>
          </div>
        </section>

        {/* Webhooks Card */}
        <section className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          <div className={sectionHeaderClass}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-ink-100 text-ink-600 flex items-center justify-center flex-shrink-0">
                <Webhook className="w-4 h-4" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-900">Webhooks</h3>
                <p className="text-sm text-ink-500 mt-0.5">Configure delivery endpoints and retry behavior.</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div>
              <label className={labelClass}>Global secret</label>
              <PasswordField value={globalSecret} onChange={setGlobalSecret} />
              <p className="text-[11px] text-ink-500 mt-1.5">Used to sign every webhook request for security verification.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Retry policy</label>
                <select
                  value={retryPolicy}
                  onChange={(e) => setRetryPolicy(e.target.value)}
                  className={inputClass}
                >
                  <option value="3">3 attempts</option>
                  <option value="5">5 attempts</option>
                  <option value="10">10 attempts</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Timeout (ms)</label>
                <input
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button className="bg-brand-600 text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-brand-700 transition-all active:scale-95 shadow-sm">
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Alerts Card */}
        <section className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          <div className={sectionHeaderClass}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-ink-100 text-ink-600 flex items-center justify-center flex-shrink-0">
                <Bell className="w-4 h-4" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-900">Alerts</h3>
                <p className="text-sm text-ink-500 mt-0.5">Notifications for system events and thresholds.</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between p-4 bg-ink-50 rounded-xl border border-ink-100">
              <div>
                <p className="text-sm font-bold text-ink-900">Email alerts</p>
                <p className="text-xs text-ink-500 mt-0.5">Receive summaries of system health via email.</p>
              </div>
              <Toggle checked={emailAlerts} onChange={setEmailAlerts} />
            </div>
            <div>
              <label className={labelClass}>Slack Webhook URL</label>
              <input
                type="text"
                value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Churn rate threshold %</label>
                <input
                  type="number"
                  value={churnThreshold}
                  onChange={(e) => setChurnThreshold(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Failed webhooks threshold %</label>
                <input
                  type="number"
                  value={failedWebhooksThreshold}
                  onChange={(e) => setFailedWebhooksThreshold(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="pt-2 flex justify-end">
              <button className="bg-brand-600 text-white text-sm font-semibold px-6 py-2 rounded-lg hover:bg-brand-700 transition-all active:scale-95 shadow-sm">
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Region & Privacy Card */}
        <section className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          <div className={sectionHeaderClass}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-ink-100 text-ink-600 flex items-center justify-center flex-shrink-0">
                <Globe className="w-4 h-4" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink-900">Region &amp; Privacy</h3>
                <p className="text-sm text-ink-500 mt-0.5">Manage data residency and compliance.</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Data residency</label>
                <select
                  value={dataResidency}
                  onChange={(e) => setDataResidency(e.target.value)}
                  className={inputClass}
                >
                  <option value="us-east">US East – N. Virginia</option>
                  <option value="eu-central">EU – Frankfurt</option>
                  <option value="ap-southeast">AP – Singapore</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className={inputClass}
                >
                  <option value="UTC">UTC</option>
                  <option value="EST">EST (GMT-5)</option>
                  <option value="PST">PST (GMT-8)</option>
                  <option value="IST">IST (GMT+5:30)</option>
                </select>
              </div>
            </div>

            {/* Dangerous Actions */}
            <div className="pt-6 border-t border-ink-100 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-danger-50 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-danger-600" strokeWidth={2} />
                </div>
                <div>
                  <p className="text-sm font-bold text-ink-900">Dangerous Actions</p>
                  <p className="text-xs text-ink-500">Account deletion and GDPR compliance requests.</p>
                </div>
              </div>
              <button className="border border-danger-200 text-danger-600 text-sm font-semibold px-6 py-2 rounded-lg hover:bg-danger-50 transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap">
                <span className="text-[10px] bg-danger-100 px-1.5 py-0.5 rounded uppercase font-black">GDPR</span>
                Delete all data
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
