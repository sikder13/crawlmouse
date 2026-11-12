/**
 * An in-memory send ledger and transport, for tests and local proofs: nothing here can reach an
 * inbox. The ledger follows `claim_email_send`'s answers without its clock (a claimed key stays
 * `sending` until finished, so a second claim meanwhile is `busy`), in the SQL's order: done,
 * suppressed row, busy, an address suppressed since the key's first claim (recorded `failed` with
 * `suppressed`), exhausted, go. `suppressed` is read on every claim, so a test may add to it between
 * claims. The real rule, its lease and the two-transaction race are tested on Postgres
 * (__tests__/v2-028-mail.test.ts, scripts/db); `memory.test.ts` holds this ledger to the same answers
 * as that file, case by case.
 */
import type { Claim, ClaimInput, MailLedger } from './ledger';
import type { MailTransport, TransportResult } from './transport';
import { ACCOUNT_KINDS, type OutgoingMail } from './types';

export interface MemoryLedger extends MailLedger {
  rows: Map<
    string,
    { status: string; attempts: number; addressHash: string; errorCode?: string | null }
  >;
  claims: ClaimInput[];
}

export function memoryLedger(suppressed: ReadonlySet<string> = new Set()): MemoryLedger {
  const rows: MemoryLedger['rows'] = new Map();
  const claims: ClaimInput[] = [];
  return {
    rows,
    claims,
    async claim(c): Promise<Claim> {
      claims.push(c);
      const r = rows.get(c.key);
      if (!r) {
        const suppress = !ACCOUNT_KINDS.has(c.kind) && suppressed.has(c.addressHash);
        rows.set(c.key, {
          status: suppress ? 'suppressed' : 'sending',
          attempts: suppress ? 0 : 1,
          addressHash: c.addressHash,
        });
        return suppress ? { outcome: 'suppressed' } : { outcome: 'go', attempt: 1 };
      }
      if (r.status === 'sent') return { outcome: 'done' };
      if (r.status === 'suppressed') return { outcome: 'suppressed' };
      if (r.status === 'sending') return { outcome: 'busy' };
      if (!ACCOUNT_KINDS.has(c.kind) && suppressed.has(c.addressHash)) {
        r.status = 'failed';
        r.errorCode = 'suppressed';
        return { outcome: 'suppressed' };
      }
      if (r.attempts >= 3) {
        r.status = 'failed';
        return { outcome: 'exhausted' };
      }
      r.status = 'sending';
      r.attempts += 1;
      r.errorCode = null;
      return { outcome: 'go', attempt: r.attempts };
    },
    async finish(f) {
      const r = rows.get(f.key);
      if (!r || r.status !== 'sending') return false;
      r.status = f.status;
      r.errorCode = f.status === 'failed' ? f.errorCode : null;
      return true;
    },
  };
}

export interface MemoryTransport extends MailTransport {
  sent: OutgoingMail[];
}

/** Records each message; answers `result` (sent, by default). */
export function memoryTransport(
  result: TransportResult = { ok: true, providerId: 'mem_1' },
): MemoryTransport {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
      return result;
    },
  };
}
