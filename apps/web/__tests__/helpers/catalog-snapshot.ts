import type { PGlite } from '@electric-sql/pglite';

/**
 * Every schema object in `public`, `partitions` and `research` (CC-06b's monthly partitions and
 * ledger), the policies on Storage's tables, the bucket rows, the
 * non-system roles and their memberships, and every non-internal trigger, with no OIDs in it. The
 * apply / re-apply / revert tests of the v2 migrations compare two of these.
 */
export async function catalogSnapshot(db: PGlite): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ snapshot: Record<string, unknown> }>(`
    select json_build_object(
      'relations', (select json_agg(json_build_object('schema', n.nspname, 'name', c.relname,
                      'kind', c.relkind, 'rls', c.relrowsecurity, 'acl', c.relacl::text,
                      'partition_of', (select pc.relname from pg_inherits i join pg_class pc on pc.oid = i.inhparent
                                        where i.inhrelid = c.oid))
                      order by n.nspname, c.relname)
                      from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname in ('public', 'partitions', 'research')),
      'columns',   (select json_agg(json_build_object('schema', n.nspname, 'rel', c.relname, 'col', a.attname,
                      'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull,
                      'default', pg_get_expr(d.adbin, d.adrelid), 'acl', a.attacl::text)
                      order by n.nspname, c.relname, a.attnum)
                      from pg_attribute a join pg_class c on c.oid = a.attrelid
                      join pg_namespace n on n.oid = c.relnamespace
                      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                     where n.nspname in ('public', 'partitions', 'research')
                       and a.attnum > 0 and not a.attisdropped),
      'constraints', (select json_agg(json_build_object('schema', n.nspname, 'rel', c.relname,
                      'name', k.conname, 'def', pg_get_constraintdef(k.oid))
                      order by n.nspname, c.relname, k.conname)
                      from pg_constraint k join pg_class c on c.oid = k.conrelid
                      join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname in ('public', 'partitions', 'research')),
      'indexes',   (select json_agg(json_build_object('schema', schemaname, 'name', indexname,
                      'def', indexdef) order by schemaname, indexname)
                      from pg_indexes where schemaname in ('public', 'partitions', 'research')),
      'policies',  (select json_agg(json_build_object('schema', schemaname, 'table', tablename,
                      'name', policyname, 'cmd', cmd, 'roles', roles::text, 'qual', qual,
                      'check', with_check) order by schemaname, tablename, policyname)
                      from pg_policies where schemaname in ('public', 'storage', 'partitions', 'research')),
      'functions', (select json_agg(json_build_object('schema', n.nspname, 'name', p.proname,
                      'args', pg_get_function_identity_arguments(p.oid), 'src', p.prosrc,
                      'definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text,
                      'volatile', p.provolatile)
                      order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'research')),
      -- A row trigger on a partitioned table is cloned to each partition under the same name, so
      -- the definition breaks the tie.
      'triggers',  (select json_agg(pg_get_triggerdef(t.oid) order by t.tgname, pg_get_triggerdef(t.oid))
                      from pg_trigger t where not t.tgisinternal),
      'storage_acl', (select json_agg(json_build_object('name', c.relname, 'acl', c.relacl::text)
                      order by c.relname)
                      from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'storage' and c.relkind = 'r'),
      'schema_acl', (select json_agg(json_build_object('name', nspname, 'acl', nspacl::text)
                      order by nspname)
                      from pg_namespace where nspname in ('public', 'storage', 'partitions', 'research')),
      'buckets',   (select json_agg(json_build_object('id', id, 'public', public) order by id)
                      from storage.buckets),
      'roles',     (select json_agg(json_build_object('name', r.rolname, 'login', r.rolcanlogin,
                      'inherit', r.rolinherit, 'bypassrls', r.rolbypassrls,
                      'member_of', array(select g.rolname from pg_auth_members m
                                           join pg_roles g on g.oid = m.roleid
                                          where m.member = r.oid order by 1))
                      order by r.rolname)
                      from pg_roles r where r.rolname !~ '^pg_')
    ) as snapshot`);
  return rows[0]!.snapshot;
}
