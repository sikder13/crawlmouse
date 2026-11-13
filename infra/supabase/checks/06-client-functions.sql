-- In public, research and partitions, authenticated may execute exactly is_member, member_role, is_member_for_site,
-- is_member_for_fix, usage_counts and is_operator.
-- anon may execute none of their functions, and authenticated only the six listed in `declared`.
-- An existing listed function authenticated cannot execute is
-- also a finding. Functions that belong to an extension are left out.
with
declared(role, signature) as (
  values
    ('authenticated', 'public.is_member(uuid)'),
    ('authenticated', 'public.member_role(uuid)'),
    ('authenticated', 'public.is_member_for_site(uuid)'),
    ('authenticated', 'public.is_member_for_fix(uuid)'),
    ('authenticated', 'public.usage_counts(uuid)'),
    ('authenticated', 'public.is_operator()')
),
funcs as (
  select p.oid, format('%s.%s(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'research', 'partitions')
    and p.oid not in (select objid from pg_depend where deptype = 'e')
)
select f.signature as object, format('%s may execute it; not declared', r.role) as problem
from funcs f cross join (values ('anon'), ('authenticated')) r(role)
where has_function_privilege(r.role, f.oid, 'EXECUTE')
  and (r.role, f.signature) not in (select role, signature from declared)
union all
select d.signature, format('%s is declared to execute it and cannot', d.role)
from declared d join funcs f on f.signature = d.signature
where not has_function_privilege(d.role, f.oid, 'EXECUTE')
order by 1, 2;
