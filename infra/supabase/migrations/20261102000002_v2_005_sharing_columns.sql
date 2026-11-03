-- v2 migration 005 (ARCH-2 §2.13, §6.1): columns added to the carried-over sharing and ledger tables.
--
-- Additive only. New nullable columns on public_reports, domain_verifications, embed_badges,
-- stripe_events and email_events, their indexes, and one trigger on embed_badges. Nothing is
-- dropped, renamed or re-granted, existing rows hold null in every new column, and v1 reads none of
-- them. Filling them (check_id from audit_id, account_id from user_id) is a later backfill, not this
-- file. This file grants nothing. What a client can do with a new column follows the table's
-- existing grants: public_reports grants SELECT per column, so its new columns stay hidden from anon
-- and authenticated; the other four carry v1's table-level grants, so their new columns are as
-- reachable as their old ones, with the rows still gated by v1's policies (deny-all on stripe_events
-- and email_events, owner-only on domain_verifications and embed_badges). public_reports.check_id is
-- on delete set null, as audit_id has been since 20260707000002; report_snapshot is not touched.
--
-- Every statement is re-runnable. The revert is
-- infra/supabase/rollbacks/20261102000002_v2_005_sharing_columns.revert.sql.
-- Tested by: pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-005-sharing-columns.test.ts

alter table public.public_reports add column if not exists check_id uuid
  references public.checks (id) on delete set null;
alter table public.public_reports add column if not exists site_id uuid
  references public.sites (id) on delete set null;
alter table public.public_reports add column if not exists account_id uuid
  references public.accounts (id) on delete set null;
create index if not exists public_reports_check_idx on public.public_reports (check_id);
create index if not exists public_reports_site_idx on public.public_reports (site_id);
create index if not exists public_reports_account_idx on public.public_reports (account_id);

alter table public.domain_verifications add column if not exists account_id uuid
  references public.accounts (id) on delete set null;
create index if not exists domain_verifications_account_idx on public.domain_verifications (account_id);

alter table public.embed_badges add column if not exists account_id uuid
  references public.accounts (id) on delete set null;
create index if not exists embed_badges_account_idx on public.embed_badges (account_id);

alter table public.stripe_events add column if not exists account_id uuid
  references public.accounts (id) on delete set null;
alter table public.stripe_events add column if not exists livemode boolean;
alter table public.stripe_events add column if not exists payload_hash text
  constraint stripe_events_payload_hash_check check (payload_hash ~ '^[0-9a-f]{64}$');
create index if not exists stripe_events_account_idx on public.stripe_events (account_id);

alter table public.email_events add column if not exists account_id uuid
  references public.accounts (id) on delete set null;
alter table public.email_events add column if not exists kind text
  constraint email_events_kind_check check (kind in ('signin', 'change', 'reminder', 'report', 'invite', 'other'));
create index if not exists email_events_account_idx on public.email_events (account_id);

-- ─── embed_badges.account_id: clients may name only their own accounts ────────────────────────────
-- v1 lets authenticated insert and update its own embed_badges rows (table grant + the owner policy),
-- so without this the new column would accept any account id from a client. The trigger refuses a
-- client write that sets or changes account_id to an account the caller is not a member of. It runs
-- as the caller (SECURITY INVOKER), so current_user is the client role, and is_member() answers for
-- the caller. Other roles (service_role, postgres) are not checked.

create or replace function public.embed_badges_account_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.account_id is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id) then
    if not public.is_member(new.account_id) then
      raise exception 'embed_badges: account_id must be an account you are a member of'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.embed_badges_account_guard() from public, anon, authenticated, service_role;

drop trigger if exists embed_badges_account_guard on public.embed_badges;
create trigger embed_badges_account_guard before insert or update on public.embed_badges
  for each row execute function public.embed_badges_account_guard();
