-- Revert of infra/supabase/migrations/20261124000002_v2_b_agency_logo_erasure.sql. It restores
-- erase_person_counts as migration 20261112000002 defines it, copied from that file, with its revoke
-- and grant. No row or object changes. With it reverted, an erasure again lists a report-logos object
-- only by its owner or by the current agency_brands.logo_path, so an Agency account's earlier logos
-- are left in the bucket. Hide agency_white_label in production before reverting.
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
   where o.owner = p_user or (o.bucket_id, o.name) in (select p.bucket, p.name from paths p);

  return json_build_object(
    'counts', (select json_object_agg(k, v order by i) from unnest(v_keys, v_vals) with ordinality t(k, v, i)),
    'kept', (select json_object_agg(k, v order by i) from unnest(v_kept_keys, v_kept_vals) with ordinality t(k, v, i)),
    'storage', v_storage);
end;
$$;

revoke all on function public.erase_person_counts(uuid, text[], uuid[]) from public, anon, authenticated;
grant execute on function public.erase_person_counts(uuid, text[], uuid[]) to service_role;
