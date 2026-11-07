-- Every partition holds each row and TRUNCATE trigger its parent table holds.
-- For each partition of a table in public, research or partitions, each row trigger and each
-- TRUNCATE trigger on its parent must exist on the partition under the same name, calling the
-- same function. Postgres copies row triggers to a new partition; it copies no statement trigger,
-- and v2_premake_month_partitions creates the TRUNCATE guards per partition. Other statement
-- triggers stay on the parent and are not required here. The fingerprint merges the lines of a
-- table's partitions, so a trigger missing from one partition shows only here.
with parts as (
  select c.oid, n.nspname, c.relname, i.inhparent
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_inherits i on i.inhrelid = c.oid
  join pg_class pc on pc.oid = i.inhparent
  join pg_namespace pn on pn.oid = pc.relnamespace
  where c.relispartition and pn.nspname in ('public', 'research', 'partitions')
)
select format('%s.%s', p.nspname, p.relname) as object,
       format('lacks trigger %s (%s) of its parent %s', t.tgname, t.tgfoid::regproc, p.inhparent::regclass)
         as problem
from parts p
join pg_trigger t on t.tgrelid = p.inhparent and not t.tgisinternal
  -- tgtype bit 1: FOR EACH ROW; bit 32: TRUNCATE.
  and ((t.tgtype & 1) <> 0 or (t.tgtype & 32) <> 0)
where not exists (
  select 1 from pg_trigger pt
  where pt.tgrelid = p.oid and pt.tgname = t.tgname and pt.tgfoid = t.tgfoid
)
order by 1, 2;
