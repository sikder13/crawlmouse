/**
 * The ExpireStore over SQL, for PGlite: the same three functions supabaseExpireStore calls, each
 * call through `run` (one transaction as the service role in the tests).
 */
import {
  expiredPage,
  unsettledPage,
  type ExpiredRow,
  type ExpireStore,
  type UnsettledRow,
} from '../expire-store';
import type { RunSql } from './sql-keep-store';

export function sqlExpireStore(run: RunSql): ExpireStore {
  return {
    async expiredUnkept(cutoff, bareBefore, after, limit) {
      const { rows } = await run((db) =>
        db.query<ExpiredRow>(
          `select site_id, check_id, batches, remaining
             from public.expired_unkept_sites($1::timestamptz, $2::timestamptz, $3::uuid, $4)`,
          [cutoff, bareBefore, after, limit],
        ),
      );
      return expiredPage(rows);
    },

    async deleteExpiredUnkept(siteIds, cutoff, bareBefore) {
      if (siteIds.length === 0) return [];
      const { rows } = await run((db) =>
        db.query<{ id: string }>(
          `select public.delete_expired_unkept_sites($1::uuid[], $2::timestamptz, $3::timestamptz) as id`,
          [[...siteIds], cutoff, bareBefore],
        ),
      );
      return rows.map((r) => r.id);
    },

    async unsettledKept(since, after, limit) {
      const { rows } = await run((db) =>
        db.query<UnsettledRow>(
          `select check_id, site_id, account_id, batches, remaining
             from public.unsettled_kept_checks($1::timestamptz, $2::uuid, $3)`,
          [since, after, limit],
        ),
      );
      return unsettledPage(rows);
    },
  };
}
