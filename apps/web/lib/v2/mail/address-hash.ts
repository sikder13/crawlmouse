/**
 * The address hash the send ledger and the suppression record hold (D1, D9): HMAC-SHA256 under the
 * trial ledger's pepper (`TRIAL_LEDGER_PEPPER`, `lib/auth/ledger.ts`), over `mail:` and the address
 * trimmed and lower-cased, so it never equals a ledger hash of another kind. Not the ledger's
 * `normalizeEmail`, which folds `+tag` and Gmail dots: a stranger who leaves `victim+x@` on a check's
 * notify form would then, by a bounce, suppress `victim@` (CC-28 security review r1, B2). No pepper,
 * no hash: the mailer then sends nothing (send.ts).
 */
import { createHmac } from 'node:crypto';
import { pepperFrom } from '../../auth/ledger';

type Env = Readonly<Record<string, string | undefined>>;

export function hashMailAddress(pepper: string, address: string): string {
  return createHmac('sha256', pepper).update(`mail:${address.trim().toLowerCase()}`).digest('hex');
}

/** The pepper the mailer hashes with, or null when it is unset or too short. */
export const mailPepper = (env: Env = process.env): string | null => pepperFrom(env);
