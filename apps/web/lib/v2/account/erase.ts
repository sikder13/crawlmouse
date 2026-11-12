/**
 * The one erasure (D5): what `scripts/ops/erase-account.ts` runs on request and what the purge runs at
 * the end of a deletion's window. The rules are SQL (`erase_person_plan` and `erase_person_apply`,
 * migration 20261112000002 section B): the app reaches the database only through PostgREST, so a
 * rule written here as SQL text could not run in one transaction. This module is the sequence around
 * them, over ports, so the script (a direct connection) and the purge (the service-role client) run
 * the same steps:
 *
 *   plan, with the mail rows found by address hash → refuse if the plan refuses for any reason but
 *   Storage objects → remove the Storage objects the plan lists → apply (one transaction; it re-plans
 *   and rolls back unless each change touched its planned count) → delete the sends to the person's
 *   address hashes → delete the Auth user → sweep the Auth audit log again → read the counts back.
 *
 * The send ledger names a recipient only by a peppered hash (CC-28, `lib/v2/mail/address-hash.ts`),
 * and the pepper is the app's, so SQL cannot find those rows by address: this sequence hashes the
 * plan's addresses and calls `erase_mail_records` (migration 20261113000001 section D). With no pepper
 * the plan refuses (`mail_pepper`) rather than leave those rows behind. The suppressions on the hashes
 * are counted and kept (owner ruling CC-28 Q2). A send of the person's own account to their own
 * address is counted twice in the plan, under `email_sends deleted (accounts)` and under
 * MAIL_SENDS_KEY, and deleted once, by the apply.
 *
 * Nothing is deleted when the plan refuses. A failure after `apply` (the Auth call) leaves the auth
 * user in place, and running the erasure again finishes it: the second plan finds no account left, so
 * its apply changes only what still holds the person's id or address.
 *
 * No Next or `server-only` import: the scripts package imports this file.
 */
import { hashMailAddress } from '../mail/address-hash';

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

/** The plan's key for the sends to the person's address hashes (`erase_mail_records`). */
export const MAIL_SENDS_KEY = 'email_sends deleted (address hash)';
/** The plan's key for the suppressions on those hashes, which are kept. */
export const MAIL_KEPT_KEY =
  'email_suppressions (peppered hashes; they stop the address being mailed)';
export const MAIL_PEPPER_REFUSAL =
  'TRIAL_LEDGER_PEPPER is not set, so the mail sent to the address cannot be found; set it first';

/** What `erase_mail_records` answers. */
export interface MailRecordCounts {
  email_sends: number;
  email_suppressions_kept: number;
}

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
  /** The mailer's pepper (`mailPepper`), or null when it is unset; the plan then refuses. */
  readonly mailPepper: string | null;
  /**
   * `erase_mail_records`: the sends to these address hashes and the suppressions on them, counted;
   * with `apply`, the sends are deleted (the suppressions never are).
   */
  mailRecords(hashes: readonly string[], apply: boolean): Promise<MailRecordCounts>;
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

/** The address hashes of the plan's addresses, one per address as `hashMailAddress` reads it. */
export function mailHashes(pepper: string, emails: readonly string[]): string[] {
  return [...new Set(emails.map((e) => hashMailAddress(pepper, e)))].sort();
}

/** The SQL plan with the rows found by address hash, or with the `mail_pepper` refusal. */
export async function planWithMail(
  ports: ErasurePorts,
  target: ErasureTarget,
): Promise<ErasurePlan> {
  return (await planBoth(ports, target)).plan;
}

async function planBoth(ports: ErasurePorts, target: ErasureTarget) {
  const sql = await ports.plan(target);
  if (ports.mailPepper === null) {
    return {
      sql,
      hashes: [],
      plan: {
        ...sql,
        refusals: [...sql.refusals, MAIL_PEPPER_REFUSAL],
        refusalCodes: [...sql.refusalCodes, 'mail_pepper'],
      },
    };
  }
  const hashes = mailHashes(ports.mailPepper, sql.emails);
  const found = await ports.mailRecords(hashes, false);
  return {
    sql,
    hashes,
    plan: {
      ...sql,
      counts: { ...sql.counts, [MAIL_SENDS_KEY]: found.email_sends },
      kept: { ...sql.kept, [MAIL_KEPT_KEY]: found.email_suppressions_kept },
    },
  };
}

export async function erasePerson(
  ports: ErasurePorts,
  target: ErasureTarget,
): Promise<ErasureResult> {
  const { sql, hashes, plan: before } = await planBoth(ports, target);
  if (blockingRefusals(before).length > 0) return { ok: false, refusals: before.refusals };
  if (before.storage.length > 0) await ports.removeStorage(before.storage);
  await ports.apply(target, sql);
  await ports.mailRecords(hashes, true);
  if (before.userId !== null) {
    await ports.deleteAuthUser(before.userId);
    await ports.sweepAuditLog(before);
  }
  const after = await ports.recount(before);
  const left = await ports.mailRecords(hashes, false);
  return {
    ok: true,
    before,
    after: { ...after, counts: { ...after.counts, [MAIL_SENDS_KEY]: left.email_sends } },
  };
}
