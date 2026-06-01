-- Plan 3 hardening: close the always-true takedown insert policy.
-- `takedown_anyone_insert ... with check (true)` let the anon/publishable key insert
-- rows into takedown_requests directly, bypassing the API route entirely (unbounded
-- spam + cost, advisor WARN). All legitimate inserts go through /api/takedown using
-- the service-role client (which bypasses RLS), now gated by rate-limit + report-
-- existence validation. Dropping the policy leaves RLS default-deny for the anon /
-- authenticated roles while the route keeps working.
drop policy if exists takedown_anyone_insert on takedown_requests;
