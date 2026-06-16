// Global test setup — wire env vars before any module imports them.
process.env.PAYCRAFT_OAUTH_STATE_SECRET = "test-oauth-state-secret-deterministic"
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co"
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key"
process.env.NEXT_PUBLIC_PAYCRAFT_DASHBOARD_URL = "https://dash.test"
process.env.STRIPE_SECRET_KEY = "sk_test_platform"
