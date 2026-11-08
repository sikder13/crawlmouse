-- Every SECURITY DEFINER function in public, research and partitions searches pg_catalog first and the caller's temporary schema last.
-- A definer function's search_path setting must be exactly "", "pg_catalog, pg_temp" or
-- "pg_catalog, public, pg_temp"; any other setting, or none, is a finding. Left out, pg_temp is
-- searched first for relations and types, so a caller's temp object could stand in for a name the
-- body (or a SQL function inlined into it, such as auth.uid()) writes without a schema, and run as
-- the function's owner. public ahead of pg_temp is safe only while no one else can create objects in
-- public, so a role that holds CREATE on public without being a superuser or a member of its owner is
-- a finding too, as is a CREATE grant to PUBLIC. Functions that belong to an extension are left out.
with definers as (
  select format('%s.%s(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature,
         (select c from unnest(p.proconfig) c where c like 'search_path=%') as setting
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname in ('public', 'research', 'partitions')
    and p.oid not in (select objid from pg_depend where deptype = 'e')
),
public_schema as (
  select oid, nspowner, nspacl from pg_namespace where nspname = 'public'
)
select signature as object,
       case when setting is null then 'SECURITY DEFINER with no search_path setting'
            else format('%s; allowed: "", "pg_catalog, pg_temp", "pg_catalog, public, pg_temp"', setting)
       end as problem
from definers
where setting is null
   or setting not in ('search_path=""', 'search_path=pg_catalog, pg_temp',
                      'search_path=pg_catalog, public, pg_temp')
union all
select format('schema public: role %s', r.rolname), 'may create objects in public'
from pg_roles r cross join public_schema s
where has_schema_privilege(r.oid, s.oid, 'CREATE')
  and not r.rolsuper
  and not pg_has_role(r.oid, s.nspowner, 'USAGE')
union all
select 'schema public: PUBLIC', 'may create objects in public'
from public_schema s, aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a
where a.grantee = 0 and a.privilege_type = 'CREATE'
order by 1, 2;
