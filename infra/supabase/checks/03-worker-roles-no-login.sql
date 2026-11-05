-- crawl_worker and research_retention cannot log in or bypass row-level security.
-- Both roles are assumed through SET ROLE or a signed token, never logged into. A role that does
-- not exist yet (its migration not applied) is skipped.
select r.rolname::text as object, p.problem
from pg_roles r
cross join lateral (
  values (r.rolcanlogin, 'can log in'), (r.rolbypassrls, 'bypasses row-level security'),
         (r.rolsuper, 'is a superuser')
) p(flagged, problem)
where r.rolname in ('crawl_worker', 'research_retention') and p.flagged
order by 1, 2;
