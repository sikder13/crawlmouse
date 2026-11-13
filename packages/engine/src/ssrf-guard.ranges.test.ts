import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { createSafeLookup, isPrivateOrReservedIp, validateUrlOrThrow } from './ssrf-guard.js';

// One named test per row of ADDRESS_RANGES (address-ranges.ts). A row that refuses is tested inside
// its prefix and just outside it; a row that reads an embedded IPv4 address is tested with a private
// and a public one, and, where it lies outside 2000::/3, just outside its prefix too: there a prefix
// read too wide would allow what the last row refuses.

const refuses = (...ips: string[]) => {
  for (const ip of ips) expect(isPrivateOrReservedIp(ip), `${ip} should be refused`).toBe(true);
};
const allows = (...ips: string[]) => {
  for (const ip of ips) expect(isPrivateOrReservedIp(ip), `${ip} should be allowed`).toBe(false);
};

describe('IPv4 rows', () => {
  it('0.0.0.0/8', () => {
    refuses('0.0.0.0', '0.0.0.1', '0.255.255.255');
    allows('1.0.0.0');
  });
  it('10.0.0.0/8', () => {
    refuses('10.0.0.0', '10.255.255.255');
    allows('9.255.255.255', '11.0.0.0');
  });
  it('100.64.0.0/10', () => {
    refuses('100.64.0.0', '100.100.100.200', '100.127.255.255');
    allows('100.63.255.255', '100.128.0.0');
  });
  it('127.0.0.0/8', () => {
    refuses('127.0.0.1', '127.255.255.255');
    allows('126.255.255.255', '128.0.0.0');
  });
  it('169.254.0.0/16', () => {
    refuses('169.254.0.0', '169.254.169.254', '169.254.255.255');
    allows('169.253.255.255', '169.255.0.0');
  });
  it('172.16.0.0/12', () => {
    refuses('172.16.0.0', '172.31.255.255');
    allows('172.15.255.255', '172.32.0.0');
  });
  it('192.0.0.0/24', () => {
    refuses('192.0.0.0', '192.0.0.255');
    allows('191.255.255.255', '192.0.1.0');
  });
  it('192.0.2.0/24', () => {
    refuses('192.0.2.0', '192.0.2.255');
    allows('192.0.1.255', '192.0.3.0');
  });
  it('192.168.0.0/16', () => {
    refuses('192.168.0.0', '192.168.255.255');
    allows('192.167.255.255', '192.169.0.0');
  });
  it('198.18.0.0/15', () => {
    refuses('198.18.0.0', '198.19.255.255');
    allows('198.17.255.255', '198.20.0.0');
  });
  it('198.51.100.0/24', () => {
    refuses('198.51.100.0', '198.51.100.255');
    allows('198.51.99.255', '198.51.101.0');
  });
  it('203.0.113.0/24', () => {
    refuses('203.0.113.0', '203.0.113.255');
    allows('203.0.112.255', '203.0.114.0');
  });
  it('224.0.0.0/4', () => {
    refuses('224.0.0.0', '239.255.255.255');
    allows('223.255.255.255');
  });
  it('240.0.0.0/4, which holds the limited broadcast address 255.255.255.255', () => {
    refuses('240.0.0.0', '255.255.255.254', '255.255.255.255');
  });
  it('public IPv4 addresses are allowed', () => {
    allows('8.8.8.8', '1.1.1.1', '93.184.216.34');
  });
});

describe('IPv6 rows that read an embedded IPv4 address', () => {
  it('::ffff:0:0/96 (IPv4-mapped)', () => {
    refuses('::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:7f00:1', '::FFFF:169.254.169.254');
    allows('::ffff:8.8.8.8', '::ffff:808:808');
    refuses('::fffe:808:808');
  });
  it('::ffff:0:0:0/96 (IPv4-translated)', () => {
    refuses('::ffff:0:a00:1', '::ffff:0:127.0.0.1', '0:0:0:0:ffff:0:a9fe:a9fe');
    allows('::ffff:0:808:808', '::ffff:0:8.8.8.8');
    refuses('::ffff:1:808:808');
  });
  it('64:ff9b::/96 (NAT64)', () => {
    refuses('64:ff9b::5', '64:ff9b::a00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::127.0.0.1');
    allows('64:ff9b::808:808', '64:ff9b::8.8.8.8', '64:ff9b::8080:8080');
    refuses('64:ff9b::1:808:808', '64:ff9b::1:0:808:808');
  });
  it('::/96 (IPv4-compatible), where :: and ::1 embed 0.0.0.0 and 0.0.0.1', () => {
    refuses('::', '::1', '::a00:1', '::10.0.0.1', '0:0:0:0:0:0:0:1');
    allows('::808:808', '::8.8.8.8');
    refuses('::1:808:808');
  });
  it('2002::/16 (6to4), the IPv4 address in bytes 2 to 5', () => {
    refuses('2002:7f00::1', '2002:a9fe:a9fe::', '2002:a00:1::');
    // 10.80.80.80 inside, and a public address at every other offset of the same bytes.
    refuses('2002:a50:5050:5050:5050:5050:5050:5050');
    allows('2002:808:808::1', '2002:808:808:a00:1::');
  });
  it('2001::/32 (Teredo), the client address in bytes 12 to 15, inverted', () => {
    // Client 127.0.0.1, stored as 80ff:fffe.
    refuses('2001:0:4136:e378:8000:63bf:80ff:fffe');
    // Client 10.0.0.1, stored as f5ff:fffe.
    refuses('2001:0:4136:e378:8000:63bf:f5ff:fffe');
    // Client 127.0.0.1 behind server 192.0.0.1: the server's first bit is set, so a prefix read
    // longer than /32 would miss this one.
    refuses('2001:0:c000:1:8000:63bf:80ff:fffe');
    // Client 8.8.8.8, stored as f7f7:f7f7.
    allows('2001:0:4136:e378:8000:63bf:f7f7:f7f7');
  });
});

describe('IPv6 rows that refuse', () => {
  it('2001:db8::/32 (documentation)', () => {
    refuses('2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff');
    allows('2001:db7:ffff::1', '2001:db9::1');
  });
  it('2001:2::/48 (benchmarking)', () => {
    refuses('2001:2::', '2001:2:0:ffff::1');
    allows('2001:1:ffff::1', '2001:2:1::1');
  });
  it('3fff::/20 (documentation)', () => {
    refuses('3fff::1', '3fff:fff:ffff::1');
    allows('3ffe:ffff::1', '3fff:1000::1');
  });
  it('outside 2000::/3: everything that is not global unicast', () => {
    refuses(
      'fe80::1',
      'febf::1',
      'fec0::1',
      'fc00::1',
      'fd00::1',
      'ff02::1',
      '100::1',
      '64:ff9b:1::a00:1',
      'fc::1',
      'fc1::',
      '4000::1',
      '5f00::1',
      '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    );
    allows('2000::1', '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  });
  it('public IPv6 addresses are allowed', () => {
    allows('2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::1');
  });
});

describe('the gates before the table', () => {
  it('refuses an address that carries a zone, private or public', () => {
    refuses('fe80::1%eth0', '2606:4700:4700::1111%eth0', '2606:4700:4700::1111%25en0');
  });
  it.each(['', 'not-an-ip', '999.999.999.999', '01.2.3.4', '[::1]', '1:2:3:4:5:6:7:8::', '::1 '])(
    'refuses text that is not an address: %j',
    (text) => {
      refuses(text);
    },
  );
});

function runLookup(
  lookup: ReturnType<typeof createSafeLookup>,
  hostname: string,
): Promise<{ address: string | LookupAddress[]; family?: number }> {
  return new Promise((resolve, reject) => {
    lookup(hostname, {}, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

// Addresses the earlier text rule allowed. The messages are the ones the worker classifies
// (packages/worker/src/fetch/fetcher.ts), so they are asserted whole.
const NEWLY_REFUSED = [
  '64:ff9b::5',
  '2002:7f00::1',
  '2001:0:4136:e378:8000:63bf:80ff:fffe',
  '::ffff:0:a00:1',
  '192.0.2.1',
  '255.255.255.255',
];

describe('the callers refuse the new vectors with their unchanged messages', () => {
  it.each(NEWLY_REFUSED)('validateUrlOrThrow refuses a name resolving to %s', async (addr) => {
    await expect(
      validateUrlOrThrow('https://evil.example/', { resolver: async () => [addr] }),
    ).rejects.toMatchObject({
      message: `URL resolves to private or reserved IP (${addr}): https://evil.example/`,
    });
  });

  it.each(NEWLY_REFUSED)('createSafeLookup refuses a name resolving to %s', async (addr) => {
    const lookup = createSafeLookup(async () => ['8.8.8.8', addr]);
    await expect(runLookup(lookup, 'evil.example')).rejects.toMatchObject({
      message: `Blocked connection to private or reserved IP (${addr}) for evil.example`,
    });
  });
});
