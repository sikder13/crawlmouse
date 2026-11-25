/**
 * The pipeline's database seams over PGlite, for tests. Persistence calls the same functions
 * production calls, and the reader selects `to_jsonb(t)`, which serialises a row as PostgREST does, so the
 * converters in rows.ts read the shapes they read in production.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { BuildInput } from '@crawlmouse/engine/v2/pipeline';
import type { Site } from '@crawlmouse/types/v2';
import { PERSIST_RPC } from '../columns';
import { STAGE_RPC } from '../persist';
import type { CheckReader, PersistDb } from '../types';

type Db = PGlite | Transaction;

export function pglitePersistDb(db: Db): PersistDb {
  return {
    async stageCheckRows(checkId, collection, chunk, rows) {
      const { rows: answer } = await db.query<{ staged: unknown }>(
        `select public.${STAGE_RPC}($1, $2, $3, $4::jsonb) as staged`,
        [checkId, collection, chunk, JSON.stringify(rows)],
      );
      return answer[0]!.staged;
    },
    async persistBuiltCheck(payload) {
      const { rows } = await db.query<{ answer: unknown }>(
        `select public.${PERSIST_RPC}($1::jsonb) as answer`,
        [JSON.stringify(payload)],
      );
      return rows[0]!.answer;
    },
    // F-330, as the service role does it through PostgREST (persist.ts supabasePersistDb).
    async edgeTarget(checkId, fetching) {
      const l = JSON.stringify(fetching);
      await db.query(
        `insert into public.measurement_lineages (id, engine_sha, detector_ruleset_version,
           crawler_registry_version, worker_release, population_version, created_at)
         select (l ->> 'id')::uuid, l ->> 'engine_sha', l ->> 'detector_ruleset_version',
                l ->> 'crawler_registry_version', l ->> 'worker_release', l ->> 'population_version',
                (l ->> 'created_at')::timestamptz
           from (select $1::jsonb as l) x
         on conflict (engine_sha, detector_ruleset_version, crawler_registry_version, worker_release,
                      population_version) do nothing`,
        [l],
      );
      const { rows: lineage } = await db.query<{ id: string }>(
        `select m.id from public.measurement_lineages m, (select $1::jsonb as l) x
          where m.engine_sha = l ->> 'engine_sha'
            and m.detector_ruleset_version = l ->> 'detector_ruleset_version'
            and m.crawler_registry_version = l ->> 'crawler_registry_version'
            and m.worker_release is not distinct from l ->> 'worker_release'
            and m.population_version is not distinct from l ->> 'population_version'`,
        [l],
      );
      const { rows: month } = await db.query<{ check_month: string }>(
        `select check_month::text as check_month from public.checks where id = $1`,
        [checkId],
      );
      if (lineage.length !== 1 || month.length !== 1) throw new Error('edgeTarget: not one row');
      await db.query(`select public.v2_premake_month_partitions($1::date, $1::date)`, [
        month[0]!.check_month,
      ]);
      return { lineageId: lineage[0]!.id, checkMonth: month[0]!.check_month };
    },
    async insertEdges(rows) {
      await db.query(
        `insert into public.link_edges (check_id, check_month, lineage_id, from_url, to_url,
           anchor_text, is_generic_anchor, js_only)
         select r.check_id, r.check_month, r.lineage_id, r.from_url, r.to_url, r.anchor_text,
                r.is_generic_anchor, r.js_only
           from jsonb_to_recordset($1::jsonb) as r (check_id uuid, check_month date,
             lineage_id uuid, from_url text, to_url text, anchor_text text,
             is_generic_anchor boolean, js_only boolean)
         on conflict (check_id, from_hash, to_hash, check_month) do nothing`,
        [JSON.stringify(rows)],
      );
    },
  };
}

/** A table or column name, as this reader interpolates it. */
const NAME = /^[a-z_]+$/;

export function pgliteCheckReader(db: Db): CheckReader {
  return {
    async rows(table, column, values) {
      if (!NAME.test(table) || !NAME.test(column))
        throw new Error(`pgliteCheckReader: not a name: ${table}.${column}`);
      const { rows } = await db.query<{ row: Record<string, unknown> }>(
        `select to_jsonb(t) as row from public.${table} t where t.${column}::text = any($1::text[])`,
        [values],
      );
      return rows.map((r) => r.row);
    },
  };
}

type SeededCheck = Pick<
  BuildInput['check'],
  'id' | 'site_id' | 'trigger' | 'grade_version' | 'queued_at' | 'started_at' | 'expires_at'
>;

/** `site`, and `check` running as claim_check leaves a check: what persist_built_check writes over. */
export async function seedRunningCheck(db: Db, site: Site, check: SeededCheck): Promise<void> {
  await seedSite(db, site);
  await seedRunning(db, check);
}

/** `site`, its schedule flattened as the sites table stores it; a client report is not seeded. */
export async function seedSite(db: Db, site: Site): Promise<void> {
  await db.query(
    `insert into public.sites (id, account_id, host, staging_of_site_id, client_name,
                               client_contact_name, client_contact_email, schedule_cadence,
                               schedule_iso_weekday, schedule_hour_local, competitor_hosts,
                               slack_channel, owner_seat_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      site.id,
      site.account_id,
      site.host,
      site.staging_of_site_id,
      site.client_name,
      site.client_contact_name,
      site.client_contact_email,
      site.schedule?.cadence ?? null,
      site.schedule?.iso_weekday ?? null,
      site.schedule?.hour_local ?? null,
      site.competitor_hosts,
      site.slack_channel,
      site.owner_seat_id,
      site.created_at,
    ],
  );
}

/** `check` of a site already seeded, running as claim_check leaves a check. */
export async function seedRunning(db: Db, check: SeededCheck): Promise<void> {
  await db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                expires_at, progress, inngest_run_id, heartbeat_at)
     values ($1, $2, 'running', $3, $4, $5, $6, $7, $8::jsonb, 'test-run', now())`,
    [
      check.id,
      check.site_id,
      check.trigger,
      check.grade_version,
      check.queued_at,
      check.started_at,
      check.expires_at,
      JSON.stringify({
        steps: [{ phase: 'grading', state: 'now' }],
        pages_crawled: 0,
        pages_estimated: null,
        links_found: 0,
        elapsed_ms: 0,
        recent_fetches: [],
      }),
    ],
  );
}
