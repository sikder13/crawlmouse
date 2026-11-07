-- Every partition has row-level security on and an owner-only ACL.
-- Every relation in the partitions schema, and every partition (in any schema) of a table in
-- public, research or partitions, must have RLS enabled, and its ACL may name only the table's
-- owner: no client role, no PUBLIC, no other role. Supabase's own partitioned tables are left out.
with parts as (
  select c.oid, c.relname, c.relowner, c.relacl, c.relrowsecurity, n.nspname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and (n.nspname = 'partitions'
         or (c.relispartition and exists (
               select 1 from pg_inherits i join pg_class pc on pc.oid = i.inhparent
                 join pg_namespace pn on pn.oid = pc.relnamespace
                where i.inhrelid = c.oid and pn.nspname in ('public', 'research', 'partitions'))))
)
select format('%s.%s', p.nspname, p.relname) as object, 'row-level security is off' as problem
from parts p
where not p.relrowsecurity
union all
select format('%s.%s', p.nspname, p.relname),
       format('%s holds %s; only the owner may appear in the ACL',
              case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
              x.privilege_type)
from parts p
cross join lateral aclexplode(coalesce(p.relacl, acldefault('r', p.relowner))) x
where x.grantee <> p.relowner
order by 1, 2;
