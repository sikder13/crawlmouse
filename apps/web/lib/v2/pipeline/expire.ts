/**
 * The daily expiry's two jobs (CC-22b D8), each one step of `crawlmouse.check.expiry`
 * (inngest/check-expiry.ts).
 *
 * `expireUnkept` deletes the sites no account keeps once they are past keeping
 * (`unkept_site_expired`, migration 022b): for each, its checks' evidence objects are removed, then
 * the site's row is deleted and its checks, their measurement rows and its fixes go by the foreign
 * keys' cascades. The objects removed are those under `anon/` and, for each account in a check's
 * `copied_for`, the same names in that account's directory of the check: what a Keep copied and did
 * not commit. The objects go first, so a run that stops between the two is finished by the
 * next, which lists the site again. Each site is deleted by a statement of its own
 * (`delete_expired_unkept_sites` with one id), so a statement holds one site's cascade and a site
 * whose delete fails is counted and left for the next run while the others go. A site an account
 * keeps is not listed, and the delete statement asks `account_id is null` itself.
 *
 * `settleKept` moves what the ended checks of kept sites still hold under `anon/`
 * (`settleKeptCheck`, keep.ts): a check kept while it ran, one whose copy failed or ran out of
 * budget inside the claim, and one whose `anon/` objects a failed removal left. For a check claimed
 * inside the sweep window it also removes the copies a refused Keep left under another account.
 *
 * Both work in bounded batches inside a time budget and return counts, with what is left for the
 * next run.
 */
import { copyPaths, objectNames, settleKeptCheck, type KeepDeps } from './keep';
import type { ExpireStore } from './expire-store';
import { ANONYMOUS_EXPIRY_HOURS } from './limits';
import { evidencePath, type EvidenceStore } from './types';

/**
 * How long past its `expires_at` a check is before the expiry lists it. `keep_check` refuses a
 * check at its `expires_at` on the database's clock, and the cutoff here is this process's clock
 * less the grace: the grace is the room for the two clocks to differ and for a claim that passed
 * the claim's own expiry test to commit.
 */
export const EXPIRY_GRACE_MS = 10 * 60 * 1000;
/**
 * Sites listed per batch. For each: one Storage removal per check (and one more for each account
 * in its `copied_for`), then one delete statement.
 */
export const EXPIRY_BATCH_SITES = 50;
/** Batches per run, so 1,000 sites a run at most. */
export const EXPIRY_MAX_BATCHES = 20;
/** Kept checks listed per batch of the settle step. */
export const SETTLE_BATCH_CHECKS = 10;
/** Batches per run of the settle step, so 100 checks a run at most. */
export const SETTLE_MAX_BATCHES = 10;
/** How long after a claim the settle step still looks under the claimed check's `anon/` directory. */
export const SETTLE_SWEEP_MS = 3 * 24 * 60 * 60 * 1000;
/** Neither step starts a batch once it has run this long: under the serve route's 300 s. */
export const STEP_BUDGET_MS = 120_000;

const HOUR_MS = 60 * 60 * 1000;

export interface ExpireDeps {
  store: ExpireStore;
  evidence: Pick<EvidenceStore, 'remove'>;
  /** What the settle step moves with. */
  keep: KeepDeps;
  /** Milliseconds since the epoch. */
  now(): number;
  /** The batch size and count, where a test sets them. */
  bounds?: { batch: number; maxBatches: number };
}

export interface ExpireOutput {
  /** Sites deleted. */
  sites: number;
  /** Their checks. */
  checks: number;
  /** Sites left in place: their objects could not be removed, or their delete failed. */
  skipped: number;
  /** Sites past keeping that this run did not reach. */
  left: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

export async function expireUnkept(deps: ExpireDeps): Promise<ExpireOutput> {
  const started = deps.now();
  const cutoff = iso(started - EXPIRY_GRACE_MS);
  // A site with no check: older than the longest an audit of it could have lived.
  const bareBefore = iso(started - EXPIRY_GRACE_MS - ANONYMOUS_EXPIRY_HOURS * HOUR_MS);
  const batch = deps.bounds?.batch ?? EXPIRY_BATCH_SITES;
  const maxBatches = deps.bounds?.maxBatches ?? EXPIRY_MAX_BATCHES;
  const out: ExpireOutput = { sites: 0, checks: 0, skipped: 0, left: 0 };
  let after: string | null = null;

  for (let i = 0; i < maxBatches; i++) {
    if (i > 0 && deps.now() - started > STEP_BUDGET_MS) break;
    const page = await deps.store.expiredUnkept(cutoff, bareBefore, after, batch);
    if (page.rows.length === 0) {
      out.left = 0;
      break;
    }
    for (const site of page.rows) {
      try {
        for (const check of site.checks) {
          const owner = { accountId: null, siteId: site.siteId, checkId: check.checkId };
          await deps.evidence.remove(
            objectNames(check.batches).map((name) => evidencePath(owner, name)),
          );
          for (const accountId of check.copiedFor) {
            await deps.evidence.remove(copyPaths({ ...owner, batches: check.batches }, accountId));
          }
        }
        // Empty when the site was kept, or stopped being past keeping, since it was listed.
        const deleted = await deps.store.deleteExpiredUnkept([site.siteId], cutoff, bareBefore);
        if (deleted.includes(site.siteId)) {
          out.sites++;
          out.checks += site.checks.length;
        }
      } catch {
        out.skipped++;
      }
    }
    after = page.rows.at(-1)!.siteId;
    out.left = page.remaining - page.rows.length;
  }
  return out;
}

export interface SettleOutput {
  /** Checks whose objects were moved under their account. */
  moved: number;
  /** Checks listed that hold nothing under `anon/`. */
  nothing: number;
  /** Checks whose copy, path rewrite or removal failed: left for the next run. */
  failed: number;
  /** Checks listed that this run did not reach. */
  left: number;
}

export async function settleKept(deps: ExpireDeps): Promise<SettleOutput> {
  const started = deps.now();
  const since = iso(started - SETTLE_SWEEP_MS);
  const batch = deps.bounds?.batch ?? SETTLE_BATCH_CHECKS;
  const maxBatches = deps.bounds?.maxBatches ?? SETTLE_MAX_BATCHES;
  const out: SettleOutput = { moved: 0, nothing: 0, failed: 0, left: 0 };
  let after: string | null = null;

  for (let i = 0; i < maxBatches; i++) {
    if (i > 0 && deps.now() - started > STEP_BUDGET_MS) break;
    const page = await deps.store.unsettledKept(since, after, batch);
    if (page.rows.length === 0) {
      out.left = 0;
      break;
    }
    for (const check of page.rows) {
      const result = await settleKeptCheck(deps.keep, check).catch(() => 'failed' as const);
      out[result]++;
    }
    after = page.rows.at(-1)!.checkId;
    out.left = page.remaining - page.rows.length;
  }
  return out;
}
