import { describe, expect, it } from 'vitest';
import { LEDGER_CASES } from './ledger-cases';
import { memoryLedger } from './memory';

const NOW = new Date('2026-11-13T10:00:00.000Z');
const HASH = 'a'.repeat(64);

describe('memoryLedger answers as claim_email_send does (ledger-cases.ts, also run on the SQL)', () => {
  it.each(LEDGER_CASES.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    const suppressed = new Set<string>();
    const ledger = memoryLedger(suppressed);
    const key = 'case:k';
    for (const step of c.steps) {
      if ('suppress' in step) suppressed.add(HASH);
      else if ('claim' in step) {
        const kind = step.kind ?? c.kind;
        expect(
          await ledger.claim({ key, kind, addressHash: HASH, accountId: null, now: NOW }),
        ).toEqual(step.claim);
      } else {
        expect(
          await ledger.finish({
            key,
            status: step.finish,
            providerId: step.finish === 'sent' ? 'm1' : null,
            errorCode: step.code ?? null,
            now: NOW,
          }),
        ).toBe(step.answer);
      }
    }
    const row = ledger.rows.get(key)!;
    expect({ status: row.status, errorCode: row.errorCode ?? null }).toEqual(c.row);
  });
});
