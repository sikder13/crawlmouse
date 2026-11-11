/**
 * What the daily expiry reads and deletes in Postgres (CC-22b D8): migration 022b section D's
 * `expired_unkept_sites`, `delete_expired_unkept_sites` and `unsettled_kept_checks`. This is the
 * service-role supabase-js implementation; `test-support/sql-expire-store.ts` calls the same three
 * functions over PGlite.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KeptCheck } from './keep';

/** A check of an expired site: its batch numbers name its batch objects. */
export interface ExpiredCheck {
  checkId: string;
  batches: number[];
}

/** A site no account keeps that is past keeping, with its checks (none for a site that has none). */
export interface ExpiredSite {
  siteId: string;
  checks: ExpiredCheck[];
}

/** One page of a keyset read, and how many rows qualified from its cursor on, the page included. */
export interface Page<T> {
  rows: T[];
  remaining: number;
}

export interface ExpireStore {
  /** `expired_unkept_sites`: up to `limit` sites in id order after `after`. */
  expiredUnkept(
    cutoff: string,
    bareBefore: string,
    after: string | null,
    limit: number,
  ): Promise<Page<ExpiredSite>>;
  /** `delete_expired_unkept_sites`: the ids it deleted, each still unkept and expired then. */
  deleteExpiredUnkept(
    siteIds: readonly string[],
    cutoff: string,
    bareBefore: string,
  ): Promise<string[]>;
  /** `unsettled_kept_checks`: up to `limit` checks in id order after `after`. */
  unsettledKept(since: string, after: string | null, limit: number): Promise<Page<KeptCheck>>;
}

/** A row of `expired_unkept_sites`. */
export interface ExpiredRow {
  site_id: string;
  check_id: string | null;
  batches: number[];
  remaining: number | string;
}

/** A row of `unsettled_kept_checks`. */
export interface UnsettledRow {
  check_id: string;
  site_id: string;
  account_id: string;
  batches: number[];
  remaining: number | string;
}

const remainingOf = (rows: readonly { remaining: number | string }[]): number =>
  rows.length === 0 ? 0 : Number(rows[0]!.remaining);

/** The function's rows, one per check, grouped into sites in the order they came. */
export function expiredPage(rows: readonly ExpiredRow[]): Page<ExpiredSite> {
  const sites: ExpiredSite[] = [];
  for (const row of rows) {
    let site = sites.at(-1);
    if (site?.siteId !== row.site_id) {
      site = { siteId: row.site_id, checks: [] };
      sites.push(site);
    }
    if (row.check_id !== null) site.checks.push({ checkId: row.check_id, batches: row.batches });
  }
  return { rows: sites, remaining: remainingOf(rows) };
}

export function unsettledPage(rows: readonly UnsettledRow[]): Page<KeptCheck> {
  return {
    rows: rows.map((r) => ({
      checkId: r.check_id,
      siteId: r.site_id,
      accountId: r.account_id,
      batches: r.batches,
    })),
    remaining: remainingOf(rows),
  };
}

type Result<T> = { data: T | null; error: { message: string } | null };

function must<T>(what: string, { data, error }: Result<T>): T {
  if (error) throw new Error(`expire store: ${what}: ${error.message}`);
  return data as T;
}

export function supabaseExpireStore(sb: SupabaseClient): ExpireStore {
  return {
    async expiredUnkept(cutoff, bareBefore, after, limit) {
      const rows = must<ExpiredRow[]>(
        'expired_unkept_sites',
        await sb.rpc('expired_unkept_sites', {
          p_cutoff: cutoff,
          p_bare_before: bareBefore,
          p_after: after,
          p_limit: limit,
        }),
      );
      return expiredPage(rows ?? []);
    },

    async deleteExpiredUnkept(siteIds, cutoff, bareBefore) {
      if (siteIds.length === 0) return [];
      const deleted = must<string[]>(
        'delete_expired_unkept_sites',
        await sb.rpc('delete_expired_unkept_sites', {
          p_sites: [...siteIds],
          p_cutoff: cutoff,
          p_bare_before: bareBefore,
        }),
      );
      return deleted ?? [];
    },

    async unsettledKept(since, after, limit) {
      const rows = must<UnsettledRow[]>(
        'unsettled_kept_checks',
        await sb.rpc('unsettled_kept_checks', { p_since: since, p_after: after, p_limit: limit }),
      );
      return unsettledPage(rows ?? []);
    },
  };
}
