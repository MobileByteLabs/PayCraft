-- 167 — the APP's sign-in clients, delivered to the SDK in /config (PLAN-paycraft-native-identity D2).
--
-- PayCraft signs buyers in natively on its OWN Supabase project, but the token audience must be the
-- app's: Credential Manager mints Google ID tokens only for a Web client living in the same Google
-- Cloud project as the app's Android client, and Apple off-iOS needs a Services ID whose Return URL
-- lists PayCraft's callback. Storing them per tenant is what lets the SDK own sign-in end to end —
-- the consumer passes nothing. Both are PUBLIC identifiers (not secrets); /idea-auth writes them.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS auth_google_web_client_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS auth_apple_services_id text;
