-- Revert of infra/supabase/migrations/20261110000001_v2_billing_rpc.sql.
--
-- ⚠ Turn V2_BILLING off in production first: the v2 Stripe webhook writes every event through
-- apply_stripe_event, and without it every delivery answers 500.
--
-- Drops the function and the three stripe_events columns. What the columns held is lost: which v2
-- events were decided, why, and the effects a decided but unstamped event still had to send. v1
-- reads none of them. The subscriptions rows and account changes the function wrote stay.
--
-- Every statement is re-runnable (v2-billing-rpc.test.ts runs it twice).

drop function if exists public.apply_stripe_event(jsonb);

alter table public.stripe_events drop column if exists effects;
alter table public.stripe_events drop column if exists handled_reason;
alter table public.stripe_events drop column if exists handled;
