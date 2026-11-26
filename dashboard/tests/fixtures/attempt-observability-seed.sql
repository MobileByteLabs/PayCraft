-- dashboard/tests/fixtures/attempt-observability-seed.sql — the e2e tenant's purchase attempts, timelines, alerts
-- (paycraft-attempt-observability 05-dashboard T9). __TENANT__ is replaced per run; the spec deletes every row below
-- in afterAll. Writes go to the real tables (checkout_attempts under the payment_attempts view), so the dashboard
-- reads them through the same views, RLS and buyer hash production uses.
--
-- Five live attempts (hand-computed numbers the spec asserts):
--   buyer   attempt                state             stage        provider  country  furthest step
--   carol   e2e-att-granted        granted           —            razorpay  IN       provider_result
--   carol   e2e-att-failed         failed            provider     stripe    US       checkout_open (card_declined)
--   carol   e2e-att-abandon        abandoned         sdk          stripe    IN       checkout_open   + nudge scheduled
--   dave    e2e-att-paidng         paid_not_granted  entitlement  stripe    US       provider_result (inferred)
--   erin    e2e-att-erin           abandoned         sdk          razorpay  IN       plan_select     + nudge skipped (no permission)
--   → totals 5 · granted 20% · byStage provider 1/5, entitlement 1/5 · stripe 2/3 failed · US 2/2 failed
--   → abandon: plan_select 1/5 = 20%, checkout_open 1/4 = 25%, provider_result 0/2 · nudge reach 1/2 = 50%

-- Carol is a subscriber, so she has a detail page; dave and erin only ever attempted.
INSERT INTO subscriptions (id, tenant_id, email, provider, plan, status, mode, created_at, updated_at)
VALUES ('00000000-0e2e-0e2e-0e2e-00000000ca01', '__TENANT__', 'carol@example.com', 'razorpay', 'pro', 'active', 'live',
        now() - interval '3 days', now() - interval '3 days');

-- The table's own trigger appends each attempt's entered state to attempt_events at now(); the seed replaces
-- those with the full, correctly-timed history below.
INSERT INTO checkout_attempts (tenant_id, attempt_id, provider, provider_session_id, mode, email, plan, outcome, state, correlation, match_rule, stage, error_class, error_code, error_message, occurred_at, paid_at, granted_at, closed_at) VALUES
  ('__TENANT__', 'e2e-att-granted', 'razorpay', 'e2e-sess-granted', 'live', 'carol@example.com', 'pro-monthly', 'abandoned',      'granted',          'exact',    NULL,            NULL,          NULL,            NULL,            NULL,                      now() - interval '3 days', now() - interval '3 days' + interval '100 sec', now() - interval '3 days' + interval '2 min', now() - interval '3 days' + interval '2 min'),
  ('__TENANT__', 'e2e-att-failed',  'stripe',   'e2e-sess-failed',  'live', 'carol@example.com', 'pro-annual',  'payment_failed', 'failed',           'exact',    NULL,            'provider',    'card_declined', 'card_declined', 'Your card was declined.', now() - interval '1 day',  NULL, NULL, now() - interval '1 day' + interval '4 min'),
  ('__TENANT__', 'e2e-att-abandon', 'stripe',   'e2e-sess-abandon', 'live', 'carol@example.com', 'pro-annual',  'abandoned',      'abandoned',        'exact',    NULL,            'sdk',         'flow_switch',   'new_plan_select', NULL,                    now() - interval '6 hours', NULL, NULL, now() - interval '6 hours' + interval '30 min'),
  ('__TENANT__', 'e2e-att-paidng',  'stripe',   'e2e-sess-paidng',  'live', 'dave@example.com',  'pro-monthly', 'abandoned',      'paid_not_granted', 'inferred', 'session_email', 'entitlement', 'grant_missing', 'grant_timeout', 'No entitlement 10 min after payment.', now() - interval '2 hours', now() - interval '2 hours' + interval '1 min', NULL, now() - interval '2 hours' + interval '12 min'),
  ('__TENANT__', 'e2e-att-erin',    'razorpay', 'e2e-sess-erin',    'live', 'erin@example.com',  'pro-monthly', 'abandoned',      'abandoned',        'exact',    NULL,            'sdk',         NULL,            NULL,            NULL,                      now() - interval '5 hours', NULL, NULL, now() - interval '5 hours' + interval '30 min');

DELETE FROM attempt_events WHERE tenant_id = '__TENANT__';

INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, error_code, error_message, occurred_at) VALUES
  ('e2e-att-granted', '__TENANT__', 'sdk',         'started',                  NULL, NULL, NULL, now() - interval '3 days'),
  ('e2e-att-granted', '__TENANT__', 'sdk',         'paycraft_checkout_start',  NULL, NULL, NULL, now() - interval '3 days' + interval '20 sec'),
  ('e2e-att-granted', '__TENANT__', 'server',      'checkout_opened',          NULL, NULL, NULL, now() - interval '3 days' + interval '22 sec'),
  ('e2e-att-granted', '__TENANT__', 'sdk',         'paycraft_checkout_return', NULL, NULL, NULL, now() - interval '3 days' + interval '95 sec'),
  ('e2e-att-granted', '__TENANT__', 'provider',    'provider_result',          NULL, NULL, NULL, now() - interval '3 days' + interval '100 sec'),
  ('e2e-att-granted', '__TENANT__', 'entitlement', 'granted',                  NULL, NULL, NULL, now() - interval '3 days' + interval '2 min'),
  ('e2e-att-failed',  '__TENANT__', 'sdk',         'started',                  NULL, NULL, NULL, now() - interval '1 day'),
  ('e2e-att-failed',  '__TENANT__', 'sdk',         'paycraft_checkout_start',  NULL, NULL, NULL, now() - interval '1 day' + interval '30 sec'),
  ('e2e-att-failed',  '__TENANT__', 'server',      'checkout_opened',          NULL, NULL, NULL, now() - interval '1 day' + interval '32 sec'),
  ('e2e-att-failed',  '__TENANT__', 'provider',    'failed',                   'card_declined', 'card_declined', 'Your card was declined.', now() - interval '1 day' + interval '4 min'),
  ('e2e-att-abandon', '__TENANT__', 'sdk',         'started',                  NULL, NULL, NULL, now() - interval '6 hours'),
  ('e2e-att-abandon', '__TENANT__', 'sdk',         'paycraft_checkout_start',  NULL, NULL, NULL, now() - interval '6 hours' + interval '10 sec'),
  ('e2e-att-abandon', '__TENANT__', 'server',      'checkout_opened',          NULL, NULL, NULL, now() - interval '6 hours' + interval '12 sec'),
  ('e2e-att-abandon', '__TENANT__', 'sdk',         'paycraft_attempt_abandon', 'flow_switch', 'new_plan_select', NULL, now() - interval '6 hours' + interval '30 min'),
  ('e2e-att-abandon', '__TENANT__', 'sdk',         'abandoned',                NULL, NULL, NULL, now() - interval '6 hours' + interval '30 min'),
  ('e2e-att-abandon', '__TENANT__', 'sdk',         'paycraft_nudge_scheduled', NULL, NULL, NULL, now() - interval '6 hours' + interval '31 min'),
  ('e2e-att-paidng',  '__TENANT__', 'sdk',         'started',                  NULL, NULL, NULL, now() - interval '2 hours'),
  ('e2e-att-paidng',  '__TENANT__', 'server',      'checkout_opened',          NULL, NULL, NULL, now() - interval '2 hours' + interval '15 sec'),
  ('e2e-att-paidng',  '__TENANT__', 'provider',    'provider_result',          NULL, NULL, NULL, now() - interval '2 hours' + interval '1 min'),
  ('e2e-att-paidng',  '__TENANT__', 'server',      'stitched:session_email',   NULL, NULL, NULL, now() - interval '2 hours' + interval '5 min'),
  ('e2e-att-paidng',  '__TENANT__', 'entitlement', 'paid_not_granted',         'grant_missing', 'grant_timeout', 'No entitlement 10 min after payment.', now() - interval '2 hours' + interval '12 min'),
  ('e2e-att-erin',    '__TENANT__', 'sdk',         'started',                  NULL, NULL, NULL, now() - interval '5 hours'),
  ('e2e-att-erin',    '__TENANT__', 'sdk',         'abandoned',                NULL, NULL, NULL, now() - interval '5 hours' + interval '30 min'),
  ('e2e-att-erin',    '__TENANT__', 'sdk',         'paycraft_nudge_skipped',   'permission', 'skipped_no_permission', NULL, now() - interval '5 hours' + interval '31 min');

-- The attempt's country is the server's (events function geo), on the buyer's paywall events. A paywall view
-- precedes the plan pick and carries no attempt id (the SDK mints it at plan select), exactly as in production.
INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, country, provider, mode, attempt_id, occurred_at) VALUES
  ('__TENANT__', 'e2e-dev-carol', 'paycraft_paywall_view', 'paywall', 'android', 'IN', NULL, 'live', NULL, now() - interval '3 days' - interval '1 min'),
  ('__TENANT__', 'e2e-dev-dave',  'paycraft_paywall_view', 'paywall', 'web',     'US', NULL, 'live', NULL, now() - interval '2 hours' - interval '1 min'),
  ('__TENANT__', 'e2e-dev-erin',  'paycraft_paywall_view', 'paywall', 'android', 'IN', NULL, 'live', NULL, now() - interval '5 hours' - interval '1 min'),
  ('__TENANT__', 'e2e-dev-carol', 'paycraft_plan_select', 'paywall', 'android', 'IN', 'razorpay', 'live', 'e2e-att-granted', now() - interval '3 days'),
  ('__TENANT__', 'e2e-dev-carol', 'paycraft_plan_select', 'paywall', 'android', 'US', 'stripe',   'live', 'e2e-att-failed',  now() - interval '1 day'),
  ('__TENANT__', 'e2e-dev-carol', 'paycraft_plan_select', 'paywall', 'android', 'IN', 'stripe',   'live', 'e2e-att-abandon', now() - interval '6 hours'),
  ('__TENANT__', 'e2e-dev-dave',  'paycraft_plan_select', 'paywall', 'web',     'US', 'stripe',   'live', 'e2e-att-paidng',  now() - interval '2 hours'),
  ('__TENANT__', 'e2e-dev-erin',  'paycraft_plan_select', 'paywall', 'android', 'IN', 'razorpay', 'live', 'e2e-att-erin',    now() - interval '5 hours');

-- Inbox: two unread (one critical, one digest) and one already read; the critical one has delivery outcomes.
INSERT INTO tenant_alerts (id, tenant_id, kind, severity, dedupe_key, title, body, stage, code, correlation, created_at, read_at) VALUES
  ('00000000-0e2e-0e2e-0e2e-0000000a1e01', '__TENANT__', 'paid_not_granted', 'critical', 'e2e-att-paidng', 'Paid but not granted',
   'A buyer paid with Stripe at ' || to_char(now() - interval '2 hours' + interval '1 min', 'HH24:MI') || ' UTC and has no access 10 minutes later. Matched by rule session_email.',
   'entitlement', 'grant_timeout', 'inferred', now() - interval '100 min', NULL),
  ('00000000-0e2e-0e2e-0e2e-0000000a1e02', '__TENANT__', 'abandon_digest', 'digest', 'hour-e2e', 'Hourly digest — 2 abandoned checkouts',
   '2 buyers left a checkout in the last hour (1 Stripe, 1 Razorpay).', NULL, NULL, NULL, now() - interval '60 min', NULL),
  ('00000000-0e2e-0e2e-0e2e-0000000a1e03', '__TENANT__', 'webhook_sig_fail', 'critical', 'stripe_signature', 'Stripe webhook signatures failing',
   '3 Stripe webhooks failed signature verification in the last hour — was the signing secret rotated?', 'webhook', 'stripe_signature', NULL,
   now() - interval '1 day', now() - interval '23 hours');

INSERT INTO alert_deliveries (alert_id, channel, status, attempts, http_status, error) VALUES
  ('00000000-0e2e-0e2e-0e2e-0000000a1e01', 'email',   'sent',   1, NULL, NULL),
  ('00000000-0e2e-0e2e-0e2e-0000000a1e01', 'slack',   'failed', 3, 500,  'HTTP 500: internal_error'),
  ('00000000-0e2e-0e2e-0e2e-0000000a1e01', 'inbox',   'sent',   1, NULL, NULL),
  ('00000000-0e2e-0e2e-0e2e-0000000a1e02', 'inbox',   'sent',   1, NULL, NULL);
