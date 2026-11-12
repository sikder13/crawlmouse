-- Reverts 20261114000001_v2_029_public_pages.sql. Re-runnable. Dropping the two accounts columns
-- forgets any open agency Checkout URL; the Checkout sessions themselves expire in Stripe.
drop index if exists public.public_reports_check_uq;
drop table if exists public.contact_requests;
drop function if exists public.start_agency_trial_account(uuid, text, text);
alter table public.accounts drop column if exists agency_checkout_at;
alter table public.accounts drop column if exists agency_checkout_url;
