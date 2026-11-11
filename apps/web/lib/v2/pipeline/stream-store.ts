/**
 * What the progress stream and the notify route read and write in Postgres (CC-22b D5, D9), through
 * the service role: one narrow read of a check per poll, the guarded write of `checks.notify_email`,
 * and an ended check's two scores for the `check_finished` event.
 *
 * `supabaseStreamStore` is production's; `sqlStreamStore` is the same statements in SQL, for PGlite.
 * `notify_email` is written here and read nowhere in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Check } from '@crawlmouse/types/v2';
import type { CrawlBatchStatus } from './types';

/** A `crawl_batches` row as the stream reads it. `pages` and `links` are its summary's counts. */
export interface StreamBatch {
  batch: number;
  kind: 'crawl' | 'access';
  status: CrawlBatchStatus;
  resultPath: string | null;
  pages: number;
  links: number;
}

/** A check as one poll of the stream reads it, with its site's owner and its batch rows. */
export interface StreamSnapshot {
  siteId: string;
  /** Null for a site no account keeps. */
  accountId: string | null;
  siteRemoved: boolean;
  status: Check['status'];
  /** The stored progress; null unless the check is running. */
  progress: {
    steps: { phase: string; state: string }[];
    pages_crawled: number;
    links_found: number;
  } | null;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  /** In batch order. */
  batches: StreamBatch[];
}

/** An ended check's scores as `check_finished` carries them. */
export interface FinishedScores {
  /** The Technical SEO score; null when that grade was refused or the check has none. */
  seo: number | null;
  /** The AI readability total; null when it was withheld or the check has none. */
  aiReadability: number | null;
  withheld: boolean;
}

export interface StreamStore {
  /** Null when there is no such check. */
  snapshot(checkId: string): Promise<StreamSnapshot | null>;
  /**
   * Stores the address on a check that is queued, running or deferred; false, writing nothing,
   * when the check is in another status or does not exist.
   */
  setNotifyEmail(checkId: string, email: string): Promise<boolean>;
  scores(checkId: string): Promise<FinishedScores>;
}

/** The statuses a notify request is stored in. */
export const WAITING: readonly Check['status'][] = ['queued', 'running', 'deferred'];

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const record = (v: unknown): Row | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : null;

function progressOf(v: unknown): StreamSnapshot['progress'] {
  const p = record(v);
  if (!p) return null;
  const steps = Array.isArray(p.steps) ? p.steps : [];
  return {
    steps: steps.flatMap((s) => {
      const step = record(s);
      return step ? [{ phase: String(step.phase), state: String(step.state) }] : [];
    }),
    pages_crawled: count(p.pages_crawled),
    links_found: count(p.links_found),
  };
}

function batchOf(r: Row): StreamBatch {
  const summary = record(r.summary);
  return {
    batch: Number(r.batch),
    kind: r.kind === 'access' ? 'access' : 'crawl',
    status: r.status as CrawlBatchStatus,
    resultPath: text(r.result_path),
    pages: count(summary?.pages),
    links: count(summary?.links),
  };
}

function snapshotOf(check: Row, site: Row, batches: Row[]): StreamSnapshot {
  return {
    siteId: String(check.site_id),
    accountId: text(site.account_id),
    siteRemoved: site.removed_at !== null && site.removed_at !== undefined,
    status: check.status as Check['status'],
    progress: progressOf(check.progress),
    startedAt: text(check.started_at),
    finishedAt: text(check.finished_at),
    expiresAt: text(check.expires_at),
    batches: batches.map(batchOf).sort((a, b) => a.batch - b.batch),
  };
}

function scoresOf(row: Row | null): FinishedScores {
  const seo = record(row?.technical_seo);
  const ai = record(row?.ai_readability);
  const withheld = ai?.withheld === true;
  return {
    seo: typeof seo?.score === 'number' ? seo.score : null,
    aiReadability: !withheld && typeof ai?.total === 'number' ? ai.total : null,
    withheld,
  };
}

const CHECK_COLUMNS = 'site_id, status, progress, started_at, finished_at, expires_at';
const BATCH_COLUMNS = 'batch, kind, status, result_path, summary';

type Result<T> = { data: T | null; error: { message: string } | null };

function must<T>(what: string, { data, error }: Result<T>): T | null {
  if (error) throw new Error(`stream store: ${what}: ${error.message}`);
  return data;
}

export function supabaseStreamStore(sb: SupabaseClient): StreamStore {
  return {
    async snapshot(checkId) {
      const check = must<Row>(
        'check',
        await sb
          .from('checks')
          .select(`${CHECK_COLUMNS}, sites(account_id, removed_at)`)
          .eq('id', checkId)
          .maybeSingle(),
      );
      if (!check) return null;
      // PostgREST gives a to-one embed as an object; a client typed without the schema may see an array.
      const site = record(Array.isArray(check.sites) ? check.sites[0] : check.sites);
      if (!site) return null;
      const batches = must<Row[]>(
        'batches',
        await sb.from('crawl_batches').select(BATCH_COLUMNS).eq('check_id', checkId).order('batch'),
      );
      return snapshotOf(check, site, batches ?? []);
    },

    async setNotifyEmail(checkId, email) {
      const rows = must<Row[]>(
        'notify',
        await sb
          .from('checks')
          .update({ notify_email: email })
          .eq('id', checkId)
          .in('status', [...WAITING])
          .select('id'),
      );
      return (rows ?? []).length > 0;
    },

    async scores(checkId) {
      return scoresOf(
        must<Row>(
          'scores',
          await sb
            .from('checks')
            .select('technical_seo, ai_readability')
            .eq('id', checkId)
            .maybeSingle(),
        ),
      );
    },
  };
}

/** What the SQL twin needs of a connection: PGlite, or a transaction of one. */
export interface SqlDb {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function sqlStreamStore(db: SqlDb): StreamStore {
  return {
    async snapshot(checkId) {
      const { rows } = await db.query<{ check: Row; site: Row; batches: Row[] }>(
        `select jsonb_build_object('site_id', c.site_id, 'status', c.status, 'progress', c.progress,
                                   'started_at', c.started_at, 'finished_at', c.finished_at,
                                   'expires_at', c.expires_at) as "check",
                jsonb_build_object('account_id', s.account_id, 'removed_at', s.removed_at) as site,
                coalesce((select jsonb_agg(jsonb_build_object(
                                   'batch', b.batch, 'kind', b.kind, 'status', b.status,
                                   'result_path', b.result_path, 'summary', b.summary))
                            from public.crawl_batches b where b.check_id = c.id), '[]'::jsonb) as batches
           from public.checks c join public.sites s on s.id = c.site_id
          where c.id = $1`,
        [checkId],
      );
      const found = rows[0];
      return found ? snapshotOf(found.check, found.site, found.batches) : null;
    },

    async setNotifyEmail(checkId, email) {
      const { rows } = await db.query<{ id: string }>(
        `update public.checks set notify_email = $2
          where id = $1 and status = any($3::text[]) returning id`,
        [checkId, email, [...WAITING]],
      );
      return rows.length > 0;
    },

    async scores(checkId) {
      const { rows } = await db.query<Row>(
        `select technical_seo, ai_readability from public.checks where id = $1`,
        [checkId],
      );
      return scoresOf(rows[0] ?? null);
    },
  };
}
