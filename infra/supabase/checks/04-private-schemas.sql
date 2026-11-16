-- The research, partitions and analytics schemas grant no USAGE or CREATE to client roles.
-- anon and authenticated (and PUBLIC, which both inherit) may not use or create objects in any of
-- them. A schema that does not exist yet is skipped.
select n.nspname::text as object, format('%s holds %s', r.role, p.privilege) as problem
from pg_namespace n
cross join (values ('anon'), ('authenticated')) r(role)
cross join (values ('USAGE'), ('CREATE')) p(privilege)
where n.nspname in ('research', 'partitions', 'analytics')
  and has_schema_privilege(r.role, n.oid, p.privilege)
order by 1, 2;
