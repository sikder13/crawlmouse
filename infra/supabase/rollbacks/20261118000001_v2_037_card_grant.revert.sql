-- Revert of infra/supabase/migrations/20261118000001_v2_037_card_grant.sql: authenticated reads
-- accounts.card_last4 again, as 20261101000001 granted it. Re-runnable.
grant select (card_last4) on public.accounts to authenticated;
