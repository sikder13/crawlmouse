/**
 * The one erasure (D5): what `scripts/ops/erase-account.ts` runs on request and what the purge runs at
 * the end of a deletion's window. The rules are SQL (`erase_person_plan` and `erase_person_apply`,
 * migration 20261112000002 section B): the app reaches the database only through PostgREST, so a
 * rule written here as SQL text could not run in one transaction. This module is the sequence around
 * them, over ports, so the script (a direct connection) and the purge (the service-role client) run
 * the same steps:
 *
 *   plan → refuse if the plan refuses → remove the Storage objects the plan lists → apply (one
 *   transaction; it re-plans and rolls back unless each change touched its planned count) → delete
 *   the Auth user → sweep the Auth audit log again → read the counts back.
 *
 * Nothing is deleted when the plan refuses. A failure after `apply` (the Auth call) leaves the auth
 * user in place, and running the erasure again finishes it.
 */

export interface StorageObject {
  bucket: string;
  name: string;
}

/** What the plan function returns (`erase_person_plan`). */
export interface ErasurePlan {
  userId: string | null;
  /** Lower-cased addresses: the one given and those on the user's rows. */
  emails: string[];
  /** Accounts the person alone is seated on; deleted with everything that cascades from them. */
  accounts: string[];
  refusals: string[];
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

export interface ErasurePorts {
  plan(target: ErasureTarget): Promise<ErasurePlan>;
  /** Applies the plan's changes in one transaction; throws, changing nothing, on any mismatch. */
  apply(plan: ErasurePlan): Promise<void>;
  removeStorage(objects: readonly StorageObject[]): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  /** Deletes the Auth audit log's entries for the person; called again after the Auth delete. */
  sweepAuditLog(plan: ErasurePlan): Promise<void>;
}

export type ErasureResult =
  | { ok: true; before: ErasurePlan; after: ErasurePlan }
  | { ok: false; refusals: string[] };

export async function erasePerson(
  _ports: ErasurePorts,
  _target: ErasureTarget,
): Promise<ErasureResult> {
  throw new Error('erasePerson: built by workstream B');
}
