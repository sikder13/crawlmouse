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

/** The tables migration 008 creates. */
export const PIPELINE_TABLES = ['crawl_batches', 'persist_chunks'] as const;

/** The indexes migration 008 creates on `checks`. */
export const PIPELINE_INDEXES = ['checks_one_running_per_site', 'checks_heartbeat_idx'] as const;

/** The functions migration 008 creates; __tests__/v2-008-pipeline.test.ts holds each to service_role. */
export const PIPELINE_FUNCTIONS = [
  'check_failure_reasons',
  'claim_check',
  'fail_check',
  'reap_stalled_checks',
  'stage_check_rows',
  PERSIST_RPC,
] as const;
