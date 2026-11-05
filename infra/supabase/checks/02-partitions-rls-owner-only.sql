-- Every partition has row-level security on and an owner-only ACL.
-- Every relation in the partitions schema must have RLS enabled, and its ACL may name only the
-- table's owner: no client role, no PUBLIC, no other role.
select format('partitions.%s', c.relname) as object, 'row-level security is off' as problem
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'partitions' and c.relkind in ('r', 'p') and not c.relrowsecurity
union all
select format('partitions.%s', c.relname),
       format('%s holds %s; only the owner may appear in the ACL',
              case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
              x.privilege_type)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
where n.nspname = 'partitions' and c.relkind in ('r', 'p') and x.grantee <> c.relowner
order by 1, 2;
