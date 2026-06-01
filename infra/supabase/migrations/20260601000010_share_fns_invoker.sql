-- Plan 3 hardening: tighten the two share functions added in ...07/...08.
-- They were SECURITY DEFINER, which (a) the advisor flags as exposing them on the
-- REST /rpc surface to anon/authenticated and (b) for increment_embed_view is an
-- actual abuse vector (an anon could call rpc/increment_embed_view to inflate any
-- domain's counter). Neither needs DEFINER:
--   * increment_embed_view is only ever called by the embed route via the service
--     role (which bypasses RLS), so INVOKER + a service_role-only EXECUTE grant is
--     both sufficient and safer.
--   * populate_public_report is a BEFORE INSERT trigger fired by the service-role
--     mint insert; the trigger manager runs it without an execute check on the
--     caller, so INVOKER is fine.

create or replace function increment_embed_view(p_domain text)
returns void
language sql
security invoker
set search_path = public
as $$
  update embed_badges set view_count = view_count + 1 where domain = p_domain;
$$;

create or replace function populate_public_report()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  select a.score, a.grade, a.cms_detected
    into new.score, new.grade, new.cms_detected
  from audits a
  where a.id = new.audit_id;

  select count(*) filter (where is_orphan), coalesce(avg(depth), 0)
    into new.orphan_count, new.avg_depth
  from pages
  where audit_id = new.audit_id;

  return new;
end;
$$;

-- Take the functions off the public REST surface; the service role (mint + embed
-- route) keeps access, anon/authenticated can no longer reach them via /rpc.
revoke execute on function increment_embed_view(text) from public;
revoke execute on function populate_public_report() from public;
grant execute on function increment_embed_view(text) to service_role;
grant execute on function populate_public_report() to service_role;
