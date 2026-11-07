-- The client roles hold exactly the declared privileges on the v1 tables and functions.
-- On the 18 v1 tables in `v1_tables` and the 2 functions in `v1_functions`, anon holds nothing and
-- authenticated holds SELECT on the columns in `declared` and nothing else, as
-- 20261106000002_v1_client_grant_hardening.sql left them. Privileges are read as the roles hold them
-- (has_table_privilege and its siblings), so a grant reaching them through PUBLIC or a role they are
-- members of counts too: any other privilege is a finding, one row per privilege, and so is a
-- declared column authenticated cannot read. A v1 table or function that does not exist is a finding
-- rather than a skip, so the check cannot pass by reading nothing. postgres's default privileges in
-- public, or in every schema, must grant anon, authenticated and PUBLIC nothing, except what Postgres
-- writes into an every-schema row itself when one is created: PUBLIC's EXECUTE on functions and USAGE
-- on types, which every new function and type gets whether or not such a row exists (check 06 governs
-- who may execute the functions in our schemas).
with
v1_tables(name) as (
  values
    ('audits'), ('benchmark_cohorts'), ('domain_verifications'), ('email_events'), ('embed_badges'),
    ('findings'), ('fixes'), ('frontier'), ('frontier_politeness'), ('links'), ('pages'),
    ('public_reports'), ('rate_limits'), ('sessions'), ('stripe_events'), ('takedown_requests'),
    ('users'), ('waitlist')
),
v1_functions(signature) as (
  values
    ('public.handle_new_user()'),
    ('public.increment_rate_limit(text, timestamp with time zone)')
),
-- authenticated SELECT, and nothing else, for anything the v1 app reads as a signed-in user.
declared(table_name, column_name) as (
  values
    ('users', 'id'), ('users', 'pro_until'), ('users', 'stripe_customer_id'),
    ('audits', 'id'), ('audits', 'url'), ('audits', 'grade'), ('audits', 'score'),
    ('audits', 'confidence'), ('audits', 'completed_at'), ('audits', 'previous_audit_id'),
    ('audits', 'status'), ('audits', 'expires_at'),
    ('domain_verifications', 'id'), ('domain_verifications', 'domain'),
    ('domain_verifications', 'method'), ('domain_verifications', 'verification_token'),
    ('domain_verifications', 'verified_at'), ('domain_verifications', 'user_id')
),
client_roles(role) as (values ('anon'), ('authenticated')),
table_privileges(privilege) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'),
         ('MAINTAIN')
),
column_privileges(privilege) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')),
tables as (
  select t.name, to_regclass(format('public.%I', t.name)) as oid from v1_tables t
),
funcs as (
  select f.signature, to_regprocedure(f.signature) as oid from v1_functions f
)
select format('public.%s', t.name) as object, 'a v1 table this check reads does not exist' as problem
from tables t
where t.oid is null
union all
select f.signature, 'a v1 function this check reads does not exist'
from funcs f
where f.oid is null
union all
select format('public.%s', t.name), format('%s holds %s on the table', r.role, p.privilege)
from tables t cross join client_roles r cross join table_privileges p
where t.oid is not null and has_table_privilege(r.role, t.oid, p.privilege)
union all
select format('public.%s.%s', t.name, a.attname), format('%s holds %s on the column', r.role, p.privilege)
from tables t
join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
cross join client_roles r cross join column_privileges p
where has_column_privilege(r.role, t.oid, a.attnum, p.privilege)
  -- Held on the whole table: reported once, above.
  and not has_table_privilege(r.role, t.oid, p.privilege)
  and not (r.role = 'authenticated' and p.privilege = 'SELECT'
           and (t.name, a.attname::text) in (select table_name, column_name from declared))
union all
select format('public.%s.%s', d.table_name, d.column_name),
       'authenticated is declared to hold SELECT and does not'
from declared d join tables t on t.name = d.table_name
where t.oid is not null
  and not exists (select 1 from pg_attribute a
                  where a.attrelid = t.oid and a.attname = d.column_name and not a.attisdropped
                    and has_column_privilege('authenticated', t.oid, a.attnum, 'SELECT'))
union all
select f.signature, format('%s may execute it', r.role)
from funcs f cross join client_roles r
where f.oid is not null and has_function_privilege(r.role, f.oid, 'EXECUTE')
union all
select format('default privileges of postgres in %s', coalesce(n.nspname, 'every schema')),
       format('%s gets %s on new %s', coalesce(g.rolname::text, 'PUBLIC'), x.privilege_type,
              case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                                   when 'f' then 'functions' when 'T' then 'types'
                                   when 'n' then 'schemas' else d.defaclobjtype::text end)
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) x
left join pg_roles g on g.oid = x.grantee
where d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
  and (d.defaclnamespace = 0 or n.nspname = 'public')
  and (x.grantee = 0 or g.rolname in ('anon', 'authenticated'))
  and not (d.defaclnamespace = 0 and x.grantee = 0
           and ((d.defaclobjtype = 'f' and x.privilege_type = 'EXECUTE')
                or (d.defaclobjtype = 'T' and x.privilege_type = 'USAGE')))
order by 1, 2;
