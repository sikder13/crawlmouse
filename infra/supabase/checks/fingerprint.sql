-- Schema fingerprint. One row per section: an md5 over the section's lines, the line count, and
-- the lines themselves, so two targets can be compared section by section and a difference named.
--
-- What it reads is what the migrations produce:
--   - in the schemas the migrations own (public, research, partitions): columns (with collation),
--     relations (kind, owner, partition key and bound, options, replica identity, view md5), RLS,
--     functions (md5 of the definition, which includes SET search_path), policies, constraints,
--     indexes, triggers, types, and the ACLs of relations, columns, functions and the schemas;
--   - on auth.users, storage.objects and storage.buckets: RLS, policies, the triggers whose
--     function is in those three schemas, and the grants to the roles below and to PUBLIC;
--   - the roles the migrations create and the client roles (anon, authenticated, service_role,
--     authenticator): attributes, settings (values as md5s), and memberships with their admin,
--     inherit and set options, except the memberships listed in SUPABASE_MANAGED_MEMBERS;
--   - default privileges for all schemas or for the three above; the names of schemas other than
--     Supabase's own and those an extension creates; the tables of the three schemas in each
--     publication; and storage bucket rows.
-- What it does not read, because Supabase or the owner manages it outside the migrations and a new
-- branch would not have it as production does: extensions (pg_cron is enabled by hand, 06b's
-- runbook), the other auth and storage tables, Supabase's schemas and their default privileges.
-- Nor comments, event triggers, pg_cron jobs, function bodies outside the three schemas, and
-- relations, functions and types that belong to an extension.
--
-- Monthly partitions are created relative to now(), so a branch built in a later month holds other
-- months than production. In each line that names a partition, the _YYYY_MM suffix and the bound's
-- dates are normalised (inside a trigger's md5 too) and identical lines are merged: one line per
-- kind of partition. A line one partition has and the others lack (a grant, say) still shows; a
-- line one partition lacks and the others have does not, so check 07 requires each partition to
-- hold its parent's triggers. Constraints Postgres derives from a parent's, one per partition, are
-- left out; the parent's is listed. Which months exist is the partition job's concern.
--
-- Lines are sorted with the "C" collation and ACLs are exploded into one line per grantee and
-- privilege, so neither collation nor the order of aclitems can change a digest. The grantor is
-- left out: it names whoever ran the GRANT, which differs between a branch and production.
--
-- Function, view and trigger definitions, and role setting values, appear as md5s: a trigger's
-- arguments or a role setting can hold a key (a
-- dashboard database webhook stores its Authorization header in a trigger), and the lines of a differing
-- section are printed in a public job log.
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
  -- Supabase versions the storage and auth schemas and adds tables to them; only the tables the
  -- app relies on are read, so a newer platform version on a branch is not a difference.
  platform_tables(schema_name, table_name) as (
    values ('auth', 'users'), ('storage', 'objects'), ('storage', 'buckets')
  ),
  platform as (
    select oid, nspname from pg_namespace where nspname in ('storage', 'auth')
  ),
  extension_members as (select objid from pg_depend where deptype = 'e'),
  -- SUPABASE_MANAGED_MEMBERS: memberships Supabase grants when it creates a project, left out of
  -- the roles section. Each entry is matched exactly: the role, the member, and the admin,
  -- inherit and set options. Measured: production held no membership with
  -- supabase_realtime_admin as the member (2026-11-06 UTC), and a branch created from it the same
  -- day held these three (docs/ops/db-migrations.md §5 has the query). Any other membership by
  -- supabase_realtime_admin, or one of these with other options, is read. So is that role owning
  -- a table, view, sequence or function, or holding a grant on one, in the schemas above. (No
  -- section records the owner of a type, for any role.)
  supabase_managed_members(role_name, member_name, admin_option, inherit_option, set_option) as (
    values ('anon', 'supabase_realtime_admin', false, false, true),
           ('authenticated', 'supabase_realtime_admin', false, false, true),
           ('service_role', 'supabase_realtime_admin', false, false, true)
  ),
  watched_roles as (
    select oid, rolname from pg_roles
    where (rolname !~ '^(pg_|supabase_|cli_login_)'
           and rolname not in ('postgres', 'dashboard_user', 'pgbouncer', 'pgsodium_keyholder',
                               'pgsodium_keyiduser', 'pgsodium_keymaker'))
  ),
  rels as (
    select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl, c.relreplident,
           c.relrowsecurity, c.relforcerowsecurity, c.relpartbound, c.reloptions
    from pg_class c join scope n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and c.oid not in (select objid from extension_members)
  ),
  platform_rels as (
    select c.oid, n.nspname, c.relname, c.relacl, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join platform n on n.oid = c.relnamespace
    join platform_tables pt on pt.schema_name = n.nspname and pt.table_name = c.relname
  ),
  funcs as (
    select p.oid, n.nspname, p.proname, p.prokind, p.proowner, p.proacl, p.prosecdef
    from pg_proc p join scope n on n.oid = p.pronamespace
    where p.oid not in (select objid from extension_members)
  ),
  grantee_name as (select 0::oid as oid, 'PUBLIC'::text as name
                   union all select oid, rolname::text from pg_roles),
  items(section, line) as (
    select 'columns', format('%s.%s.%s %s%s%s%s%s%s', r.nspname, r.relname, a.attname,
             format_type(a.atttypid, a.atttypmod),
             case when a.attcollation <> 0 and a.attcollation <> t.typcollation
                  then ' collate ' || a.attcollation::regcollation::text else '' end,
             case when a.attnotnull then ' not null' else '' end,
             coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''),
             case when a.attidentity <> '' then ' identity ' || a.attidentity::text else '' end,
             case when a.attgenerated <> '' then ' generated ' || a.attgenerated::text else '' end)
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum

    union all
    select 'relations', format(
             '%s.%s kind=%s owner=%s partition_key=%s bound=%s options=%s replica_identity=%s view=%s',
             r.nspname, r.relname, r.relkind, pg_get_userbyid(r.relowner),
             case when r.relkind = 'p' then pg_get_partkeydef(r.oid) else '' end,
             coalesce(pg_get_expr(r.relpartbound, r.oid), ''),
             coalesce(r.reloptions::text, ''), r.relreplident,
             case when r.relkind in ('v', 'm') then md5(pg_get_viewdef(r.oid)) else '' end)
    from rels r

    union all
    select 'rls', format('%s.%s enabled=%s forced=%s', r.nspname, r.relname,
             r.relrowsecurity, r.relforcerowsecurity)
    from rels r where r.relkind in ('r', 'p')

    union all
    select 'rls', format('%s.%s enabled=%s forced=%s', r.nspname, r.relname,
             r.relrowsecurity, r.relforcerowsecurity)
    from platform_rels r

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
    where p.schemaname in (select nspname from scope)
       or (p.schemaname, p.tablename) in (select schema_name, table_name from platform_tables)

    union all
    select 'constraints', format('%s.%s %s %s', n.nspname,
             coalesce(c.relname, t.typname), con.conname, pg_get_constraintdef(con.oid))
    from pg_constraint con
    join scope n on n.oid = con.connamespace
    left join pg_class c on c.oid = con.conrelid
    left join pg_type t on t.oid = con.contypid
    where (con.conrelid in (select oid from rels) or con.contypid <> 0)
      -- A constraint Postgres derives from a parent's, one per partition (a foreign key to a
      -- partitioned table gets one per referenced partition): the parent's constraint is listed.
      and con.conparentid = 0

    union all
    select 'indexes', format('%s.%s %s', i.schemaname, i.indexname, i.indexdef)
    from pg_indexes i where i.schemaname in (select nspname from scope)

    union all
    select 'triggers', format('%s.%s %s enabled=%s definition=%s', r.nspname, r.relname,
             t.tgname, t.tgenabled,
             md5(case when r.nspname = 'partitions'
                      then regexp_replace(pg_get_triggerdef(t.oid), '_[0-9]{4}_[0-9]{2}', '_YYYY_MM', 'g')
                      else pg_get_triggerdef(t.oid) end))
    from pg_trigger t join rels r on r.oid = t.tgrelid
    where not t.tgisinternal

    union all
    select 'triggers', format('%s.%s %s enabled=%s definition=%s', r.nspname, r.relname,
             t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid)))
    from pg_trigger t
    join platform_rels r on r.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and p.pronamespace in (select oid from scope)

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
       or (n.oid in (select oid from platform)
           and (x.grantee = 0 or x.grantee in (select oid from watched_roles)))

    union all
    select 'acls', format('relation %s.%s %s %s', r.nspname, r.relname, g.name, x.privilege_type)
    from platform_rels r
    cross join lateral aclexplode(r.relacl) x
    join grantee_name g on g.oid = x.grantee
    where r.relacl is not null and (x.grantee = 0 or x.grantee in (select oid from watched_roles))

    union all
    select 'default_acls', format('%s in %s on %s: %s %s%s', pg_get_userbyid(d.defaclrole),
             coalesce(n.nspname, '*'), d.defaclobjtype, g.name, x.privilege_type,
             case when x.is_grantable then ' with grant option' else '' end)
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) x
    join grantee_name g on g.oid = x.grantee
    where d.defaclnamespace = 0 or d.defaclnamespace in (select oid from scope)

    union all
    select 'roles', format(
             '%s login=%s bypassrls=%s superuser=%s createrole=%s createdb=%s inherit=%s replication=%s connection_limit=%s config=%s',
             r.rolname, r.rolcanlogin, r.rolbypassrls, r.rolsuper, r.rolcreaterole,
             r.rolcreatedb, r.rolinherit, r.rolreplication, r.rolconnlimit,
             coalesce((select string_agg(split_part(c, '=', 1) || '=md5:' ||
                                           md5(substr(c, strpos(c, '=') + 1)),
                                         ',' order by c collate "C")
                       from unnest(r.rolconfig) c), ''))
    from pg_roles r where r.oid in (select oid from watched_roles)

    union all
    select 'roles', format('%s member of %s admin=%s inherit=%s set=%s',
             pg_get_userbyid(m.member), pg_get_userbyid(m.roleid), m.admin_option,
             m.inherit_option, m.set_option)
    from pg_auth_members m
    where (m.roleid in (select oid from watched_roles) or m.member in (select oid from watched_roles))
      and not exists (
        select 1 from supabase_managed_members s
        where s.role_name = pg_get_userbyid(m.roleid) and s.member_name = pg_get_userbyid(m.member)
          and s.admin_option = m.admin_option and s.inherit_option = m.inherit_option
          and s.set_option = m.set_option)

    union all
    select 'schemas', n.nspname::text
    from pg_namespace n
    where n.nspname !~ '^pg_'
      and n.nspname not in ('information_schema', 'auth', 'storage', 'realtime', 'graphql',
                            'graphql_public', 'vault', 'extensions', 'pgbouncer', 'cron', 'net',
                            'supabase_migrations', 'supabase_functions')
      and n.oid not in (select objid from extension_members)

    union all
    select 'publications', format('%s %s.%s', t.pubname, t.schemaname, t.tablename)
    from pg_publication_tables t
    where t.schemaname in (select nspname from scope)

    union all
    select 'buckets', format('%s name=%s public=%s file_size_limit=%s allowed_mime_types=%s',
             b.id, b.name, b.public, to_jsonb(b) ->> 'file_size_limit',
             to_jsonb(b) ->> 'allowed_mime_types')
    from storage.buckets b
  ),
  normalised as (
    select distinct section,
           case when line ~ '(^|[ (])partitions\.'
                then regexp_replace(
                       regexp_replace(line, '_[0-9]{4}_[0-9]{2}', '_YYYY_MM', 'g'),
                       '''[0-9]{4}-[0-9]{2}-[0-9]{2}''', '''YYYY-MM-DD''', 'g')
                else line end as line
    from items
  ),
  sections(section) as (
    values ('acls'), ('buckets'), ('columns'), ('constraints'), ('default_acls'), ('functions'),
           ('indexes'), ('policies'), ('publications'), ('relations'), ('rls'), ('roles'),
           ('schemas'), ('triggers'), ('types')
  )
  select s.section,
         string_agg(i.line, E'\n' order by i.line collate "C") as body,
         count(i.line)::int as items,
         coalesce(array_agg(i.line order by i.line collate "C") filter (where i.line is not null),
                  '{}') as lines
  from sections s left join normalised i on i.section = s.section
  group by s.section
) f
order by f.section collate "C";
