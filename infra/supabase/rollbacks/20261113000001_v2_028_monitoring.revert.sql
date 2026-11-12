-- Revert of infra/supabase/migrations/20261113000001_v2_028_monitoring.sql.
--
-- ⚠ Unset V2_CHECKS_PUBLIC in production first: the scheduler, the alert and summary functions and the
-- mailer call these functions. The ledgers, the suppressions and the seats' summary switch are dropped
-- with their rows: after a re-apply a suppressed address is no longer suppressed, and every seat's
-- summary is on again. sites.next_check_at keeps the values it holds and has no writer.
--
-- The statements are re-runnable.

-- ═══ D ════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.erase_mail_records(text[], boolean);
-- erase_rules as migration 027b (20261112000002_v2_027b_account.sql) defines it.
create or replace function public.erase_rules()
returns table (ord integer, kind text, key text, target text, action text, pred text)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select r.ord, r.kind, r.key, r.target, r.action, r.pred
    from (values
      (1, 'with_user', 'auth.users deleted', 'auth.users x', null, 'x.id = $1'),
      (2, 'with_user', 'users deleted', 'public.users x', null, 'x.id = $1'),
      (3, 'with_user', 'audits deleted', 'public.audits x', null, 'x.user_id = $1'),
      (4, 'with_user', 'sessions deleted', 'public.sessions x', null, 'x.user_id = $1'),
      (5, 'with_user', 'domain_verifications deleted', 'public.domain_verifications x', null,
       'x.user_id = $1'),
      (6, 'with_user', 'embed_badges deleted', 'public.embed_badges x', null, 'x.user_id = $1'),
      (7, 'with_user', 'seats deleted (own)', 'public.seats x', null, 'x.user_id = $1'),
      (8, 'with_user', 'public_reports.minted_by nulled', 'public.public_reports x', null,
       'x.minted_by = $1'),
      (9, 'with_user', 'share_links.created_by nulled', 'public.share_links x', null,
       'x.created_by = $1'),
      (10, 'with_user', 'api_keys.created_by nulled', 'public.api_keys x', null, 'x.created_by = $1'),
      -- Supabase Auth's audit log, where the project keeps one. An entry names the user by id and
      -- address in its JSON payload.
      (20, 'change', 'auth.audit_log_entries deleted', 'auth.audit_log_entries x', null,
       $p$($1 is not null and x.payload->>'actor_id' = $1::text)
          or ($1 is not null and x.payload->'traits'->>'user_id' = $1::text)
          or lower(x.payload->>'actor_username') = any($2)
          or lower(x.payload->'traits'->>'user_email') = any($2)$p$),
      -- Not the user's own audits, which go with the user; with no user, every audit holding it.
      (21, 'change', 'audits.notify_email nulled', 'public.audits x', 'notify_email = null',
       'lower(x.notify_email) = any($2) and ($1 is null or x.user_id is distinct from $1)'),
      -- Checks of sites outside the person's own accounts (theirs go with the accounts).
      (22, 'change', 'checks.notify_email nulled', 'public.checks x', 'notify_email = null',
       $p$lower(x.notify_email) = any($2)
          and not exists (select 1 from public.sites s where s.id = x.site_id and s.account_id = any($3))$p$),
      (23, 'change', 'email_events deleted', 'public.email_events x', null,
       'lower(x.email_address) = any($2)'),
      (24, 'change', 'waitlist deleted', 'public.waitlist x', null, 'lower(x.email) = any($2)'),
      -- The column is NOT NULL, so the address is replaced, not nulled.
      (25, 'change', 'takedown_requests redacted (closed)', 'public.takedown_requests x',
       $p$requester_email = 'redacted@erased.invalid'$p$,
       $p$lower(x.requester_email) = any($2) and x.status in ('removed', 'rejected')$p$),
      (26, 'change', 'rate_limits deleted', 'public.rate_limits x', null,
       $p$($1 is not null and right(x.bucket_key, 37) = ':' || $1::text)
          or exists (select 1 from unnest($2) e where right(x.bucket_key, length(e) + 1) = ':' || e)$p$),
      -- Another person's record of the address as one they used before (an email change).
      (27, 'change', 'users.previous_emails pruned', 'public.users x',
       'previous_emails = array(select e from unnest(x.previous_emails) e where lower(e) <> all($2))',
       $p$x.id is distinct from $1
          and exists (select 1 from unnest(x.previous_emails) e where lower(e) = any($2))$p$),
      (28, 'change', 'seats deleted (invitations in other accounts)', 'public.seats x', null,
       'lower(x.invited_email) = any($2) and x.user_id is null and not (x.account_id = any($3))'),
      (29, 'change', 'reports.recipient_email nulled', 'public.reports x', 'recipient_email = null',
       'lower(x.recipient_email) = any($2) and not (x.account_id = any($3))'),
      (30, 'change', 'sites.client_contact_email nulled', 'public.sites x',
       'client_contact_email = null',
       'lower(x.client_contact_email) = any($2) and not (x.account_id = any($3))'),
      (31, 'change', 'fix_email_requests deleted', 'public.fix_email_requests x', null,
       $p$(x.requested_by_seat_id in (select s.id from public.seats s where s.user_id = $1)
           or lower(x.to_email) = any($2))
          and not (x.account_id = any($3))$p$),
      (32, 'change', 'accounts deleted', 'public.accounts x', null, 'x.id = any($3)'),
      (40, 'with_accounts', 'sites deleted', 'public.sites x', null, 'x.account_id = any($3)'),
      (41, 'with_accounts', 'checks deleted', 'public.checks x', null,
       'exists (select 1 from public.sites s where s.id = x.site_id and s.account_id = any($3))'),
      (42, 'with_accounts', 'reports deleted', 'public.reports x', null, 'x.account_id = any($3)'),
      (50, 'kept', 'trial_ledger (peppered hashes; account reference set null)',
       'public.trial_ledger x', null, 'x.account_id = any($3)'),
      (51, 'kept', 'takedown_requests (open; the address stays until closed)',
       'public.takedown_requests x', null,
       $p$lower(x.requester_email) = any($2) and x.status not in ('removed', 'rejected')$p$)
    ) r(ord, kind, key, target, action, pred)
   where r.target <> 'auth.audit_log_entries x'
      or pg_catalog.to_regclass('auth.audit_log_entries') is not null
   order by r.ord;
$$;

-- ═══ C ════════════════════════════════════════════════════════════════════════════════════════════
-- The default rules the migration seeded stay: they are ordinary rules an account may have changed.
drop function if exists public.seed_default_alert_rules(uuid);
drop function if exists public.unsubscribe_seat(uuid, text);
drop function if exists public.due_summary_accounts(timestamptz, uuid, integer);
drop function if exists public.record_alert_delivery(jsonb);
drop function if exists public.summary_recipients(uuid);
drop function if exists public.alert_email_recipients(uuid, uuid);
drop function if exists public.account_slack_webhook_url(uuid, timestamptz);
drop function if exists public.finish_slack_send(text, text, text, timestamptz);
drop function if exists public.claim_slack_send(text, uuid, timestamptz);
drop table if exists public.slack_sends;
alter table public.alert_events drop constraint if exists alert_events_reason;
alter table public.alert_events drop column if exists reason;
alter table public.seats drop column if exists email_weekly_summary;

-- ═══ B ════════════════════════════════════════════════════════════════════════════════════════════
drop trigger if exists accounts_timezone_reschedule on public.accounts;
drop trigger if exists sites_schedule_next on public.sites;
drop function if exists public.accounts_timezone_reschedule();
drop function if exists public.sites_schedule_next();
drop function if exists public.release_scheduled_claim(uuid, timestamptz, jsonb, timestamptz);
drop function if exists public.claim_due_sites(timestamptz, integer, jsonb);
drop function if exists public.next_check_after(text, smallint, smallint, smallint, text, timestamptz);
drop function if exists public.account_effective_tier(uuid, timestamptz);

-- ═══ A ════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.account_link_recipient(uuid);
drop function if exists public.email_address_suppressed(text);
drop function if exists public.record_email_suppression(text, text, timestamptz);
drop function if exists public.finish_email_send(text, text, text, text, timestamptz);
drop function if exists public.claim_email_send(text, text, text, uuid, timestamptz);
drop function if exists public.email_kind_suppressible(text);
drop table if exists public.email_suppressions;
drop table if exists public.email_sends;
