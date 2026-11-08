import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { hashLedgerValue, ip24, ledgerValues, pepperFrom } from './ledger';

// The ledger rule itself is SQL since 006c; its tests are __tests__/v2-006c-trial-function.test.ts.

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
    expect(ip24('::ffff:cb00:7109')).toBe('203.0.113.0/24');
    expect(ip24('::ffff:cb00:7109')).toBe(ip24('203.0.113.9'));
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
