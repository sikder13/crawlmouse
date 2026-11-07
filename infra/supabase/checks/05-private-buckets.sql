-- The evidence and reports buckets are private.
-- A bucket that does not exist yet is skipped.
select b.id::text as object, 'the bucket is public' as problem
from storage.buckets b
where b.id in ('evidence', 'reports') and b.public is distinct from false
order by 1;
