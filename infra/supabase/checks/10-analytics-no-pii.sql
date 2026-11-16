-- The analytics schema exposes no personal column, and `analytics_reader` reads nothing outside it.
-- A column of an `analytics` relation is a finding when its name matches the personal-data list
-- (email, name, host, url, uri, ip, token, address, phone, password, secret, referrer, path, card,
-- customer, note) or its type is inet or cidr, unless it is one of the two allowlisted attribution
-- columns below. Also a finding: any table, view or sequence outside `analytics` on which
-- `analytics_reader` holds a privilege; any schema other than `analytics`, `public` and the catalog
-- schemas on which it holds USAGE or CREATE (`public`'s USAGE is PUBLIC's, so its tables are checked
-- one by one above instead); and any privilege anon or authenticated holds on an `analytics` relation.
-- Also a finding: a SECURITY DEFINER function outside the catalog schemas that `analytics_reader` may
-- execute (through PUBLIC or a grant), since it would run with its owner's rights. Functions that
-- belong to an extension are left out, as `06-client-functions` leaves them out.
--
-- The allowlist, and why each entry is safe (CC-41 rulings, Q5):
--   `analytics.account_attribution.referrer_host`: a hostname only, lowercased, at most 253 characters
--     of letters, digits, hyphens and dots; never a scheme, path or query.
--   `analytics.account_attribution.landing_path`: a path of our own site as a shape, at most 200
--     characters of `[A-Za-z0-9/._~-]`, never a query or fragment; a segment that is not a lowercase
--     slug (an id, a host, anything encoded) is written `~` (`landingShape`).
-- Both are enforced where the value is written and read back (`apps/web/lib/analytics/first-touch.ts`);
-- the table's CHECKs (migration 20261120000001) enforce each one's alphabet and length, not the shape.
with
allowed(rel, col) as (
  values ('analytics.account_attribution', 'referrer_host'),
         ('analytics.account_attribution', 'landing_path')
),
cols as (
  select format('%I.%I', n.nspname, c.relname) as rel, a.attname::text as col,
         format_type(a.atttypid, a.atttypmod) as typ
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'analytics' and a.attnum > 0 and not a.attisdropped
),
reader as (select oid from pg_roles where rolname = 'analytics_reader')
select format('%s.%s', rel, col) as object, format('personal-looking column (%s)', typ) as problem
  from cols
 where (col ~* '(email|name|host|url|uri|(^|_)ip($|_)|token|address|phone|password|secret|referrer|path|card|customer|note)'
        or typ in ('inet', 'cidr'))
   and (rel, col) not in (select rel, col from allowed)
union all
select format('%I.%I', n.nspname, c.relname), format('analytics_reader holds %s', p.privilege)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                     ('TRIGGER')) p(privilege)
 where exists (select 1 from reader)
   and n.nspname <> 'analytics'
   and n.nspname not in ('pg_catalog', 'information_schema')
   and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and has_table_privilege('analytics_reader', c.oid, p.privilege)
union all
select n.nspname::text, format('analytics_reader holds %s on the schema', p.privilege)
  from pg_namespace n
  cross join (values ('USAGE'), ('CREATE')) p(privilege)
 where exists (select 1 from reader)
   and n.nspname not in ('analytics', 'pg_catalog', 'information_schema', 'public')
   and n.nspname !~ '^pg_'
   and has_schema_privilege('analytics_reader', n.oid, p.privilege)
union all
select format('analytics.%s', c.relname), format('%s holds %s', r.role, p.privilege)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(role)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
 where n.nspname = 'analytics'
   and exists (select 1 from pg_roles where rolname = r.role)
   and has_table_privilege(r.role, c.oid, p.privilege)
union all
select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
       'analytics_reader may execute this security definer function'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where exists (select 1 from reader)
   and p.prosecdef
   and n.nspname not in ('pg_catalog', 'information_schema')
   and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
   and has_function_privilege('analytics_reader', p.oid, 'EXECUTE')
order by 1, 2;
