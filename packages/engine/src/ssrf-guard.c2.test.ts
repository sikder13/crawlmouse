import { describe, expect, it } from 'vitest';
import { createSafeLookup, isPrivateOrReservedIp } from './ssrf-guard.js';

// C-2 (v1 inventory) named six ranges the guard once missed. Each is refused here as written, as an
// IPv4 address carried in each IPv6 form the guard reads through, and in each spelling its parser
// accepts. The public addresses below were allowed before CC-37 and must stay allowed.

const C2_IPV4 = {
  '192.0.0.0/24': ['192.0.0.0', '192.0.0.8', '192.0.0.255'],
  '198.18.0.0/15': ['198.18.0.0', '198.18.200.7', '198.19.255.255'],
  '224.0.0.0/4': ['224.0.0.0', '232.1.2.3', '239.255.255.255'],
  '240.0.0.0/4': ['240.0.0.0', '250.1.2.3', '255.255.255.255'],
} as const;

const C2_IPV6 = {
  'fec0::/10': ['fec0::', 'fec0::1', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'],
  '100::/64': ['100::', '100::1', '100::ffff:ffff:ffff:ffff'],
} as const;

const hex = (v4: string) => {
  const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)] as const;
};

/** One IPv4 address in every IPv6 form that carries it, each in several spellings. */
function carried(v4: string): string[] {
  const [hi, lo] = hex(v4);
  const inverted = hex(
    v4
      .split('.')
      .map((n) => String(Number(n) ^ 0xff))
      .join('.'),
  );
  return [
    // IPv4-mapped
    `::ffff:${v4}`,
    `::FFFF:${v4}`,
    `::ffff:${hi}:${lo}`,
    `::FFFF:${hi.toUpperCase()}:${lo.toUpperCase()}`,
    `0:0:0:0:0:ffff:${hi}:${lo}`,
    `0000:0000:0000:0000:0000:ffff:${hi.padStart(4, '0')}:${lo.padStart(4, '0')}`,
    `0:0:0:0:0:ffff:${v4}`,
    // IPv4-translated
    `::ffff:0:${v4}`,
    `::ffff:0:${hi}:${lo}`,
    // NAT64 well-known prefix
    `64:ff9b::${v4}`,
    `64:FF9B::${hi}:${lo}`,
    // IPv4-compatible
    `::${v4}`,
    `::${hi}:${lo}`,
    // 6to4
    `2002:${hi}:${lo}::`,
    `2002:${hi}:${lo}::1`,
    // Teredo: the client address inverted in the last four bytes
    `2001:0:4136:e378:8000:63bf:${inverted[0]}:${inverted[1]}`,
  ];
}

/** An IPv6 address in each spelling the parser accepts: as listed, full width, upper case. */
function spelled(v6: string): string[] {
  const halves = v6.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length === 1
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  const full = groups.map((g) => g.padStart(4, '0')).join(':');
  return [v6, v6.toUpperCase(), full, full.toUpperCase(), groups.join(':')];
}

const refusedByLookup = (address: string) =>
  new Promise<boolean>((resolve) => {
    createSafeLookup(async () => [address])('probe.example', {}, (err) => resolve(err !== null));
  });

describe('C-2: the IPv4 ranges', () => {
  for (const [cidr, samples] of Object.entries(C2_IPV4)) {
    describe(cidr, () => {
      it.each(samples.map((s) => [s]))('refuses %s', (v4) => {
        expect(isPrivateOrReservedIp(v4)).toBe(true);
      });
      it.each(samples.flatMap((s) => carried(s).map((v6) => [v6])))(
        'refuses %s, which carries it',
        (v6) => {
          expect(isPrivateOrReservedIp(v6)).toBe(true);
        },
      );
      it.each(samples.map((s) => [s]))(
        'a hostname resolving to %s is not connected',
        async (v4) => {
          expect(await refusedByLookup(v4)).toBe(true);
          expect(await refusedByLookup(`::ffff:${v4}`)).toBe(true);
        },
      );
    });
  }
});

describe('C-2: the IPv6 ranges', () => {
  for (const [cidr, samples] of Object.entries(C2_IPV6)) {
    describe(cidr, () => {
      it.each(samples.flatMap((s) => spelled(s).map((v) => [v])))('refuses %s', (v6) => {
        expect(isPrivateOrReservedIp(v6)).toBe(true);
      });
      it.each(samples.map((s) => [s]))(
        'a hostname resolving to %s is not connected',
        async (v6) => {
          expect(await refusedByLookup(v6)).toBe(true);
        },
      );
    });
  }
});

// Public addresses the guard allowed on origin/main d8402ec0, each just outside a C-2 range where
// one is adjacent, and in the IPv6 forms that carry a public IPv4 address.
const ALLOWED_BEFORE = [
  '8.8.8.8',
  '1.1.1.1',
  '93.184.216.34',
  '191.255.255.255',
  '192.0.1.0',
  '198.17.255.255',
  '198.20.0.0',
  '223.255.255.255',
  '76.76.21.21',
  '::ffff:8.8.8.8',
  '::FFFF:808:808',
  '64:ff9b::8.8.8.8',
  '2002:808:808::1',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '2a00:1450:4001:82a::200e',
  '2600:1f18:aaaa::1',
];

describe('addresses allowed before C-2 stay allowed', () => {
  it.each(ALLOWED_BEFORE.map((a) => [a]))('%s', async (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(false);
    expect(await refusedByLookup(address)).toBe(false);
  });
});
