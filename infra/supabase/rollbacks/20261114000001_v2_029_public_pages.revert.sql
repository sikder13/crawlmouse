-- Reverts 20261114000001_v2_029_public_pages.sql. Re-runnable. It drops four accounts columns:
-- agency_trial_consent_at, and the three that hold an open agency Checkout (agency_checkout_url,
-- agency_checkout_at, agency_checkout_interval), which forgets its URL; the Checkout sessions
-- themselves expire in Stripe. It deletes the ledger's agency_plus_contact rows (email_sends), which
-- record the mail of the contact_requests it drops, and restores CC-28's eight-kind check. Both are
-- skipped when email_sends is absent, i.e. 028 was reverted first.
drop index if exists public.public_reports_check_uq;
drop function if exists public.purge_contact_requests(timestamptz);
drop table if exists public.contact_requests;
do $$
begin
  if pg_catalog.to_regclass('public.email_sends') is not null then
    delete from public.email_sends where kind = 'agency_plus_contact';
    alter table public.email_sends drop constraint if exists email_sends_kind_check;
    alter table public.email_sends add constraint email_sends_kind_check
      check (kind in ('check_notify', 'fix_to_developer', 'trial_reminder', 'email_change_confirm',
                      'email_change_notice', 'account_delete', 'alert', 'weekly_summary'));
  end if;
end $$;
drop function if exists public.start_agency_trial_account(uuid, text, text);
alter table public.accounts drop column if exists agency_trial_consent_at;
alter table public.accounts drop column if exists agency_checkout_interval;
alter table public.accounts drop column if exists agency_checkout_at;
alter table public.accounts drop column if exists agency_checkout_url;
