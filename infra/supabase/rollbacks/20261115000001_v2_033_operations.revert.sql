-- Reverts 20261115000001_v2_033_operations.sql. Re-runnable. Sections run in reverse order.

-- ═══ §K ═══════════════════════════════════════════════════════════════════════════════════════════

-- The two founder kinds leave the CHECK on email_sends.kind and email_kind_suppressible, each rebuilt
-- from what it holds now without them, as 031's revert does for its three; a ledger row of either is
-- deleted first, with the record that its notice was sent.
do $$
declare
  v_removed constant text[] := array['founder_event', 'founder_digest'];
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
    raise exception 'email_sends.kind: the CHECK % lists no kind but the two', v_name;
  end if;

  delete from public.email_sends e where e.kind = any (v_removed);
  execute pg_catalog.format('alter table public.email_sends drop constraint %I', v_name);
  execute pg_catalog.format(
    'alter table public.email_sends add constraint %I check (kind in (%s))', v_name,
    (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k), ', ' order by u.n)
       from pg_catalog.unnest(v_kinds) with ordinality as u(k, n)));
  execute pg_catalog.format(
    E'create or replace function public.email_kind_suppressible(p_kind text) returns boolean '
    'language sql immutable set search_path = pg_catalog, pg_temp '
    'as $f$\n  select %s;\n$f$',
    coalesce(
      'p_kind in ('
        || (select pg_catalog.string_agg(pg_catalog.quote_literal(u.k), ', ' order by u.n)
              from pg_catalog.unnest(v_suppressible) with ordinality as u(k, n))
        || ')',
      'false'));
end;
$$;

-- ═══ end §K ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §C ═══════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.signin_delivery_seen(text, text, timestamptz);
drop function if exists public.founder_signups_unannounced(timestamptz, integer, bigint);
drop function if exists public.founder_digest_counts(timestamptz, timestamptz);
drop function if exists public.take_founder_overflow(text, integer);
drop function if exists public.claim_founder_notice(text, text, uuid, boolean, timestamptz, jsonb,
                                                    timestamptz, integer, boolean);
drop table if exists public.founder_notices;
-- ═══ end §C ══════════════════════════════════════════════════════════════════════════════════════


-- ═══ §A ═══════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.operator_finish(bigint, text);
drop function if exists public.operator_request_check(uuid, uuid, text, jsonb, integer, jsonb);
drop function if exists public.operator_log(uuid, text, uuid, text, text, text);
drop table if exists public.operator_actions;
drop function if exists public.operator_account_counts(uuid, uuid[], uuid[]);
drop function if exists public.user_id_by_email(text);
drop function if exists public.operator_account_ids_by_email(text);
drop function if exists public.is_operator();
drop function if exists public.is_internal_subject(text, uuid);
alter table public.accounts drop column if exists internal;
drop table if exists public.operators;

-- ═══ end §A ══════════════════════════════════════════════════════════════════════════════════════
