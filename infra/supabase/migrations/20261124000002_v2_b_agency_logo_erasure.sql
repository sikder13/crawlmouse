-- v2 V2R B: an erasure lists the Agency logos an account saved earlier, not only its current one.
--
-- POST /api/agency/brand stores each logo with the service role, so its storage.objects row has no
-- owner, at report-logos/agency/<account_id>/<sha256-16>.<ext>. A new upload does not delete the
-- one before it: a report made with the earlier logo keeps showing it. Until this file, the storage
-- list in erase_person_counts (migration 20261112000002) found a report-logos object only by its
-- owner or by the current agency_brands.logo_path, so a replaced logo outlived an erasure, still
-- served from the public bucket.
--
-- The function is 20261112000002's, unchanged except the storage list's final `where`, which also
-- takes every report-logos object whose name is agency/<an erased account's id>/... . The first
-- segment must be `agency` exactly and the second must equal an account id as text, so a v1 logo
-- (<slug>/<hash>) and another account's prefix are not listed by it. v_accounts is the function's
-- uuid[] (coalesce(p_accounts, '{}')), and Postgres casts a uuid to lower-case hex text, so a name
-- whose id segment is written in upper case is not matched. The revoke and grant are 20261112000002's, re-issued. The rollback restores that body.
-- Tests: scripts/ops/erase-account.test.ts ('every logo an Agency account saved').

create or replace function public.erase_person_counts(p_user uuid, p_emails text[], p_accounts uuid[])
returns json
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r record;
  v_n bigint;
  v_keys text[] := '{}';
  v_vals bigint[] := '{}';
  v_kept_keys text[] := '{}';
  v_kept_vals bigint[] := '{}';
  v_storage json;
  v_emails text[] := coalesce(p_emails, '{}');
  v_accounts uuid[] := coalesce(p_accounts, '{}');
begin
  for r in select * from public.erase_rules() loop
    continue when r.kind = 'with_user' and p_user is null;
    execute format('select count(*) from %s where %s', r.target, r.pred)
      into v_n using p_user, v_emails, v_accounts;
    if r.kind = 'kept' then
      v_kept_keys := v_kept_keys || r.key;
      v_kept_vals := v_kept_vals || v_n;
    else
      v_keys := v_keys || r.key;
      v_vals := v_vals || v_n;
    end if;
  end loop;

  with paths(bucket, name) as (
    select 'report-logos', b.logo_path from public.agency_brands b
     where b.account_id = any(v_accounts) and b.logo_path is not null
    union all
    select 'reports', rp.storage_path from public.reports rp
     where rp.account_id = any(v_accounts) and rp.storage_path is not null
    union all
    select 'evidence', e.storage_path from public.evidence_blobs e
      join public.checks c on c.id = e.check_id join public.sites s on s.id = c.site_id
     where s.account_id = any(v_accounts)
    union all
    select 'evidence', c.map_path from public.checks c join public.sites s on s.id = c.site_id
     where s.account_id = any(v_accounts) and c.map_path is not null
    union all
    select 'evidence', cb.result_path from public.crawl_batches cb
      join public.checks c on c.id = cb.check_id join public.sites s on s.id = c.site_id
     where s.account_id = any(v_accounts) and cb.result_path is not null
  )
  select coalesce(json_agg(json_build_object('bucket', o.bucket_id, 'name', o.name)
                           order by o.bucket_id, o.name), '[]'::json)
    into v_storage
    from storage.objects o
   where o.owner = p_user
      or (o.bucket_id, o.name) in (select p.bucket, p.name from paths p)
      -- Every logo an Agency account ever saved: uploads are content-addressed under
      -- agency/<account_id>/ and an earlier one is kept (reports made with it), with no owner.
      or (o.bucket_id = 'report-logos'
          and split_part(o.name, '/', 1) = 'agency'
          and split_part(o.name, '/', 2) = any (v_accounts::text[]));

  return json_build_object(
    'counts', (select json_object_agg(k, v order by i) from unnest(v_keys, v_vals) with ordinality t(k, v, i)),
    'kept', (select json_object_agg(k, v order by i) from unnest(v_kept_keys, v_kept_vals) with ordinality t(k, v, i)),
    'storage', v_storage);
end;
$$;

revoke all on function public.erase_person_counts(uuid, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.erase_person_counts(uuid, text[], uuid[]) to service_role;
