/**
 * The evidence move of a kept audit (CC-22b D7). An audit nobody keeps stores its objects under
 * `anon/{site}/{check}/`; once an account keeps its site they belong under `{account}/{site}/{check}/`.
 *
 * The order is copy, verify, commit, remove:
 * 1. the check's objects are named from its owner and its batch numbers (`objectNames`), and the
 *    listing of its `anon/` directory says which of them exist;
 * 2. each is read, written under the account and read back, and the bytes compared;
 * 3. the stored paths are rewritten by the pairs that were copied, in the database;
 * 4. the `anon/` objects are removed.
 * The stored paths are rewritten when the listed objects were copied and read back, and not when a
 * copy failed, so a stored path names an object that exists whichever step fails
 * (`pnpm --filter @crawlmouse/web exec vitest run lib/v2/pipeline/keep.test.ts -t property`).
 *
 * `claimKeep` is what the claim calls (lib/auth/claim.ts, through door-deps.ts): its commit is
 * `keep_check`, which takes the site and rewrites the paths in one transaction. A copy that fails
 * or passes its budget does not refuse the Keep: the commit then carries no pair, the check reads at
 * its `anon/` paths as before, and `settleKeptCheck` (the daily function, expire.ts) moves it later.
 * So does a check kept while it is queued or running, whose objects are still being written.
 *
 * Before the claim copies anything it records the account on the check's row (`note_check_copy`,
 * `checks.copied_for`), and copies nothing when that write fails. `keep_check` takes the account
 * out again when it commits. A Keep that is refused or throws removes its copies (`discardCopies`);
 * where that removal fails, a request is still in flight when the budget passes, or the process
 * stops first, the account stays on the row and the daily function removes the copies by name:
 * with the site's own objects when the site expires unkept (`expireUnkept`), and from
 * `settleKeptCheck` when another account kept it.
 */
import type { ClaimKeep } from '../../auth/claim';
import type { Report } from '../../auth/door-store';
import { evidenceDir, type EvidenceDirectory } from './evidence';
import type { KeepStore, PathPair } from './keep-store';
import { evidencePath, type EvidenceName, type EvidenceOwner, type EvidenceStore } from './types';

/**
 * What a copy inside the claim may take. A 500-page check holds 15 objects (keep.test.ts): one
 * listing and three requests an object, four objects at a time, so twelve rounds of requests; the
 * budget allows each about 650 ms. Storage's own latency is not measured here.
 */
export const KEEP_MOVE_BUDGET_MS = 8_000;
/** Objects copied at a time: each is held in memory twice while it is compared. */
export const MOVE_CONCURRENCY = 4;

export interface KeepDeps {
  store: KeepStore;
  evidence: EvidenceStore & EvidenceDirectory;
  /** A Sentry signal with ids only. */
  report: Report;
  /** KEEP_MOVE_BUDGET_MS unless a test sets another. */
  budgetMs?: number;
}

/** A check of a kept site, as the move needs it. */
export interface KeptCheck {
  checkId: string;
  siteId: string;
  accountId: string;
  /** The numbers of its `crawl_batches` rows. */
  batches: readonly number[];
  /**
   * What is left in the check's `copied_for`: accounts other than the keeper that a Keep copied its
   * objects for. The settle step's read gives it; the claim has none to give.
   */
  strays?: readonly string[];
}

/**
 * The names a check's objects can have: `built` and `map` can exist with no stored path, so the
 * names come from the path scheme and the batch numbers, not from `result_path` or `map_path`.
 */
export function objectNames(batches: readonly number[]): EvidenceName[] {
  return ['seeds', 'render', 'built', 'map', ...batches.map((n): EvidenceName => `batch-${n}`)];
}

const ENDED: readonly string[] = ['finished', 'partial', 'failed'];

interface Copy {
  /** Every listed object of the check was written under the account and read back equal. */
  complete: boolean;
  /** One pair per copied object when `complete`; none otherwise. */
  pairs: PathPair[];
  /** The paths under the account this copy wrote, complete or not. */
  written: string[];
}

const NOT_COPIED: Copy = { complete: false, pairs: [], written: [] };

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

const LATE = Symbol('late');

/** `work`'s value, or LATE once `ms` have passed. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function copyEvidence(
  evidence: KeepDeps['evidence'],
  check: KeptCheck,
  budgetMs: number,
): Promise<Copy> {
  const from: EvidenceOwner = { accountId: null, siteId: check.siteId, checkId: check.checkId };
  const to: EvidenceOwner = { ...from, accountId: check.accountId };
  const written: string[] = [];
  // Set when a copy failed or the budget passed: the others stop before their next request.
  const state = { stopped: false };

  const copyAll = async (): Promise<PathPair[]> => {
    const listed = new Set(await evidence.list(evidenceDir(from)));
    const plan = objectNames(check.batches)
      .map((name) => ({ old_path: evidencePath(from, name), new_path: evidencePath(to, name) }))
      .filter((pair) => listed.has(pair.old_path));
    let next = 0;
    const worker = async () => {
      while (!state.stopped && next < plan.length) {
        const pair = plan[next++]!;
        const bytes = await evidence.get(pair.old_path);
        if (state.stopped) return;
        written.push(pair.new_path);
        await evidence.put(pair.new_path, bytes);
        if (state.stopped) return;
        if (!sameBytes(bytes, await evidence.get(pair.new_path))) {
          throw new Error(`evidence: ${pair.new_path} read back differs`);
        }
      }
    };
    await Promise.all(Array.from({ length: MOVE_CONCURRENCY }, worker));
    if (state.stopped) throw new Error('evidence: the copy was stopped');
    return plan;
  };

  const settled = copyAll().then(
    (pairs) => pairs,
    () => null,
  );
  const pairs = await within(budgetMs, settled);
  state.stopped = true;
  return pairs === LATE || pairs === null
    ? { complete: false, pairs: [], written }
    : { complete: true, pairs, written };
}

/** The claim's commit with the move around it. */
export function claimKeep(deps: KeepDeps): ClaimKeep {
  const { store, evidence, report } = deps;
  const budgetMs = deps.budgetMs ?? KEEP_MOVE_BUDGET_MS;
  return {
    hostKept: (accountId, host) => store.hostKept(accountId, host),

    async keep(input) {
      const held = await store.evidenceOf(input.checkId);
      if (held === null) return 'not_unowned';
      const ended = ENDED.includes(held.status);
      // No copy without the account on the check's row: the row is what a later removal goes by.
      const noted =
        ended && (await store.noteCopy(input.checkId, input.accountId).catch(() => false));
      const copy = noted
        ? await copyEvidence(evidence, { ...input, batches: held.batches }, budgetMs)
        : NOT_COPIED;
      const outcome = await store
        .keep({
          checkId: input.checkId,
          accountId: input.accountId,
          ownerSeatId: input.ownerSeatId,
          schedule: input.schedule,
          pairs: copy.pairs,
        })
        .catch(async (error: unknown) => {
          await discardCopies(deps, input, copy.written);
          throw error;
        });
      if (outcome !== 'taken') {
        await discardCopies(deps, input, copy.written);
        return outcome;
      }
      if (copy.complete) {
        await evidence
          .remove(copy.pairs.map((p) => p.old_path))
          .catch(() => report('keep-evidence-remove-failed', { checkId: input.checkId }));
      } else if (ended) {
        report('keep-evidence-not-moved', { checkId: input.checkId });
      }
      return outcome;
    },
  };
}

/**
 * Removes what a claim copied when its commit was refused or threw, unless the caller's account
 * turns out to keep the site: then the commit happened (another call of the same claim won, or the
 * commit's answer was lost), and its stored paths may name these objects. A removal that fails, or
 * an owner that cannot be read, is reported with the account and the number of objects left; it
 * does not throw. The account stays in the check's `copied_for` either way.
 */
async function discardCopies(
  deps: KeepDeps,
  input: { checkId: string; accountId: string },
  written: readonly string[],
): Promise<void> {
  if (written.length === 0) return;
  try {
    const held = await deps.store.evidenceOf(input.checkId);
    if (held?.accountId === input.accountId) return;
    await deps.evidence.remove(written);
  } catch {
    deps.report('keep-evidence-discard-failed', {
      checkId: input.checkId,
      accountId: input.accountId,
      objects: String(written.length),
    });
  }
}

/** The names a check's objects can have, as paths in `accountId`'s directory of the check. */
export function copyPaths(
  check: Pick<KeptCheck, 'siteId' | 'checkId' | 'batches'>,
  accountId: string,
): string[] {
  const owner: EvidenceOwner = { accountId, siteId: check.siteId, checkId: check.checkId };
  return objectNames(check.batches).map((name) => evidencePath(owner, name));
}

/**
 * Moves what a kept check still holds under `anon/`: the same copy, then `move_check_paths`, then
 * the removal. 'nothing' when its `anon/` directory lists none of its objects; 'failed', with no
 * row and no `anon/` object changed, when the copy did not complete. A commit or a removal that
 * throws is the caller's to count; the next call starts again from the listing.
 *
 * First it removes, by name, the check's objects in the directory of each of `check.strays` other
 * than the keeper: the copies of a Keep that did not commit.
 */
export async function settleKeptCheck(
  deps: KeepDeps,
  check: KeptCheck,
): Promise<'moved' | 'nothing' | 'failed'> {
  for (const stray of check.strays ?? []) {
    if (stray !== check.accountId) await deps.evidence.remove(copyPaths(check, stray));
  }
  const copy = await copyEvidence(deps.evidence, check, deps.budgetMs ?? KEEP_MOVE_BUDGET_MS);
  if (!copy.complete) return 'failed';
  if (copy.pairs.length === 0) return 'nothing';
  await deps.store.movePaths(check.checkId, check.accountId, copy.pairs);
  await deps.evidence.remove(copy.pairs.map((p) => p.old_path));
  return 'moved';
}
