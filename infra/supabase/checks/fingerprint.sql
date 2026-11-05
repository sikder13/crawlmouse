-- Schema fingerprint. One row per section: an md5 over the section's lines, the line count, and
-- the lines themselves, so two targets can be compared section by section and a difference named.
--
-- Scope: the schemas the migrations own (public, research, partitions), the policies on storage
-- tables, the storage bucket rows, and the roles the migrations create. Relations, functions and
-- types that belong to an extension, and Supabase's own roles, are left out.
--
-- Lines are sorted with the "C" collation and ACLs are exploded into one line per grantee and
-- privilege, so neither collation nor the order of aclitems can change a digest. The grantor is
-- left out: it names whoever ran the GRANT, which differs between a branch and production.
--
-- search_path is set to pg_catalog for this statement only (set_config is_local, evaluated before
-- the lateral subquery that reads it), so every deparsed expression names its schema whichever
-- connection runs the file.
select f.section, md5(coalesce(f.body, '')) as md5, f.items, f.lines
from (select set_config('search_path', 'pg_catalog', true) as sp) cfg
cross join lateral (
  with
  scope as (
    select oid, nspname from pg_namespace
    where nspname in ('public', 'research', 'partitions') and cfg.sp is not null
  ),
  extension_members as (select objid from pg_depend where deptype = 'e'),
  app_roles as (
    select oid, rolname from pg_roles
    where rolname !~ '^(pg_|supabase_|cli_login_)'
      and rolname not in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator',
                          'dashboard_user', 'pgbouncer', 'pgsodium_keyholder',
                          'pgsodium_keyiduser', 'pgsodium_keymaker')
  ),
  rels as (
    select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl,
           c.relrowsecurity, c.relforcerowsecurity, c.relpartbound, c.reloptions
    from pg_class c join scope n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and c.oid not in (select objid from extension_members)
  ),
  funcs as (
    select p.oid, n.nspname, p.proname, p.prokind, p.proowner, p.proacl, p.prosecdef
    from pg_proc p join scope n on n.oid = p.pronamespace
    where p.oid not in (select objid from extension_members)
  ),
  grantee_name as (select 0::oid as oid, 'PUBLIC'::text as name
                   union all select oid, rolname::text from pg_roles),
  items(section, line) as (
    select 'columns', format('%s.%s.%s %s%s%s%s%s', r.nspname, r.relname, a.attname,
             format_type(a.atttypid, a.atttypmod),
             case when a.attnotnull then ' not null' else '' end,
             coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
             case when a.attidentity <> '' then ' identity ' || a.attidentity::text else '' end,
             case when a.attgenerated <> '' then ' generated ' || a.attgenerated::text else '' end)
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum

    union all
    select 'relations', format('%s.%s kind=%s owner=%s partition_key=%s bound=%s options=%s view=%s',
             r.nspname, r.relname, r.relkind, pg_get_userbyid(r.relowner),
             case when r.relkind = 'p' then pg_get_partkeydef(r.oid) else '' end,
             coalesce(pg_get_expr(r.relpartbound, r.oid), ''),
             coalesce(r.reloptions::text, ''),
             case when r.relkind in ('v', 'm') then md5(pg_get_viewdef(r.oid)) else '' end)
    from rels r

    union all
    select 'rls', format('%s.%s enabled=%s forced=%s', r.nspname, r.relname,
             r.relrowsecurity, r.relforcerowsecurity)
    from rels r where r.relkind in ('r', 'p')

    union all
    select 'functions', format('%s.%s(%s) kind=%s owner=%s security_definer=%s definition=%s',
             f.nspname, f.proname, pg_get_function_identity_arguments(f.oid), f.prokind,
             pg_get_userbyid(f.proowner), f.prosecdef,
             case when f.prokind in ('f', 'p') then md5(pg_get_functiondef(f.oid)) else '' end)
    from funcs f

    union all
    select 'policies', format('%s.%s %s %s %s roles=%s using=%s check=%s',
             p.schemaname, p.tablename, p.policyname, p.permissive, p.cmd,
             (select string_agg(x, ',' order by x collate "C") from unnest(p.roles) x),
             coalesce(p.qual, ''), coalesce(p.with_check, ''))
    from pg_policies p
    where p.schemaname in (select nspname from scope) or p.schemaname = 'storage'

    union all
    select 'constraints', format('%s.%s %s %s', n.nspname,
             coalesce(c.relname, t.typname), con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con
    join scope n on n.oid = con.connamespace
    left join pg_class c on c.oid = con.conrelid
    left join pg_type t on t.oid = con.contypid
    where con.conrelid in (select oid from rels) or con.contypid <> 0

    union all
    select 'indexes', format('%s.%s %s', i.schemaname, i.indexname, i.indexdef)
    from pg_indexes i where i.schemaname in (select nspname from scope)

    union all
    select 'triggers', format('%s.%s enabled=%s %s', r.nspname, r.relname, t.tgenabled,
             pg_get_triggerdef(t.oid))
    from pg_trigger t join rels r on r.oid = t.tgrelid
    where not t.tgisinternal

    union all
    select 'types', format('%s.%s kind=%s base=%s labels=%s', n.nspname, t.typname, t.typtype,
             case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) else '' end,
             coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                       from pg_enum e where e.enumtypid = t.oid), ''))
    from pg_type t join scope n on n.oid = t.typnamespace
    where t.typtype in ('e', 'd')
      and t.oid not in (select objid from extension_members)

    union all
    select 'acls', format('relation %s.%s %s %s%s', r.nspname, r.relname, g.name,
             x.privilege_type, case when x.is_grantable then ' with grant option' else '' end)
    from rels r
    cross join lateral aclexplode(coalesce(r.relacl,
      acldefault(case when r.relkind = 'S' then 's' else 'r' end::"char", r.relowner))) x
    join grantee_name g on g.oid = x.grantee

    union all
    select 'acls', format('column %s.%s.%s %s %s%s', r.nspname, r.relname, a.attname, g.name,
             x.privilege_type, case when x.is_grantable then ' with grant option' else '' end)
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) x
    join grantee_name g on g.oid = x.grantee
    where a.attacl is not null

    union all
    select 'acls', format('function %s.%s(%s) %s %s%s', f.nspname, f.proname,
             pg_get_function_identity_arguments(f.oid), g.name, x.privilege_type,
             case when x.is_grantable then ' with grant option' else '' end)
    from funcs f
    cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) x
    join grantee_name g on g.oid = x.grantee

    union all
    select 'acls', format('schema %s %s %s%s', n.nspname, g.name, x.privilege_type,
             case when x.is_grantable then ' with grant option' else '' end)
    from pg_namespace n
    cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x
    join grantee_name g on g.oid = x.grantee
    where n.oid in (select oid from scope)
       or (n.nspname = 'storage' and x.grantee in (select oid from app_roles))

    union all
    select 'acls', format('relation storage.%s %s %s', c.relname, g.name, x.privilege_type)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'storage'
    cross join lateral aclexplode(c.relacl) x
    join grantee_name g on g.oid = x.grantee
    where c.relacl is not null and x.grantee in (select oid from app_roles)

    union all
    select 'roles', format('%s login=%s bypassrls=%s superuser=%s createrole=%s createdb=%s inherit=%s',
             r.rolname, r.rolcanlogin, r.rolbypassrls, r.rolsuper, r.rolcreaterole,
             r.rolcreatedb, r.rolinherit)
    from pg_roles r where r.oid in (select oid from app_roles)

    union all
    select 'roles', format('%s member of %s admin=%s', pg_get_userbyid(m.member),
             pg_get_userbyid(m.roleid), m.admin_option)
    from pg_auth_members m
    where m.roleid in (select oid from app_roles) or m.member in (select oid from app_roles)

    union all
    select 'buckets', format('%s name=%s public=%s file_size_limit=%s allowed_mime_types=%s',
             b.id, b.name, b.public, to_jsonb(b) ->> 'file_size_limit',
             to_jsonb(b) ->> 'allowed_mime_types')
    from storage.buckets b
  ),
  sections(section) as (
    values ('acls'), ('buckets'), ('columns'), ('constraints'), ('functions'), ('indexes'),
           ('policies'), ('relations'), ('rls'), ('roles'), ('triggers'), ('types')
  )
  select s.section,
         string_agg(i.line, E'\n' order by i.line collate "C") as body,
         count(i.line)::int as items,
         coalesce(array_agg(i.line order by i.line collate "C") filter (where i.line is not null),
                  '{}') as lines
  from sections s left join items i on i.section = s.section
  group by s.section
) f
order by f.section collate "C";
