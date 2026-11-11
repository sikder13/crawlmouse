-- Revert of infra/supabase/migrations/20261112000002_v2_027b_account.sql. Tokens, account events,
-- pending erasures and the account's Slack destinations are dropped; a deletion in its window is
-- forgotten, so restore the marked accounts (clear the two columns) and unban their people BEFORE
-- running this. is_member, member_role and is_member_for_site return to their 003/001 bodies with the
-- search_path 20261108000002 set.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────

-- ─── B ────────────────────────────────────────────────────────────────────────────────────────────

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
drop function if exists public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid);
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
