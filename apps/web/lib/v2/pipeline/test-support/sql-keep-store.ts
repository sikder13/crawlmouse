/**
 * The KeepStore over SQL, for PGlite: the same statements as supabaseKeepStore, written out. Each
 * call runs through `run`, which the tests give as one transaction as the service role, as each
 * PostgREST request is.
 */
import {
  keepArgs,
  keepOutcome,
  LIVE_OR_GRADED,
  type CheckEvidence,
  type KeepStore,
} from '../keep-store';
import type { SqlDb } from './sql-store';

/** Runs `fn` against a connection: the database itself, or a transaction under a role. */
export type RunSql = <T>(fn: (db: SqlDb) => Promise<T>) => Promise<T>;

export const direct =
  (db: SqlDb): RunSql =>
  (fn) =>
    fn(db);

export function sqlKeepStore(run: RunSql): KeepStore {
  return {
    async hostKept(accountId, host) {
      const { rows } = await run((db) =>
        db.query<{ n: number }>(
          `select count(*)::int as n from public.sites
            where account_id = $1 and host = $2 and removed_at is null`,
          [accountId, host],
        ),
      );
      return rows[0]!.n > 0;
    },

    async evidenceOf(checkId) {
      const { rows } = await run((db) =>
        db.query<CheckEvidence & { account_id: string | null }>(
          `select c.status, s.account_id,
                  coalesce((select array_agg(b.batch order by b.batch)
                              from public.crawl_batches b where b.check_id = c.id),
                           '{}'::integer[]) as batches
             from public.checks c join public.sites s on s.id = c.site_id
            where c.id = $1`,
          [checkId],
        ),
      );
      const r = rows[0];
      return r ? { status: r.status, accountId: r.account_id, batches: r.batches } : null;
    },

    async noteCopy(checkId, accountId) {
      const { rows } = await run((db) =>
        db.query<{ noted: boolean }>(`select public.note_check_copy($1::uuid, $2::uuid) as noted`, [
          checkId,
          accountId,
        ]),
      );
      return rows[0]!.noted === true;
    },

    async keep(commit) {
      const a = keepArgs(commit);
      const { rows } = await run((db) =>
        db.query<{ outcome: unknown }>(
          `select public.keep_check($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb) as outcome`,
          [
            a.p_check,
            a.p_account,
            a.p_owner_seat,
            a.p_cadence,
            a.p_iso_weekday,
            a.p_hour_local,
            JSON.stringify(a.p_paths),
          ],
        ),
      );
      return keepOutcome(rows[0]!.outcome);
    },

    async movePaths(checkId, accountId, pairs) {
      const { rows } = await run((db) =>
        db.query<{ moved: number }>(
          `select public.move_check_paths($1::uuid, $2::uuid, $3::jsonb) as moved`,
          [checkId, accountId, JSON.stringify(pairs)],
        ),
      );
      return Number(rows[0]!.moved);
    },

    async hasLiveOrGradedCheck(siteId) {
      const { rows } = await run((db) =>
        db.query<{ n: number }>(
          `select count(*)::int as n from public.checks
            where site_id = $1 and status = any($2::text[])`,
          [siteId, [...LIVE_OR_GRADED]],
        ),
      );
      return rows[0]!.n > 0;
    },
  };
}
