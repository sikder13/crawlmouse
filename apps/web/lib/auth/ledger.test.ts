import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  hashLedgerValue,
  ip24,
  ledgerDecision,
  ledgerValues,
  pepperFrom,
  slotKey,
  twelveMonthsBefore,
  type PriorLedgerRow,
} from './ledger';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const row = (kind: PriorLedgerRow['kind'], at: Date): PriorLedgerRow => ({ kind, created_at: at });

describe('ledgerDecision: the D4 rule as amended (email 12 months; device and IP per SECURITY §5.3)', () => {
  it('allows when nothing matches', () => {
    expect(ledgerDecision([], NOW)).toEqual({ deny: false, hits: [] });
  });

  it('denies on one email row younger than 12 months, and allows on one exactly 12 months old', () => {
    expect(ledgerDecision([row('email', ago(DAY))], NOW).deny).toBe(true);
    expect(
      ledgerDecision([row('email', new Date(twelveMonthsBefore(NOW).getTime() + 1))], NOW).deny,
    ).toBe(true);
    expect(ledgerDecision([row('email', twelveMonthsBefore(NOW))], NOW).deny).toBe(false);
  });

  it('12 months is calendar months, clamped at the month end', () => {
    expect(twelveMonthsBefore(new Date('2028-02-29T10:00:00.000Z')).toISOString()).toBe(
      '2027-02-28T10:00:00.000Z',
    );
    expect(twelveMonthsBefore(NOW).toISOString()).toBe('2025-11-05T12:00:00.000Z');
  });

  it('a device denies on the third trial in 30 days: two prior rows deny, one does not', () => {
    expect(ledgerDecision([row('device', ago(DAY))], NOW).deny).toBe(false);
    expect(ledgerDecision([row('device', ago(DAY)), row('device', ago(29 * DAY))], NOW)).toEqual({
      deny: true,
      hits: ['device'],
    });
    // A row older than 30 days does not count.
    expect(ledgerDecision([row('device', ago(DAY)), row('device', ago(30 * DAY))], NOW).deny).toBe(
      false,
    );
  });

  it('IP alone never denies, however many rows it has', () => {
    const many = Array.from({ length: 50 }, (_, i) => row('ip24', ago(i * 1000)));
    expect(ledgerDecision(many, NOW).deny).toBe(false);
  });

  it('IP at its threshold denies together with a device seen in the same 30 days', () => {
    const ip = [row('ip24', ago(DAY)), row('ip24', ago(2 * DAY))];
    expect(ledgerDecision([...ip, row('device', ago(3 * DAY))], NOW)).toEqual({
      deny: true,
      hits: ['ip24'],
    });
    expect(ledgerDecision([row('ip24', ago(DAY)), row('device', ago(3 * DAY))], NOW).deny).toBe(
      false,
    );
  });

  it('rows of the kinds CC-04 owns are not read here', () => {
    const rows = [
      { kind: 'hostname', created_at: ago(DAY) },
      { kind: 'card_fingerprint', created_at: ago(DAY) },
    ] as unknown as PriorLedgerRow[];
    expect(ledgerDecision(rows, NOW).deny).toBe(false);
  });

  it('a future-dated row counts as recent (clock skew must not open a hole)', () => {
    expect(ledgerDecision([row('email', new Date(NOW.getTime() + DAY))], NOW).deny).toBe(true);
  });
});

describe('hashLedgerValue', () => {
  it('is HMAC-SHA256 of kind:value under the pepper, as 64 lowercase hex', () => {
    const expected = createHmac('sha256', 'p'.repeat(32)).update('email:a@b.co').digest('hex');
    expect(hashLedgerValue('p'.repeat(32), 'email', 'a@b.co')).toBe(expected);
  });

  it('differs per pepper and per kind, and always matches the column check', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 32 }),
        fc.string({ minLength: 32 }),
        fc.string(),
        (p1, p2, v) => {
          fc.pre(p1 !== p2);
          const h = hashLedgerValue(p1, 'device', v);
          expect(h).toMatch(/^[0-9a-f]{64}$/);
          expect(h).not.toBe(hashLedgerValue(p2, 'device', v));
          expect(h).not.toBe(hashLedgerValue(p1, 'ip24', v));
        },
      ),
    );
  });
});

describe('slotKey', () => {
  it('names the slot by a separate HMAC, so it never equals the ledger hash it guards', () => {
    const pepper = 'p'.repeat(32);
    const hash = hashLedgerValue(pepper, 'email', 'a@b.co');
    const key = slotKey(pepper, 'email', hash);
    expect(key).toMatch(/^trial:email:[0-9a-f]{64}$/);
    expect(key).not.toContain(hash);
    expect(slotKey(pepper, 'device', hash)).not.toBe(key);
  });
});

describe('pepperFrom: the ledger fails closed without a usable pepper', () => {
  it('is null when unset, empty, blank or shorter than 32 characters', () => {
    for (const v of [undefined, '', '   ', 'short']) {
      expect(pepperFrom({ TRIAL_LEDGER_PEPPER: v })).toBeNull();
    }
    expect(pepperFrom({ TRIAL_LEDGER_PEPPER: ` ${'x'.repeat(32)} ` })).toBe('x'.repeat(32));
  });
});

describe('ip24', () => {
  it('is the /24 of an IPv4 address and the /48 of an IPv6 address', () => {
    expect(ip24('203.0.113.77')).toBe('203.0.113.0/24');
    expect(ip24('2001:db8:abcd:12::1')).toBe('2001:0db8:abcd::/48');
    expect(ip24('2001:db8::1')).toBe('2001:0db8:0000::/48');
    expect(ip24('::ffff:203.0.113.9')).toBe('203.0.113.0/24');
  });

  it('is null for an unknown or malformed address', () => {
    for (const v of ['unknown', '', '999.1.1.1', 'not-an-ip', '1.2.3']) expect(ip24(v)).toBeNull();
  });
});

describe('ledgerValues', () => {
  it('names email always, device and IP when known', () => {
    expect(ledgerValues({ email: 'A.B+x@Gmail.com', device: 'dev1', ip: '198.51.100.4' })).toEqual([
      { kind: 'email', value: 'ab@gmail.com' },
      { kind: 'device', value: 'dev1' },
      { kind: 'ip24', value: '198.51.100.0/24' },
    ]);
    expect(ledgerValues({ email: 'a@b.co', device: null, ip: 'unknown' })).toEqual([
      { kind: 'email', value: 'a@b.co' },
    ]);
  });
});
