import { describe, expect, it } from 'vitest';
import { ADDRESS_RANGES, parseAddress } from './address-ranges.js';

const hex = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : Buffer.from(bytes).toString('hex');

describe('parseAddress reads text into bytes', () => {
  it.each([
    ['0.0.0.0', '00000000'],
    ['8.8.8.8', '08080808'],
    ['255.255.255.255', 'ffffffff'],
    ['192.168.1.10', 'c0a8010a'],
  ])('IPv4 %s is %s', (text, bytes) => {
    const parsed = parseAddress(text);
    expect(parsed?.family).toBe(4);
    expect(hex(parsed?.bytes)).toBe(bytes);
    expect(parsed?.zone).toBeNull();
  });

  it.each([
    ['::', '00000000000000000000000000000000'],
    ['::1', '00000000000000000000000000000001'],
    ['1::', '00010000000000000000000000000000'],
    ['fc::1', '00fc0000000000000000000000000001'],
    ['fc1::', '0fc10000000000000000000000000000'],
    ['FE80:0:0:0:0:0:0:0001', 'fe800000000000000000000000000001'],
    ['2606:4700:4700::1111', '26064700470000000000000000001111'],
    ['::ffff:10.0.0.1', '00000000000000000000ffff0a000001'],
    ['::ffff:0:a00:1', '0000000000000000ffff00000a000001'],
    ['1:2:3:4:5:6:7::', '00010002000300040005000600070000'],
    ['::1:2:3:4:5:6:7', '00000001000200030004000500060007'],
    ['1:2:3:4:5:6:1.2.3.4', '00010002000300040005000601020304'],
    ['0001:0002:0003:0004:0005:0006:0007:0008', '00010002000300040005000600070008'],
  ])('IPv6 %s is %s', (text, bytes) => {
    const parsed = parseAddress(text);
    expect(parsed?.family).toBe(6);
    expect(hex(parsed?.bytes)).toBe(bytes);
    expect(parsed?.zone).toBeNull();
  });

  it('keeps a zone apart from the bytes, so the guard can refuse it', () => {
    const parsed = parseAddress('fe80::1%eth0');
    expect(hex(parsed?.bytes)).toBe('fe800000000000000000000000000001');
    expect(parsed?.zone).toBe('eth0');
    expect(parseAddress('2606:4700:4700::1111%')?.zone).toBe('');
  });

  it.each([
    '',
    'not-an-ip',
    '1.2.3',
    '1.2.3.4.5',
    '01.2.3.4',
    '1.2.3.256',
    '1.2.3.4%eth0',
    ' 1.2.3.4',
    '1.2.3.4\n',
    '::ffff:1.2.3.256',
    '::ffff:01.2.3.4',
    '1:2:3:4:5:6:7:8::',
    '1:2:3:4:5:6::1.2.3.4',
    '1:2:3:4:5:6:7:1.2.3.4',
    '::1.2.3.4:5',
    '0::0::1',
    ':::1',
    '00000::1',
    '[::1]',
    '1:2:3:4:5:6:7',
    'g::1',
  ])('refuses to read %j', (text) => {
    expect(parseAddress(text)).toBeNull();
  });
});

describe('the table', () => {
  it('cites a source for each row', () => {
    for (const row of ADDRESS_RANGES) expect(row.source, row.cidr).toMatch(/RFC \d+|IANA/);
  });

  it('holds 14 IPv4 rows and 10 IPv6 rows', () => {
    expect(ADDRESS_RANGES.filter((r) => r.family === 4)).toHaveLength(14);
    expect(ADDRESS_RANGES.filter((r) => r.family === 6)).toHaveLength(10);
  });

  // The header comment's order rule, made true here: the only overlap in the table is between the
  // outside-2000::/3 row and the rows before it, and that row is last.
  it('has no two overlapping inside rows, and the one outside row is last', () => {
    const inside = ADDRESS_RANGES.filter((r) => r.match === 'inside');
    for (const a of inside) {
      for (const b of inside) {
        if (a === b || a.family !== b.family) continue;
        const bits = Math.min(a.length, b.length);
        expect(samePrefix(a.prefix, b.prefix, bits), `${a.cidr} overlaps ${b.cidr}`).toBe(false);
      }
    }
    const outside = ADDRESS_RANGES.filter((r) => r.match === 'outside');
    expect(outside.map((r) => r.cidr)).toEqual(['2000::/3']);
    expect(ADDRESS_RANGES.at(-1)?.cidr).toBe('2000::/3');
  });
});

function samePrefix(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> (i % 8);
    if ((a[i >> 3]! & mask) !== (b[i >> 3]! & mask)) return false;
  }
  return true;
}
