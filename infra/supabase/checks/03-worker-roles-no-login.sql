-- crawl_worker and research_retention cannot log in, bypass row-level security, or reach a role that can.
-- Neither role may log in, bypass RLS, be a superuser, create roles or databases, or replicate,
-- and neither may be a member (directly or through other roles) of a role that bypasses RLS or is
-- a superuser. Both are meant to be assumed through SET ROLE or a signed token. A role that does
-- not exist yet (its migration not applied) is skipped.
with workers as (
  select oid, rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb,
         rolreplication
  from pg_roles where rolname in ('crawl_worker', 'research_retention')
)
select w.rolname::text as object, p.problem
from workers w
cross join lateral (
  values (w.rolcanlogin, 'can log in'), (w.rolbypassrls, 'bypasses row-level security'),
         (w.rolsuper, 'is a superuser'), (w.rolcreaterole, 'can create roles'),
         (w.rolcreatedb, 'can create databases'), (w.rolreplication, 'can replicate')
) p(flagged, problem)
where p.flagged
union all
select w.rolname::text,
       format('is a member of %s, which %s', r.rolname,
              case when r.rolsuper then 'is a superuser' else 'bypasses row-level security' end)
from workers w
join pg_roles r on r.oid <> w.oid and (r.rolbypassrls or r.rolsuper)
where pg_has_role(w.oid, r.oid, 'MEMBER')
order by 1, 2;
