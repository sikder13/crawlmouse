/**
 * What keeping an audit reads and writes in Postgres (CC-22b D7), beside the door's own store: the
 * check's status and batch numbers, the commit (`keep_check`, migration 022b section D), the later
 * path rewrite (`move_check_paths`), and two reads the claim decides by. This is the service-role
 * supabase-js implementation; `test-support/sql-keep-store.ts` is the same interface over PGlite,
 * with the same statements in SQL.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Check } from '@crawlmouse/types/v2';
import type { SiteSchedule } from '../../auth/schedule';

/** A stored evidence path and the path its object was copied to. */
export interface PathPair {
  old_path: string;
  new_path: string;
}

/** What `keep_check` answers. */
export const KEEP_OUTCOMES = ['taken', 'not_unowned', 'host_kept', 'expired'] as const;
export type KeepOutcome = (typeof KEEP_OUTCOMES)[number];

export interface KeepCommit {
  checkId: string;
  accountId: string;
  ownerSeatId: string;
  schedule: SiteSchedule | null;
  /** The stored paths to rewrite: each pair's object was copied and read back. */
  pairs: readonly PathPair[];
}

/** What the move reads of a check. */
export interface CheckEvidence {
  status: Check['status'];
  /** The account that keeps the check's site; null when none does. */
  accountId: string | null;
  /** The numbers of the check's `crawl_batches` rows, which name its batch objects. */
  batches: number[];
}

/** The statuses of a check that is waiting, running, or has a result: a site with one has its audit. */
export const LIVE_OR_GRADED: readonly Check['status'][] = [
  'queued',
  'running',
  'deferred',
  'finished',
  'partial',
];

export interface KeepStore {
  /** Whether the account keeps a site (not removed) with that host. */
  hostKept(accountId: string, host: string): Promise<boolean>;
  /** Null when there is no such check. */
  evidenceOf(checkId: string): Promise<CheckEvidence | null>;
  /** `keep_check`: ownership, the expiry and the path pairs in one transaction. */
  keep(commit: KeepCommit): Promise<KeepOutcome>;
  /** `move_check_paths`: how many stored paths it rewrote. */
  movePaths(checkId: string, accountId: string, pairs: readonly PathPair[]): Promise<number>;
  /** Whether the site has a check whose status is one of LIVE_OR_GRADED. */
  hasLiveOrGradedCheck(siteId: string): Promise<boolean>;
}

type PgError = { message: string; code?: string } | null;

function check(what: string, error: PgError): void {
  if (error) {
    throw Object.assign(new Error(`keep store: ${what}: ${error.message}`), { code: error.code });
  }
}

function must<T>(what: string, { data, error }: { data: T | null; error: PgError }): T | null {
  check(what, error);
  return data;
}

export function keepOutcome(answer: unknown): KeepOutcome {
  if (!KEEP_OUTCOMES.includes(answer as KeepOutcome)) {
    throw new Error(`keep store: keep_check answered ${JSON.stringify(answer)}`);
  }
  return answer as KeepOutcome;
}

/** `keep_check`'s arguments, as both implementations pass them. */
export const keepArgs = (c: KeepCommit) => ({
  p_check: c.checkId,
  p_account: c.accountId,
  p_owner_seat: c.ownerSeatId,
  p_cadence: c.schedule?.cadence ?? null,
  p_iso_weekday: c.schedule?.iso_weekday ?? null,
  p_hour_local: c.schedule?.hour_local ?? null,
  p_paths: c.pairs,
});

export function supabaseKeepStore(sb: SupabaseClient): KeepStore {
  return {
    async hostKept(accountId, host) {
      const { count, error } = await sb
        .from('sites')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('host', host)
        .is('removed_at', null);
      check('sites host read', error);
      return (count ?? 0) > 0;
    },

    async evidenceOf(checkId) {
      const row = must(
        'checks read',
        await sb.from('checks').select('status, site_id').eq('id', checkId).maybeSingle(),
      ) as { status: Check['status']; site_id: string } | null;
      if (row === null) return null;
      const site = must(
        'sites read',
        await sb.from('sites').select('account_id').eq('id', row.site_id).maybeSingle(),
      ) as { account_id: string | null } | null;
      if (site === null) return null;
      const batches = (must(
        'crawl_batches read',
        await sb.from('crawl_batches').select('batch').eq('check_id', checkId).order('batch'),
      ) ?? []) as { batch: number }[];
      return {
        status: row.status,
        accountId: site.account_id,
        batches: batches.map((b) => b.batch),
      };
    },

    async keep(commit) {
      return keepOutcome(must('keep_check', await sb.rpc('keep_check', keepArgs(commit))));
    },

    async movePaths(checkId, accountId, pairs) {
      const moved = must(
        'move_check_paths',
        await sb.rpc('move_check_paths', {
          p_check: checkId,
          p_account: accountId,
          p_paths: pairs,
        }),
      );
      return Number(moved);
    },

    async hasLiveOrGradedCheck(siteId) {
      const { count, error } = await sb
        .from('checks')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .in('status', [...LIVE_OR_GRADED]);
      check('checks status read', error);
      return (count ?? 0) > 0;
    },
  };
}
