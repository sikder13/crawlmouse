-- Revert of infra/supabase/migrations/20261112000002_v2_027b_account.sql. Tokens, account events,
-- pending erasures and the account's Slack destinations are dropped; a deletion in its window is
-- forgotten, so restore the marked accounts (clear the two columns) and unban their people BEFORE
-- running this. is_member, member_role and is_member_for_site return to their 003/001 bodies with the
-- search_path 20261108000002 set.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.account_deletion_blocked(uuid, uuid);
-- The stored Slack URLs are Vault secrets the table names; they go with it, so a revert leaves none
-- behind and every account has to save its URL again after a re-apply.
do $$ begin
  if to_regclass('public.account_slack_destinations') is not null then
    delete from vault.secrets s using public.account_slack_destinations d where s.id = d.vault_secret_id;
  end if;
end $$;
drop function if exists public.account_slack_last4(uuid);
drop function if exists public.clear_account_slack_webhook(uuid);
drop function if exists public.set_account_slack_webhook(uuid, text);
drop table if exists public.account_slack_destinations;
-- Its trigger went with the table.
drop function if exists public.account_slack_destinations_drop_secret();

-- ─── B ────────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.finish_erasure(uuid);
drop function if exists public.record_erasure_attempt(uuid);
drop function if exists public.due_erasures(timestamptz, integer);
drop function if exists public.erasure_pending(uuid);
drop function if exists public.erasure_state(uuid);
drop function if exists public.record_deletion_cancel(uuid, uuid, text, boolean);
drop function if exists public.restore_account(text, timestamptz);
drop function if exists public.confirm_account_deletion(text, timestamptz);
drop function if exists public.read_deletion_link(text, text, timestamptz);
drop function if exists public.request_account_deletion(uuid, uuid, text);
drop function if exists public.email_change_live(uuid, timestamptz);
drop function if exists public.deletion_refusal(uuid, uuid);
drop function if exists public.deletion_hostname(uuid, uuid);
drop table if exists public.deletion_cancellations;
drop function if exists public.erase_auth_audit_log(uuid, text[]);
drop function if exists public.erase_person_apply(uuid, text, jsonb, boolean);
drop function if exists public.erase_person_plan(uuid, text);
drop function if exists public.erase_person_counts(uuid, text[], uuid[]);
drop function if exists public.erase_person_refusals(uuid, uuid[]);
drop function if exists public.erase_person_accounts(uuid);
drop function if exists public.erase_rules();

-- ─── A ────────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.undo_email_change(text, timestamptz, boolean);
drop function if exists public.prepare_email_undo(text, timestamptz);
drop function if exists public.revert_email_change(uuid);
drop function if exists public.apply_email_change(text, timestamptz);
drop function if exists public.request_email_change(uuid, uuid, text, timestamptz);
drop function if exists public.email_held_by_other(text, uuid);
drop function if exists public.normalize_email(text);

-- ─── Shared ───────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.issue_account_link(uuid);
drop function if exists public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid, text);
drop function if exists public.end_user_sessions(uuid, uuid);
drop table if exists public.pending_erasures;
alter table public.users drop column if exists previous_emails;
drop table if exists public.account_events;
drop table if exists public.account_tokens;

create or replace function public.is_member(p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.seats s
      join public.accounts a on a.id = s.account_id
     where s.account_id = p_account
       and s.user_id = auth.uid()
       and s.status = 'active'
       and a.deleted_at is null
  );
$$;

create or replace function public.member_role(p_account uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select s.role
    from public.seats s
    join public.accounts a on a.id = s.account_id
   where s.account_id = p_account
     and s.user_id = auth.uid()
     and s.status = 'active'
     and a.deleted_at is null
   limit 1;
$$;

create or replace function public.is_member_for_site(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.sites st
      join public.accounts a on a.id = st.account_id
      join public.seats s on s.account_id = st.account_id
     where st.id = p_site
       and s.user_id = auth.uid()
       and s.status = 'active'
       and a.deleted_at is null
       and (s.client_scope_all
            or exists (select 1
                         from public.seat_sites ss
                        where ss.seat_id = s.id
                          and ss.site_id in (st.id, st.staging_of_site_id)))
  );
$$;

drop index if exists public.accounts_purge_after_idx;
alter table public.accounts drop constraint if exists accounts_deletion_pair;
alter table public.accounts drop column if exists purge_after;
alter table public.accounts drop column if exists deletion_confirmed_at;
