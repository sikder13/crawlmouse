-- Revert of infra/supabase/migrations/20261114000002_v2_031_agency.sql, section by section in reverse.

-- ─── C ────────────────────────────────────────────────────────────────────────────────────────────
-- The three kinds leave the CHECK on email_sends.kind and email_kind_suppressible, each rebuilt from
-- what it holds now without them, so a kind another migration added stays with its answer. A ledger
-- row of one of the three is deleted first, since the CHECK without its kind would refuse it; with it
-- goes the record that its message was sent. Like the migration's block, this raises and changes
-- nothing unless the kind column has one CHECK and it is a plain list.
do $$
declare
  v_removed constant text[] := array['seat_invite', 'report_confirm', 'client_report'];
  v_count integer;
  v_name name;
  v_def text;
  v_kinds text[];
  v_suppressible text[];
begin
  select pg_catalog.count(*), pg_catalog.min(c.conname), pg_catalog.min(pg_catalog.pg_get_constraintdef(c.oid))
    into v_count, v_name, v_def
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.email_sends'::pg_catalog.regclass
     and c.contype = 'c'
     and c.conkey = array[(select a.attnum
                             from pg_catalog.pg_attribute a
                            where a.attrelid = 'public.email_sends'::pg_catalog.regclass
                              and a.attname = 'kind')];
  if v_count <> 1 then
    raise exception 'email_sends.kind: % CHECKs on the column, where one is read', v_count;
  end if;
  select pg_catalog.array_agg(m.k[1] order by m.n)
    into v_kinds
    from pg_catalog.regexp_matches(v_def, '''([a-z0-9_]+)''::text', 'g') with ordinality as m(k, n);
  if v_kinds is null
     or v_def <> 'CHECK ((kind = ANY (ARRAY['
                 || (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k) || '::text', ', ' order by u.n)
                       from pg_catalog.unnest(v_kinds) with ordinality as u(k, n))
                 || '])))' then
    raise exception 'email_sends.kind: the CHECK % is not a plain list of kinds', v_name;
  end if;

  select coalesce(pg_catalog.array_agg(u.k order by u.n)
                    filter (where public.email_kind_suppressible(u.k)), '{}'),
         pg_catalog.array_agg(u.k order by u.n)
    into v_suppressible, v_kinds
    from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)
   where u.k <> all (v_removed);
  if v_kinds is null then
    raise exception 'email_sends.kind: the CHECK % lists no kind but the three', v_name;
  end if;

  delete from public.email_sends e where e.kind = any (v_removed);
  execute pg_catalog.format('alter table public.email_sends drop constraint %I', v_name);
  execute pg_catalog.format(
    'alter table public.email_sends add constraint %I check (kind in (%s))', v_name,
    (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k), ', ' order by u.n)
       from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)));
  execute pg_catalog.format(
    'create or replace function public.email_kind_suppressible(p_kind text) returns boolean '
    'language sql immutable set search_path = pg_catalog, pg_temp '
    'as $f$ select p_kind = any (%L::text[]); $f$', v_suppressible);
end;
$$;

-- ─── B ────────────────────────────────────────────────────────────────────────────────────────────

-- ─── A ────────────────────────────────────────────────────────────────────────────────────────────
-- The seat functions go, then the invitation's columns. A seat invited meanwhile stays, as a row of
-- status 'invited'. Its link's hash is cleared: no function is left to accept the link, and a hash
-- without an expiry would stop the migration's CHECK from being added again.
drop function if exists public.remove_seat(uuid, uuid, timestamptz);
drop function if exists public.change_seat(uuid, uuid, text, uuid[]);
drop function if exists public.accept_seat_invite(text, uuid, timestamptz);
drop function if exists public.read_seat_invite(text, timestamptz);
drop function if exists public.resend_seat_invite(uuid, uuid);
drop function if exists public.issue_seat_invite(uuid, integer, timestamptz);
drop function if exists public.invite_seat(uuid, text, text, uuid[], integer, timestamptz);
drop function if exists public.seat_scope_valid(uuid, uuid[]);
drop index if exists public.seats_invite_token_hash_uq;
alter table public.seats drop constraint if exists seats_invite_token;
update public.seats set invite_token_hash = null where invite_token_hash is not null;
alter table public.seats drop column if exists invite_seq;
alter table public.seats drop column if exists invite_expires_at;

-- ─── S ────────────────────────────────────────────────────────────────────────────────────────────
-- seats returns to 001's policy: every member of the account reads every seat.
drop policy if exists seats_member_read on public.seats;
create policy seats_member_read on public.seats
  for select to authenticated using (public.is_member(account_id));
drop function if exists public.member_covers_all(uuid);
-- seat_sites returns to 003's policy: every member of the account reads every row.
drop policy if exists seat_sites_member_read on public.seat_sites;
create policy seat_sites_member_read on public.seat_sites
  for select to authenticated using (public.is_member(account_id));
drop function if exists public.seat_may(uuid, text);
