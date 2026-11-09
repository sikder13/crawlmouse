/**
 * The PipelineStore over SQL, for PGlite: the same statements as supabasePipelineStore, written out,
 * so the pipeline's integration tests and the live run (D14) run against the migrations without a
 * PostgREST. Rows are read as `to_jsonb(...)`, which gives PostgREST's JSON shapes (timestamps as
 * strings), and go through the same converters.
 */
import type { CheckSide } from '@crawlmouse/engine/v2/pipeline';
import type { ReapedCheck } from '../../../../../../inngest/check-reaper';
import { checkFromRow, fixEventFromRow, fixFromRow, siteFromRow } from '../rows';
import {
  batchDone,
  graded,
  knownReason,
  statesOf,
  type ClaimOutcome,
  type PipelineStore,
  type RequestSite,
} from '../store';
import type { CrawlBatchRow } from '../types';

/** What the store needs of a connection: PGlite, or a transaction of one, satisfies it. */
export interface SqlDb {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

type Row = Record<string, unknown>;

export function sqlPipelineStore(db: SqlDb): PipelineStore {
  const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
    (await db.query<{ row: Row }>(sql, params)).rows.map((r) => r.row);
  const one = async (sql: string, params: unknown[]): Promise<Row | null> =>
    (await rows(sql, params))[0] ?? null;

  return {
    async claim(checkId, runId, progress) {
      const { rows: r } = await db.query<{ outcome: ClaimOutcome }>(
        `select public.claim_check($1::uuid, $2, $3::jsonb) as outcome`,
        [checkId, runId, JSON.stringify(progress)],
      );
      return r[0]!.outcome;
    },

    async fail(checkId, reason, runId) {
      knownReason(reason);
      const { rows: r } = await db.query<{ moved: boolean }>(
        `select public.fail_check($1::uuid, $2, $3) as moved`,
        [checkId, reason, runId],
      );
      return r[0]!.moved === true;
    },

    async reap(cutoff) {
      const { rows: r } = await db.query<{ check_id: string; site_id: string; reason: string }>(
        `select check_id, site_id, reason from public.reap_stalled_checks($1::timestamptz)`,
        [cutoff],
      );
      return r.map((x) => ({
        checkId: x.check_id,
        siteId: x.site_id,
        reason: x.reason as ReapedCheck['reason'],
      }));
    },

    async checkOfRun(runId) {
      const r = await one(
        `select jsonb_build_object('id', id, 'site_id', site_id) as row
           from public.checks where inngest_run_id = $1`,
        [runId],
      );
      return r ? { checkId: String(r.id), siteId: String(r.site_id) } : null;
    },

    async progress(checkId, progress, at) {
      await db.query(
        `update public.checks set progress = $2::jsonb, heartbeat_at = $3::timestamptz
          where id = $1 and status = 'running'`,
        [checkId, JSON.stringify(progress), at],
      );
    },

    async check(checkId) {
      const r = await one(`select to_jsonb(c) as row from public.checks c where c.id = $1`, [
        checkId,
      ]);
      if (!r) throw new Error(`sql store: no check ${checkId}`);
      return checkFromRow(r);
    },

    async site(siteId) {
      const r = await one(
        `select to_jsonb(s) || jsonb_build_object('report_schedules',
                  (select to_jsonb(rs) from public.report_schedules rs where rs.site_id = s.id)) as row
           from public.sites s where s.id = $1`,
        [siteId],
      );
      if (!r) throw new Error(`sql store: no site ${siteId}`);
      return siteFromRow(r);
    },

    async requestSite(siteId) {
      const r = await one(
        `select jsonb_build_object('id', id, 'account_id', account_id, 'host', host,
                                   'next_check_at', next_check_at) as row
           from public.sites where id = $1`,
        [siteId],
      );
      if (!r) throw new Error(`sql store: no site ${siteId}`);
      return r as unknown as RequestSite;
    },

    async previousCheckId(siteId, checkId, queuedAt) {
      const r = await one(
        `select jsonb_build_object('id', id) as row from public.checks
          where site_id = $1 and id <> $2 and queued_at <= $3::timestamptz
          order by queued_at desc, id desc limit 1`,
        [siteId, checkId, queuedAt],
      );
      return r ? String(r.id) : null;
    },

    async previousGraded(siteId, checkId): Promise<CheckSide | null> {
      const r = await one(
        `select to_jsonb(c) as row from public.checks c
          where c.site_id = $1 and c.id <> $2 and c.status in ('finished', 'partial')
          order by c.finished_at desc, c.id desc limit 1`,
        [siteId, checkId],
      );
      return r ? graded(r) : null;
    },

    async fixes(siteId) {
      return (
        await rows(
          `select to_jsonb(f) as row from public.site_fixes f where f.site_id = $1 order by f.id`,
          [siteId],
        )
      ).map(fixFromRow);
    },

    async fixEvents(fixIds) {
      return (
        await rows(
          `select to_jsonb(e) as row from public.fix_events e where e.fix_id = any($1::uuid[]) order by e.id`,
          [fixIds],
        )
      ).map(fixEventFromRow);
    },

    async pageStates(checkId) {
      return statesOf(
        await rows(
          `select jsonb_build_object('url', url, 'without_js', without_js) as row
             from public.page_results where check_id = $1 and without_js is not null order by url`,
          [checkId],
        ),
      );
    },

    async batch(checkId, batch) {
      return (await one(
        `select to_jsonb(b) as row from public.crawl_batches b where b.check_id = $1 and b.batch = $2`,
        [checkId, batch],
      )) as CrawlBatchRow | null;
    },

    async batches(checkId) {
      return (await rows(
        `select to_jsonb(b) as row from public.crawl_batches b where b.check_id = $1 order by b.batch`,
        [checkId],
      )) as unknown as CrawlBatchRow[];
    },

    async upsertBatch(row) {
      const { rows: written } = await db.query(
        `insert into public.crawl_batches
           (check_id, batch, kind, nonce, status, posted_at, finished_at, summary, result_path)
         values ($1, $2, $3, $4, 'posted', $5::timestamptz, null, $6::jsonb, null)
         on conflict (check_id, batch) do update set
           kind = excluded.kind, nonce = excluded.nonce, status = excluded.status,
           posted_at = excluded.posted_at, finished_at = null, summary = excluded.summary,
           result_path = null
         where public.crawl_batches.status <> 'done'
         returning batch`,
        [row.check_id, row.batch, row.kind, row.nonce, row.posted_at, JSON.stringify(row.summary)],
      );
      if (written.length === 0) throw batchDone(row.check_id, row.batch);
    },

    async endBatch(checkId, batch, end) {
      // Like supabase-js's update: a field left out is not written.
      const sets = ['status = $3', 'finished_at = $4::timestamptz'];
      const params: unknown[] = [checkId, batch, end.status, end.finished_at];
      if (end.summary !== undefined) {
        params.push(JSON.stringify(end.summary));
        sets.push(`summary = $${params.length}::jsonb`);
      }
      if (end.result_path !== undefined) {
        params.push(end.result_path);
        sets.push(`result_path = $${params.length}`);
      }
      await db.query(
        `update public.crawl_batches set ${sets.join(', ')}
          where check_id = $1 and batch = $2 and status = 'posted'`,
        params,
      );
    },

    async insertQueued(row) {
      const { rows: r } = await db.query(
        `insert into public.checks
           (id, site_id, status, trigger, grade_version, queued_at, heartbeat_at, expires_at)
         values ($1, $2, 'queued', $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz)
         on conflict (id) do nothing returning id`,
        [
          row.id,
          row.site_id,
          row.trigger,
          row.grade_version,
          row.queued_at,
          row.heartbeat_at,
          row.expires_at,
        ],
      );
      return r.length > 0;
    },
  };
}
