-- v2 V2R A2 (inbox 023): a readable list of checks for the owner's table editor.
--
-- `checks` holds a site_id, so a row does not say which website it is for. This view joins the host
-- rather than copying it onto `checks`, where a second copy could drift. It holds no email address
-- or other personal data.
--
-- security_invoker: it reads with the rights of whoever queries it, so it opens nothing RLS closes.
-- anon and authenticated hold nothing on it, and infra/supabase/checks/01-client-table-privileges.sql
-- lists it, so a later migration that grants them anything fails the catalog check.
create or replace view public.ops_recent_checks
with (security_invoker = true) as
select s.host,
       c.status,
       c.trigger,
       c.queued_at,
       c.finished_at,
       -- A value that is not a plain whole number reads as null: a bare cast would make one bad row
       -- fail every read of the view.
       case
         when jsonb_typeof(c.coverage -> 'pages_crawled') = 'number'
          and (c.coverage ->> 'pages_crawled') ~ '^[0-9]{1,9}$'
         then (c.coverage ->> 'pages_crawled')::integer
       end as pages_read,
       -- The stored tier: an expired no-card trial can still read as the tier it trialled.
       coalesce(a.tier::text, 'no account') as plan,
       c.id as check_id
  from public.checks c
  join public.sites s on s.id = c.site_id
  left join public.accounts a on a.id = s.account_id
 order by c.queued_at desc, c.id desc;

alter view public.ops_recent_checks owner to postgres;
revoke all on public.ops_recent_checks from public, anon, authenticated, service_role;
grant select on public.ops_recent_checks to service_role;
