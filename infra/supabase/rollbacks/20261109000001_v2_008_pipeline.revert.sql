-- Reverts 20261109000001_v2_008_pipeline.sql: drops the five functions, the two indexes, the columns
-- 008 added to checks and sites with what they hold, and crawl_batches and persist_chunks with their
-- rows. A check persisted under 008 keeps its rows in the measurement tables; only its diff inputs,
-- map path, run id and heartbeat go. Re-runnable.

drop function if exists public.persist_built_check(jsonb);
drop function if exists public.stage_check_rows(uuid, text, integer, jsonb);
drop function if exists public.reap_stalled_checks(timestamptz);
drop function if exists public.fail_check(uuid, text, text);
drop function if exists public.claim_check(uuid, text, jsonb);

drop index if exists public.checks_heartbeat_idx;
drop index if exists public.checks_one_running_per_site;

alter table public.checks
  drop column if exists inngest_run_id,
  drop column if exists heartbeat_at,
  drop column if exists diff_inputs,
  drop column if exists map_path;

alter table public.sites drop constraint if exists sites_schedule_offset_min;
alter table public.sites
  drop column if exists next_check_at,
  drop column if exists schedule_offset_min;

drop table if exists public.persist_chunks;
drop table if exists public.crawl_batches;
