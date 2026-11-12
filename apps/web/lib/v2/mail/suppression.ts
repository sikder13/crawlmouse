/**
 * Suppression from Resend's webhook (D7): a hard bounce (`email.bounced` whose `bounce.type` is
 * `Permanent`) or a complaint (`email.complained`) records the address's hash with
 * `record_email_suppression`, and `claim_email_send` then answers `suppressed` for every kind that is
 * not account mail. The address is hashed as the send ledger hashes it (`hashMailAddress`: the address
 * as written, lower-cased, so a bounce on `x+tag@` suppresses that address only) and is neither stored
 * nor logged here. Resend's payload, read
 * 2026-11-12 (resend.com/docs/webhooks/emails/bounced, /complained): `data.to` is an array of the
 * affected recipients; a bounce's `data.bounce.type` is e.g. `Permanent` or `Temporary`.
 */
import { hashMailAddress } from './address-hash';
import { isPlainAddress } from './headers';

export type SuppressionReason = 'hard_bounce' | 'complaint';

export interface Suppression {
  reason: SuppressionReason;
  addresses: string[];
}

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string'
      ? [v]
      : [];

/** What a webhook payload suppresses, or null for any other event (a soft bounce among them). */
export function suppressionOf(payload: unknown): Suppression | null {
  const p = (payload ?? {}) as {
    type?: unknown;
    data?: { to?: unknown; email?: unknown; bounce?: { type?: unknown } };
  };
  let reason: SuppressionReason;
  if (p.type === 'email.complained') reason = 'complaint';
  else if (
    p.type === 'email.bounced' &&
    String(p.data?.bounce?.type ?? '').toLowerCase() === 'permanent'
  )
    reason = 'hard_bounce';
  else return null;
  const addresses = [...new Set([...strings(p.data?.to), ...strings(p.data?.email)])]
    .map((a) => a.trim())
    .filter(isPlainAddress);
  return addresses.length > 0 ? { reason, addresses } : null;
}

export interface SuppressionDeps {
  pepper: string | null;
  /** `record_email_suppression`; throws on a database error, so the webhook answers 500 and Resend retries. */
  record(hash: string, reason: SuppressionReason, at: Date): Promise<void>;
  now(): Date;
  log(event: 'mail.suppression_unhashed', fields: Readonly<Record<string, string | number>>): void;
}

/** Records what the payload suppresses; the number of addresses recorded. */
export async function recordSuppressions(payload: unknown, deps: SuppressionDeps): Promise<number> {
  const s = suppressionOf(payload);
  if (s === null) return 0;
  if (deps.pepper === null) {
    // No pepper, no hash: the mailer sends nothing either (send.ts), but this record is lost.
    deps.log('mail.suppression_unhashed', { reason: s.reason, count: s.addresses.length });
    return 0;
  }
  for (const address of s.addresses) {
    await deps.record(hashMailAddress(deps.pepper, address), s.reason, deps.now());
  }
  return s.addresses.length;
}
