-- Revert of infra/supabase/migrations/20261110000001_v2_billing_rpc.sql.
--
-- ⚠ Turn V2_BILLING off in production first: the v2 Stripe webhook decides events through
-- apply_stripe_event, and without it a delivery that needs a decision answers 500.
--
-- Drops the function and the three stripe_events columns. What the columns held is lost: which v2
-- events were decided, why, and the effects a decided but unstamped event still had to send. v1's
-- handler (apply-stripe-event.ts) reads none of them. The subscriptions rows and account changes the function wrote stay.
--
-- The statements are re-runnable (v2-billing-rpc.test.ts runs the file twice).

drop function if exists public.apply_stripe_event(jsonb);

alter table public.stripe_events drop column if exists effects;
alter table public.stripe_events drop column if exists handled_reason;
alter table public.stripe_events drop column if exists handled;
