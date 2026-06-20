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

/**
 * Single bullet in the paywall's value-prop list, rendered as an icon-leading
 * row under the hero subtitle. The icon string is a known vocabulary key
 * (ad-free, hd, unlimited, priority, early, wifi, lock, star, heart);
 * unknown keys fall back to a check icon in the SDK render.
 */
export interface ValuePropTriple {
  icon: string
  title: string
  description?: string
}

/**
 * Paywall config row stored at `tenant_paywall` (server) and edited by the
 * dashboard's Paywall designer. v2 contract — matches migration 071 columns
 * exactly. Authoritative shape for `/api/paywall` PATCH payload.
 *
 * **Defaults**: every nullable field defaults to a value matching reels-downloader's
 * existing hand-coded Settings banner copy so a consumer dropping in
 * `PayCraftPremiumBanner()` with no overrides gets an identical look.
 *
 * **Back-compat**: pre-2.1.0 SDKs ignore unknown fields via kotlinx.serialization's
 * `ignoreUnknownKeys = true` default, so emitting v2 fields to v1 consumers is safe.
 */
export interface PaywallConfig {
  tenant_id: string
  // v1 (migration 030)
  template: string
  theme_jsonb: Record<string, string>
  branding: "attribution" | "none" | "custom"
  custom_footer: string | null
  primary_color: string | null
  font_family: string | null
  support_email: string | null
  // v2 (migration 071)
  hero_title: string
  hero_subtitle: string
  value_props: ValuePropTriple[]
  cta_continue: string
  cta_get_premium: string
  restore_label: string
  terms_url: string | null
  privacy_url: string | null
  popular_plan_sku: string | null
  success_title: string
  success_message: string
  success_cta_label: string
  hero_icon_svg: string | null
  hero_icon_url: string | null
}

export const PAYWALL_CONFIG_DEFAULTS: Omit<PaywallConfig, "tenant_id"> = {
  template: "branded-stack",
  theme_jsonb: {},
  branding: "attribution",
  custom_footer: null,
  primary_color: null,
  font_family: null,
  support_email: null,
  hero_title: "Upgrade to Premium",
  hero_subtitle: "Enjoy ad-free experience, HD downloads, and exclusive features",
  value_props: [],
  cta_continue: "Continue",
  cta_get_premium: "Get Premium",
  restore_label: "Restore Your Premium",
  terms_url: null,
  privacy_url: null,
  popular_plan_sku: null,
  success_title: "Welcome to Premium!",
  success_message: "You now have access to all premium features.",
  success_cta_label: "Continue to app",
  hero_icon_svg: null,
  hero_icon_url: null,
}

/**
 * Known value-prop icon-keys. The SDK ships a curated set of Material/inline
 * vectors for these; arbitrary keys are accepted on the wire but render with
 * a generic check icon. Dashboards SHOULD restrict the picker to this list.
 */
export const VALUE_PROP_ICON_VOCAB = [
  "ad-free",
  "hd",
  "unlimited",
  "priority",
  "early",
  "wifi",
  "lock",
  "star",
  "heart",
] as const

export type ValuePropIconKey = typeof VALUE_PROP_ICON_VOCAB[number]
