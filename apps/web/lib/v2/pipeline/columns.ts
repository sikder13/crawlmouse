/**
 * The columns migration 008 (`20261109000001_v2_008_pipeline.sql`) adds, by name, so the pipeline's
 * code and the migration's tests name them from one place.
 */

/** `crawl_batches`: one row per batch the pipeline posted to the worker. */
export const CRAWL_BATCH_COLUMNS = [
  'check_id',
  'batch',
  'kind',
  'nonce',
  'status',
  'posted_at',
  'finished_at',
  'summary',
  'result_path',
] as const;

/** Added to `checks`. None is granted to a client role. */
export const CHECK_PIPELINE_COLUMNS = [
  'inngest_run_id',
  'heartbeat_at',
  'diff_inputs',
  'map_path',
] as const;

/** Added to `sites` where absent. */
export const SITE_SCHEDULE_COLUMNS = ['next_check_at', 'schedule_offset_min'] as const;

/** The persistence RPC: `persist_built_check(p jsonb) returns jsonb`, executable by service_role only. */
export const PERSIST_RPC = 'persist_built_check';
