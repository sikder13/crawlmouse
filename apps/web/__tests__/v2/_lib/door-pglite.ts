/**
 * The account door's stores over PGlite with every migration applied, for the first-login and claim
 * tests. Each call is its own transaction as the service role, as each PostgREST request is, so the
 * tests interleave calls the way two concurrent requests would. PGlite has one connection: a lock
 * never waits here, so these tests cover interleavings between calls, not inside one.
 */
import type { PGlite } from '@electric-sql/pglite';
import {
  EntitlementConflictError,
  snapshotFromRow,
  type AccountRow,
  type EntitlementStore,
} from '../../../lib/billing/state-machine-apply';
import type { DoorStore, MemberAccount } from '../../../lib/auth/door-store';
import { parseTrialDecision } from '../../../lib/auth/trial-decision';
import { applyAllMigrations, asRole, freshDb } from '../../helpers/pglite-migrations';

let template: Promise<PGlite> | null = null;

/** A database with every migration applied: one migrated template per test file, cloned per call. */
export async function doorDb(): Promise<PGlite> {
  template ??= (async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    return db;
  })();
  return (await template).clone() as Promise<PGlite>;
}

const svc = <T>(db: PGlite, fn: Parameters<typeof asRole<T>>[3]) =>
  asRole(db, 'service_role', null, fn);

/** A signed-up user: the auth row, which the trigger turns into users, an account and a seat. */
export async function signUp(db: PGlite, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [email],
  );
  return rows[0]!.id;
}

export async function accountOf(db: PGlite, userId: string) {
  const { rows } = await db.query<{
    id: string;
    state: string;
    trial_variant: string | null;
    trial_ends_at: Date | null;
    site_limit: number;
    timezone: string;
  }>(
    `select a.id, a.state, a.trial_variant, a.trial_ends_at, a.site_limit, a.timezone
       from public.accounts a join public.users u on u.default_account_id = a.id where u.id = $1`,
    [userId],
  );
  return rows[0]!;
}

export async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from (${sql}) q`,
    params,
  );
  return rows[0]!.n;
}

/** An anonymous audit: an unowned site and its check, expiring at `expiresAt`. */
export async function anonymousCheck(
  db: PGlite,
  host: string,
  expiresAt: Date | null,
): Promise<{ siteId: string; checkId: string }> {
  const site = await db.query<{ id: string }>(
    `insert into public.sites (host) values ($1) returning id`,
    [host],
  );
  const siteId = site.rows[0]!.id;
  const check = await db.query<{ id: string }>(
    `insert into public.checks (site_id, status, trigger, grade_version, expires_at)
     values ($1, 'queued', 'first_audit', '1.0.0', $2) returning id`,
    [siteId, expiresAt],
  );
  return { siteId, checkId: check.rows[0]!.id };
}

const ACCOUNT_COLUMNS =
  'state, tier, trial_variant, trial_ends_at, trial_used_at, past_due_tier, past_due_since, ' +
  'disputed_at, seat_limit, site_limit, competitor_limit, entitlement_version, ' +
  'current_subscription_id, entitlement_changed_at, state_history';

export function pgliteEntitlementStore(db: PGlite): EntitlementStore {
  return {
    async load(accountId) {
      const { rows } = await svc(db, (tx) =>
        tx.query<AccountRow>(`select ${ACCOUNT_COLUMNS} from public.accounts where id = $1`, [
          accountId,
        ]),
      );
      return rows[0] ? snapshotFromRow(rows[0]) : null;
    },
    async commit(p) {
      try {
        const { rows } = await svc(db, (tx) =>
          tx.query<{ v: number }>(
            `select public.apply_entitlement_transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) as v`,
            [
              p.p_account_id,
              p.p_expected_version,
              p.p_state,
              p.p_tier,
              p.p_past_due_tier,
              p.p_past_due_since,
              p.p_trial_variant,
              p.p_trial_ends_at,
              p.p_trial_used_at,
              p.p_disputed_at,
              p.p_seat_limit,
              p.p_site_limit,
              p.p_competitor_limit,
              p.p_at,
              p.p_subscription_id,
              p.p_changed_at,
            ],
          ),
        );
        return rows[0]!.v;
      } catch (e) {
        if ((e as { code?: string }).code === '40001')
          throw new EntitlementConflictError(p.p_account_id);
        throw e;
      }
    },
    async confirm(accountId, version) {
      try {
        await svc(db, (tx) =>
          tx.query(`select public.assert_entitlement_version($1, $2)`, [accountId, version]),
        );
      } catch (e) {
        if ((e as { code?: string }).code === '40001')
          throw new EntitlementConflictError(accountId);
        throw e;
      }
    },
  };
}

export function pgliteDoorStore(db: PGlite): DoorStore {
  return {
    async loadMember(userId) {
      const { rows } = await svc(db, (tx) =>
        tx.query<{
          account_id: string;
          seat_id: string;
          state: MemberAccount['state'];
          tier: MemberAccount['tier'];
          trial_variant: MemberAccount['trialVariant'];
          trial_ends_at: Date | null;
          trial_used_at: Date | null;
          past_due_tier: MemberAccount['pastDueTier'];
          past_due_since: Date | null;
          site_limit: number;
          timezone: string;
        }>(
          `select a.id as account_id, s.id as seat_id, a.state, a.tier, a.trial_variant,
                  a.trial_ends_at, a.trial_used_at, a.past_due_tier, a.past_due_since, a.site_limit,
                  a.timezone
             from public.users u
             join public.accounts a on a.id = u.default_account_id and a.deleted_at is null
             join public.seats s on s.account_id = a.id and s.user_id = u.id
                                and s.role = 'owner' and s.status = 'active'
            where u.id = $1`,
          [userId],
        ),
      );
      const r = rows[0];
      if (!r) return null;
      return {
        accountId: r.account_id,
        ownerSeatId: r.seat_id,
        state: r.state,
        tier: r.tier,
        trialVariant: r.trial_variant,
        trialEndsAt: r.trial_ends_at,
        trialUsedAt: r.trial_used_at,
        pastDueTier: r.past_due_tier,
        pastDueSince: r.past_due_since,
        siteLimit: r.site_limit,
        timezone: r.timezone,
      };
    },
    async setTimezone(accountId, zone) {
      await svc(db, (tx) =>
        tx.query(`update public.accounts set timezone = $2, updated_at = now() where id = $1`, [
          accountId,
          zone,
        ]),
      );
    },
    async startTrial(accountId, hashes, transition) {
      const { rows } = await svc(db, (tx) =>
        tx.query<{ r: unknown }>(
          `select public.start_trial_with_ledger($1, $2::jsonb, $3::jsonb) as r`,
          [accountId, JSON.stringify(hashes), JSON.stringify(transition)],
        ),
      );
      return parseTrialDecision(rows[0]!.r);
    },
    async countActiveSites(accountId) {
      const { rows } = await svc(db, (tx) =>
        tx.query<{ n: number }>(
          `select count(*)::int as n from public.sites
            where account_id = $1 and removed_at is null and staging_of_site_id is null`,
          [accountId],
        ),
      );
      return rows[0]!.n;
    },
    async insertSite(site) {
      try {
        const { rows } = await svc(db, (tx) =>
          tx.query<{ id: string }>(
            `insert into public.sites (account_id, host, owner_seat_id, schedule_cadence,
                                       schedule_iso_weekday, schedule_hour_local)
             values ($1, $2, $3, $4, $5, $6) returning id`,
            [
              site.accountId,
              site.host,
              site.ownerSeatId,
              site.schedule?.cadence ?? null,
              site.schedule?.iso_weekday ?? null,
              site.schedule?.hour_local ?? null,
            ],
          ),
        );
        return { siteId: rows[0]!.id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return 'exists';
        throw e;
      }
    },
    async loadCheck(checkId) {
      const { rows } = await svc(db, (tx) =>
        tx.query<{
          id: string;
          site_id: string;
          account_id: string | null;
          host: string;
          expires_at: Date | null;
        }>(
          `select c.id, c.site_id, s.account_id, s.host, c.expires_at
             from public.checks c join public.sites s on s.id = c.site_id
            where c.id = $1 and s.removed_at is null`,
          [checkId],
        ),
      );
      const r = rows[0];
      return r
        ? {
            checkId: r.id,
            siteId: r.site_id,
            siteAccountId: r.account_id,
            host: r.host,
            expiresAt: r.expires_at,
          }
        : null;
    },
    async takeSite(siteId, site) {
      try {
        const { rows } = await svc(db, (tx) =>
          tx.query<{ id: string }>(
            `update public.sites
                set account_id = $2, owner_seat_id = $3, schedule_cadence = $4,
                    schedule_iso_weekday = $5, schedule_hour_local = $6, updated_at = now()
              where id = $1 and account_id is null
             returning id`,
            [
              siteId,
              site.accountId,
              site.ownerSeatId,
              site.schedule?.cadence ?? null,
              site.schedule?.iso_weekday ?? null,
              site.schedule?.hour_local ?? null,
            ],
          ),
        );
        return rows.length === 1 ? 'taken' : 'not_unowned';
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return 'host_kept';
        throw e;
      }
    },
    async clearExpiry(checkId) {
      await svc(db, (tx) =>
        tx.query(`update public.checks set expires_at = null where id = $1`, [checkId]),
      );
    },
  };
}
