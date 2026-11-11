/**
 * The one erasure (D5): what `scripts/ops/erase-account.ts` runs on request and what the purge runs at
 * the end of a deletion's window. The rules are SQL (`erase_person_plan` and `erase_person_apply`,
 * migration 20261112000002 section B): the app reaches the database only through PostgREST, so a
 * rule written here as SQL text could not run in one transaction. This module is the sequence around
 * them, over ports, so the script (a direct connection) and the purge (the service-role client) run
 * the same steps:
 *
 *   plan → refuse if the plan refuses for any reason but Storage objects → remove the Storage objects
 *   the plan lists → apply (one transaction; it re-plans and rolls back unless each change touched its
 *   planned count) → delete the Auth user → sweep the Auth audit log again → read the counts back.
 *
 * Nothing is deleted when the plan refuses. A failure after `apply` (the Auth call) leaves the auth
 * user in place, and running the erasure again finishes it: the second plan finds no account left, so
 * its apply changes only what still holds the person's id or address.
 *
 * No Next or `server-only` import: the scripts package imports this file.
 */

export interface StorageObject {
  bucket: string;
  name: string;
}

/** What the plan function returns (`erase_person_plan`). */
export interface ErasurePlan {
  userId: string | null;
  /** Lower-cased addresses: the one given, those on the user's rows and `users.previous_emails`. */
  emails: string[];
  /** Accounts the person alone is seated on; deleted with everything that cascades from them. */
  accounts: string[];
  refusals: string[];
  /**
   * Each refusal's code, in the same order: `storage` (the plan lists Storage objects, which this
   * sequence removes), and the codes `erase_person_refusals` gives.
   */
  refusalCodes: string[];
  /** Rows the erasure deletes or changes, by `table.action`. */
  counts: Record<string, number>;
  /** Rows deliberately kept, by `table.reason`. */
  kept: Record<string, number>;
  storage: StorageObject[];
  /** Public reports the person minted, which stay (minted_by is set null). */
  mintedReports: string[];
}

export interface ErasureTarget {
  email?: string;
  userId?: string;
}

/** The counts read again after an erasure, with the erased user id, addresses and accounts. */
export interface AfterCounts {
  counts: Record<string, number>;
  storage: StorageObject[];
}

/** A redacted takedown requester (the rule `takedown_requests redacted (closed)` writes it). */
export const REDACTED_EMAIL = 'redacted@erased.invalid';

export interface ErasurePorts {
  plan(target: ErasureTarget): Promise<ErasurePlan>;
  /**
   * Applies the erasure of `target` in one transaction (`erase_person_apply`, which plans again);
   * throws, changing nothing, on a refusal or a count that moved. `expected` is the plan read first.
   */
  apply(target: ErasureTarget, expected: ErasurePlan): Promise<void>;
  removeStorage(objects: readonly StorageObject[]): Promise<void>;
  /** Deletes the Auth user; an Auth user already gone is success. */
  deleteAuthUser(userId: string): Promise<void>;
  /** Deletes the Auth audit log's entries for the person; called again after the Auth delete. */
  sweepAuditLog(plan: ErasurePlan): Promise<void>;
  /** Every count again, read with the plan's user id, addresses and accounts. */
  recount(plan: ErasurePlan): Promise<AfterCounts>;
}

export type ErasureResult =
  | { ok: true; before: ErasurePlan; after: AfterCounts }
  | { ok: false; refusals: string[] };

/**
 * The plan's refusals other than its Storage one, told apart by code: this sequence removes the
 * objects, and any other refusal stops the erasure.
 */
export function blockingRefusals(plan: ErasurePlan): string[] {
  return plan.refusals.filter((_, i) => plan.refusalCodes[i] !== 'storage');
}

export async function erasePerson(
  ports: ErasurePorts,
  target: ErasureTarget,
): Promise<ErasureResult> {
  const before = await ports.plan(target);
  if (blockingRefusals(before).length > 0) return { ok: false, refusals: before.refusals };
  if (before.storage.length > 0) await ports.removeStorage(before.storage);
  await ports.apply(target, before);
  if (before.userId !== null) {
    await ports.deleteAuthUser(before.userId);
    await ports.sweepAuditLog(before);
  }
  return { ok: true, before, after: await ports.recount(before) };
}
