-- 076_native_store_methods.sql
--
-- Register the two native-store billing methods (Apple App Store / StoreKit 2 and Google Play
-- Billing) in provider_method_registry so they are VALID entries in tenant_routing_rules.priority_methods.
--
-- Why: the Platform-providers dashboard lets a merchant pick the PRIMARY provider per platform. For
-- iOS/Android the primary is the native store (mandatory for digital subscriptions per store policy),
-- and the merchant must be able to SELECT it explicitly. tenant_routing_rules_upsert() validates every
-- method against this registry (migration 075), so without a registry row the native primary can't be
-- persisted.
--
-- Safety: neither routing consumer transacts through these methods —
--   • checkout-router.ts tryMethod() switch has no app_store/google_play case → returns null → the
--     method is skipped and routing continues (native purchases go through the store SDK, never a URL).
--   • config/index.ts orderProvidersByPlatform() ranks providers by priority_methods; a native method
--     ranks the native provider, which is correct (SDK primaryProvider() = the native store on that
--     platform) and never affects web-provider ordering.
-- So these rows only make the native store a *selectable, persistable* primary — they add no checkout URL path.
--
-- fee_percent is capped at 15 by the registry's fee_percent_sane CHECK; the store commission is really
-- 15–30% (small-business vs standard). We store 15 (the sane-max) and the dashboard renders the
-- "15–30% store cut" range in the catalog. Idempotent via ON CONFLICT.

INSERT INTO public.provider_method_registry
  (method, display_name, provider, supports_one_time, supports_subscription,
   supported_countries, supported_currencies, fee_percent, fee_fixed_cents,
   cross_border_markup_percent, notes)
VALUES
  ('app_store',   'App Store (StoreKit 2)', 'app_store',   true, true,
   '{}', '{}', 15, 0, 0,
   'Apple StoreKit 2 in-app purchase. Mandatory for iOS digital subscriptions per App Store policy. 15% (small business) to 30% commission. Native-store method — not a routable checkout URL; the SDK transacts via StoreKit.'),
  ('google_play', 'Google Play Billing',    'google_play', true, true,
   '{}', '{}', 15, 0, 0,
   'Google Play Billing Library. Mandatory for Android digital subscriptions per Play policy. 15% (first $1M / subscriptions) to 30% commission. Native-store method — not a routable checkout URL; the SDK transacts via Play Billing.')
ON CONFLICT (method) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      supports_one_time = EXCLUDED.supports_one_time,
      supports_subscription = EXCLUDED.supports_subscription,
      supported_countries = EXCLUDED.supported_countries,
      supported_currencies = EXCLUDED.supported_currencies,
      fee_percent = EXCLUDED.fee_percent,
      fee_fixed_cents = EXCLUDED.fee_fixed_cents,
      cross_border_markup_percent = EXCLUDED.cross_border_markup_percent,
      notes = EXCLUDED.notes;
