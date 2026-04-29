export interface Tenant {
  id: string
  name: string
  api_key_test: string
  api_key_live: string
  status: "active" | "suspended" | "churned"
  plan: "free" | "pro" | "enterprise"
  subscriber_limit: number
  owner_email: string
  created_at: string
}

export interface TenantAdmin {
  id: string
  tenant_id: string
  user_id: string
  role: "owner" | "admin" | "viewer"
}

export interface Subscription {
  id: string
  email: string
  provider: string
  provider_customer_id: string | null
  provider_subscription_id: string | null
  plan: string
  status: string
  mode: "test" | "live"
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  tenant_id: string | null
  created_at: string
  updated_at: string
}

export interface WebhookLog {
  id: string
  tenant_id: string
  provider: string
  event_type: string
  status: "success" | "failed"
  payload_redacted: Record<string, unknown>
  error_message: string | null
  created_at: string
}

export interface TenantProvider {
  id: string
  tenant_id: string
  provider: string
  test_payment_links: Record<string, string>
  live_payment_links: Record<string, string>
  is_active: boolean
  created_at: string
}
